import { retryOperation } from "./geminiService";
import { supabase } from "./supabaseService";
import { uploadAudioToStorage, deleteAudioPaths } from "./storageService";
import { getChunkTranscripts, saveChunkTranscript } from "./recordingRecovery";

// Options for resumable / observable transcription. Both fields are optional so
// every existing call site (`transcribeAudioWithSarvam(blob)`) keeps working.
export interface SarvamTranscribeOptions {
  // When set, per-chunk transcripts are cached in IndexedDB and restored on
  // retry so interrupted long recordings resume instead of restarting.
  recoveryId?: string;
  // Fired as chunks complete (multi-chunk path only) for UI progress display.
  onProgress?: (done: number, total: number) => void;
}

const CHUNK_DURATION_MS = 25000; // 25 seconds per chunk (Sarvam REST API limit is 30s)

const getAuthToken = async (): Promise<string> => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not authenticated. Please log in.");
  return token;
};

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
const transcribeChunkInline = async (audioBlob: Blob, token: string): Promise<string> => {
  const audioBase64 = await blobToBase64(audioBlob);
  const mimeType = audioBlob.type || "audio/wav";

  const res = await fetch("/api/sarvam/transcribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      audioBase64,
      mimeType,
      filename: mimeType.includes("wav") ? "audio.wav" : "audio.webm",
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Sarvam proxy error ${res.status}`);
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
): Promise<{ transcript: string; storagePath: string }> => {
  const storagePath = await uploadAudioToStorage(audioBlob, pathSuffix);

  const res = await fetch("/api/sarvam/transcribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      audioPath: storagePath,
      mimeType: audioBlob.type || "audio/wav",
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Sarvam proxy error ${res.status}`);
  }

  const data = await res.json();
  return { transcript: data.transcript || "", storagePath };
};

// Probe the file's true duration via a transient <audio> element. Reads the
// container metadata only — no PCM decode, so it works reliably even on
// very long files where decodeAudioData runs out of memory.
const probeBlobDuration = (blob: Blob): Promise<number | null> => {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    audio.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
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
const splitAudioBlob = async (audioBlob: Blob, chunkDurationMs: number): Promise<Blob[]> => {
  const durationEstimateMs = (audioBlob.size / 16000) * 1000;
  if (durationEstimateMs <= 30000 || audioBlob.size < 500000) {
    return [audioBlob];
  }

  // Probe the source's true duration BEFORE decoding so we can detect
  // silent truncation afterwards.
  const probedDurationS = await probeBlobDuration(audioBlob);
  const arrayBuffer = await audioBlob.arrayBuffer();

  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await decodeForChunking(arrayBuffer);
  } catch (e) {
    console.warn("[Sarvam] Could not decode audio for chunking, sending as single request:", (e as Error)?.message);
    return [audioBlob];
  }

  // Sanity check: if the browser truncated during decode (typical for
  // very long webm/opus files), surface a clear error rather than
  // silently losing the tail. 10% tolerance covers normal rounding /
  // container vs PCM-length skew.
  if (probedDurationS !== null) {
    const decodedDurationS = audioBuffer.duration;
    const lossPct = (probedDurationS - decodedDurationS) / probedDurationS;
    console.log(
      `[Sarvam] Decoded ${decodedDurationS.toFixed(1)}s of ${probedDurationS.toFixed(1)}s ` +
      `(${audioBuffer.sampleRate} Hz, ${audioBuffer.numberOfChannels}ch, ${(lossPct * 100).toFixed(1)}% loss)`,
    );
    if (lossPct > 0.1) {
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
  const chunks: Blob[] = [];

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

    let offset = 44;
    for (let i = 0; i < chunkLength; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = audioBuffer.getChannelData(ch)[start + i];
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, clamped * 0x7fff, true);
        offset += 2;
      }
    }

    chunks.push(new Blob([wavBuffer], { type: "audio/wav" }));
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

  console.log(`[Sarvam] Transcribing audio (${(audioBlob.size / 1024).toFixed(1)} KB)...`);
  const token = await getAuthToken();
  const chunks = await splitAudioBlob(audioBlob, CHUNK_DURATION_MS);
  console.log(`[Sarvam] Split into ${chunks.length} chunk(s)`);

  // Single-chunk fast path: send inline as base64 — no storage needed
  if (chunks.length === 1) {
    return retryOperation(
      () => transcribeChunkInline(chunks[0], token),
      2,
      1000,
      "Sarvam STT",
    );
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
  const UNRECOGNISED_PLACEHOLDER = "[…audio unclear…]";

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
        if (cached[idx] !== undefined && cached[idx] !== UNRECOGNISED_PLACEHOLDER) {
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

  // Progress: count restored + freshly-completed chunks against the total.
  let completedCount = cachedIndices.size;
  const reportProgress = () => {
    try { onProgress?.(completedCount, chunks.length); } catch { /* ignore */ }
  };
  reportProgress();

  // Fire-and-forget cache write — a cache failure must never fail transcription.
  const cacheChunk = (idx: number, transcript: string) => {
    if (recoveryId) saveChunkTranscript(recoveryId, idx, chunks.length, transcript).catch(() => {});
  };

  // Only the not-yet-cached indices need work, batched at the given concurrency.
  const pendingIndices = chunks
    .map((_, idx) => idx)
    .filter((idx) => !cachedIndices.has(idx));

  try {
    // ── First pass: parallel batches, 4 attempts per chunk ─────────────
    for (let i = 0; i < pendingIndices.length; i += concurrency) {
      const batchIndices = pendingIndices.slice(i, i + concurrency);
      const batchResults = await Promise.allSettled(
        batchIndices.map((idx) => {
          const pathSuffix = `chunks/${sessionId}-${String(idx).padStart(4, "0")}.wav`;
          return retryOperation(
            () => transcribeChunkViaStorage(chunks[idx], token, pathSuffix),
            3,
            1000,
            `Sarvam STT chunk ${idx + 1}/${chunks.length}`,
          );
        }),
      );
      batchResults.forEach((result, j) => {
        const idx = batchIndices[j];
        if (result.status === "fulfilled") {
          results[idx] = result.value.transcript;
          uploadedPaths.push(result.value.storagePath);
          cacheChunk(idx, result.value.transcript);
          completedCount++;
          reportProgress();
        } else {
          console.warn(`[Sarvam] Chunk ${idx + 1} failed (pass 1): ${result.reason?.message}`);
          failedIndices.push(idx);
        }
      });
    }

    // ── Final pass: serial retry of stragglers ─────────────────────────
    if (failedIndices.length > 0) {
      console.warn(
        `[Sarvam] ${failedIndices.length} of ${chunks.length} chunks failed first pass — retrying serially…`,
      );
      for (const idx of failedIndices) {
        const pathSuffix = `chunks/${sessionId}-${String(idx).padStart(4, "0")}-retry.wav`;
        try {
          const result = await retryOperation(
            () => transcribeChunkViaStorage(chunks[idx], token, pathSuffix),
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
          console.warn(`[Sarvam] Chunk ${idx + 1} failed (final pass): ${err?.message}`);
          // Do NOT cache the placeholder — this chunk must be retried next time.
          results[idx] = UNRECOGNISED_PLACEHOLDER;
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

  const unrecognisedCount = results.filter((r) => r === UNRECOGNISED_PLACEHOLDER).length;
  const fullTranscript = results.join(" ").trim();
  if (unrecognisedCount > 0) {
    console.warn(
      `[Sarvam] ✅ Transcription complete (${fullTranscript.length} chars) — ${unrecognisedCount}/${chunks.length} chunks unrecognised after retries`,
    );
  } else {
    console.log(`[Sarvam] ✅ Transcription complete (${fullTranscript.length} chars)`);
  }
  return fullTranscript;
};
