import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ── Environment ──────────────────────────────────────────────
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl.startsWith('https://') &&
  !supabaseUrl.includes('placeholder') &&
  !supabaseAnonKey.includes('placeholder')
);

// ── Client ───────────────────────────────────────────────────
// Always export a usable client to avoid null-checks throughout the app.
// When Supabase is unconfigured, we use a dummy HTTPS URL so `createClient`
// doesn't throw. All operations will fail gracefully at the network level,
// which the existing demo-mode guards in page.tsx already handle.
export const supabase: SupabaseClient = createClient(
  isSupabaseConfigured ? supabaseUrl : 'https://placeholder.supabase.co',
  isSupabaseConfigured ? supabaseAnonKey : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE2MDAwMDAwMDAsImV4cCI6MjAwMDAwMDAwMH0.placeholder'
);

// ── Types ────────────────────────────────────────────────────

export interface Chat {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  chat_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  created_at: string;
}

export interface NewsEmbeddingResult {
  id: string;
  title: string;
  content: string;
  source: string;
  url: string;
  published_date: string;
  category: string;
  chunk_index: number;
  similarity: number;
}
