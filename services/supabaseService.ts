import { createClient } from '@supabase/supabase-js';
import { Capacitor } from '@capacitor/core';
import { RecordingSession, TrackedActionItem, ActionItemStatus, ActionItemUpdate, StrategicAnalysis } from '../types';

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
export const saveRecording = async (
  recording: RecordingSession,
  userId: string,
  opts?: { billable?: boolean },
) => {
  // `billable` (default true) controls whether this recording's minutes count
  // toward the monthly audio-hours budget. Manual transcript paste sets it
  // false — no audio was transcribed, so it has no STT cost. It's a DB-only
  // concern (not part of RecordingSession); the usage trigger reads it at
  // INSERT time, so it must be set on the first save.
  const row: Record<string, unknown> = {
    id: recording.id,
    user_id: userId,
    title: recording.title,
    date: recording.date,
    duration: recording.duration,
    status: recording.status,
    source: recording.source,
    analysis: recording.analysis, // Stores the MeetingAnalysis object (transcript, summary, etc.)
    errorMessage: recording.errorMessage,
    recoveryId: recording.recoveryId ?? null,
    audioPath: recording.audioPath ?? null,
  };
  if (opts?.billable === false) row.billable = false;

  const { error } = await supabase.from('recordings').upsert(row);

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

// ─── Strategist Analysis Cache ────────────────────────────────────────────────
//
// Keyed by (user_id, date_range_start, date_range_end). One row per unique
// date range; regenerating for the same range upserts in place. Staleness
// on "new meeting added" is detected at load time by comparing
// analyzed_meetings_count to the current filtered set — the row stays in
// the table but is treated as a cache miss until regenerated.

/**
 * Upserts the strategist analysis for the current user + date range.
 * Best-effort: errors are logged but not thrown so a persistence hiccup
 * doesn't block the user from seeing the result that just generated.
 */
export const saveStrategistAnalysis = async (
  userId: string,
  analysis: StrategicAnalysis,
): Promise<void> => {
  const { error } = await supabase
    .from('strategist_analyses')
    .upsert(
      {
        user_id: userId,
        date_range_start: analysis.dateRange.start,
        date_range_end: analysis.dateRange.end,
        analyzed_meetings_count: analysis.analyzedMeetingsCount,
        analysis_data: analysis,
        generated_at: analysis.generatedAt,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,date_range_start,date_range_end' },
    );

  if (error) {
    console.error('[Supabase] Error saving strategist analysis:', error);
  }
};

/**
 * Loads the cached strategist analysis for a given (user, date range).
 * Returns null on cache miss, error, or staleness — the cached row's
 * analyzed_meetings_count must match `expectedCount`, otherwise the
 * caller should regenerate.
 */
export const loadStrategistAnalysis = async (
  userId: string,
  dateRangeStart: number,
  dateRangeEnd: number,
  expectedCount: number,
): Promise<StrategicAnalysis | null> => {
  const { data, error } = await supabase
    .from('strategist_analyses')
    .select('analysis_data, analyzed_meetings_count, generated_at')
    .eq('user_id', userId)
    .eq('date_range_start', dateRangeStart)
    .eq('date_range_end', dateRangeEnd)
    .maybeSingle();

  if (error) {
    console.error('[Supabase] Error loading strategist analysis:', error);
    return null;
  }
  if (!data) return null;
  if (data.analyzed_meetings_count !== expectedCount) return null;

  const cached = data.analysis_data as StrategicAnalysis;
  // generated_at on the row is authoritative — overlay in case the jsonb
  // copy ever drifts (e.g. older schema).
  return { ...cached, generatedAt: Number(data.generated_at) };
};

// ─── Action Tracker CRUD ──────────────────────────────────────────────────────

const mapActionItemRow = (row: any): TrackedActionItem => ({
  id: row.id,
  displayId: row.display_id,
  userId: row.user_id,
  recordingId: row.recording_id ?? null,
  text: row.text,
  status: row.status as ActionItemStatus,
  functionTag: row.function_tag ?? null,
  assignee: row.assignee ?? null,
  dueDate: row.due_date ? new Date(row.due_date).getTime() : null,
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
 * Adds selected action items from a recording's actionPoints array into the action_items table.
 * Idempotent: uses source_index + recording_id to avoid duplicates.
 *
 * @param selectedIndices If provided, only items at these indices in actionPoints
 *                        are inserted. If omitted, ALL points are synced (legacy behavior).
 *                        Items already in the table for this recording are always skipped.
 */
export const syncActionItemsFromRecording = async (
  recording: RecordingSession,
  userId: string,
  selectedIndices?: number[]
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

  const selectedSet = selectedIndices ? new Set(selectedIndices) : null;

  const toInsert = points
    .map((text, i) => ({ index: i, text }))
    .filter(({ index }) => {
      if (existingIndices.has(index)) return false;
      if (selectedSet && !selectedSet.has(index)) return false;
      return true;
    })
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
    // Bubble the real reason up so the UI can show something useful instead
    // of silently reporting "0 added".
    throw new Error(error.message || 'Failed to add action items to tracker.');
  }
  return (data ?? []).map(mapActionItemRow);
};

/**
 * Returns the current set of source_index values already present in
 * action_items for a given (user, recording). Used by the session view to
 * refresh "already tracked" state when the in-memory prop may be stale.
 */
export const fetchTrackedSourceIndicesForRecording = async (
  userId: string,
  recordingId: string
): Promise<number[]> => {
  const { data, error } = await supabase
    .from('action_items')
    .select('source_index')
    .eq('user_id', userId)
    .eq('recording_id', recordingId);
  if (error) {
    console.error('[Supabase] Error fetching tracked indices:', error);
    return [];
  }
  return (data ?? [])
    .map((r: any) => r.source_index)
    .filter((v: any): v is number => typeof v === 'number');
};

/**
 * Creates a single ad-hoc action item not tied to a recording sync.
 * The display_id is assigned server-side by the BEFORE INSERT trigger.
 */
export const createActionItem = async (
  userId: string,
  text: string,
  opts: { recordingId?: string | null; dueDate?: number | null; assignee?: string | null } = {}
): Promise<TrackedActionItem | null> => {
  const payload = {
    user_id: userId,
    recording_id: opts.recordingId ?? null,
    text,
    status: 'not_started',
    function_tag: null,
    assignee: opts.assignee ?? null,
    due_date: opts.dueDate ? new Date(opts.dueDate).toISOString().slice(0, 10) : null,
  };
  const { data, error } = await supabase
    .from('action_items')
    .insert(payload)
    .select()
    .single();
  if (error) {
    console.error('[Supabase] Error creating action item:', error);
    return null;
  }
  return mapActionItemRow(data);
};

/**
 * Updates an action item's status, functionTag, assignee, dueDate, or text.
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
  if (updates.dueDate     !== undefined) {
    payload.due_date = updates.dueDate ? new Date(updates.dueDate).toISOString().slice(0, 10) : null;
  }

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