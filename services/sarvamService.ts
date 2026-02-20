import { retryOperation } from './geminiService';

const SARVAM_API_URL = 'https://api.sarvam.ai/speech-to-text';
const CHUNK_DURATION_MS = 25000; // 25 seconds per chunk (REST API limit is 30s)

interface SarvamResponse {
  request_id: string | null;
  transcript: string;
  language_code: string | null;
  language_probability: number | null;
}

// Transcribe a single audio chunk (must be <30s)
const transcribeChunk = async (audioBlob: Blob): Promise<string> => {
  const apiKey = import.meta.env.VITE_SARVAM_API_KEY;
  if (!apiKey) throw new Error('VITE_SARVAM_API_KEY is missing.');

  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', 'saaras:v3');
  formData.append('language_code', 'unknown');

  const response = await fetch(SARVAM_API_URL, {
    method: 'POST',
    headers: { 'api-subscription-key': apiKey },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`Sarvam API error ${response.status}: ${errorText}`);
  }

  const data: SarvamResponse = await response.json();
  return data.transcript || '';
};

// Split an audio blob into time-based chunks using MediaSource/decoding
const splitAudioBlob = async (audioBlob: Blob, chunkDurationMs: number): Promise<Blob[]> => {
  // For short recordings, return as-is
  const durationEstimateMs = (audioBlob.size / 16000) * 1000; // rough estimate at 16kbps
  if (durationEstimateMs <= 30000 || audioBlob.size < 500000) {
    return [audioBlob];
  }

  // Use OfflineAudioContext to decode and re-encode chunks
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
  } catch {
    // If we can't decode (unsupported codec), just send the whole blob
    console.warn('[Sarvam] Could not decode audio for chunking, sending as single request');
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

    // Create a WAV blob for each chunk
    const numChannels = audioBuffer.numberOfChannels;
    const wavBuffer = new ArrayBuffer(44 + chunkLength * numChannels * 2);
    const view = new DataView(wavBuffer);

    // WAV header
    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + chunkLength * numChannels * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, chunkLength * numChannels * 2, true);

    // Interleave channels and write PCM data
    let offset = 44;
    for (let i = 0; i < chunkLength; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = audioBuffer.getChannelData(ch)[start + i];
        const clamped = Math.max(-1, Math.min(1, sample));
        view.setInt16(offset, clamped * 0x7fff, true);
        offset += 2;
      }
    }

    chunks.push(new Blob([wavBuffer], { type: 'audio/wav' }));
  }

  return chunks;
};

// Main export: Transcribe audio with Sarvam (handles chunking for long recordings)
export const transcribeAudioWithSarvam = async (audioBlob: Blob): Promise<string> => {
  console.log(`[Sarvam] Transcribing audio (${(audioBlob.size / 1024).toFixed(1)} KB)...`);

  const chunks = await splitAudioBlob(audioBlob, CHUNK_DURATION_MS);
  console.log(`[Sarvam] Split into ${chunks.length} chunk(s)`);

  if (chunks.length === 1) {
    return retryOperation(
      () => transcribeChunk(chunks[0]),
      2, 1000, 'Sarvam STT'
    );
  }

  // Transcribe chunks in parallel (max 3 concurrent)
  const results: string[] = new Array(chunks.length).fill('');
  const concurrency = 3;

  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((chunk, j) =>
        retryOperation(
          () => transcribeChunk(chunk),
          2, 1000, `Sarvam STT chunk ${i + j + 1}/${chunks.length}`
        )
      )
    );
    batchResults.forEach((text, j) => {
      results[i + j] = text;
    });
  }

  const fullTranscript = results.join(' ').trim();
  console.log(`[Sarvam] ✓ Transcription complete (${fullTranscript.length} chars)`);
  return fullTranscript;
};
