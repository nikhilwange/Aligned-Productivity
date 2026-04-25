import { MeetingAnalysis } from "../types";
import { supabase } from "./supabaseService";

// ─── Large-audio threshold (kept for client-side timeout selection) ────────────
// 15 MB ≈ 15 min at 128 kbps. Crossing this threshold means the server route
// will use the Gemini Files API path internally (slower upload + preprocessing),
// so we extend the client timeout accordingly.
const LARGE_AUDIO_THRESHOLD_BYTES = 15 * 1024 * 1024;
const LARGE_AUDIO_TIMEOUT_MS = 10 * 60_000;
const SMALL_AUDIO_TIMEOUT_MS = 2 * 60_000;

// ─── Auth helper (matches the proven sarvamService pattern) ───────────────────
const getAuthToken = async (): Promise<string> => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not authenticated. Please log in.");
  return token;
};

// ─── Blob helper ──────────────────────────────────────────────────────────────
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to convert blob to base64'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// ─── JSON parser (server returns this exact JSON shape) ───────────────────────
//
// Gemini is asked to return:
// {
//   "meetingType": string,
//   "detectedLanguages": string[],
//   "actionPoints": string[],       // plain text, no "- [ ]" prefix
//   "notes": string                 // full rich-markdown meeting notes document
// }

interface GeminiAnalysisJSON {
  meetingType?: string;
  detectedLanguages?: string[];
  actionPoints?: string[];
  notes?: string;
}

/** Try multiple strategies to parse JSON from Gemini */
const tryParseJSON = (raw: string): GeminiAnalysisJSON | null => {
  // Strategy 1: direct parse
  try { return JSON.parse(raw); } catch {}

  // Strategy 2: strip markdown code fences
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned);
  } catch {}

  // Strategy 3: extract JSON object from surrounding text
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {}

  // Strategy 4: fix common Gemini JSON issues (unescaped newlines inside string values)
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      const fixed = match[0].replace(/"([^"\\]|\\.)*"/g, (str) =>
        str.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
      );
      return JSON.parse(fixed);
    }
  } catch {}

  return null;
};

/** Extract the notes field directly via regex when JSON parsing fails entirely */
const extractNotesFromRaw = (raw: string): string => {
  const notesMatch = raw.match(/"notes"\s*:\s*"([\s\S]*?)(?:"\s*[,}])/);
  if (notesMatch) {
    return notesMatch[1]
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  if (/[📋🎯📝💬✅🔲❓📊📅🔗💡🧱📍📌]/.test(raw)) {
    return raw
      .replace(/^\s*\{[\s\S]*?"notes"\s*:\s*"?/, '')
      .replace(/"?\s*\}\s*$/, '')
      .replace(/\\n/g, '\n')
      .replace(/\\"/g, '"')
      .trim();
  }

  return '';
};

const parseJsonResponse = (raw: string): MeetingAnalysis => {
  const parsed = tryParseJSON(raw);

  if (parsed) {
    let notes = parsed.notes ?? '';
    if (notes.includes('\\n')) {
      notes = notes.replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }

    return {
      summary: notes,
      actionPoints: (parsed.actionPoints ?? []).map(a => a.replace(/^- \[[ x]\]\s*/, '').trim()).filter(Boolean),
      meetingType: parsed.meetingType,
      detectedLanguages: parsed.detectedLanguages?.filter(Boolean),
      transcript: '',
    };
  }

  console.warn('[parseJsonResponse] All JSON parse strategies failed, extracting fields manually.');

  const notes = extractNotesFromRaw(raw);
  const meetingTypeMatch = raw.match(/"?meetingType"?\s*:\s*"?([^",}\n]+)/i);
  const languagesMatch = raw.match(/"?detectedLanguages"?\s*:\s*\[([^\]]*)\]/i);
  const actionItemsMatch = raw.match(/"?actionPoints"?\s*:\s*\[([\s\S]*?)\]/i);

  let actionPoints: string[] = [];
  if (actionItemsMatch) {
    actionPoints = actionItemsMatch[1]
      .split(',')
      .map(s => s.replace(/^[\s"]+|[\s"]+$/g, ''))
      .filter(Boolean);
  }

  const summary = notes || raw
    .replace(/^\s*\{/, '')
    .replace(/\}\s*$/, '')
    .replace(/"meetingType"\s*:\s*"[^"]*"\s*,?/g, '')
    .replace(/"detectedLanguages"\s*:\s*\[[^\]]*\]\s*,?/g, '')
    .replace(/"actionPoints"\s*:\s*\[[^\]]*\]\s*,?/g, '')
    .replace(/"notes"\s*:\s*"?/g, '')
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .trim();

  return {
    summary,
    actionPoints,
    meetingType: meetingTypeMatch?.[1]?.trim(),
    detectedLanguages: languagesMatch?.[1]?.split(',').map(l => l.trim().replace(/["\]]/g, '')).filter(Boolean),
    transcript: '',
  };
};

// ─── Timeout helper ───────────────────────────────────────────────────────────
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s — please try again.`)), ms);
    promise.then(
      (val) => { clearTimeout(timer); resolve(val); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ─── Retry helper ──────────────────────────────────────────────────────────────
export async function retryOperation<T>(
  operation: () => Promise<T>,
  retries = 3,
  delay = 1000,
  operationName = 'API call',
  timeoutMs = 120_000,
): Promise<T> {
  try {
    return await withTimeout(operation(), timeoutMs, operationName);
  } catch (error: any) {
    const isRetryable =
      error.status === 500 ||
      error.status === 503 ||
      error.status === 429 ||
      error.message?.includes('xhr error') ||
      error.message?.includes('fetch failed') ||
      error.message?.includes('timed out') ||
      error.message?.includes('code: 6');

    if (retries > 0 && isRetryable) {
      console.warn(`[Retry] ${operationName} failed, retrying in ${delay}ms... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryOperation(operation, retries - 1, delay * 2, operationName, timeoutMs);
    }
    throw error;
  }
}

// ─── Pass 1: Extract verbatim transcript via /api/gemini/transcribe-audio ─────
export const extractTranscript = async (audioBlob: Blob): Promise<string> => {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error("No audio was captured. Please check your microphone and try again.");
  }
  if (audioBlob.size < 1000) {
    throw new Error("Audio recording is too short. Please record for at least a few seconds.");
  }

  const token = await getAuthToken();
  const mimeType = (audioBlob.type || 'audio/webm').split(';')[0];
  const audioBase64 = await blobToBase64(audioBlob);
  const useFilesApi = audioBlob.size > LARGE_AUDIO_THRESHOLD_BYTES;

  const data = await retryOperation(
    async () => {
      const res = await fetch('/api/gemini/transcribe-audio', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ audioBase64, mimeType, audioSizeBytes: audioBlob.size }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        const error = new Error(err.error || `Transcription failed (${res.status})`);
        (error as any).status = res.status;
        throw error;
      }

      return res.json() as Promise<{ transcript: string; wasTruncated?: boolean }>;
    },
    3,
    1000,
    'Pass 1: Transcript extraction',
    useFilesApi ? LARGE_AUDIO_TIMEOUT_MS : SMALL_AUDIO_TIMEOUT_MS,
  );

  const transcript = (data.transcript ?? '').trim();
  if (!transcript) throw new Error("Empty transcript from Gemini.");

  if (data.wasTruncated) {
    console.warn('⚠️ Transcript was truncated due to token limits.');
  }

  return transcript;
};

// ─── Pass 2: Analyze transcript via /api/gemini/analyze ───────────────────────
export const analyzeTranscript = async (
  transcript: string,
  recordingDate?: number,
): Promise<Omit<MeetingAnalysis, 'transcript'>> => {
  const token = await getAuthToken();

  const data = await retryOperation(
    async () => {
      const res = await fetch('/api/gemini/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ transcript, recordingDate }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        const error = new Error(err.error || `Analysis failed (${res.status})`);
        (error as any).status = res.status;
        throw error;
      }

      return res.json() as Promise<{ responseText: string; isTruncated?: boolean }>;
    },
    3,
    1000,
    'Pass 2: Analysis generation',
  );

  if (!data.responseText) throw new Error("Empty analysis response from Gemini.");

  const analysis = parseJsonResponse(data.responseText);
  return { ...analysis, isTruncated: !!data.isTruncated };
};


