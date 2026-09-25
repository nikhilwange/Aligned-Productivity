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

// ─── Pause markers ───────────────────────────────────────────────────────────
// A user pause shows as "[Paused 14:05–14:20]" (local time) between the
// segments either side of it. Markers are not pieces: they never count as
// speech in the trailing trim and are never unclear / failed.

export interface PauseMark {
  startedAt: number; // ms epoch
  endedAt: number; // ms epoch
  nextSegment: number; // first segment recorded after the pause
}

/** The pauses a manifest recorded (sleep gaps and older notes are ignored). */
export function pausesFromManifest(m: SegmentManifest | null | undefined): PauseMark[] {
  return (m?.gaps ?? [])
    .filter((g) => g.kind === 'pause' && typeof g.nextSegment === 'number')
    .map((g) => ({ startedAt: g.startedAt, endedAt: g.startedAt + g.gapMs, nextSegment: g.nextSegment! }));
}

const hhmm = (ms: number): string => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export const pauseLine = (startedAt: number, endedAt: number): string => `[Paused ${hhmm(startedAt)}–${hhmm(endedAt)}]`;

const PAUSE_LINE_RE = /^\[Paused \d{2}:\d{2}–\d{2}:\d{2}\]$/gm;
export const ANALYSIS_PAUSE_LINE = '--- Recording paused here ---';

/**
 * The copy of a transcript sent for analysis: each pause line becomes a
 * neutral marker without times, so the times are never read as meeting
 * content. The saved transcript keeps the full line.
 */
export const transcriptForAnalysis = (transcript: string): string =>
  transcript.replace(PAUSE_LINE_RE, ANALYSIS_PAUSE_LINE);

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
 *
 * Pause lines go in AFTER the trim, before the first kept segment recorded
 * after each pause — only when a kept segment precedes it too, so a pause at
 * the very start or end adds nothing. Pauses with no kept segment between
 * them (e.g. a skipped sub-second segment) merge into one line.
 */
export function buildSegmentedTranscript(pieces: SegmentPiece[], fallbackDurationSec: number, pauses: PauseMark[] = []): BuiltTranscript {
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
  // Kept-piece position → the (merged) pause just before it.
  const pauseBefore = new Map<number, { startedAt: number; endedAt: number }>();
  for (const pz of pauses) {
    const at = kept.findIndex((p) => p.seg.index >= pz.nextSegment);
    if (at <= 0) continue; // nothing kept before it, or nothing kept after it
    const prev = pauseBefore.get(at);
    pauseBefore.set(at, prev
      ? { startedAt: Math.min(prev.startedAt, pz.startedAt), endedAt: Math.max(prev.endedAt, pz.endedAt) }
      : { startedAt: pz.startedAt, endedAt: pz.endedAt });
  }
  const transcript = kept
    .flatMap((p, i) => {
      const text = p.status === 'failed' && !(p.text ?? '').includes(UNCLEAR_MARKER) ? FAILED_SEGMENT_TEXT : p.text;
      const pz = pauseBefore.get(i);
      return pz ? [pauseLine(pz.startedAt, pz.endedAt), text] : [text];
    })
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
