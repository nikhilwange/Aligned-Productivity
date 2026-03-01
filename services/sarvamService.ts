import { retryOperation } from "./geminiService";
import { supabase } from "./supabaseService";

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

// Transcribe a single audio chunk via the secure API route
const transcribeChunk = async (audioBlob: Blob, token: string): Promise<string> => {
  const audioBase64 = await blobToBase64(audioBlob);
  const mimeType = audioBlob.type || "audio/webm";

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

// Split an audio blob into time-based chunks using OfflineAudioContext
// (This runs entirely client-side — no change from original)
const splitAudioBlob = async (audioBlob: Blob, chunkDurationMs: number): Promise<Blob[]> => {
  const durationEstimateMs = (audioBlob.size / 16000) * 1000;
  if (durationEstimateMs <= 30000 || audioBlob.size < 500000) {
    return [audioBlob];
  }

  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  } catch {
    console.warn("[Sarvam] Could not decode audio for chunking, sending as single request");
    await audioContext.close();
    return [audioBlob];
  }

  await audioContext.close();

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
export const transcribeAudioWithSarvam = async (audioBlob: Blob): Promise<string> => {
  console.log(`[Sarvam] Transcribing audio (${(audioBlob.size / 1024).toFixed(1)} KB)...`);
  const token = await getAuthToken();
  const chunks = await splitAudioBlob(audioBlob, CHUNK_DURATION_MS);
  console.log(`[Sarvam] Split into ${chunks.length} chunk(s)`);

  if (chunks.length === 1) {
    return retryOperation(
      () => transcribeChunk(chunks[0], token),
      2,
      1000,
      "Sarvam STT"
    );
  }

  const results: string[] = new Array(chunks.length).fill("");
  const concurrency = 3;

  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((chunk, j) =>
        retryOperation(
          () => transcribeChunk(chunk, token),
          2,
          1000,
          `Sarvam STT chunk ${i + j + 1}/${chunks.length}`
        )
      )
    );
    batchResults.forEach((text, j) => {
      results[i + j] = text;
    });
  }

  const fullTranscript = results.join(" ").trim();
  console.log(`[Sarvam] ✅ Transcription complete (${fullTranscript.length} chars)`);
  return fullTranscript;
};
