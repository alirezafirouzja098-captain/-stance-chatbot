/**
 * POST /api/chat — RAG-augmented chat endpoint with Supabase persistence.
 *
 * Flow:
 * 1. Save the user's message to Supabase `messages` table.
 * 2. Embed the user's message via Ollama nomic-embed-text.
 * 3. Search Supabase pgvector for relevant news context (RAG).
 * 4. Fetch recent conversation history from Supabase.
 * 5. Build Ollama prompt with system instructions + RAG context + history.
 * 6. Stream Ollama response back as SSE events.
 * 7. Save the assistant's complete response to Supabase.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const ollamaHost = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const chatModel = process.env.OLLAMA_MODEL || 'llama3.2:1b';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { chatId, message, userId } = body;

    if (!chatId || !message || !userId) {
      return NextResponse.json(
        { error: 'chatId, message, and userId are required' },
        { status: 400 }
      );
    }

    // Create an authenticated Supabase client using the caller's JWT
    const authHeader = req.headers.get('Authorization');
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: authHeader ? { Authorization: authHeader } : {},
      },
    });

    // ── Step 1: Save the user's message ──────────────────────
    await supabase.from('messages').insert({
      chat_id: chatId,
      role: 'user',
      content: message,
    });

    // ── Step 2 & 3: Embed + RAG vector search ────────────────
    let ragContext = '';
    try {
      const embedRes = await fetch(`${ollamaHost}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'nomic-embed-text',
          input: [message],
        }),
      });

      if (embedRes.ok) {
        const embedData = await embedRes.json();
        const queryVector = embedData.embeddings?.[0];

        if (queryVector) {
          const { data: matches } = await supabase.rpc(
            'match_news_embeddings',
            {
              query_embedding: queryVector,
              match_count: 5,
              filter_source: null,
              filter_days: null,
            }
          );

          if (matches && matches.length > 0) {
            ragContext = matches
              .map(
                (m: any, i: number) =>
                  `[Source ${i + 1}] (${m.source} — ${m.published_date})\nTitle: ${m.title}\n${m.content}`
              )
              .join('\n---\n');
          }
        }
      }
    } catch (err) {
      console.warn('RAG embedding/search skipped (Ollama or Supabase pgvector unavailable):', err);
    }

    // ── Step 4: Fetch recent conversation history ────────────
    const { data: history } = await supabase
      .from('messages')
      .select('role, content')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .limit(20);

    // ── Step 5: Build Ollama messages ────────────────────────
    const systemPrompt = ragContext
      ? [
          'You are a professional news analyst assistant. Answer questions using the provided news context.',
          'Rules:',
          '1. Base your answer on the provided context. Do NOT fabricate information.',
          '2. Be concise and informative. Cite sources as [Source N] inline.',
          '3. If the context does not cover the question, say so clearly.',
          '',
          '## News Context',
          ragContext,
        ].join('\n')
      : 'You are a helpful assistant that provides multi-perspective stance analysis on topics and links. Be concise, objective, and informative.';

    const ollamaMessages = [
      { role: 'system', content: systemPrompt },
      ...(history || []).map((m: any) => ({
        role: m.role,
        content: m.content,
      })),
    ];

    // ── Step 6: Stream response from Ollama ──────────────────
    const ollamaRes = await fetch(`${ollamaHost}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: chatModel,
        messages: ollamaMessages,
        stream: true,
        options: {
          temperature: 0.4,
          num_predict: 700,
          num_ctx: 2048,
        },
      }),
    });

    if (!ollamaRes.ok) {
      throw new Error(`Ollama ${ollamaRes.status}: ${ollamaRes.statusText}`);
    }

    // SSE stream: parse Ollama NDJSON → forward tokens → save final
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        const reader = ollamaRes.body?.getReader();
        if (!reader) {
          controller.close();
          return;
        }

        const decoder = new TextDecoder();
        let fullText = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            for (const line of chunk.split('\n')) {
              if (!line.trim()) continue;
              try {
                const parsed = JSON.parse(line);
                const token = parsed.message?.content || '';
                if (token) {
                  fullText += token;
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ token, done: false })}\n\n`
                    )
                  );
                }
                if (parsed.done) {
                  controller.enqueue(
                    encoder.encode(
                      `data: ${JSON.stringify({ token: '', done: true, full: fullText })}\n\n`
                    )
                  );
                }
              } catch {
                /* skip partial JSON lines */
              }
            }
          }

          // ── Step 7: Save assistant's complete response ──────
          if (fullText) {
            await supabase.from('messages').insert({
              chat_id: chatId,
              role: 'assistant',
              content: fullText,
            });
          }
        } catch (err) {
          controller.error(err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: any) {
    console.error('Chat API Error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
