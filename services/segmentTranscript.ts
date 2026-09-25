// ─── Per-segment transcription ──────────────────────────────────────────────
//
// Shared by the post-Finish pipeline and "Re-transcribe unclear parts", so
// both classify and store segments exactly the same way. The pure part —
// statuses, stitching, trimming, saved duration — lives in
// services/transcriptAssembly.ts (re-exported here for callers).
//
// Each segment's result (text + status) is stored in IndexedDB, which is what
// lets a later re-transcription patch the transcript in place. A 'failed'
// segment's text is the unclear marker, so the saved transcript always shows
// it and the server's retention sweep knows the session still needs a retry.

import { transcribeAudioWithSarvam, isSegmentDecodeError } from './sarvamService';
import { downloadAudioFromStorage } from './storageService';
import { getSegmentBlob, saveSegmentTranscript, type SegmentEntry, type SegmentResultStatus } from './recordingRecovery';
import { getRecordingInitSegment, patchSegmentEntry, persistRepairedSegment } from './segmentRecorder';
import { isUsageLimitError } from './usageLimit';
import { FAILED_SEGMENT_TEXT, type SegmentPiece } from './transcriptAssembly';
import { UNCLEAR_MARKER } from '../supabase/functions/_shared/audioRetention.ts';

export {
  buildSegmentedTranscript,
  resultStatus,
  needsRetry,
  type SegmentPiece,
  type PieceStatus,
  type BuiltTranscript,
} from './transcriptAssembly';

/**
 * Transcribe one segment and store its result. Returns the piece; throws only
 * for an abort (superseded run) or a usage-limit refusal (monthly / ceiling),
 * which the caller handles. Everything else becomes a 'failed' piece.
 */
export async function transcribeSegment(
  recoveryId: string,
  seg: SegmentEntry,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<SegmentPiece> {
  const fail = async (why: string): Promise<SegmentPiece> => {
    console.error(`[Pipeline] segment ${seg.index} failed — audio kept for retry: ${why}`);
    await saveSegmentTranscript(recoveryId, seg.index, FAILED_SEGMENT_TEXT, 'failed');
    return { seg, text: FAILED_SEGMENT_TEXT, status: 'failed' };
  };

  // Prefer the cached blob; fall back to the uploaded segment in Storage.
  let blob = await getSegmentBlob(recoveryId, seg.index);
  if (!blob && seg.storagePath) {
    try { blob = await downloadAudioFromStorage(seg.storagePath); } catch (e: any) {
      if (opts.signal?.aborted) throw e;
      console.error(`[Pipeline] segment ${seg.index} download failed:`, e?.message);
    }
  }
  if (!blob) return fail('audio unavailable');

  let initPromise: Promise<Blob | null> | null = null;
  const getInit = () => (initPromise ??= getRecordingInitSegment(recoveryId));
  const segBlob = blob;
  try {
    const text = await transcribeAudioWithSarvam(segBlob, {
      recoveryId: `${recoveryId}:seg${seg.index}`,
      signal: opts.signal,
      // The audio-clock duration: authoritative, and what the truncation
      // check compares against (a VBR MP3 slice would otherwise be mis-probed).
      knownDurationMs: seg.durationMs,
      getInitSegment: seg.index > 0 ? getInit : undefined,
      onDecoded: ({ decodedMs, repaired }) => {
        void patchSegmentEntry(recoveryId, seg.index, { decodedMs, decodeFailed: false });
        if (repaired) void getInit().then((init) => (init ? persistRepairedSegment(recoveryId, seg.index, init, segBlob) : undefined));
      },
      onProgress: opts.onProgress,
    });
    const status: SegmentResultStatus = text.includes(UNCLEAR_MARKER) ? 'unclear' : 'ok';
    await saveSegmentTranscript(recoveryId, seg.index, text, status);
    return { seg, text, status };
  } catch (e: any) {
    if (opts.signal?.aborted) throw e;
    if (isUsageLimitError(e)) throw e;
    if (isSegmentDecodeError(e)) {
      await patchSegmentEntry(recoveryId, seg.index, { decodeFailed: true });
      return fail(`undecodable — ${e.message}`);
    }
    return fail(e?.message ?? String(e));
  }
}
