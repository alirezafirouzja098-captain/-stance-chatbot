-- ============================================================
-- SUPABASE BACKEND SCHEMA — Stance Chatbot + News RAG
-- Run this entire file in the Supabase SQL Editor (in order).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- STEP 1: Enable pgvector extension for vector similarity
-- ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;


-- ────────────────────────────────────────────────────────────
-- STEP 2: Chat sessions (groups messages into threads)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chats (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title       TEXT NOT NULL DEFAULT 'New Chat',
  created_at  TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

-- Index for fast user-scoped queries
CREATE INDEX IF NOT EXISTS idx_chats_user_id ON public.chats (user_id);

-- RLS
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own chats"
  ON public.chats FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own chats"
  ON public.chats FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own chats"
  ON public.chats FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own chats"
  ON public.chats FOR DELETE
  USING (auth.uid() = user_id);


-- ────────────────────────────────────────────────────────────
-- STEP 3: Messages within a chat session
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  chat_id     UUID REFERENCES public.chats(id) ON DELETE CASCADE NOT NULL,
  role        VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

-- Index for fetching messages by chat in chronological order
CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON public.messages (chat_id, created_at ASC);

-- RLS (messages inherit access through their parent chat)
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read messages in their own chats"
  ON public.messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.chats
      WHERE chats.id = messages.chat_id
        AND chats.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert messages in their own chats"
  ON public.messages FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.chats
      WHERE chats.id = messages.chat_id
        AND chats.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete messages in their own chats"
  ON public.messages FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.chats
      WHERE chats.id = messages.chat_id
        AND chats.user_id = auth.uid()
    )
  );


-- ────────────────────────────────────────────────────────────
-- STEP 4: News article embeddings for RAG vector search
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.news_embeddings (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title           TEXT NOT NULL,
  content         TEXT NOT NULL,
  source          TEXT NOT NULL,
  url             TEXT NOT NULL,
  published_date  TIMESTAMPTZ,
  category        TEXT DEFAULT 'general',
  chunk_index     INTEGER DEFAULT 0,
  embedding       vector(768) NOT NULL,   -- nomic-embed-text produces 768-dim vectors
  created_at      TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

-- Unique constraint to prevent duplicate article chunks
CREATE UNIQUE INDEX IF NOT EXISTS idx_news_url_chunk
  ON public.news_embeddings (url, chunk_index);

-- HNSW index for fast approximate nearest neighbor search
CREATE INDEX IF NOT EXISTS idx_news_embedding_hnsw
  ON public.news_embeddings
  USING hnsw (embedding vector_cosine_ops);

-- Indexes for metadata filtering
CREATE INDEX IF NOT EXISTS idx_news_source ON public.news_embeddings (source);
CREATE INDEX IF NOT EXISTS idx_news_published ON public.news_embeddings (published_date);

-- RLS: news embeddings are public-readable by any authenticated user
ALTER TABLE public.news_embeddings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read news embeddings"
  ON public.news_embeddings FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only the service_role key (used by the Python backend) can write
CREATE POLICY "Service role can manage news embeddings"
  ON public.news_embeddings FOR ALL
  USING (auth.role() = 'service_role');


-- ────────────────────────────────────────────────────────────
-- STEP 5: RPC function for cosine similarity search
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_news_embeddings(
  query_embedding vector(768),
  match_count     INT DEFAULT 10,
  filter_source   TEXT DEFAULT NULL,
  filter_days     INT DEFAULT NULL
)
RETURNS TABLE (
  id              UUID,
  title           TEXT,
  content         TEXT,
  source          TEXT,
  url             TEXT,
  published_date  TIMESTAMPTZ,
  category        TEXT,
  chunk_index     INTEGER,
  similarity      FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    ne.id,
    ne.title,
    ne.content,
    ne.source,
    ne.url,
    ne.published_date,
    ne.category,
    ne.chunk_index,
    1 - (ne.embedding <=> query_embedding) AS similarity
  FROM public.news_embeddings ne
  WHERE
    (filter_source IS NULL OR ne.source = filter_source)
    AND
    (filter_days IS NULL OR ne.published_date >= now() - (filter_days || ' days')::INTERVAL)
  ORDER BY ne.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


-- ────────────────────────────────────────────────────────────
-- STEP 6: Auto-update chats.updated_at on new messages
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_chat_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.chats
  SET updated_at = now()
  WHERE id = NEW.chat_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_message_insert
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION update_chat_timestamp();


-- ────────────────────────────────────────────────────────────
-- STEP 7: Keep the existing analyses table (backward compat)
-- ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.analyses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  link text NOT NULL,
  source varchar(50) NOT NULL,
  content text NOT NULL,
  summary text NOT NULL,
  perspectives jsonb NOT NULL,
  created_at TIMESTAMPTZ DEFAULT timezone('utc', now()) NOT NULL
);

ALTER TABLE public.analyses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'analyses' AND policyname = 'Allow users to read their own analyses'
  ) THEN
    CREATE POLICY "Allow users to read their own analyses" ON public.analyses
      FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'analyses' AND policyname = 'Allow users to insert their own analyses'
  ) THEN
    CREATE POLICY "Allow users to insert their own analyses" ON public.analyses
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
