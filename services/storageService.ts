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

// Throws on failure so callers can surface the problem (orphan-audio risk).
export const deleteAudioPaths = async (paths: string[]): Promise<void> => {
  if (paths.length === 0) return;
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) {
    throw new Error(`Storage delete failed for ${paths.length} path(s): ${error.message}`);
  }
};

// Downloads an archived audio Blob from Storage via a short-lived signed URL.
// Used by cross-device Retry (when the IndexedDB recovery blob is gone) and
// by the failed-session "Download audio" button.
// Bound the signed-URL download so a hung connection can't stall the segmented
// pipeline (or a Retry) forever — mirrors the chunk-request timeout.
const DOWNLOAD_TIMEOUT_MS = 90_000;

export const downloadAudioFromStorage = async (audioPath: string): Promise<Blob> => {
  const { data, error } = await supabase
    .storage
    .from(BUCKET)
    .createSignedUrl(audioPath, 300);
  if (error || !data?.signedUrl) {
    throw new Error(`Could not mint signed URL for ${audioPath}: ${error?.message ?? 'unknown'}`);
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Audio download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s for ${audioPath}`)),
    DOWNLOAD_TIMEOUT_MS,
  );
  try {
    const res = await fetch(data.signedUrl, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Audio download failed (HTTP ${res.status}) for ${audioPath}`);
    }
    return await res.blob();
  } catch (err: any) {
    if (controller.signal.aborted) {
      throw new Error(`Audio download timed out after ${DOWNLOAD_TIMEOUT_MS / 1000}s for ${audioPath}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};
