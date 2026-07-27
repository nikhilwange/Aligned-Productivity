// ─── Live transcription worker (Phase 3) ─────────────────────────────────────
//
// Transcribes each ~5-minute segment in the background AS SOON AS IT IS
// FINALIZED during recording, instead of waiting for Finish. By the time the
// user stops, only the final partial segment (plus anything that failed live)
// still needs transcription, so "Finish → notes" is ~2-3 minutes regardless of
// how long the meeting ran.
//
// Design constraints this file exists to honour:
//   - Recording is sacred. Enqueueing is fire-and-forget; nothing here can
//     throw into the recorder, delay segment finalize/upload, or write session
//     error state.
//   - One segment at a time (segment-level concurrency 1). Chunk-level
//     concurrency inside transcribeAudioWithSarvam stays as-is (2), so we never
//     compete with the live recorder or trigger rate-limit storms.
//   - Failure is always deferred, never surfaced. Any error just means "no
//     saved transcript for this segment", and the post-Finish finisher does it.
//   - The shared run-token map (services/pipelineRuns.ts) stays the single
//     authority: the worker registers its controller under the recording's
//     `recoveryId`, and the finisher aborts that key when it takes over.

import { transcribeAudioWithSarvam } from './sarvamService';
import { downloadAudioFromStorage } from './storageService';
import {
  getSegmentBlob,
  getSegmentManifest,
  getSegmentTranscript,
  saveSegmentTranscript,
} from './recordingRecovery';
import { beginPipelineRun, abortPipelineRun } from './pipelineRuns';
import { startHeartbeat, clearHeartbeat } from './processingHeartbeat';

interface LiveSession {
  sessionId: string;
  controller: AbortController;
  queue: number[];
  /** Resolves when the pump has drained and gone idle. */
  running: Promise<void> | null;
  /** Segment indices enqueued so far (denominator for the UI readout). */
  enqueued: Set<number>;
  /** Segment indices with a saved transcript (numerator for the UI readout). */
  done: Set<number>;
}

const sessions = new Map<string, LiveSession>();

// ─── Progress notification (component state only — never persisted) ──────────
export interface LiveProgress {
  sessionId: string;
  done: number;
  total: number;
}

type ProgressListener = (progress: LiveProgress) => void;
const listeners = new Set<ProgressListener>();

/** Subscribe to live-transcription progress. Returns an unsubscribe function. */
export function subscribeLiveProgress(listener: ProgressListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitProgress(s: LiveSession): void {
  const progress: LiveProgress = {
    sessionId: s.sessionId,
    done: s.done.size,
    total: s.enqueued.size,
  };
  listeners.forEach((l) => {
    try { l(progress); } catch { /* a listener must never break the worker */ }
  });
}

/** Current progress for a session, or null when it isn't live-transcribing. */
export function getLiveProgress(sessionId: string): LiveProgress | null {
  const s = sessions.get(sessionId);
  if (!s) return null;
  return { sessionId, done: s.done.size, total: s.enqueued.size };
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Begin live transcription for a recording session. Called when the segmented
 * recorder starts. Registers an AbortController in the shared run-token map
 * under `sessionId` (== the recording's recoveryId).
 */
export function startLiveTranscription(sessionId: string): void {
  if (!sessionId) return;
  if (sessions.has(sessionId)) return; // already live
  const controller = beginPipelineRun(sessionId);
  sessions.set(sessionId, {
    sessionId,
    controller,
    queue: [],
    running: null,
    enqueued: new Set(),
    done: new Set(),
  });
  console.log(`[LiveTx] started for ${sessionId}`);
}

/**
 * Queue a finalized segment for background transcription. Fire-and-forget:
 * safe to call from the recorder, never throws, never blocks.
 */
export function enqueueSegment(sessionId: string, index: number): void {
  const s = sessions.get(sessionId);
  if (!s || s.controller.signal.aborted) return;
  if (s.enqueued.has(index)) return; // already queued/processed
  s.enqueued.add(index);
  s.queue.push(index);
  console.log(`[LiveTx] seg ${index} queued`);
  emitProgress(s);
  kick(s);
}

/**
 * Start the pump if it isn't already draining. Re-kicked from the pump's own
 * teardown so a segment enqueued in the window between "queue went empty" and
 * "running cleared" is picked up rather than stranded until the next enqueue.
 */
function kick(s: LiveSession): void {
  if (s.running) return;
  if (s.queue.length === 0) return;
  if (s.controller.signal.aborted) return;
  s.running = pump(s).finally(() => {
    s.running = null;
    kick(s);
  });
}

/**
 * Hand off to the post-Finish pipeline: abort any in-flight live work and wait
 * for the pump to unwind. Resolves once no live Sarvam work is running for this
 * session, so the finisher can safely take over the same chunk-cache keys.
 */
export async function stopLiveTranscription(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.queue.length = 0;
  abortPipelineRun(sessionId); // clears the shared-map registration
  // Abort our own controller directly too: if anything ever re-registered this
  // key, the map lookup above would have aborted the wrong controller and the
  // pump would keep running past the handoff.
  if (!s.controller.signal.aborted) {
    s.controller.abort(new DOMException('Live transcription handed off', 'AbortError'));
  }
  try { await s.running; } catch { /* pump never rejects, but be safe */ }
  clearHeartbeat(sessionId);
  sessions.delete(sessionId);
  console.log(`[LiveTx] stopped for ${sessionId} (${s.done.size}/${s.enqueued.size} transcribed live)`);
}

/** Forget a session without waiting (discard path). */
export function clearLiveSession(sessionId: string): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.queue.length = 0;
  abortPipelineRun(sessionId);
  if (!s.controller.signal.aborted) {
    s.controller.abort(new DOMException('Live transcription discarded', 'AbortError'));
  }
  clearHeartbeat(sessionId);
  sessions.delete(sessionId);
}

// ─── The pump: one segment at a time ─────────────────────────────────────────

async function pump(s: LiveSession): Promise<void> {
  const { signal } = s.controller;
  // Keep a heartbeat while we're actively working so reconciliation in other
  // tabs never mistakes live transcription for a crashed run.
  startHeartbeat(s.sessionId);

  try {
    while (s.queue.length > 0) {
      if (signal.aborted) return;
      const index = s.queue.shift()!;
      await transcribeOneSegment(s, index, signal);
    }
  } finally {
    // Idle → stop beating. A later enqueue restarts both pump and heartbeat.
    if (!signal.aborted) clearHeartbeat(s.sessionId);
  }
}

async function transcribeOneSegment(
  s: LiveSession,
  index: number,
  signal: AbortSignal,
): Promise<void> {
  const startedAt = Date.now();
  try {
    // Already transcribed (e.g. resumed after a reload)? Nothing to do.
    const existing = await getSegmentTranscript(s.sessionId, index);
    if (existing !== null) {
      s.done.add(index);
      emitProgress(s);
      return;
    }
    if (signal.aborted) return;

    // Prefer the locally cached blob; fall back to the uploaded copy.
    let blob = await getSegmentBlob(s.sessionId, index);
    if (!blob) {
      const manifest = await getSegmentManifest(s.sessionId);
      const entry = manifest?.segments.find((seg) => seg.index === index);
      if (entry?.storagePath) {
        blob = await downloadAudioFromStorage(entry.storagePath);
      }
    }
    if (!blob) {
      console.log(`[LiveTx] seg ${index} blob unavailable, deferring to finish`);
      return;
    }
    if (signal.aborted) return;

    console.log(`[LiveTx] seg ${index} started`);
    let chunksDone = 0;
    let chunksTotal = 0;
    // Reuses the Phase 1 chunk cache under the SAME key the finisher uses, so
    // partial work survives an abort and is resumed rather than repeated.
    const transcript = await transcribeAudioWithSarvam(blob, {
      recoveryId: `${s.sessionId}:seg${index}`,
      signal,
      onProgress: (done, total) => { chunksDone = done; chunksTotal = total; },
    });

    if (signal.aborted) return; // superseded mid-flight — let the finisher own it

    await saveSegmentTranscript(s.sessionId, index, transcript);
    s.done.add(index);
    emitProgress(s);

    const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `[LiveTx] seg ${index} done in ${secs}s ` +
      `(chunks: ${chunksDone} done, ${Math.max(0, chunksTotal - chunksDone)} failed)`,
    );
  } catch (err: any) {
    // TOTALLY non-fatal by design. Rate limits, network drops, decode errors —
    // all of them just mean this segment gets transcribed after Finish instead.
    if (signal.aborted) return; // handoff/discard, not a real failure
    console.log(
      `[LiveTx] segment ${index} failed, deferring to finish:`,
      err?.message ?? err,
    );
  }
}
