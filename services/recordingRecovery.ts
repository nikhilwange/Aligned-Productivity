// ─── Recording Recovery Service ──────────────────────────────────────────────
// Periodically checkpoints audio chunks to IndexedDB so recordings survive
// accidental browser/tab close. On next app load, orphaned recordings can be
// recovered and processed normally.

const DB_NAME = 'aligned-recovery';
const STORE_NAME = 'recordings';
// Separate store for resumable chunk transcripts (Feature: resumable processing).
// Keeping it in its own store means the audio-blob recovery entries above are
// never disturbed by chunk-cache reads/writes.
const CHUNK_STORE_NAME = 'chunk-transcripts';
const DB_VERSION = 2;

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface RecoveryMeta {
  id: string;
  startedAt: number;
  duration: number;
  source: string;
  mimeType: string;
  inputMode: string;
}

interface RecoveryRecord {
  id: string;
  meta: RecoveryMeta;
  chunks: Blob[];
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(CHUNK_STORE_NAME)) {
        db.createObjectStore(CHUNK_STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Start tracking a new recording session for recovery */
export async function startRecoverySession(meta: RecoveryMeta): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ id: meta.id, meta, chunks: [] });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[Recovery] Failed to start session:', err);
  }
}

/** Append new audio chunks to the recovery store */
export async function checkpointChunks(sessionId: string, newChunks: Blob[]): Promise<void> {
  if (newChunks.length === 0) return;
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const existing: RecoveryRecord | undefined = await new Promise((resolve, reject) => {
      const req = store.get(sessionId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (existing) {
      existing.chunks = [...existing.chunks, ...newChunks];
      store.put(existing);
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[Recovery] Failed to checkpoint chunks:', err);
  }
}

/** Update the duration in recovery metadata */
export async function updateRecoveryDuration(sessionId: string, duration: number): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const existing: RecoveryRecord | undefined = await new Promise((resolve, reject) => {
      const req = store.get(sessionId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    if (existing) {
      existing.meta.duration = duration;
      store.put(existing);
    }

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[Recovery] Failed to update duration:', err);
  }
}

/** Recording finished normally — remove from recovery store */
export async function clearRecoverySession(sessionId: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(sessionId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[Recovery] Failed to clear session:', err);
  }
}

/** Check for any orphaned recordings from previous crashed sessions */
export async function getRecoverableRecordings(): Promise<{ meta: RecoveryMeta; blob: Blob }[]> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const all: RecoveryRecord[] = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();

    return all
      .filter(r => r.chunks.length > 0)
      .map(r => ({
        meta: r.meta,
        blob: new Blob(r.chunks, { type: r.meta.mimeType || 'audio/webm' }),
      }));
  } catch (err) {
    console.warn('[Recovery] Failed to get recoverable recordings:', err);
    return [];
  }
}

/** Clear all recovery data (e.g. after user dismisses recovery prompt) */
export async function clearAllRecovery(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[Recovery] Failed to clear all:', err);
  }
}

// ─── Resumable chunk-transcript cache ────────────────────────────────────────
// Persists each Sarvam chunk transcript as it completes, keyed by recoveryId, so
// that an interrupted/retried recording can skip chunks already done instead of
// re-transcribing from chunk 1. Lives entirely in IndexedDB — no schema/type
// model changes. Every operation is best-effort: a cache failure must never
// break transcription.

interface ChunkTranscriptRecord {
  id: string; // recoveryId
  chunkCount: number;
  transcripts: Record<number, string>;
  updatedAt: number;
}

/** Persist a single completed chunk transcript (fire-and-forget at call sites). */
export async function saveChunkTranscript(
  recoveryId: string,
  chunkIndex: number,
  chunkCount: number,
  transcript: string,
): Promise<void> {
  if (!recoveryId) return;
  try {
    const db = await openDB();
    const tx = db.transaction(CHUNK_STORE_NAME, 'readwrite');
    const store = tx.objectStore(CHUNK_STORE_NAME);

    const existing: ChunkTranscriptRecord | undefined = await new Promise((resolve, reject) => {
      const req = store.get(recoveryId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    // If the chunk count changed (different blob / decode), start fresh so we
    // never mix transcripts from two different chunkings.
    const record: ChunkTranscriptRecord =
      existing && existing.chunkCount === chunkCount
        ? existing
        : { id: recoveryId, chunkCount, transcripts: {}, updatedAt: Date.now() };

    record.transcripts[chunkIndex] = transcript;
    record.updatedAt = Date.now();
    store.put(record);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[Recovery] Failed to save chunk transcript:', err);
  }
}

/**
 * Return the cached transcripts for a recoveryId, but ONLY if the stored
 * chunkCount matches `expectedChunkCount`. A mismatch means the chunking
 * differs from when the cache was written, so the cache is discarded (returns
 * null) rather than risk stitching text into the wrong positions.
 */
export async function getChunkTranscripts(
  recoveryId: string,
  expectedChunkCount: number,
): Promise<Record<number, string> | null> {
  if (!recoveryId) return null;
  try {
    const db = await openDB();
    const tx = db.transaction(CHUNK_STORE_NAME, 'readonly');
    const store = tx.objectStore(CHUNK_STORE_NAME);
    const record: ChunkTranscriptRecord | undefined = await new Promise((resolve, reject) => {
      const req = store.get(recoveryId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();

    if (!record) return null;
    if (record.chunkCount !== expectedChunkCount) {
      console.warn(
        `[Recovery] Chunk cache discarded: stored ${record.chunkCount} chunks, expected ${expectedChunkCount}`,
      );
      return null;
    }
    return record.transcripts || {};
  } catch (err) {
    console.warn('[Recovery] Failed to read chunk transcripts:', err);
    return null;
  }
}

/** Remove the chunk-transcript cache for a single recoveryId. */
export async function clearChunkTranscripts(recoveryId: string): Promise<void> {
  if (!recoveryId) return;
  try {
    const db = await openDB();
    const tx = db.transaction(CHUNK_STORE_NAME, 'readwrite');
    tx.objectStore(CHUNK_STORE_NAME).delete(recoveryId);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[Recovery] Failed to clear chunk transcripts:', err);
  }
}

/** Wipe every chunk-transcript cache (used when discarding all recovery data). */
export async function clearAllChunkTranscripts(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(CHUNK_STORE_NAME, 'readwrite');
    tx.objectStore(CHUNK_STORE_NAME).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[Recovery] Failed to clear all chunk transcripts:', err);
  }
}

/** Purge chunk caches older than 7 days. Call once on app load. */
export async function purgeStaleChunkTranscripts(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(CHUNK_STORE_NAME, 'readwrite');
    const store = tx.objectStore(CHUNK_STORE_NAME);
    const all: ChunkTranscriptRecord[] = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const cutoff = Date.now() - SEVEN_DAYS_MS;
    for (const rec of all) {
      if (!rec.updatedAt || rec.updatedAt < cutoff) store.delete(rec.id);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn('[Recovery] Failed to purge stale chunk transcripts:', err);
  }
}
