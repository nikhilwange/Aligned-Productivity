// ─── Per-segment transcription + transcript assembly ────────────────────────
//
// Shared by the post-Finish pipeline and "Re-transcribe unclear parts", so
// both classify, store and stitch segments exactly the same way.
//
// Every segment ends in one of:
//   ok       transcribed ("" for silence is fine)
//   unclear  transcribed, but some chunks failed every retry (placeholder inside)
//   failed   not transcribed at all (undecodable, unavailable, or errored after
//            retries). Its audio is KEPT so it can be retried — never silently
//            turned into a placeholder and forgotten.
//   skipped  not attempted (the recording hit its STT ceiling)
// The result (text + status) is stored per segment in IndexedDB, which is what
// lets a later re-transcription patch the transcript in place.

import { transcribeAudioWithSarvam, isSegmentDecodeError, UNCLEAR_PLACEHOLDER } from './sarvamService';
import { downloadAudioFromStorage } from './storageService';
import { getSegmentBlob, saveSegmentTranscript, type SegmentEntry, type SegmentResultStatus } from './recordingRecovery';
import { getRecordingInitSegment, patchSegmentEntry, persistRepairedSegment, segmentSavedMs } from './segmentRecorder';
import { isUsageLimitError } from './usageLimit';

export type PieceStatus = SegmentResultStatus | 'skipped';

export interface SegmentPiece {
  seg: SegmentEntry;
  text: string | null; // null = no text (skipped)
  status: PieceStatus;
}

/** Status of a stored result; records from before statuses existed are derived from their text. */
export function resultStatus(r: { transcript: string; status?: SegmentResultStatus } | undefined): SegmentResultStatus | null {
  if (!r) return null;
  if (r.status) return r.status;
  return r.transcript.includes(UNCLEAR_PLACEHOLDER) ? 'unclear' : 'ok';
}

export const needsRetry = (status: PieceStatus | null): boolean => status === 'unclear' || status === 'failed';

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
    await saveSegmentTranscript(recoveryId, seg.index, UNCLEAR_PLACEHOLDER, 'failed');
    return { seg, text: UNCLEAR_PLACEHOLDER, status: 'failed' };
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
    const status: SegmentResultStatus = text.includes(UNCLEAR_PLACEHOLDER) ? 'unclear' : 'ok';
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

export interface BuiltTranscript {
  transcript: string;
  /** Seconds of audio up to the last segment with real speech. */
  durationSec: number;
  trimmedCount: number;
  /** Kept segments that are unclear or failed (worth a re-transcription). */
  problems: number;
}

const TRAIL_MIN_WORDS = 30;
const TRAIL_SPARSE_MIN_MS = 2 * 60 * 1000;
const wordCount = (t: string | null) =>
  (t ?? '').split(UNCLEAR_PLACEHOLDER).join(' ').trim().split(/\s+/).filter(Boolean).length;

/**
 * Stitch segment texts into one transcript, trimming trailing non-speech.
 *
 * A recording left running after the meeting ends (or one that died
 * mid-segment) tails off into segments with no real speech. They are dropped
 * from the transcript and from the saved duration when a trailing segment
 * has no words (empty, skipped, or only the unclear placeholder), or fewer
 * than TRAIL_MIN_WORDS words over at least TRAIL_SPARSE_MIN_MS of audio. A
 * short final segment with a few real words ("thanks, bye") is kept. A
 * 'failed' segment is never trimmed (its audio is kept for a retry), and the
 * first segment is never trimmed.
 */
export function buildSegmentedTranscript(pieces: SegmentPiece[], fallbackDurationSec: number): BuiltTranscript {
  let keep = pieces.length;
  while (keep > 1) {
    const { seg, text, status } = pieces[keep - 1];
    if (status === 'failed') break;
    const words = wordCount(text);
    const sparse = words < TRAIL_MIN_WORDS && (seg.durationMs || 0) >= TRAIL_SPARSE_MIN_MS;
    if (words > 0 && !sparse) break;
    keep--;
  }
  const kept = pieces.slice(0, keep);
  const keptMs = kept.reduce((s, p) => s + segmentSavedMs(p.seg), 0);
  // Join segments with a blank line, not a space. Collapsing on /\s+/ used to
  // eat every newline, leaving multi-hour meetings as one unbroken line.
  const transcript = kept
    .map((p) => p.text)
    .filter((t): t is string => t !== null)
    .map((t) => t.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n\n');
  return {
    transcript,
    durationSec: keptMs > 0 ? Math.round(keptMs / 1000) : fallbackDurationSec,
    trimmedCount: pieces.length - keep,
    problems: kept.filter((p) => needsRetry(p.status)).length,
  };
}
