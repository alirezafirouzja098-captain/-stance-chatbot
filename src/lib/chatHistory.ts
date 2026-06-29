/**
 * Chat history persistence via Supabase.
 *
 * Provides CRUD operations for chat sessions (threads) and messages.
 * All queries are RLS-scoped to the authenticated user automatically.
 */

import { supabase, type Chat, type Message } from './supabase';

// ── Chat Sessions ────────────────────────────────────────────

/** Create a new chat session and return the created row. */
export async function createChat(userId: string, title: string): Promise<Chat> {
  const { data, error } = await supabase
    .from('chats')
    .insert({ user_id: userId, title })
    .select()
    .single();

  if (error) throw error;
  return data as Chat;
}

/** Fetch all chat sessions for a user, ordered by most recent activity. */
export async function fetchChats(userId: string): Promise<Chat[]> {
  const { data, error } = await supabase
    .from('chats')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data || []) as Chat[];
}

/** Update the title of a chat session. */
export async function updateChatTitle(chatId: string, title: string): Promise<void> {
  const { error } = await supabase
    .from('chats')
    .update({ title })
    .eq('id', chatId);

  if (error) throw error;
}

/** Delete a chat session (cascades to its messages via FK). */
export async function deleteChat(chatId: string): Promise<void> {
  const { error } = await supabase
    .from('chats')
    .delete()
    .eq('id', chatId);

  if (error) throw error;
}

// ── Messages ─────────────────────────────────────────────────

/** Insert a single message into a chat session. */
export async function insertMessage(
  chatId: string,
  role: 'user' | 'assistant' | 'system',
  content: string
): Promise<Message> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ chat_id: chatId, role, content })
    .select()
    .single();

  if (error) throw error;
  return data as Message;
}

/** Fetch all messages for a chat session in chronological order. */
export async function fetchMessages(chatId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []) as Message[];
}
