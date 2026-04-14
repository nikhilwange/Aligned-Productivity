import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { RecordingSession, TrackedActionItem, ActionItemStatus, ActionItemUpdate } from '../types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('[Supabase] Missing environment variables! VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set.');
}

// Enable session persistence on native apps so users stay logged in.
// Disabled on web to avoid lock manager issues.
const isNative = Capacitor.isNativePlatform();

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseAnonKey || 'placeholder', {
  auth: {
    storageKey: 'aligned-auth',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: !isNative
  }
});

/**
 * Fetches all recordings for a specific user from Supabase.
 */
export const fetchRecordings = async (userId: string): Promise<RecordingSession[]> => {
  console.log('[Supabase] Fetching recordings for user_id:', userId);

  const { data, error } = await supabase
    .from('recordings')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (error) {
    console.error('[Supabase] Error fetching recordings:', error);
    console.error('[Supabase] Error details:', {
      message: error.message,
      details: error.details,
      hint: error.hint,
      code: error.code
    });
    return [];
  }

  console.log('[Supabase] Successfully fetched recordings:', data?.length || 0);
  return data as RecordingSession[];
};

/**
 * Saves or updates a recording session, including the AI-generated insights (analysis).
 */
export const saveRecording = async (recording: RecordingSession, userId: string) => {
  const { error } = await supabase
    .from('recordings')
    .upsert({
      id: recording.id,
      user_id: userId,
      title: recording.title,
      date: recording.date,
      duration: recording.duration,
      status: recording.status,
      source: recording.source,
      analysis: recording.analysis, // Stores the MeetingAnalysis object (transcript, summary, etc.)
      errorMessage: recording.errorMessage
    });

  if (error) {
    console.error('Error saving recording to Supabase:', error);
    throw error;
  }
};

/**
 * Permanently deletes a recording from the database.
 */
export const deleteRecordingFromDb = async (id: string, userId: string) => {
  const { error } = await supabase
    .from('recordings')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);

  if (error) {
    console.error('Error deleting recording from Supabase:', error);
    throw error;
  }
};

// ─── Action Tracker CRUD ──────────────────────────────────────────────────────

const mapActionItemRow = (row: any): TrackedActionItem => ({
  id: row.id,
  userId: row.user_id,
  recordingId: row.recording_id ?? null,
  text: row.text,
  status: row.status as ActionItemStatus,
  functionTag: row.function_tag ?? null,
  assignee: row.assignee ?? null,
  sourceIndex: row.source_index ?? null,
  createdAt: new Date(row.created_at).getTime(),
  updatedAt: new Date(row.updated_at).getTime(),
});

/**
 * Fetches all action items for a user, ordered by creation time.
 */
export const fetchActionItems = async (userId: string): Promise<TrackedActionItem[]> => {
  const { data, error } = await supabase
    .from('action_items')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[Supabase] Error fetching action items:', error);
    return [];
  }
  return (data ?? []).map(mapActionItemRow);
};

/**
 * Syncs action items from a recording's actionPoints array into the action_items table.
 * Idempotent: uses source_index + recording_id to avoid duplicates.
 */
export const syncActionItemsFromRecording = async (
  recording: RecordingSession,
  userId: string
): Promise<TrackedActionItem[]> => {
  const points = recording.analysis?.actionPoints ?? [];
  if (points.length === 0) return [];

  // Find which source_indices are already synced
  const { data: existing } = await supabase
    .from('action_items')
    .select('source_index')
    .eq('user_id', userId)
    .eq('recording_id', recording.id);

  const existingIndices = new Set(
    (existing ?? [])
      .map((r: any) => r.source_index)
      .filter((v): v is number => typeof v === 'number')
  );

  const toInsert = points
    .map((text, i) => ({ index: i, text }))
    .filter(({ index }) => !existingIndices.has(index))
    .map(({ index, text }) => ({
      user_id: userId,
      recording_id: recording.id,
      text,
      status: 'not_started',
      source_index: index,
      function_tag: null,
      assignee: null,
    }));

  if (toInsert.length === 0) return [];

  const { data, error } = await supabase
    .from('action_items')
    .insert(toInsert)
    .select();

  if (error) {
    console.error('[Supabase] Error syncing action items:', error);
    return [];
  }
  return (data ?? []).map(mapActionItemRow);
};

/**
 * Updates an action item's status, functionTag, assignee, or text.
 */
export const updateActionItem = async (
  id: string,
  updates: ActionItemUpdate
): Promise<TrackedActionItem | null> => {
  const payload: Record<string, any> = {};
  if (updates.status      !== undefined) payload.status       = updates.status;
  if (updates.functionTag !== undefined) payload.function_tag = updates.functionTag;
  if (updates.assignee    !== undefined) payload.assignee     = updates.assignee;
  if (updates.text        !== undefined) payload.text         = updates.text;

  const { data, error } = await supabase
    .from('action_items')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('[Supabase] Error updating action item:', error);
    return null;
  }
  return mapActionItemRow(data);
};

/**
 * Deletes a single action item.
 */
export const deleteActionItem = async (id: string): Promise<boolean> => {
  const { error } = await supabase
    .from('action_items')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('[Supabase] Error deleting action item:', error);
    return false;
  }
  return true;
};