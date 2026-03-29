// ─── Recording Recovery Service ──────────────────────────────────────────────
// Periodically checkpoints audio chunks to IndexedDB so recordings survive
// accidental browser/tab close. On next app load, orphaned recordings can be
// recovered and processed normally.

const DB_NAME = 'aligned-recovery';
const STORE_NAME = 'recordings';
const DB_VERSION = 1;

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
