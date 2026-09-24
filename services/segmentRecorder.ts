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

import { uploadAudioToStorage, deleteAudioPaths } from './storageService';
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
} from './recordingRecovery';
import { LIVE_TRANSCRIPTION } from '../config/features';
import { startLiveTranscription, enqueueSegment } from './liveTranscription';
import { splitAudioFile } from './audioSplitter';

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

  // Every IndexedDB write for this recording (segment blobs + manifest) runs
  // through this queue, in order. The manifest is read-modify-write, so
  // concurrent writers (finalize / upload / checkpoint) used to be able to
  // drop each other's entries.
  private writeQueue: Promise<void> = Promise.resolve();

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
    const run = this.writeQueue.then(task);
    this.writeQueue = run.catch(() => {});
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
    await this.writeQueue;
    await reuploadPendingSegments(this.sessionId);
    this.tornDown = true;
    return this.sessionId;
  }
}

/**
 * Permanently remove a segmented recording: Storage objects, the IndexedDB
 * manifest + cached blobs, live transcripts and per-segment chunk caches.
 * Used on success cleanup, explicit Discard, and deleting a session.
 */
export async function deleteSegmentedRecording(recoveryId: string, manifest?: SegmentManifest | null): Promise<void> {
  const m = manifest ?? (await getSegmentManifest(recoveryId));
  if (m) {
    const paths = m.segments.map((s) => s.storagePath).filter((p): p is string => !!p);
    if (paths.length > 0) {
      await deleteAudioPaths(paths).catch((err) =>
        console.error('[SegmentRecorder] Segment storage cleanup failed:', err?.message));
    }
    m.segments.forEach((s) => clearChunkTranscripts(`${recoveryId}:seg${s.index}`));
  }
  await clearSegmentManifest(recoveryId);
  await clearSegmentTranscripts(recoveryId); // Phase 3 live transcripts
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
  let changed = false;
  for (const seg of manifest.segments) {
    if (seg.uploaded && seg.storagePath) continue;
    const blob = await getSegmentBlob(sessionId, seg.index);
    if (!blob) continue;
    try {
      const path = await uploadAudioToStorage(blob, segmentStoragePath(sessionId, seg.index, seg.ext));
      seg.uploaded = true;
      seg.storagePath = path;
      changed = true;
    } catch (err: any) {
      console.warn(`[SegmentRecorder] Re-upload of segment ${seg.index} failed:`, err?.message);
    }
  }
  if (changed) {
    manifest.updatedAt = Date.now();
    await saveSegmentManifest(manifest);
  }
}
