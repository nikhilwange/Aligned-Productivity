import { MeetingAnalysis } from "../types";
import { supabase } from "./supabaseService";
import { usageLimitFromBody } from "./usageLimit";

// ─── Large-audio threshold (kept for client-side timeout selection) ────────────
// 6 MB ≈ 25 min at our 32 kbps recording bitrate. Crossing this threshold
// means the server route will use the Gemini Files API path internally
// (slower upload + preprocessing) instead of inline base64, so we extend the
// client timeout accordingly.
//
// Why 6 MB and not 15 MB any more: on Supabase Edge, inline-base64 of audio
// over ~25 min routinely hits the wall and the gateway returns HTTP 546
// ("worker limit exceeded"). The limit in play is the 150s request idle
// timeout, which applies on every plan — NOT the plan-dependent wall clock
// (150s free / 400s paid; this project is on Pro). The Files API
// path is more reliable in that band because Gemini preprocesses the audio
// up front rather than processing it inside a single generateContent call.
// For files long enough to defeat Files API too, App.tsx has a silent
// Sarvam fallback wired in runProcessingForSession.
const LARGE_AUDIO_THRESHOLD_BYTES = 6 * 1024 * 1024;
const LARGE_AUDIO_TIMEOUT_MS = 10 * 60_000;
const SMALL_AUDIO_TIMEOUT_MS = 2 * 60_000;

// ─── Auth helper (matches the proven sarvamService pattern) ───────────────────
const getAuthToken = async (): Promise<string> => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not authenticated. Please log in.");
  return token;
};

// ─── Supabase Edge Function invoker ───────────────────────────────────────────
// The heavy Gemini calls (analyze, transcribe-audio, strategic) run as Supabase
// Edge Functions instead of Vercel serverless functions: Vercel Hobby caps
// every request at 60s, which the long-output Gemini 2.5 Flash calls routinely
// exceed. Supabase free tier gives 150s wall, enough for typical meetings.
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const invokeEdgeFunction = async <T>(
  name: string,
  body: unknown,
): Promise<T> => {
  const token = await getAuthToken();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(err.error || `${name} failed (${res.status})`);
    (error as any).status = res.status;
    (error as any).body = err;
    throw error;
  }
  return res.json() as Promise<T>;
};

// NOTE: an NDJSON streaming variant of the above lived here. It emitted
// keepalives so a long analysis could not trip Supabase's 150s request idle
// timeout. It was removed once analysis was chunked: no single call now
// exceeds ~76s, so the idle timeout is no longer reachable, and streaming
// cannot help with the OTHER limit (the 150s WallClockTime kill) anyway.
// Meanwhile it added a real failure mode -- a long-held streaming response is
// exactly what an intercepting corporate proxy mangles, and a 3.5h upload died
// with "TypeError: Failed to fetch" inside it after every segment had already
// transcribed. The edge function still honours Accept: application/x-ndjson,
// so this can be reinstated if a future call ever needs it.

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
//   "title": string,                // short content-derived session name, no date
//   "meetingType": string,
//   "detectedLanguages": string[],
//   "actionPoints": string[],       // plain text, no "- [ ]" prefix
//   "notes": string                 // full rich-markdown meeting notes document
// }
//
// `title` is only requested from the passes that see the WHOLE transcript (the
// combined pass and the 'notes' pass) — never from the chunked 'actions' pass.

interface GeminiAnalysisJSON {
  title?: string;
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
      title: parsed.title,
      detectedLanguages: parsed.detectedLanguages?.filter(Boolean),
      transcript: '',
    };
  }

  console.warn('[parseJsonResponse] All JSON parse strategies failed, extracting fields manually.');

  const notes = extractNotesFromRaw(raw);
  const titleMatch = raw.match(/"?title"?\s*:\s*"([^"\n]+)"/i);
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
    .replace(/"title"\s*:\s*"[^"]*"\s*,?/g, '')
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
    title: titleMatch?.[1]?.trim(),
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
    // A browser network failure (connection reset, proxy hiccup, DNS blip,
    // CORS rejection) surfaces as `TypeError` with a message that differs per
    // engine: Chrome "Failed to fetch", Safari "Load failed", Node/undici
    // "fetch failed". Only the Node spelling was listed here, so a real
    // browser network blip was treated as fatal and skipped retries entirely —
    // which cost a 3.5h upload its entire analysis after all 43 segments had
    // already transcribed successfully.
    const msg: string = error?.message ?? '';
    const isNetworkError =
      error instanceof TypeError ||
      /failed to fetch|fetch failed|load failed|network ?error|networkerror/i.test(msg);

    const isRetryable =
      error.status === 500 ||
      error.status === 503 ||
      error.status === 429 ||
      isNetworkError ||
      msg.includes('xhr error') ||
      msg.includes('timed out') ||
      msg.includes('code: 6');

    if (retries > 0 && isRetryable) {
      // Honor a server-supplied Retry-After (attached as `retryAfterMs` on 429s)
      // instead of the fixed exponential backoff; fall back to `delay` otherwise.
      const honored = typeof error.retryAfterMs === 'number' && Number.isFinite(error.retryAfterMs);
      const wait = honored ? error.retryAfterMs : delay;
      // Rate limits are the single most common cause of slow transcription —
      // log them distinctly so a console screenshot is enough to diagnose.
      if (error.status === 429) {
        console.warn(`[Sarvam] 429, waiting ${wait}ms (Retry-After honored: ${honored ? 'yes' : 'no'})`);
      }
      console.warn(`[Retry] ${operationName} failed, retrying in ${wait}ms... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, wait));
      return retryOperation(operation, retries - 1, delay * 2, operationName, timeoutMs);
    }
    throw error;
  }
}

// ─── Pass 1: Extract verbatim transcript via /api/gemini/transcribe-audio ─────
//
// Vercel serverless functions have a 4.5 MB request body limit. Base64
// inflation (~33%) means raw audio over ~3 MB hits 413 Request Entity Too
// Large. For larger files the caller passes `audioPath` (Supabase Storage),
// we mint a short-lived signed URL, and the server fetches the bytes
// directly — bypassing the body limit entirely.
const INLINE_BODY_THRESHOLD_BYTES = 3 * 1024 * 1024; // 3 MB raw → ~4 MB base64 → fits

export const extractTranscript = async (
  audioBlob: Blob,
  opts: { audioPath?: string } = {}
): Promise<string> => {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error("No audio was captured. Please check your microphone and try again.");
  }
  if (audioBlob.size < 1000) {
    throw new Error("Audio recording is too short. Please record for at least a few seconds.");
  }

  const mimeType = (audioBlob.type || 'audio/webm').split(';')[0];
  const useFilesApi = audioBlob.size > LARGE_AUDIO_THRESHOLD_BYTES;
  const mustUseStorageUrl = audioBlob.size > INLINE_BODY_THRESHOLD_BYTES;
  // Whenever the server has to go through the Files API path (either because
  // we sent a Storage URL or because the raw size crosses the threshold),
  // the round trip can take 60-150s. The short timeout is only safe for
  // small inline-base64 calls.
  const serverWillUseFilesApi = mustUseStorageUrl || useFilesApi;

  // Build payload: signed URL for big files, inline base64 for small ones.
  let payload: Record<string, unknown>;
  if (mustUseStorageUrl) {
    if (!opts.audioPath) {
      throw new Error(
        "Audio file too large to upload directly. The recording archive failed — please retry processing."
      );
    }
    const { data: signed, error: signedErr } = await supabase
      .storage.from('audio-recordings')
      .createSignedUrl(opts.audioPath, 600);
    if (signedErr || !signed?.signedUrl) {
      throw new Error(`Could not create signed URL for audio: ${signedErr?.message ?? 'unknown'}`);
    }
    payload = { audioUrl: signed.signedUrl, mimeType, audioSizeBytes: audioBlob.size };
  } else {
    const audioBase64 = await blobToBase64(audioBlob);
    payload = { audioBase64, mimeType, audioSizeBytes: audioBlob.size };
  }

  let data: { transcript: string; wasTruncated?: boolean };
  try {
    data = await retryOperation(
      () => invokeEdgeFunction<{ transcript: string; wasTruncated?: boolean }>(
        'gemini-transcribe-audio',
        payload,
      ),
      3,
      1000,
      'Pass 1: Transcript extraction',
      serverWillUseFilesApi ? LARGE_AUDIO_TIMEOUT_MS : SMALL_AUDIO_TIMEOUT_MS,
    );
  } catch (e: any) {
    // Monthly usage cap hit — surface as a typed error so the pipeline shows
    // an upgrade prompt and does NOT fall through to the Sarvam fallback.
    if (e?.status === 402) throw usageLimitFromBody(e.body ?? {});
    throw e;
  }

  const transcript = (data.transcript ?? '').trim();
  if (!transcript) throw new Error("Empty transcript from Gemini.");

  if (data.wasTruncated) {
    console.warn('⚠️ Transcript was truncated due to token limits.');
  }

  return transcript;
};

// ─── Pass 2: Analyze transcript via Supabase Edge Function ────────────────────
// Long transcripts (Zoom/Teams pastes, 60+ minute meetings) routinely exceed
// Vercel Hobby's 60s timeout, which is why this moved to a Supabase Edge
// Function.
//
// Analysis is split across several edge function calls rather than one, because
// each invocation gets its own wall-clock budget and this project is terminated
// at 150s (reason: WallClockTime, despite the org being on Pro where 400s is
// documented). A single combined call measured 132.8-142.6s for 2-3.5h of
// transcript — close enough that it was intermittently killed outright and the
// analysis lost.
//
// Measured behaviour of the two halves (see ACTION_CHUNK_WORDS below):
//
//   'notes'   ~71s at BOTH 12k and 40k words — essentially flat, always safe.
//   'actions' 36.7s @5k · 51.6s @12k · 56.3s @24k · 133.4s @40k · killed @40k
//
// So only action extraction scales dangerously: a 3.5h meeting yields ~170
// action points and writing that list is what approaches the limit. The notes
// document does not need splitting at all.
//
// Hence: chunk the transcript for the 'actions' pass only, run those chunks in
// parallel (they are independent), then ONE 'notes' call over the whole
// transcript using the merged action list.
//
// Measured end-to-end on a 40k-word (~3.5h) transcript:
//
//   4 'actions' chunks, all in parallel : 36.7s / 46.2s / 47.5s / 52.6s
//   1 'notes' call over the full text   : 75.7s
//   total wall time                     : 128.3s, worst single call 75.7s
//
// So the long path is now FASTER than the old single call (~142s) as well as
// reliable, with roughly 2x margin on every call. Getting there took two
// levers beyond the split itself, both of which matter if this is ever tuned:
//
//   1. Capping action points per chunk (server side). Unbounded extraction
//      produced ~213 for a 3.5h meeting, which made the actions pass slow
//      (97.9s worst chunk) AND the notes pass slow (123.5s, rendering them
//      all). Capping cut the total to ~105 and both halves got faster.
//   2. Running all chunks in one parallel wave rather than two.
//
// Note when re-measuring: Portkey caches identical prompts. Re-running the
// same transcript returned a full 3.5h analysis in 0.7s, which measures
// nothing. Vary the transcript between runs.
//
// The 'notes' call is handed the merged action points and told to use exactly
// those, preserving the guarantee that the notes' ✅ Action Items section and
// the actionPoints array are the same set — something downstream (action-item
// promotion, grouping by owner) relies on.
//
// Streaming (NDJSON keepalives) is layered on top; it removes the separate
// 150s idle-timeout failure mode but cannot extend a wall clock.

// Below this, ONE combined call is both safe and faster, so we use it and skip
// the split entirely. Measured combined: 85.4s @12k (65s margin) but 132.8s and
// 109.8s @23k — that upper band is too close to the limit to trust, so the
// threshold sits nearer the measured-safe end.
//
// This matters for UX far more than it looks: the overwhelming majority of
// meetings land under it, so they keep today's speed AND today's richer,
// uncapped action list. Only genuinely long recordings — the ones that were
// failing outright — pay the slower multi-call cost.
const SINGLE_CALL_MAX_WORDS = 14000;

// Transcript words per 'actions' call once we do split. 12k measured at 51.6s —
// roughly a 3x margin against the 150s limit, which leaves room for the
// provider-side variance we see (the same input has come back anywhere from
// 110s to 133s).
const ACTION_CHUNK_WORDS = 12000;

// Parallel 'actions' calls in flight. 4 covers a 3.5h meeting in a single wave
// (its 4 chunks all start at once, so the phase costs one slow chunk rather
// than two rounds), while still being modest enough not to fan a very long
// recording out into a rate-limit storm against Portkey.
const ACTION_CHUNK_CONCURRENCY = 4;

/**
 * Split a transcript into chunks of at most `maxWords`, breaking on sentence
 * boundaries so an action isn't cut in half across two chunks.
 */
const chunkTranscript = (text: string, maxWords: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [text];

  const chunks: string[] = [];
  let start = 0;
  while (start < words.length) {
    let end = Math.min(start + maxWords, words.length);
    // Prefer to end on a sentence boundary, looking back up to 10% of a chunk.
    if (end < words.length) {
      const floor = end - Math.floor(maxWords * 0.1);
      for (let i = end - 1; i > floor; i--) {
        if (/[.!?]$/.test(words[i])) { end = i + 1; break; }
      }
    }
    chunks.push(words.slice(start, end).join(' '));
    start = end;
  }
  return chunks;
};

/** Case/punctuation-insensitive key for de-duplicating action points. */
const actionKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Run `tasks` with at most `limit` in flight, preserving result order. */
const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
};

export const analyzeTranscript = async (
  transcript: string,
  recordingDate?: number,
): Promise<Omit<MeetingAnalysis, 'transcript'>> => {
  const callPass = (
    body: Record<string, unknown>,
    label: string,
  ) =>
    retryOperation(
      () => invokeEdgeFunction<{ responseText: string; isTruncated?: boolean }>(
        'gemini-analyze',
        { recordingDate, ...body },
      ),
      3,
      1000,
      label,
      LARGE_AUDIO_TIMEOUT_MS, // generous 10-min client-side timeout per call
    );

  // ── Fast path: short enough for one combined call ───────────────────────
  // Keeps the common case at its original speed and output. It also means an
  // older function (which ignores `pass`) behaves identically here.
  const totalWords = transcript.split(/\s+/).length;
  if (totalWords <= SINGLE_CALL_MAX_WORDS) {
    const data = await callPass({ transcript }, 'Pass 2: Analysis generation');
    if (!data.responseText) throw new Error('Empty analysis response from Gemini.');
    return { ...parseJsonResponse(data.responseText), isTruncated: !!data.isTruncated };
  }

  // ── Pass 1: action points, one call per transcript chunk, in parallel ───
  const chunks = chunkTranscript(transcript, ACTION_CHUNK_WORDS);

  const chunkResults = await mapWithConcurrency(
    chunks,
    ACTION_CHUNK_CONCURRENCY,
    async (chunk, i) => {
      const data = await callPass(
        { transcript: chunk, pass: 'actions' },
        `Pass 2a: Action extraction (${i + 1}/${chunks.length})`,
      );
      if (!data.responseText) throw new Error('Empty analysis response from Gemini.');
      return { parsed: parseJsonResponse(data.responseText), isTruncated: !!data.isTruncated };
    },
  );

  // Merge chunk results. Actions are concatenated in transcript order and
  // de-duplicated (a commitment restated near a chunk boundary can surface
  // twice); languages are unioned; meetingType comes from the first chunk that
  // inferred one, since chunks later in a long meeting drift off-topic.
  const seen = new Set<string>();
  const actionPoints: string[] = [];
  for (const r of chunkResults) {
    for (const a of r.parsed.actionPoints ?? []) {
      const key = actionKey(a);
      if (key && !seen.has(key)) { seen.add(key); actionPoints.push(a); }
    }
  }
  const detectedLanguages = [
    ...new Set(chunkResults.flatMap(r => r.parsed.detectedLanguages ?? [])),
  ];
  const meetingType = chunkResults.find(r => r.parsed.meetingType)?.parsed.meetingType;

  // ── Pass 2: one notes call over the FULL transcript + merged actions ────
  // Measured flat at ~71s regardless of transcript length, so this half never
  // needs chunking — and keeping the whole transcript here is what lets the
  // notes stay a single coherent document rather than stitched fragments.
  const notesData = await callPass(
    { transcript, pass: 'notes', actionPoints },
    'Pass 2b: Notes generation',
  );
  if (!notesData.responseText) throw new Error('Empty notes response from Gemini.');

  const notesParsed = parseJsonResponse(notesData.responseText);

  return {
    summary: notesParsed.summary,
    actionPoints,
    meetingType,
    // The title comes from the notes pass, which is the only call in this path
    // that sees the whole transcript. Taking it from a chunk (the way
    // meetingType has to) would name a 3-hour meeting after its first 20
    // minutes.
    title: notesParsed.title,
    detectedLanguages: detectedLanguages.length > 0 ? detectedLanguages : undefined,
    isTruncated: !!(chunkResults.some(r => r.isTruncated) || notesData.isTruncated),
  };
};


