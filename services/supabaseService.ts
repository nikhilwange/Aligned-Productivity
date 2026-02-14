import { createClient } from '@supabase/supabase-js';
import { RecordingSession } from '../types';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Fetches all recordings for a specific user from Supabase.
 */
export const fetchRecordings = async (userId: string): Promise<RecordingSession[]> => {
  const { data, error } = await supabase
    .from('recordings')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (error) {
    console.error('Error fetching recordings:', error);
    return [];
  }

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