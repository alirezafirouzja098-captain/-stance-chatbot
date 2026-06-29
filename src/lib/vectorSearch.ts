/**
 * Vector similarity search via the Supabase `match_news_embeddings` RPC.
 *
 * This calls the PostgreSQL function defined in supabase_schema.sql (Step 5)
 * which performs cosine similarity search over the news_embeddings table
 * using the pgvector HNSW index.
 */

import { supabase, isSupabaseConfigured, type NewsEmbeddingResult } from './supabase';

/**
 * Search news embeddings by similarity to a query vector.
 *
 * @param queryEmbedding - A 768-dimensional vector from nomic-embed-text.
 * @param options.matchCount - Max results to return (default: 10).
 * @param options.filterSource - Optional: filter by news source name.
 * @param options.filterDays - Optional: only return articles from the last N days.
 */
export async function searchNewsEmbeddings(
  queryEmbedding: number[],
  options: {
    matchCount?: number;
    filterSource?: string | null;
    filterDays?: number | null;
  } = {}
): Promise<NewsEmbeddingResult[]> {
  if (!isSupabaseConfigured) {
    return [];
  }

  const { matchCount = 10, filterSource = null, filterDays = null } = options;

  const { data, error } = await supabase.rpc('match_news_embeddings', {
    query_embedding: queryEmbedding,
    match_count: matchCount,
    filter_source: filterSource,
    filter_days: filterDays,
  });

  if (error) throw error;
  return (data || []) as NewsEmbeddingResult[];
}
