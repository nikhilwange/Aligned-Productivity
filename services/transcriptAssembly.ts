// ─── Transcript assembly (pure) ─────────────────────────────────────────────
//
// How per-segment results become one transcript and one saved duration.
// Shared by the post-Finish pipeline and "Re-transcribe unclear parts" (via
// services/segmentTranscript.ts). No runtime imports beyond pure config, so
// tests/segmentCleanup.test.mts runs it directly under Node.
//
// Every segment ends in one of:
//   ok       transcribed ("" for silence is fine)
//   unclear  transcribed, but some chunks failed every retry (marker inside)
//   failed   not transcribed at all; its text IS the marker, so the saved
//            transcript always shows it — which is how the server sweep
//            (supabase/functions/audio-retention) knows the session still has
//            parts worth a retry
//   skipped  not attempted (the recording hit its STT ceiling)

import type { SegmentEntry, SegmentManifest, SegmentResultStatus } from './recordingRecovery';
import { DECODED_DURATION_TOLERANCE } from '../config/sttLimits.ts';
import { UNCLEAR_MARKER } from '../supabase/functions/_shared/audioRetention.ts';

export type PieceStatus = SegmentResultStatus | 'skipped';

export interface SegmentPiece {
  seg: SegmentEntry;
  text: string | null; // null = no text (skipped)
  status: PieceStatus;
}

/** The text a wholly failed segment contributes to the transcript. */
export const FAILED_SEGMENT_TEXT = UNCLEAR_MARKER;

/** Status of a stored result; records from before statuses existed are derived from their text. */
export function resultStatus(r: { transcript: string; status?: SegmentResultStatus } | undefined): SegmentResultStatus | null {
  if (!r) return null;
  if (r.status) return r.status;
  return r.transcript.includes(UNCLEAR_MARKER) ? 'unclear' : 'ok';
}

export const needsRetry = (status: PieceStatus | null): boolean => status === 'unclear' || status === 'failed';

// ─── Saved duration ──────────────────────────────────────────────────────────
// durationMs is the recorder's audio clock (authoritative, and what the
// truncation check compares against). decodedMs is what the decoder found.
// The saved duration uses decodedMs only when the two agree within
// DECODED_DURATION_TOLERANCE; a larger mismatch is logged and the clock wins.
export function segmentSavedMs(seg: SegmentEntry): number {
  const clock = seg.durationMs || 0;
  const decoded = seg.decodedMs;
  if (!decoded || decoded <= 0) return clock;
  if (!clock) return decoded;
  if (Math.abs(decoded - clock) / clock <= DECODED_DURATION_TOLERANCE) return decoded;
  console.warn(`[SegmentRecorder] seg ${seg.index}: decoded ${decoded}ms vs clock ${clock}ms (>${DECODED_DURATION_TOLERANCE * 100}% apart) — using clock`);
  return clock;
}
export const manifestSavedMs = (m: SegmentManifest): number =>
  m.segments.reduce((s, seg) => s + segmentSavedMs(seg), 0);

// ─── Stitching ───────────────────────────────────────────────────────────────

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
  (t ?? '').split(UNCLEAR_MARKER).join(' ').trim().split(/\s+/).filter(Boolean).length;

/**
 * Stitch segment texts into one transcript, trimming trailing non-speech.
 *
 * A recording left running after the meeting ends tails off into segments
 * with no real speech. They are dropped from the transcript and from the
 * saved duration — but ONLY trailing segments whose status is 'ok' and whose
 * text is empty, or has fewer than TRAIL_MIN_WORDS words over at least
 * TRAIL_SPARSE_MIN_MS of audio. A short final segment with a few real words
 * ("thanks, bye") is kept. Trimming stops at the first trailing segment that
 * is 'unclear', 'failed' or 'skipped': unclear/failed ones are retryable (their
 * audio is kept), so they are never trimmed. The first segment is never trimmed.
 *
 * A 'failed' segment always contributes FAILED_SEGMENT_TEXT (the marker), even
 * if its stored text is empty, so the saved transcript reveals it.
 */
export function buildSegmentedTranscript(pieces: SegmentPiece[], fallbackDurationSec: number): BuiltTranscript {
  let keep = pieces.length;
  while (keep > 1) {
    const { seg, text, status } = pieces[keep - 1];
    if (status !== 'ok') break;
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
    .map((p) => (p.status === 'failed' && !(p.text ?? '').includes(UNCLEAR_MARKER) ? FAILED_SEGMENT_TEXT : p.text))
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
