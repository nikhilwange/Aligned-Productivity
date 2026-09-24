// ─── Segmented recorder controller (Phase 2) ─────────────────────────────────
// Records in self-contained ~5-minute segments by STOPPING the MediaRecorder
// and immediately STARTING a new one on the same MediaStream. Each stopped
// segment is a complete, independently-decodable audio file — the ONLY correct
// way to segment webm/opus (a `timeslice` blob after the first is NOT
// independently decodable because it lacks the container header).
//
// As each segment completes it is cached in IndexedDB (crash safety) and
// uploaded to Supabase Storage at `recordings/{sessionId}/seg-{index}.{ext}`
// while the meeting is still going, so "stop → ready" is fast even for very
// long recordings and the full file is never decoded at once.
//
// Lifetime is owned by services/recordingController.ts, never by a component.

import { uploadAudioToStorage, deleteAudioPaths, downloadAudioFromStorage, getRecordingFolderInfo } from './storageService';
import {
  saveSegmentBlob,
  getSegmentBlob,
  getSegmentManifest,
  saveSegmentManifest,
  clearSegmentManifest,
  clearSegmentTranscripts,
  clearChunkTranscripts,
  SegmentManifest,
  SegmentEntry,
  SegmentGap,
  getAllSegmentManifests,
} from './recordingRecovery';
import { LIVE_TRANSCRIPTION } from '../config/features';
import { startLiveTranscription, enqueueSegment } from './liveTranscription';
import { splitAudioFile } from './audioSplitter';
import { deleteRecordingSegments, type SegmentDeletion, type RecordingRowStatus } from './segmentCleanupPolicy';

// ~5 minutes per segment. Exported so callers/tests can reference it.
export const SEGMENT_DURATION_MS = 5 * 60 * 1000;

const AUDIO_BITS_PER_SECOND = 32000; // matches the monolithic recorder

// Map a MediaRecorder mimeType to a file extension for the storage path.
export function extFromMime(mime: string | undefined): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('mp4') || m.includes('m4a') || m.includes('aac')) return 'mp4';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('wav')) return 'wav';
  return 'webm';
}

export const segmentStoragePath = (sessionId: string, index: number, ext: string) =>
  `recordings/${sessionId}/seg-${String(index).padStart(4, '0')}.${ext}`;

// ─── Per-recording write queue ───────────────────────────────────────────────
// The manifest is read-modify-write in IndexedDB. Everything that writes a
// recording's manifest or segment blobs — the recorder, the live worker, the
// finisher — goes through this one queue per recording, in order, so
// concurrent writers can't drop each other's changes.
const writeQueues = new Map<string, Promise<void>>();
export function enqueueRecordingWrite(sessionId: string, task: () => Promise<void>): Promise<void> {
  const prev = writeQueues.get(sessionId) ?? Promise.resolve();
  const run = prev.then(task);
  const settled = run.catch(() => {});
  writeQueues.set(sessionId, settled);
  settled.then(() => { if (writeQueues.get(sessionId) === settled) writeQueues.delete(sessionId); });
  return run;
}

/**
 * Update fields on one existing segment entry (e.g. decodedMs, decodeFailed).
 * No-op when the manifest or entry is gone — never recreates a cleaned-up one.
 */
export function patchSegmentEntry(sessionId: string, index: number, patch: Partial<SegmentEntry>): Promise<void> {
  return enqueueRecordingWrite(sessionId, async () => {
    const m = await getSegmentManifest(sessionId);
    const i = m ? m.segments.findIndex((s) => s.index === index) : -1;
    if (!m || i === -1) return;
    m.segments[i] = { ...m.segments[i], ...patch };
    await saveSegmentManifest(m);
  });
}

// Saved-duration rule (decodedMs vs the audio clock) lives in the pure
// transcriptAssembly module; re-exported for existing callers.
export { segmentSavedMs, manifestSavedMs } from './transcriptAssembly';

// ─── Header (init segment) repair ────────────────────────────────────────────
const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3];
const CLUSTER_ID = [0x1f, 0x43, 0xb6, 0x75];
function indexOfBytes(u8: Uint8Array, pat: number[]): number {
  outer: for (let i = 0; i <= u8.length - pat.length; i++) {
    for (let j = 0; j < pat.length; j++) if (u8[i + j] !== pat[j]) continue outer;
    return i;
  }
  return -1;
}

/**
 * The recording's WebM header — EBML + Segment info + Tracks, everything
 * before the first Cluster — taken from segment 0. Every segment of a
 * recording is written by an identically configured MediaRecorder, so this
 * header is valid for all of them. Null for non-WebM or when unavailable.
 */
export async function getRecordingInitSegment(sessionId: string): Promise<Blob | null> {
  try {
    let blob = await getSegmentBlob(sessionId, 0);
    if (!blob) {
      const m = await getSegmentManifest(sessionId);
      const seg0 = m?.segments.find((s) => s.index === 0);
      if (seg0?.storagePath) blob = await downloadAudioFromStorage(seg0.storagePath).catch(() => null);
    }
    if (!blob) return null;
    const head = new Uint8Array(await blob.slice(0, 64 * 1024).arrayBuffer());
    if (indexOfBytes(head.subarray(0, 4), EBML_MAGIC) !== 0) return null;
    const clusterAt = indexOfBytes(head, CLUSTER_ID);
    if (clusterAt <= 0) return null;
    return new Blob([head.slice(0, clusterAt)], { type: blob.type || 'audio/webm' });
  } catch {
    return null;
  }
}

/** Replace a segment's cached + uploaded file with its header-repaired version. */
export async function persistRepairedSegment(sessionId: string, index: number, init: Blob, original: Blob): Promise<void> {
  const repaired = new Blob([init, original], { type: original.type || init.type || 'audio/webm' });
  await enqueueRecordingWrite(sessionId, async () => {
    await saveSegmentBlob(sessionId, index, repaired);
    const m = await getSegmentManifest(sessionId);
    const seg = m?.segments.find((s) => s.index === index);
    if (m && seg?.storagePath) {
      // Never delete a segment while its recording may still be processing
      // (hard rule): upload the repaired file to a NEW path and remember the
      // old one, which goes only when the whole recording is deleted.
      const oldPath = seg.storagePath;
      try {
        const newPath = await uploadAudioToStorage(
          repaired,
          segmentStoragePath(sessionId, index, seg.ext).replace(/\.(\w+)$/, `-r${Date.now()}.$1`),
        );
        seg.storagePath = newPath;
      } catch (err: any) {
        console.warn(`[SegmentRecorder] upload of repaired seg ${index} failed (IndexedDB copy is repaired):`, err?.message);
        seg.uploaded = false; // reuploadPendingSegments will retry from the repaired cache
        seg.storagePath = undefined;
      }
      seg.previousStoragePaths = [...(seg.previousStoragePaths ?? []), oldPath];
      await saveSegmentManifest(m);
    }
  });
  console.warn(`[SegmentRecorder] seg ${index} of ${sessionId}: header repaired and saved`);
}

/** Decoded length of a blob in ms, or null if it doesn't decode. */
async function decodedLengthMs(blob: Blob): Promise<number | null> {
  try {
    const Offline: typeof OfflineAudioContext | undefined =
      (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    if (!Offline) return null;
    const buf = await new Offline(1, 1, 16000).decodeAudioData(await blob.arrayBuffer());
    return Math.round(buf.duration * 1000);
  } catch {
    return null;
  }
}

/**
 * Standalone decode check for a just-closed segment. Used only when live
 * transcription is OFF — otherwise the live worker's own decode (for
 * transcription) is the check, so each segment is decoded once. Records
 * decodedMs; on failure tries the header repair; if that fails too, marks
 * the entry decodeFailed (its audio is kept).
 */
export async function checkSegmentDecodes(sessionId: string, index: number, blob: Blob): Promise<void> {
  const ms = await decodedLengthMs(blob);
  if (ms !== null) {
    await patchSegmentEntry(sessionId, index, { decodedMs: ms, decodeFailed: false });
    return;
  }
  console.warn(`[SegmentRecorder] seg ${index} of ${sessionId} does not decode — trying header repair`);
  const init = index > 0 ? await getRecordingInitSegment(sessionId) : null;
  if (init) {
    const repairedMs = await decodedLengthMs(new Blob([init, blob], { type: blob.type }));
    if (repairedMs !== null) {
      await persistRepairedSegment(sessionId, index, init, blob);
      await patchSegmentEntry(sessionId, index, { decodedMs: repairedMs, decodeFailed: false });
      return;
    }
  }
  console.error(`[SegmentRecorder] seg ${index} of ${sessionId} is undecodable — kept and marked failed`);
  await patchSegmentEntry(sessionId, index, { decodeFailed: true });
}

// The recording currently in progress IN THIS TAB. Set while a SegmentRecorder
// is live and cleared when it stops, so crash-recovery can tell a still-
// recording manifest apart from a genuinely crashed one and never "recover"
// (and then delete) an active recording. Module-level so it resets on reload —
// a real crash leaves no active id, so recovery still works.
let activeSegmentSessionId: string | null = null;
export function getActiveSegmentSessionId(): string | null {
  return activeSegmentSessionId;
}

export interface SegmentRecorderOptions {
  stream: MediaStream;
  sessionId: string; // == the recording's recoveryId
  source: string;
  // Called after each segment finishes uploading (or is queued), for UI hints.
  onSegmentUploaded?: (uploaded: number, total: number) => void;
  /**
   * Capture clock in ms. Segment durations are measured on it. The controller
   * passes the recording AudioContext's clock, which stops while the device
   * sleeps — so a segment spanning a sleep reports only the audio captured,
   * not the wall-clock time. Defaults to Date.now.
   */
  clock?: () => number;
}

export class SegmentRecorder {
  readonly sessionId: string;
  private stream: MediaStream;
  private source: string;
  private onSegmentUploaded?: (uploaded: number, total: number) => void;
  private clock: () => number;

  private recorder: MediaRecorder | null = null;
  private mimeType = 'audio/webm';
  private nextIndex = 0;
  private rotationTimer: number | null = null;
  private stopped = false;
  // Set once stop() has fully resolved: nothing may be recorded or uploaded
  // for this recording again (guards against a zombie producing segments).
  private tornDown = false;

  // The segment currently being recorded, for checkpoints.
  private current: { index: number; chunks: Blob[]; startedAt: number } | null = null;
  // Segments whose final blob has been handed to finalizeSegment. A checkpoint
  // must never overwrite them with a shorter partial blob.
  private finalized = new Set<number>();

  // Every IndexedDB write for this recording (segment blobs + manifest) goes
  // through the shared per-recording queue (enqueueRecordingWrite).
  private lastWrite: Promise<void> = Promise.resolve();

  // Finalize (cache + manifest) promises and background upload promises so
  // stop() can wait for everything to settle before handing off.
  private finalizePromises: Promise<void>[] = [];
  private uploadPromises: Promise<void>[] = [];

  constructor(opts: SegmentRecorderOptions) {
    this.stream = opts.stream;
    this.sessionId = opts.sessionId;
    this.source = opts.source;
    this.onSegmentUploaded = opts.onSegmentUploaded;
    this.clock = opts.clock ?? (() => Date.now());
  }

  start(): void {
    this.stopped = false;
    activeSegmentSessionId = this.sessionId; // mark this tab as actively recording
    // Phase 3: open the live-transcription session so finalized segments can be
    // transcribed while the meeting continues. Never allowed to affect recording.
    if (LIVE_TRANSCRIPTION) {
      try { startLiveTranscription(this.sessionId); } catch (err) {
        console.warn('[SegmentRecorder] startLiveTranscription failed (non-critical):', err);
      }
    }
    this.beginSegment();
  }

  private enqueueWrite(task: () => Promise<void>): Promise<void> {
    const run = enqueueRecordingWrite(this.sessionId, task);
    this.lastWrite = run.catch(() => {});
    return run;
  }

  /** Begin a fresh segment recorder on the shared stream. */
  private beginSegment(): void {
    if (this.stopped || this.tornDown) return;
    const chunks: Blob[] = [];
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(this.stream, { audioBitsPerSecond: AUDIO_BITS_PER_SECOND });
    } catch (err) {
      console.error('[SegmentRecorder] Failed to create MediaRecorder:', err);
      return;
    }
    this.mimeType = rec.mimeType || this.mimeType;
    const index = this.nextIndex++;
    // Capture this segment's start time in the closure — `rotate()` starts the
    // next segment before this one's `onstop` fires, so reading a shared field
    // here would give the wrong (next-segment) start time.
    const segStartAt = this.clock();

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      const durationMs = Math.max(0, this.clock() - segStartAt);
      this.finalized.add(index);
      this.finalizePromises.push(this.finalizeSegment(index, chunks, rec.mimeType, durationMs));
    };
    rec.onerror = (e: any) => console.error('[SegmentRecorder] recorder error:', e);

    try {
      // timeslice keeps data flushing so the final ondataavailable is small
      // (and so checkpoints have the audio so far).
      rec.start(1000);
    } catch (err) {
      console.error('[SegmentRecorder] Failed to start MediaRecorder:', err);
      return;
    }
    this.recorder = rec;
    this.current = { index, chunks, startedAt: segStartAt };

    // Schedule rotation. While the tab is throttled this can fire late — the
    // segment just runs longer; rotate() starts the next recorder before
    // stopping this one, so no audio falls between segments.
    if (typeof window !== 'undefined') {
      this.rotationTimer = window.setTimeout(() => this.rotate(), SEGMENT_DURATION_MS);
    }
  }

  /** Cut the current segment and immediately continue on a new recorder. */
  private rotate(): void {
    if (this.stopped) return;
    if (this.rotationTimer !== null) {
      clearTimeout(this.rotationTimer);
      this.rotationTimer = null;
    }
    const finishing = this.recorder;
    // Start the next segment first so the gap between recorders is minimal.
    this.beginSegment();
    if (finishing && finishing.state !== 'inactive') {
      try { finishing.stop(); } catch { /* onstop still fires or segment is dropped */ }
    }
  }

  /** End the current segment now and continue in a new one (e.g. after a sleep). */
  cutSegment(): void {
    console.log(`[SegmentRecorder] cutting segment early for ${this.sessionId}`);
    this.rotate();
  }

  /** Record a sleep the recording resumed across, in the manifest. */
  recordGap(gap: SegmentGap): Promise<void> {
    return this.enqueueWrite(async () => {
      const manifest = await this.readOrCreateManifest();
      manifest.gaps = [...(manifest.gaps ?? []), gap];
      await saveSegmentManifest(manifest);
    });
  }

  /**
   * Save the in-progress segment's audio so far (blob + `partial` manifest
   * entry), so a closed or crashed tab loses at most one checkpoint interval.
   * A webm made of the recorder's timeslice chunks from the start is decodable.
   */
  checkpoint(): Promise<void> {
    const cur = this.current;
    if (this.stopped || !cur || cur.chunks.length === 0 || this.finalized.has(cur.index)) {
      return Promise.resolve();
    }
    const index = cur.index;
    const blob = new Blob(cur.chunks.slice(), { type: this.mimeType });
    const durationMs = Math.max(0, this.clock() - cur.startedAt);
    const ext = extFromMime(this.mimeType);
    return this.enqueueWrite(async () => {
      if (this.finalized.has(index)) return; // the real blob is already queued
      await saveSegmentBlob(this.sessionId, index, blob);
      await this.upsertManifestEntryNow({ index, ext, uploaded: false, durationMs, partial: true }, 'checkpoint');
    });
  }

  /** Cache the segment, add it to the manifest, and kick off its upload. */
  private async finalizeSegment(
    index: number,
    chunks: Blob[],
    mime: string,
    durationMs: number,
  ): Promise<void> {
    const blob = new Blob(chunks, { type: mime || this.mimeType });
    if (blob.size === 0) return; // nothing captured (e.g. instant stop) — skip.
    const ext = extFromMime(mime || this.mimeType);

    // Cache first (crash safety), then record in the manifest.
    await this.enqueueWrite(async () => {
      await saveSegmentBlob(this.sessionId, index, blob);
      await this.upsertManifestEntryNow({ index, ext, uploaded: false, durationMs, partial: false }, 'finalize');
    });

    // Phase 3: queue this segment for background transcription NOW — the blob
    // is cached, so we deliberately do not wait for the upload. Fire-and-forget
    // and fully guarded: a queueing failure must never affect recording.
    if (LIVE_TRANSCRIPTION) {
      try { enqueueSegment(this.sessionId, index); } catch (err) {
        console.warn('[SegmentRecorder] enqueueSegment failed (non-critical):', err);
      }
    }

    // Upload in the background — never block recording on the network.
    this.uploadPromises.push(this.uploadSegment(index, blob, ext));

    // Decode check at segment close. With live transcription on, the live
    // worker's decode for transcription IS the check (no second decode).
    if (!LIVE_TRANSCRIPTION) void checkSegmentDecodes(this.sessionId, index, blob);
  }

  private async uploadSegment(index: number, blob: Blob, ext: string): Promise<void> {
    if (this.tornDown) {
      console.warn(`[SegmentRecorder] refusing upload of seg ${index} for torn-down ${this.sessionId}`);
      return;
    }
    try {
      const path = await uploadAudioToStorage(blob, segmentStoragePath(this.sessionId, index, ext));
      await this.enqueueWrite(() =>
        this.upsertManifestEntryNow({ index, ext, uploaded: true, storagePath: path, durationMs: 0 }, 'upload'),
      );
      const m = await getSegmentManifest(this.sessionId);
      const uploaded = m ? m.segments.filter((s) => s.uploaded).length : 0;
      const total = m ? m.segments.length : 0;
      this.onSegmentUploaded?.(uploaded, total);
    } catch (err: any) {
      // Leave uploaded:false — recovery/stop retry will pick it up. Recording
      // continues regardless; a transient network drop must never stop it.
      console.warn(`[SegmentRecorder] Segment ${index} upload failed (will retry):`, err?.message);
    }
  }

  private async readOrCreateManifest(): Promise<SegmentManifest> {
    const existing = await getSegmentManifest(this.sessionId);
    return existing || {
      sessionId: this.sessionId,
      source: this.source,
      startedAt: Date.now(),
      mimeType: this.mimeType,
      segments: [],
      updatedAt: Date.now(),
    };
  }

  /**
   * Merge a segment entry into the persisted manifest, creating it if needed.
   * MUST run inside the write queue (read-modify-write).
   *   finalize   — the segment's real entry (clears `partial`)
   *   upload     — only the upload fields; duration from finalize is kept
   *   checkpoint — only while the entry is still partial (never downgrades a finalized one)
   */
  private async upsertManifestEntryNow(
    entry: SegmentEntry,
    mode: 'finalize' | 'upload' | 'checkpoint',
  ): Promise<void> {
    const manifest = await this.readOrCreateManifest();
    const i = manifest.segments.findIndex((s) => s.index === entry.index);
    if (i === -1) {
      manifest.segments.push(entry);
    } else if (mode === 'upload') {
      manifest.segments[i] = {
        ...manifest.segments[i],
        uploaded: entry.uploaded,
        storagePath: entry.storagePath ?? manifest.segments[i].storagePath,
      };
    } else if (mode === 'checkpoint') {
      if (!manifest.segments[i].partial) return;
      manifest.segments[i] = { ...manifest.segments[i], ...entry };
    } else {
      manifest.segments[i] = { ...manifest.segments[i], ...entry };
    }
    manifest.segments.sort((a, b) => a.index - b.index);
    await saveSegmentManifest(manifest);
  }

  /**
   * Stop recording: flush the final segment, wait for caching + all pending
   * uploads, retry any that are still un-uploaded once, then resolve.
   * Returns the sessionId so the caller can read the finished manifest.
   * After this resolves the recorder is torn down for good.
   */
  async stop(): Promise<string> {
    this.stopped = true;
    // No longer actively recording in this tab. The freshness guard (recent
    // updatedAt) still protects the brief handoff/processing window that
    // follows, so recovery can't grab this manifest before it's handled.
    if (activeSegmentSessionId === this.sessionId) activeSegmentSessionId = null;
    if (this.rotationTimer !== null) {
      clearTimeout(this.rotationTimer);
      this.rotationTimer = null;
    }

    const finishing = this.recorder;
    if (finishing && finishing.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        const prev = finishing.onstop;
        finishing.onstop = (ev) => {
          if (prev) (prev as any).call(finishing, ev);
          resolve();
        };
        try { finishing.stop(); } catch { resolve(); }
      });
    }
    this.recorder = null;
    this.current = null;

    // Wait for all segment finalizes (cache + manifest) and background uploads.
    await Promise.allSettled(this.finalizePromises);
    await Promise.allSettled(this.uploadPromises);
    await this.lastWrite;
    await reuploadPendingSegments(this.sessionId);
    this.tornDown = true;
    return this.sessionId;
  }
}

/**
 * Permanently remove a segmented recording: Storage objects, the IndexedDB
 * manifest + cached blobs, live transcripts and per-segment chunk caches —
 * ONLY if `deletion` satisfies the hard rule in segmentCleanupPolicy.ts
 * (automatic: row 'completed' with no unclear/failed parts; otherwise only a
 * user-confirmed Discard/Delete). Returns false, touching nothing, if refused.
 */
export async function deleteSegmentedRecording(
  recoveryId: string,
  manifest: SegmentManifest | null | undefined,
  deletion: SegmentDeletion,
): Promise<boolean> {
  const m = manifest ?? (await getSegmentManifest(recoveryId));
  return deleteRecordingSegments(
    {
      deleteAudioPaths,
      clearManifest: clearSegmentManifest,
      clearTranscripts: clearSegmentTranscripts,
      clearChunkCache: clearChunkTranscripts,
    },
    recoveryId,
    m,
    deletion,
  );
}


/**
 * Turn an UPLOADED audio file into the same segment manifest a live recording
 * produces, so a manual upload can use the identical downstream pipeline
 * (per-segment upload, per-segment transcription, stitched into one transcript,
 * one session).
 *
 * Why this exists: the manual-upload path previously PUT the whole file to
 * Storage in one request, which is how a 813 MB / 3.5h MP3 came back
 * `413 EntityTooLarge`, and then transcribed it as a single blob. Splitting
 * client-side means we upload ~42 small objects instead of one huge one — each
 * individually retryable and crash-recoverable through the machinery already
 * built for recordings.
 *
 * Returns null when the file's format can't be cut safely (see audioSplitter:
 * m4a/mp4/webm/ogg need real remuxing). The caller should fall back to the
 * whole-file path rather than risk corrupt audio.
 *
 * Uploads are deliberately left to `reuploadPendingSegments`, which already
 * handles per-segment retry — segments are cached and written to the manifest
 * as `uploaded: false` first, so a failure mid-upload is resumable rather than
 * losing the import.
 */
export async function ingestFileAsSegments(
  file: File,
  sessionId: string,
  source: string,
  onProgress?: (phase: 'splitting' | 'saving' | 'uploading', fraction: number) => void,
): Promise<SegmentManifest | null> {
  const segments = await splitAudioFile(file, SEGMENT_DURATION_MS / 1000, (f) =>
    onProgress?.('splitting', f),
  );
  if (!segments || segments.length === 0) return null;

  const mimeType = segments[0].ext === 'wav' ? 'audio/wav' : 'audio/mpeg';
  const manifest: SegmentManifest = {
    sessionId,
    source,
    startedAt: Date.now(),
    mimeType,
    segments: [],
    updatedAt: Date.now(),
  };

  // Cache every segment first (crash safety), then persist the manifest once.
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    await saveSegmentBlob(sessionId, seg.index, seg.blob);
    manifest.segments.push({
      index: seg.index,
      ext: seg.ext,
      uploaded: false,
      durationMs: seg.durationMs,
    });
    onProgress?.('saving', (i + 1) / segments.length);
  }
  await saveSegmentManifest(manifest);

  onProgress?.('uploading', 0);
  await reuploadPendingSegments(sessionId);
  onProgress?.('uploading', 1);

  return (await getSegmentManifest(sessionId)) ?? manifest;
}

/**
 * Re-upload any segments still marked `uploaded: false` from their cached
 * IndexedDB blobs. Safe to call standalone during crash recovery. Best-effort.
 */
export async function reuploadPendingSegments(sessionId: string): Promise<void> {
  const manifest = await getSegmentManifest(sessionId);
  if (!manifest) return;
  const uploaded = new Map<number, string>();
  for (const seg of manifest.segments) {
    if (seg.uploaded && seg.storagePath) continue;
    const blob = await getSegmentBlob(sessionId, seg.index);
    if (!blob) continue;
    try {
      uploaded.set(seg.index, await uploadAudioToStorage(blob, segmentStoragePath(sessionId, seg.index, seg.ext)));
    } catch (err: any) {
      console.warn(`[SegmentRecorder] Re-upload of segment ${seg.index} failed:`, err?.message);
    }
  }
  if (uploaded.size === 0) return;
  // Merge into the CURRENT manifest inside the write queue (uploads are slow;
  // other writers may have changed it meanwhile). Never recreates a removed one.
  await enqueueRecordingWrite(sessionId, async () => {
    const m = await getSegmentManifest(sessionId);
    if (!m) return;
    for (const seg of m.segments) {
      const path = uploaded.get(seg.index);
      if (path) { seg.uploaded = true; seg.storagePath = path; }
    }
    await saveSegmentManifest(m);
  });
}


/**
 * Client retention pass over this device's segmented recordings (call once on
 * load). Applies the SHARED retention rules (via segmentCleanupPolicy) to any
 * recording whose local manifest hasn't changed for a day:
 *   - Storage folder already emptied by the server sweep (retention ended) but
 *     the recording HAD been uploaded → drop this device's local copy too.
 *   - otherwise → an automatic deletion request anchored on the newest Storage
 *     object, which the policy grants only for a completed recording whose
 *     retention allows it (never processing / interrupted / error, never an
 *     orphan — those are the server sweep's job).
 * A recording that never reached Storage (e.g. recorded offline) is the only
 * copy and is never touched here. Skips anything live.
 */
export async function applyLocalRetention(
  isLive: (recoveryId: string) => Promise<boolean | null>,
  describe: (recoveryId: string, manifest: SegmentManifest) => Promise<{ rowStatus: RecordingRowStatus | null; hasProblems: boolean }>,
): Promise<void> {
  try {
    const settledBefore = Date.now() - 24 * 60 * 60 * 1000;
    for (const m of await getAllSegmentManifests()) {
      if (m.updatedAt && m.updatedAt >= settledBefore) continue;
      if ((await isLive(m.sessionId)) === true) continue;
      const folder = await getRecordingFolderInfo(m.sessionId);
      if (!folder) continue; // couldn't check Storage — do nothing
      const everUploaded = m.segments.some((s) => s.uploaded || s.storagePath);
      if (folder.count === 0 && everUploaded) {
        await deleteSegmentedRecording(m.sessionId, m, { kind: 'local_only', reason: 'storage_already_deleted' });
        continue;
      }
      if (folder.count === 0) continue; // never uploaded: this device holds the only copy
      const { rowStatus, hasProblems } = await describe(m.sessionId, m);
      await deleteSegmentedRecording(m.sessionId, m, {
        kind: 'automatic',
        reason: 'retention_sweep',
        rowStatus,
        hasProblems,
        lastUploadMs: folder.lastUploadMs,
      });
    }
  } catch (err) {
    console.warn('[SegmentRecorder] retention pass failed:', err);
  }
}
