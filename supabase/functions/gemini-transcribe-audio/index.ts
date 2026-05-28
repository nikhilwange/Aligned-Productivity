// gemini-transcribe-audio — Pass 1 of the Aligned pipeline.
//
// NOTE: this function does NOT use Portkey. Transcription is audio→text,
// which only Gemini's multimodal model handles among the providers we have
// configured. Krutrim's OSS text models and OpenAI's chat models can't
// process our raw webm/m4a/opus payloads, so there is no meaningful
// fallback chain through Portkey for this call. (Sarvam IS our real
// transcription fallback, and it's already wired up in the frontend via
// services/sarvamService.ts — the React layer will call Sarvam if this
// function fails.)
//
// Implementation notes:
// - Two code paths split at 15 MB:
//     * < 15 MB → inline base64 via generateContent (one round trip)
//     * >= 15 MB → Files API: resumable upload, poll until ACTIVE, then
//       reference the file via file_uri in generateContent.
// - Pure fetch + Deno, no SDK — keeps the bundle Deno-native and avoids
//   pulling in @google/genai (which assumes Node).
// - Repetition guard at the end matches the old Vercel behaviour: when the
//   model loops on the same line (silent / unclear audio), we return 422
//   so the frontend can surface a clear "re-record" message.

import { corsHeaders } from '../_shared/cors.ts';

const LARGE_AUDIO_THRESHOLD_BYTES = 15 * 1024 * 1024;
const FILES_API_READY_TIMEOUT_MS = 5 * 60_000;
const GEMINI_MODEL = 'gemini-2.5-flash';

// Transcription prompt — copied verbatim from api/gemini/transcribe-audio.ts.
// Do not paraphrase: the timestamp/speaker format is what the analyze pass
// expects to see in its input, and downstream "Original transcript" rendering
// in components/ResultsView.tsx is tuned to this layout.
const TRANSCRIPT_PROMPT = `You are a professional transcription service.

Your task is to provide a complete, verbatim transcript of this audio recording.

REQUIREMENTS:
1. Transcribe EVERY word spoken - do not summarize or skip any content
2. Format: [Speaker Name/Role] (MM:SS): [Exact words spoken]
3. Identify speakers by voice (Speaker 1, Speaker 2, etc.)
4. Preserve multilingual content (English and Indian languages)
5. If spoken in a regional language, transcribe in native script with [English translation]
6. Mark unclear segments as [inaudible] rather than guessing
7. Include timestamps every 30-60 seconds
8. Do not add commentary or analysis - ONLY verbatim transcript

Output ONLY the transcript.`;

// ─── Helpers ──────────────────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function uint8ToBase64(bytes: Uint8Array): string {
  // btoa works on a binary string; chunk to stay under arg-length limits.
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Upload audio bytes via Gemini's resumable Files API and wait for ACTIVE.
 * Returns { fileName, fileUri, mimeType } — fileName is used for the
 * post-call DELETE to clean up.
 */
async function uploadToGeminiFiles(
  bytes: Uint8Array,
  mimeType: string,
  apiKey: string,
): Promise<{ fileName: string; fileUri: string; mimeType: string }> {
  const displayName = `aligned-recording-${Date.now()}`;

  // Step 1: start resumable upload. The response carries the upload URL
  // in the X-Goog-Upload-URL header.
  const startRes = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(bytes.length),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file: { display_name: displayName } }),
    },
  );

  if (!startRes.ok) {
    const detail = await startRes.text().catch(() => startRes.statusText);
    throw new Error(`Gemini Files API: start failed (${startRes.status}): ${detail}`);
  }

  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) {
    throw new Error('Gemini Files API: missing X-Goog-Upload-URL header on start');
  }

  // Step 2: upload + finalize in a single request.
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(bytes.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: bytes,
  });

  if (!uploadRes.ok) {
    const detail = await uploadRes.text().catch(() => uploadRes.statusText);
    throw new Error(`Gemini Files API: upload failed (${uploadRes.status}): ${detail}`);
  }

  const uploadJson = await uploadRes.json() as {
    file?: { name?: string; uri?: string; state?: string; mimeType?: string };
  };

  let file = uploadJson.file;
  if (!file?.name) {
    throw new Error('Gemini Files API: upload returned no file name');
  }

  // Step 3: poll for ACTIVE. Audio files usually preprocess in 5–30s but
  // long recordings can take a couple of minutes — match the Vercel
  // handler's 5-minute ceiling.
  const start = Date.now();
  while (file.state !== 'ACTIVE') {
    if (file.state === 'FAILED') {
      throw new Error('Gemini Files API rejected the audio file');
    }
    if (Date.now() - start > FILES_API_READY_TIMEOUT_MS) {
      throw new Error('Gemini file upload timed out during preprocessing (waited 5 min)');
    }
    await new Promise((r) => setTimeout(r, 2000));

    const pollRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${file.name}?key=${apiKey}`,
    );
    if (!pollRes.ok) {
      const detail = await pollRes.text().catch(() => pollRes.statusText);
      throw new Error(`Gemini Files API: poll failed (${pollRes.status}): ${detail}`);
    }
    file = await pollRes.json() as typeof file;
    if (!file?.name) {
      throw new Error('Gemini Files API: poll returned no file metadata');
    }
  }

  if (!file.uri) {
    throw new Error('Gemini Files API: uploaded file has no URI');
  }

  console.log(`[API /gemini-transcribe-audio] ✅ File ACTIVE: ${file.name}`);
  return {
    fileName: file.name,
    fileUri: file.uri,
    mimeType: file.mimeType ?? mimeType,
  };
}

/** Best-effort cleanup — never throws. */
async function deleteGeminiFile(fileName: string, apiKey: string): Promise<void> {
  try {
    await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${apiKey}`,
      { method: 'DELETE' },
    );
  } catch (e) {
    console.log('[API /gemini-transcribe-audio] Cleanup failed:', (e as Error).message);
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return jsonResponse(
      { error: 'Server misconfiguration: GEMINI_API_KEY not set' },
      500,
    );
  }

  let audioBase64: unknown;
  let audioUrl: unknown;
  let mimeType: unknown;
  let audioSizeBytes: unknown;
  try {
    const body = await req.json();
    audioBase64 = body?.audioBase64;
    audioUrl = body?.audioUrl;
    mimeType = body?.mimeType;
    audioSizeBytes = body?.audioSizeBytes;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (typeof mimeType !== 'string' || (!audioBase64 && !audioUrl)) {
    return jsonResponse(
      { error: 'Missing mimeType or audio payload (audioBase64 or audioUrl)' },
      400,
    );
  }

  const cleanMimeType = mimeType.split(';')[0] || 'audio/webm';

  // Resolve audio bytes — either inline base64 (small files) or fetched
  // from a short-lived Supabase Storage signed URL (large files that would
  // otherwise exceed the request body limit).
  let audioBytes: Uint8Array;
  if (typeof audioUrl === 'string' && audioUrl.length > 0) {
    try {
      const resp = await fetch(audioUrl);
      if (!resp.ok) {
        return jsonResponse(
          { error: `Failed to fetch audio from storage URL (${resp.status})` },
          502,
        );
      }
      audioBytes = new Uint8Array(await resp.arrayBuffer());
    } catch (e) {
      return jsonResponse(
        { error: `Storage URL fetch failed: ${(e as Error).message ?? 'unknown'}` },
        502,
      );
    }
  } else if (typeof audioBase64 === 'string') {
    audioBytes = base64ToUint8(audioBase64);
  } else {
    return jsonResponse({ error: 'Invalid audio payload' }, 400);
  }

  const sizeBytes = typeof audioSizeBytes === 'number' ? audioSizeBytes : audioBytes.length;
  // URL-mode is only used for big files, so always route those through
  // the Files API. Otherwise switch on the 15 MB threshold.
  const useFilesApi =
    (typeof audioUrl === 'string' && audioUrl.length > 0) || sizeBytes > LARGE_AUDIO_THRESHOLD_BYTES;

  let uploadedFileName: string | undefined;

  try {
    let audioPart: Record<string, unknown>;

    if (useFilesApi) {
      console.log(
        `[API /gemini-transcribe-audio] Uploading ${(audioBytes.length / 1024 / 1024).toFixed(1)} MB via Files API...`,
      );
      const uploaded = await uploadToGeminiFiles(audioBytes, cleanMimeType, apiKey);
      uploadedFileName = uploaded.fileName;
      audioPart = {
        file_data: { file_uri: uploaded.fileUri, mime_type: uploaded.mimeType },
      };
    } else {
      // Inline base64 — reuse the caller's base64 string when we have it,
      // otherwise re-encode from the fetched bytes.
      const inlineData = typeof audioBase64 === 'string'
        ? audioBase64
        : uint8ToBase64(audioBytes);
      audioPart = {
        inline_data: { mime_type: cleanMimeType, data: inlineData },
      };
    }

    // Single generateContent call — same model and config as the Vercel
    // handler (temperature 0 for faithful transcription, 65k output cap
    // because Gemini accepts it for audio).
    const genRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            { parts: [audioPart, { text: TRANSCRIPT_PROMPT }] },
          ],
          generationConfig: {
            maxOutputTokens: 65536,
            temperature: 0.0,
          },
        }),
      },
    );

    if (!genRes.ok) {
      const detail = await genRes.text().catch(() => genRes.statusText);
      console.log('[API /gemini-transcribe-audio] generateContent failed:', detail);
      return jsonResponse(
        { error: `Gemini generateContent failed (${genRes.status}): ${detail}` },
        500,
      );
    }

    const genJson = await genRes.json() as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;
    };

    const candidate = genJson.candidates?.[0];
    const transcriptText = (candidate?.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim();

    if (!transcriptText) {
      return jsonResponse({ error: 'Empty transcript from Gemini' }, 500);
    }

    // Repetition guard — when the audio is silent / very quiet / unclear,
    // Gemini sometimes loops on a single line. The 422 lets the frontend
    // show a "re-record with mic closer" message instead of treating
    // gibberish as a valid transcript.
    const lines = transcriptText.split('\n').filter((l) => l.trim());
    if (lines.length > 5) {
      const lineCounts = new Map<string, number>();
      for (const line of lines) {
        lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
      }
      const maxRepeat = Math.max(...lineCounts.values());
      if (maxRepeat >= 10 || maxRepeat / lines.length > 0.4) {
        return jsonResponse(
          {
            error:
              'Transcription produced repetitive output — the audio may be too quiet, unclear, or silent. Please re-record with the microphone closer.',
          },
          422,
        );
      }
    }

    const wasTruncated = candidate?.finishReason === 'MAX_TOKENS';
    return jsonResponse({ transcript: transcriptText, wasTruncated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transcription failed';
    console.log('[API /gemini-transcribe-audio] Error:', message);
    return jsonResponse({ error: message }, 500);
  } finally {
    if (uploadedFileName) {
      // Fire and forget — we don't want cleanup latency to block the
      // response, and a failure here is non-fatal (Gemini files auto-expire
      // after ~48h anyway).
      deleteGeminiFile(uploadedFileName, apiKey);
    }
  }
});
