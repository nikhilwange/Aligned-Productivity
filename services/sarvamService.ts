import { retryOperation } from "./geminiService";
import { supabase } from "./supabaseService";
import { uploadAudioToStorage, deleteAudioPaths } from "./storageService";
import { getChunkTranscripts, saveChunkTranscript } from "./recordingRecovery";
import { usageLimitFromBody, isUsageLimitError } from "./usageLimit";
import { SKIP_SILENT_CHUNKS, SILENT_CHUNK_RMS, SILENT_CHUNK_PEAK } from "../config/sttLimits";
// The ONE unclear marker — shared with the server's retention sweep, which
// detects "this session still has parts to retry" by it.
import { UNCLEAR_MARKER } from "../supabase/functions/_shared/audioRetention.ts";

const IS_DEV = !!(import.meta as any).env?.DEV;

// Sent on every proxy request so the server can tell current clients (which
// only ever send decoded WAV inline) from older cached bundles.
const CLIENT_HEADER = { "X-Aligned-Client": "web" };

// Options for resumable / observable transcription. Both fields are optional so
// every existing call site (`transcribeAudioWithSarvam(blob)`) keeps working.
export interface SarvamTranscribeOptions {
  // When set, per-chunk transcripts are cached in IndexedDB and restored on
  // retry so interrupted long recordings resume instead of restarting.
  recoveryId?: string;
  // Fired as chunks complete (multi-chunk path only) for UI progress display.
  onProgress?: (done: number, total: number) => void;
  // Superseding-run cancellation. When a newer pipeline for the same session
  // starts (Retry / auto-resume), the previous run's signal is aborted so its
  // in-flight chunk fetches cancel and the pipeline exits without writing state.
  signal?: AbortSignal;
  // True duration of this blob, when the caller already knows it, used INSTEAD
  // of probing with an <audio> element for the decode-truncation check below.
  //
  // Why this matters: a segment sliced out of a VBR MP3 carries no Xing/Info
  // header (that lives in the original file's first frame only), so browsers
  // fall back to estimating duration as size x 8 / first-frame-bitrate. On VBR
  // that estimate can be wildly high — a real 5-minute segment probed as 8 or
  // 13 minutes — which made the truncation check below fire on perfectly good
  // audio and drop the segment. Callers holding a segment manifest know the
  // real duration from the frame headers, so they should pass it.
  knownDurationMs?: number;
  // The recording's WebM header (EBML + Tracks, no audio), for ONE repair
  // attempt if this blob fails to decode (a segment whose header was lost).
  // Callers read it from segment 0 of the same recording.
  getInitSegment?: () => Promise<Blob | null>;
  // Fired once the blob has decoded: its decoded length, and whether that
  // needed the header repair (so the caller can persist the repaired file).
  onDecoded?: (info: { decodedMs: number; repaired: boolean }) => void;
}

const CHUNK_DURATION_MS = 25000; // 25 seconds per chunk (Sarvam REST API limit is 30s)

// Inline (base64-in-JSON) is allowed ONLY for a decoded WAV of at most this
// many seconds, and small enough for Vercel's 4.5 MB body cap. Everything
// else goes through Storage. Never decided by a size guess.
const INLINE_MAX_SECONDS = 28;
const INLINE_MAX_BYTES = 3 * 1024 * 1024;

/** Audio could not be decoded, even after a header repair. The segment's
 *  audio is kept; callers mark the segment failed and retryable. */
export class SegmentDecodeError extends Error {
  constructor(message: string) { super(message); this.name = 'SegmentDecodeError'; }
}
export const isSegmentDecodeError = (e: unknown): e is SegmentDecodeError =>
  e instanceof SegmentDecodeError ||
  (typeof e === 'object' && e !== null && (e as any).name === 'SegmentDecodeError');

/** The placeholder a chunk that failed every retry becomes in the transcript. */
export const UNCLEAR_PLACEHOLDER = UNCLEAR_MARKER;

interface WavChunk {
  blob: Blob;
  seconds: number;
  /** Below both silence thresholds — not worth sending to Sarvam. */
  silent: boolean;
}

// Hard ceiling on any single chunk-transcription request. Without this a hung
// request would only be caught by retryOperation's coarse 120s wall-timeout —
// and even then the underlying connection is left open. An AbortController both
// bounds the wait tighter (90s) and actually cancels the request.
const CHUNK_FETCH_TIMEOUT_MS = 90_000;

// Abort a fetch on whichever fires first: the per-request timeout, or an
// external superseding-run signal. The timeout throws a "timed out" error that
// retryOperation treats as retryable; an external abort propagates as an
// AbortError so the caller can exit silently instead of retrying.
const fetchWithTimeout = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
  externalSignal?: AbortSignal,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(timeoutMessage)), timeoutMs);
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort(externalSignal.reason);
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    // Timeout fired (external signal still live) → surface a retryable
    // "timed out" error. Otherwise re-throw the abort so it stays fatal.
    if (controller.signal.aborted && !externalSignal?.aborted) {
      throw new Error(timeoutMessage);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
};

// Parse a Retry-After value (delta-seconds or an HTTP date) into milliseconds.
const parseRetryAfterMs = (value?: string | null): number | null => {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const dateMs = Date.parse(value);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());
  return null;
};

// Build the error thrown when the Sarvam proxy returns a non-OK status,
// tagging 429s with a `retryAfterMs` so retryOperation waits the server-
// requested interval instead of its fixed exponential backoff.
const proxyError = (status: number, body: any, res: Response): Error => {
  const err: any = new Error(body?.error || `Sarvam proxy error ${status}`);
  err.status = status;
  if (status === 429) {
    const ms = parseRetryAfterMs(body?.retryAfter ?? res.headers.get('retry-after'));
    if (ms !== null) err.retryAfterMs = ms;
  }
  return err;
};

const getAuthToken = async (): Promise<string> => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not authenticated. Please log in.");
  return token;
};

// Sarvam rejects MIME types that carry parameters (e.g. `audio/webm;codecs=opus`
// from MediaRecorder) even though the base type `audio/webm` is allowed. Strip
// the parameter before sending. The proxy normalizes too, but doing it here
// keeps the request correct at the source.
const normalizeMime = (m?: string, fallback = "audio/wav"): string =>
  (m || fallback).split(";")[0].trim() || fallback;

const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result.split(",")[1]);
      } else {
        reject(new Error("Failed to convert blob to base64"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// Single-chunk path: small audio sent as base64 (no storage round-trip needed)
const transcribeChunkInline = async (
  audioBlob: Blob,
  token: string,
  sessionStart = false,
  signal?: AbortSignal,
  recoveryId?: string,
): Promise<string> => {
  const audioBase64 = await blobToBase64(audioBlob);
  const mimeType = normalizeMime(audioBlob.type);

  const res = await fetchWithTimeout(
    "/api/sarvam/transcribe",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...CLIENT_HEADER,
      },
      body: JSON.stringify({
        audioBase64,
        mimeType,
        filename: mimeType.includes("wav") ? "audio.wav" : "audio.webm",
        // Signals the server usage gate to run (only at session start).
        sessionStart,
        // Server-side STT ledger / per-recording ceiling key.
        recoveryId,
      }),
    },
    CHUNK_FETCH_TIMEOUT_MS,
    `Sarvam chunk request timed out after ${CHUNK_FETCH_TIMEOUT_MS / 1000}s`,
    signal,
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 402) throw usageLimitFromBody(err);
    throw proxyError(res.status, err, res);
  }

  const data = await res.json();
  return data.transcript || "";
};

// Multi-chunk path: each chunk uploaded to Supabase Storage, then referenced by path.
// This bypasses Vercel's body size limit (4.5 MB hard cap on Hobby) which would otherwise
// constrain very long recordings.
const transcribeChunkViaStorage = async (
  audioBlob: Blob,
  token: string,
  pathSuffix: string,
  sessionStart = false,
  signal?: AbortSignal,
  recoveryId?: string,
): Promise<{ transcript: string; storagePath: string }> => {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  const storagePath = await uploadAudioToStorage(audioBlob, pathSuffix);

  const res = await fetchWithTimeout(
    "/api/sarvam/transcribe",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...CLIENT_HEADER,
      },
      body: JSON.stringify({
        audioPath: storagePath,
        mimeType: normalizeMime(audioBlob.type),
        // Signals the server usage gate to run (only at session start).
        sessionStart,
        // Server-side STT ledger / per-recording ceiling key.
        recoveryId,
      }),
    },
    CHUNK_FETCH_TIMEOUT_MS,
    `Sarvam chunk request timed out after ${CHUNK_FETCH_TIMEOUT_MS / 1000}s`,
    signal,
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    if (res.status === 402) throw usageLimitFromBody(err);
    throw proxyError(res.status, err, res);
  }

  const data = await res.json();
  return { transcript: data.transcript || "", storagePath };
};

// Probe the file's true duration via a transient <audio> element. Reads the
// container metadata only — no PCM decode, so it works reliably even on
// very long files where decodeAudioData runs out of memory.
//
// MUST be bounded. Browsers throttle (and in background tabs may indefinitely
// suspend) media-element loading, so neither `loadedmetadata` nor `error` is
// guaranteed to fire — most reliably reproduced by live transcription, whose
// segments are probed while the tab sits behind a video-call window. An
// unbounded wait here hangs the whole transcription pipeline with no error.
// The probe is only a sanity check, so timing out and returning null is safe:
// the caller simply skips the decode-truncation comparison.
const PROBE_DURATION_TIMEOUT_MS = 15_000;

const probeBlobDuration = (blob: Blob): Promise<number | null> => {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      // Detach the source so a suspended load doesn't keep the element alive.
      try { audio.src = ''; } catch { /* ignore */ }
      URL.revokeObjectURL(url);
      resolve(value);
    };

    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    };
    audio.onerror = () => finish(null);
    timer = setTimeout(() => {
      console.warn(
        `[Sarvam] Duration probe timed out after ${PROBE_DURATION_TIMEOUT_MS}ms ` +
        `(tab likely backgrounded) — continuing without the truncation check.`,
      );
      finish(null);
    }, PROBE_DURATION_TIMEOUT_MS);
    audio.src = url;
  });
};

// Decode an audio file into a PCM AudioBuffer suitable for chunking.
//
// For long recordings (e.g. 45 min webm/opus ≈ 1 GB of PCM at 48 kHz
// stereo), Chrome's `AudioContext.decodeAudioData` is known to SILENTLY
// TRUNCATE rather than throw under memory pressure — the returned buffer
// is shorter than the source, with no error. The fix:
//   1. Decode through an OfflineAudioContext at 16 kHz mono first — that's
//      what Sarvam consumes anyway, and it cuts memory ~6× vs 48 kHz
//      stereo. Most browsers respect the context's sample rate during
//      decode and downsample automatically.
//   2. If the offline path fails (older Safari, etc.), fall back to a
//      regular AudioContext.
async function decodeForChunking(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
  const OfflineCtx: typeof OfflineAudioContext | undefined =
    (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
  if (OfflineCtx) {
    try {
      // length=1 sample is a dummy — decodeAudioData ignores it and
      // returns a buffer sized to the source. sampleRate=16000 asks the
      // decoder to resample down to 16 kHz inside its own pipeline.
      const ctx = new OfflineCtx(1, 1, 16000);
      // slice(0) — some implementations detach the buffer after decode;
      // copying preserves it for our fallback below.
      return await ctx.decodeAudioData(arrayBuffer.slice(0));
    } catch (e) {
      console.warn("[Sarvam] 16k offline decode failed, trying regular AudioContext:", (e as Error)?.message);
    }
  }
  const ctx2 = new (window.AudioContext || (window as any).webkitAudioContext)();
  try {
    return await ctx2.decodeAudioData(arrayBuffer);
  } finally {
    try { await ctx2.close(); } catch { /* ignore */ }
  }
}

// Split an audio blob into time-based WAV chunks using OfflineAudioContext.
//
// EVERY blob is decoded and re-cut into ≤25 s 16-bit WAV chunks, short blobs
// included. The old shortcut sent any blob under 500 KB as one unsplit
// request, assuming 16 KB/s; the recorder writes ~4 KB/s for speech and
// ~0.3 KB/s for silence, so those blobs held 2–30+ min of audio and Sarvam
// rejected them (400). Decoding a ≤5-min segment at 16 kHz is cheap.
const splitAudioBlob = async (
  audioBlob: Blob,
  chunkDurationMs: number,
  knownDurationMs?: number,
  getInitSegment?: () => Promise<Blob | null>,
  onDecoded?: (info: { decodedMs: number; repaired: boolean }) => void,
): Promise<WavChunk[]> => {
  // Establish the source's true duration BEFORE decoding so we can detect
  // silent truncation afterwards. A caller-supplied duration always wins: it
  // comes from the segment manifest (the recorder's audio clock, or MP3 frame
  // headers for a split upload) and is authoritative, whereas the <audio>
  // probe guesses from bitrate and is badly wrong for a VBR slice with no Xing
  // header. See knownDurationMs.
  const probedDurationS = knownDurationMs && knownDurationMs > 0
    ? knownDurationMs / 1000
    : await probeBlobDuration(audioBlob);

  let audioBuffer: AudioBuffer;
  let repaired = false;
  try {
    audioBuffer = await decodeForChunking(await audioBlob.arrayBuffer());
  } catch (e) {
    // NEVER send an undecodable blob raw. One repair attempt with the
    // recording's header prepended, then give up with a typed error.
    const firstError = (e as Error)?.message;
    const init = getInitSegment ? await getInitSegment().catch(() => null) : null;
    if (!init) {
      throw new SegmentDecodeError(`Audio could not be decoded (${firstError}) and no header was available to repair it.`);
    }
    console.warn(`[Sarvam] decode failed (${firstError}) — retrying with the recording's header prepended`);
    try {
      audioBuffer = await decodeForChunking(await new Blob([init, audioBlob]).arrayBuffer());
      repaired = true;
      console.warn(`[Sarvam] header repair worked: ${audioBuffer.duration.toFixed(1)}s decoded`);
    } catch (e2) {
      throw new SegmentDecodeError(`Audio could not be decoded even with the header repaired (${(e2 as Error)?.message}).`);
    }
  }
  try { onDecoded?.({ decodedMs: Math.round(audioBuffer.duration * 1000), repaired }); } catch { /* ignore */ }

  // Sanity check: if the browser truncated during decode (typical for
  // very long webm/opus files), surface a clear error rather than
  // silently losing the tail. 10% tolerance covers normal rounding /
  // container vs PCM-length skew; the 2 s floor covers a segment rebuilt
  // from a checkpoint, whose last ≤1 s chunk hadn't been delivered yet.
  if (probedDurationS !== null) {
    const decodedDurationS = audioBuffer.duration;
    const lossS = probedDurationS - decodedDurationS;
    const lossPct = lossS / probedDurationS;
    console.log(
      `[Sarvam] Decoded ${decodedDurationS.toFixed(1)}s of ${probedDurationS.toFixed(1)}s ` +
      `(${audioBuffer.sampleRate} Hz, ${audioBuffer.numberOfChannels}ch, ${(lossPct * 100).toFixed(1)}% loss)`,
    );
    if (lossPct > 0.1 && lossS > 2) {
      throw new Error(
        `Audio decode was truncated by the browser: only ${Math.round(decodedDurationS / 60)} of ` +
        `${Math.round(probedDurationS / 60)} minutes decoded. This file is too long for in-browser ` +
        `chunking — try splitting the recording into ~30-minute segments and uploading each separately.`,
      );
    }
  }

  const sampleRate = audioBuffer.sampleRate;
  const totalSamples = audioBuffer.length;
  const chunkSamples = Math.floor((chunkDurationMs / 1000) * sampleRate);
  const chunks: WavChunk[] = [];

  for (let start = 0; start < totalSamples; start += chunkSamples) {
    const end = Math.min(start + chunkSamples, totalSamples);
    const chunkLength = end - start;
    const numChannels = audioBuffer.numberOfChannels;
    const wavBuffer = new ArrayBuffer(44 + chunkLength * numChannels * 2);
    const view = new DataView(wavBuffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + chunkLength * numChannels * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, chunkLength * numChannels * 2, true);

    // Levels for the silent-chunk skip, measured on the same samples we write.
    let sumSquares = 0;
    let peak = 0;
    let offset = 44;
    for (let i = 0; i < chunkLength; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = audioBuffer.getChannelData(ch)[start + i];
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, clamped * 0x7fff, true);
        offset += 2;
        sumSquares += clamped * clamped;
        const abs = clamped < 0 ? -clamped : clamped;
        if (abs > peak) peak = abs;
      }
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, chunkLength * numChannels));
    const silent = SKIP_SILENT_CHUNKS && rms < SILENT_CHUNK_RMS && peak < SILENT_CHUNK_PEAK;
    if (IS_DEV) {
      console.debug(
        `[Sarvam] chunk levels #${chunks.length + 1}: rms ${rms.toFixed(4)} peak ${peak.toFixed(4)}` +
        `${silent ? ' → silent, skipped' : ''} (thresholds rms<${SILENT_CHUNK_RMS} & peak<${SILENT_CHUNK_PEAK})`,
      );
    }

    chunks.push({ blob: new Blob([wavBuffer], { type: "audio/wav" }), seconds: chunkLength / sampleRate, silent });
  }

  return chunks;
};

// Main export: Transcribe audio with Sarvam (handles chunking for long recordings)
export const transcribeAudioWithSarvam = async (
  audioBlob: Blob,
  opts?: SarvamTranscribeOptions,
): Promise<string> => {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error("No audio was captured. Please check your microphone and try again.");
  }

  const recoveryId = opts?.recoveryId;
  const onProgress = opts?.onProgress;
  const signal = opts?.signal;
  const throwIfAborted = () => {
    if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
  };

  console.log(`[Sarvam] Transcribing audio (${(audioBlob.size / 1024).toFixed(1)} KB)...`);
  const token = await getAuthToken();
  const chunks = await splitAudioBlob(
    audioBlob, CHUNK_DURATION_MS, opts?.knownDurationMs, opts?.getInitSegment, opts?.onDecoded,
  );
  console.log(`[Sarvam] Split into ${chunks.length} chunk(s)`);

  // Decoded to nothing (empty audio): an empty, successful result.
  if (chunks.length === 0) return "";

  // Silent chunks are never sent; they contribute "" to the transcript.
  const silentIndices = new Set(chunks.map((c, i) => (c.silent ? i : -1)).filter((i) => i >= 0));
  if (silentIndices.size > 0) {
    const silentSecs = chunks.filter((c) => c.silent).reduce((s, c) => s + c.seconds, 0);
    console.log(`[Sarvam] skipped ${silentIndices.size} silent chunk(s), ${silentSecs.toFixed(0)} s`);
  }
  // Every chunk silent: nothing to transcribe — an empty, successful result.
  if (silentIndices.size === chunks.length) return "";

  // Inline fast path ONLY for one decoded WAV chunk of ≤ INLINE_MAX_SECONDS
  // that fits the body cap; anything else takes the Storage path below.
  if (chunks.length === 1 && chunks[0].seconds <= INLINE_MAX_SECONDS && chunks[0].blob.size <= INLINE_MAX_BYTES) {
    const text = await retryOperation(
      () => transcribeChunkInline(chunks[0].blob, token, /* sessionStart */ true, signal, recoveryId),
      2,
      1000,
      "Sarvam STT",
    );
    console.log(`[Sarvam] ✅ Transcription complete (${text.length} chars)`);
    return text;
  }

  // Multi-chunk path: upload each chunk to Supabase Storage, transcribe by path,
  // then clean up. This avoids hitting Vercel's request body size cap on long recordings.
  //
  // Reliability profile (a 50-min recording = ~120 chunks):
  //   - concurrency=2: lower rate-limit pressure on Sarvam/Vercel than 3
  //     concurrent batches; ~50% more wall time but materially fewer chunk
  //     failures.
  //   - First-pass retry: 4 attempts per chunk (initial + 3 retries) with
  //     exponential backoff 1s → 2s → 4s → 8s.
  //   - Final-pass retry: any chunk still missing after the main loop is
  //     retried SERIALLY with a longer 3s → 6s → 12s backoff. This sidesteps
  //     transient rate-limit / cold-start issues that batch retries can't.
  //   - Last resort: chunks that fail BOTH passes are replaced with a
  //     friendly `[…audio unclear…]` placeholder (visible to the user but
  //     not alarming like `[chunk 51 failed]`).
  const sessionId = `sarvam-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const results: string[] = new Array(chunks.length).fill("");
  const uploadedPaths: string[] = [];
  const failedIndices: number[] = [];
  const concurrency = 2;

  // ── Resume: restore chunks already transcribed on a previous attempt ──
  // The cache is keyed by recoveryId and is only returned when its chunkCount
  // matches chunks.length, so a mismatched chunking can never be stitched in.
  const cachedIndices = new Set<number>();
  if (recoveryId) {
    const cached = await getChunkTranscripts(recoveryId, chunks.length);
    if (cached) {
      for (const key of Object.keys(cached)) {
        const idx = Number(key);
        // Never treat a cached placeholder as done — those must be re-attempted.
        if (cached[idx] !== undefined && cached[idx] !== UNCLEAR_PLACEHOLDER) {
          results[idx] = cached[idx];
          cachedIndices.add(idx);
        }
      }
      if (cachedIndices.size > 0) {
        console.log(
          `[Sarvam] Resumed: ${cachedIndices.size}/${chunks.length} chunks restored from cache, ` +
          `transcribing ${chunks.length - cachedIndices.size} remaining`,
        );
      }
    }
  }

  // Progress: count restored, silent and freshly-completed chunks against the total.
  let completedCount = new Set([...cachedIndices, ...silentIndices]).size;
  const reportProgress = () => {
    try { onProgress?.(completedCount, chunks.length); } catch { /* ignore */ }
  };
  reportProgress();

  // Fire-and-forget cache write — a cache failure must never fail transcription.
  const cacheChunk = (idx: number, transcript: string) => {
    if (recoveryId) saveChunkTranscript(recoveryId, idx, chunks.length, transcript).catch(() => {});
  };

  // Only the not-yet-cached, non-silent indices need work, batched at the given concurrency.
  const pendingIndices = chunks
    .map((_, idx) => idx)
    .filter((idx) => !cachedIndices.has(idx) && !silentIndices.has(idx));
  // The server's usage gate runs on this call's first request.
  const sessionStartIdx = pendingIndices[0];

  try {
    // ── First pass: parallel batches, 4 attempts per chunk ─────────────
    for (let i = 0; i < pendingIndices.length; i += concurrency) {
      throwIfAborted(); // superseded by a newer run — stop before the next batch
      const batchIndices = pendingIndices.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batchIndices.map((idx) => {
          const pathSuffix = `chunks/${sessionId}-${String(idx).padStart(4, "0")}.wav`;
          return retryOperation(
            () => transcribeChunkViaStorage(chunks[idx].blob, token, pathSuffix, /* sessionStart */ idx === sessionStartIdx, signal, recoveryId),
            3,
            1000,
            `Sarvam STT chunk ${idx + 1}/${chunks.length}`,
          );
        }),
      );
      for (let j = 0; j < batchResults.length; j++) {
        const result = batchResults[j];
        const idx = batchIndices[j];
        if (result.status === "fulfilled") {
          results[idx] = result.value.transcript;
          uploadedPaths.push(result.value.storagePath);
          cacheChunk(idx, result.value.transcript);
          completedCount++;
          reportProgress();
        } else {
          // Superseded by a newer run → stop immediately; don't degrade chunks
          // to placeholders or write any more state.
          if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
          // Monthly usage cap → abort the whole transcription (not a partial
          // degrade). Propagates out of the try/finally after cleanup.
          if (isUsageLimitError(result.reason)) throw result.reason;
          console.warn(`[Sarvam] Chunk ${idx + 1} failed (pass 1): ${result.reason?.message}`);
          failedIndices.push(idx);
        }
      }
    }

    // ── Final pass: serial retry of stragglers ─────────────────────────
    if (failedIndices.length > 0) {
      console.warn(
        `[Sarvam] ${failedIndices.length} of ${chunks.length} chunks failed first pass — retrying serially…`,
      );
      for (const idx of failedIndices) {
        throwIfAborted(); // superseded — stop before the next straggler
        const pathSuffix = `chunks/${sessionId}-${String(idx).padStart(4, "0")}-retry.wav`;
        try {
          const result = await retryOperation(
            () => transcribeChunkViaStorage(chunks[idx].blob, token, pathSuffix, /* sessionStart */ false, signal, recoveryId),
            3,
            3000,
            `Sarvam STT chunk ${idx + 1} (final pass)`,
          );
          results[idx] = result.transcript;
          uploadedPaths.push(result.storagePath);
          cacheChunk(idx, result.transcript);
          completedCount++;
          reportProgress();
        } catch (err: any) {
          if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
          if (isUsageLimitError(err)) throw err;
          console.warn(`[Sarvam] Chunk ${idx + 1} failed (final pass): ${err?.message}`);
          // Do NOT cache the placeholder — this chunk must be retried next time.
          results[idx] = UNCLEAR_PLACEHOLDER;
        }
      }
    }
  } finally {
    // Best-effort cleanup of transient chunk files (don't block on failures)
    if (uploadedPaths.length > 0) {
      deleteAudioPaths(uploadedPaths).catch((err) =>
        console.warn(`[Sarvam] Cleanup failed: ${err?.message}`),
      );
    }
  }

  const unrecognisedCount = results.filter((r) => r === UNCLEAR_PLACEHOLDER).length;
  const fullTranscript = results.filter((r) => r !== "").join(" ").trim();
  if (unrecognisedCount > 0) {
    console.warn(
      `[Sarvam] ✅ Transcription complete (${fullTranscript.length} chars) — ${unrecognisedCount}/${chunks.length} chunks unrecognised after retries`,
    );
  } else {
    console.log(`[Sarvam] ✅ Transcription complete (${fullTranscript.length} chars)`);
  }
  return fullTranscript;
};
