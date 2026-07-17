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

import { uploadAudioToStorage } from './storageService';
import {
  saveSegmentBlob,
  getSegmentBlob,
  getSegmentManifest,
  saveSegmentManifest,
  SegmentManifest,
  SegmentEntry,
} from './recordingRecovery';

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

export interface SegmentRecorderOptions {
  stream: MediaStream;
  sessionId: string; // == the recording's recoveryId
  source: string;
  // Called after each segment finishes uploading (or is queued), for UI hints.
  onSegmentUploaded?: (uploaded: number, total: number) => void;
}

export class SegmentRecorder {
  readonly sessionId: string;
  private stream: MediaStream;
  private source: string;
  private onSegmentUploaded?: (uploaded: number, total: number) => void;

  private recorder: MediaRecorder | null = null;
  private mimeType = 'audio/webm';
  private nextIndex = 0;
  private rotationTimer: number | null = null;
  private stopped = false;

  // Finalize (cache + manifest) promises and background upload promises so
  // stop() can wait for everything to settle before handing off.
  private finalizePromises: Promise<void>[] = [];
  private uploadPromises: Promise<void>[] = [];

  constructor(opts: SegmentRecorderOptions) {
    this.stream = opts.stream;
    this.sessionId = opts.sessionId;
    this.source = opts.source;
    this.onSegmentUploaded = opts.onSegmentUploaded;
  }

  start(): void {
    this.stopped = false;
    this.beginSegment();
  }

  /** Begin a fresh segment recorder on the shared stream. */
  private beginSegment(): void {
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
    const segStartAt = Date.now();

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      const durationMs = Date.now() - segStartAt;
      this.finalizePromises.push(this.finalizeSegment(index, chunks, rec.mimeType, durationMs));
    };
    rec.onerror = (e: any) => console.error('[SegmentRecorder] recorder error:', e);

    this.recorder = rec;
    // timeslice keeps data flushing so the final ondataavailable is small.
    rec.start(1000);

    // Schedule rotation for non-final segments.
    if (typeof window !== 'undefined') {
      this.rotationTimer = window.setTimeout(() => this.rotate(), SEGMENT_DURATION_MS);
    }
  }

  /** Cut the current segment and immediately continue on a new recorder. */
  private rotate(): void {
    if (this.stopped) return;
    const finishing = this.recorder;
    // Start the next segment first so the gap between recorders is minimal.
    this.beginSegment();
    if (finishing && finishing.state !== 'inactive') {
      try { finishing.stop(); } catch { /* onstop still fires or segment is dropped */ }
    }
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
    await saveSegmentBlob(this.sessionId, index, blob);
    const entry: SegmentEntry = { index, ext, uploaded: false, durationMs };
    await this.upsertManifestEntry(entry);

    // Upload in the background — never block recording on the network.
    this.uploadPromises.push(this.uploadSegment(index, blob, ext));
  }

  private async uploadSegment(index: number, blob: Blob, ext: string): Promise<void> {
    try {
      const path = await uploadAudioToStorage(blob, segmentStoragePath(this.sessionId, index, ext));
      await this.upsertManifestEntry({ index, ext, uploaded: true, storagePath: path, durationMs: 0 }, true);
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

  /** Merge a segment entry into the persisted manifest, creating it if needed. */
  private async upsertManifestEntry(entry: SegmentEntry, mergeUpload = false): Promise<void> {
    const existing = await getSegmentManifest(this.sessionId);
    const manifest: SegmentManifest = existing || {
      sessionId: this.sessionId,
      source: this.source,
      startedAt: Date.now(),
      mimeType: this.mimeType,
      segments: [],
      updatedAt: Date.now(),
    };
    const i = manifest.segments.findIndex((s) => s.index === entry.index);
    if (i === -1) {
      manifest.segments.push(entry);
    } else if (mergeUpload) {
      // Preserve durationMs from the finalize write; only update upload fields.
      manifest.segments[i] = {
        ...manifest.segments[i],
        uploaded: entry.uploaded,
        storagePath: entry.storagePath ?? manifest.segments[i].storagePath,
      };
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
   */
  async stop(): Promise<string> {
    this.stopped = true;
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

    // Wait for all segment finalizes (cache + manifest) and background uploads.
    await Promise.allSettled(this.finalizePromises);
    await Promise.allSettled(this.uploadPromises);
    await reuploadPendingSegments(this.sessionId);
    return this.sessionId;
  }
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
