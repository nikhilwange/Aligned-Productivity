import { supabase } from './supabaseService';

const BUCKET = 'audio-recordings';

// Upload a Blob to Supabase Storage under the authenticated user's folder.
// pathSuffix is appended to "{user_id}/" so RLS policies pass.
// Returns the full storage path that the server will use to fetch the file.
export const uploadAudioToStorage = async (
  blob: Blob,
  pathSuffix: string,
): Promise<string> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated — cannot upload to storage.');

  const fullPath = `${user.id}/${pathSuffix}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(fullPath, blob, {
      contentType: blob.type || 'application/octet-stream',
      upsert: false,
    });

  if (error) {
    throw new Error(`Storage upload failed (${pathSuffix}): ${error.message}`);
  }

  return fullPath;
};

// Best-effort cleanup — failures are logged but not thrown so they don't break callers.
export const deleteAudioPaths = async (paths: string[]): Promise<void> => {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) {
    console.warn(`[Storage] Failed to delete ${paths.length} path(s): ${error.message}`);
  }
};
