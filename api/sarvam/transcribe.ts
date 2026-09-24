import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { checkUsageAllowed } from '../_lib/usageGate.js';
import {
  parseRecoveryId,
  audioSecondsFor,
  checkSttGuards,
  writeLedgerRow,
  inlineRejection,
  type LedgerRow,
} from '../_lib/sttLedger.js';
import { REQUIRE_RECOVERY_ID_AFTER } from '../_lib/sttLimits.js';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const SARVAM_API_URL = 'https://api.sarvam.ai/speech-to-text';
const STORAGE_BUCKET = 'audio-recordings';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing auth token' });
  }

  const token = authHeader.split(' ')[1];
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(500).json({ error: 'Supabase env vars not configured' });
  }

  // Authenticated client — passes the user's JWT so Storage RLS policies are honored
  const userSupabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user }, error: authError } = await userSupabase.auth.getUser(token);
  if (authError || !user) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }

  // Which recording / segment this request belongs to (`base:segN`). Older
  // clients don't send it — allowed until REQUIRE_RECOVERY_ID_AFTER (logged and
  // ledgered with nulls), rejected with 426 after.
  const { recoveryId, segmentIndex } = parseRecoveryId(req.body?.recoveryId);
  if (!recoveryId) console.warn(`[Sarvam proxy] Request without recoveryId (user ${user.id})`);
  const reqPath: LedgerRow['path'] = req.body?.audioPath ? 'storage' : req.body?.audioBase64 ? 'inline' : null;
  const ledgerBase = { user_id: user.id, recovery_id: recoveryId, segment_index: segmentIndex, path: reqPath };

  // Kill switch: STT_DISABLED=true on Vercel rejects every STT call. The client
  // treats this as a transcription failure, so the audio stays in IndexedDB /
  // Storage and the session can be retried once STT is re-enabled.
  if (process.env.STT_DISABLED === 'true') {
    await writeLedgerRow({
      ...ledgerBase,
      audio_seconds: null,
      bytes: null,
      status: 'rejected',
      http_status: 503,
      reject_reason: 'stt_disabled',
    });
    return res.status(503).json({
      error: 'stt_disabled',
      message: 'Transcription is temporarily disabled. Your recording is saved and can be retried later.',
    });
  }

  // Outdated client: without a recoveryId the call can't be counted against
  // the per-recording ceiling. Allowed (and logged) until the cut-off date.
  if (!recoveryId && Date.now() >= REQUIRE_RECOVERY_ID_AFTER) {
    await writeLedgerRow({
      ...ledgerBase,
      audio_seconds: null,
      bytes: null,
      status: 'rejected',
      http_status: 426,
      reject_reason: 'missing_recovery_id',
    });
    // `error` is what the client shows as the session's error message.
    return res.status(426).json({ error: 'Please refresh the app.', code: 'client_outdated' });
  }

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Sarvam API key not configured' });
  }

  // Usage gate — only at SESSION START (first chunk). Sarvam re-chunks a whole
  // recording into ~120 requests; gating every one would be wasteful and could
  // interrupt an in-flight session. The RPC counts only COMPLETED sessions, so
  // once a session starts it always finishes. Fail-open inside the helper.
  if (req.body?.sessionStart) {
    const gate = await checkUsageAllowed(userSupabase, user.id, user.email);
    if (!gate.allowed) {
      return res.status(402).json({
        error: 'usage_limit',
        tier: gate.tier,
        usedMinutes: Math.round(gate.usedMinutes),
        limitMinutes: gate.limitMinutes,
      });
    }
  }

  const { audioBase64, audioPath, mimeType, filename } = req.body;

  // Sarvam validates the file's content-type against a strict allowlist and
  // does NOT accept MIME parameters: `audio/webm;codecs=opus` is rejected even
  // though `audio/webm` is allowed. MediaRecorder always tags blobs with the
  // codecs parameter, so strip everything after ';' before sending.
  const normalizeMime = (m?: string, fallback = 'audio/wav'): string =>
    (m || fallback).split(';')[0].trim() || fallback;

  let audioBuffer: Buffer;
  let resolvedMimeType: string;
  let resolvedFilename: string;

  if (audioPath) {
    // Storage path — RLS enforces that user can only download files in their own folder
    const { data: blob, error: dlError } = await userSupabase.storage
      .from(STORAGE_BUCKET)
      .download(audioPath);

    if (dlError || !blob) {
      console.error('[Sarvam proxy] Storage download failed:', dlError?.message);
      return res.status(404).json({ error: `Failed to fetch audio from storage: ${dlError?.message ?? 'not found'}` });
    }

    audioBuffer = Buffer.from(await blob.arrayBuffer());
    resolvedMimeType = normalizeMime(mimeType || blob.type);
    resolvedFilename = filename || audioPath.split('/').pop() || 'audio.wav';
  } else if (audioBase64) {
    audioBuffer = Buffer.from(audioBase64, 'base64');
    resolvedMimeType = normalizeMime(mimeType);
    resolvedFilename = filename || 'audio.wav';
  } else {
    return res.status(400).json({ error: 'Missing audioBase64 or audioPath' });
  }

  // Inline requests must hold ≤ 30 s of audio (Sarvam's REST limit). Refuse
  // anything longer BEFORE calling Sarvam — these used to come back as 400s
  // and turn whole segments into "[…audio unclear…]".
  if (reqPath === 'inline') {
    const isCurrentClient = !!req.headers['x-aligned-client'];
    const inline = inlineRejection(audioBuffer, isCurrentClient);
    if (inline) {
      console.warn(
        `[Sarvam proxy] Rejected inline (${inline.reason}) user ${user.id} recovery ${recoveryId ?? '-'} ` +
        `seg ${segmentIndex ?? '-'}: ${inline.seconds !== null ? `${inline.seconds.toFixed(1)}s` : 'n/a'} ` +
        `via ${inline.how}, ${audioBuffer.length} bytes, client ${isCurrentClient ? 'current' : 'old'}`,
      );
      await writeLedgerRow({
        ...ledgerBase,
        audio_seconds: inline.seconds !== null ? Math.round(inline.seconds * 100) / 100 : null,
        bytes: audioBuffer.length,
        status: 'rejected',
        http_status: 400,
        reject_reason: inline.reason,
      });
      return res.status(400).json({
        error: inline.reason === 'inline_not_wav'
          ? 'Inline audio must be WAV.'
          : `Inline audio is ${Math.round(inline.seconds ?? 0)}s; the limit is 30s.`,
        reject_reason: inline.reason,
      });
    }
  }

  // Cost guard: audio length is computed here from the bytes, never taken from
  // the client. Refuse the call if it would push this recording past the hard
  // ceiling or the user past their monthly limit. Same 402 shape as the
  // sessionStart gate, plus `reject_reason` so the client can tell them apart.
  const audioSeconds = audioSecondsFor(audioBuffer);
  const ledgerAudio = { ...ledgerBase, audio_seconds: audioSeconds, bytes: audioBuffer.length };
  const rejection = await checkSttGuards({
    userId: user.id,
    email: user.email,
    recoveryId,
    audioSeconds,
    sessionStart: !!req.body?.sessionStart,
  });
  if (rejection) {
    console.warn(
      `[Sarvam proxy] Rejected (${rejection.reason}) user ${user.id} recovery ${recoveryId ?? '-'} ` +
      `seg ${segmentIndex ?? '-'}: ${rejection.usedMinutes}/${rejection.limitMinutes} min used`,
    );
    await writeLedgerRow({ ...ledgerAudio, status: 'rejected', http_status: 402, reject_reason: rejection.reason });
    return res.status(402).json({
      error: 'usage_limit',
      tier: rejection.tier,
      usedMinutes: rejection.usedMinutes,
      limitMinutes: rejection.limitMinutes,
      reject_reason: rejection.reason,
    });
  }

  const audioBlob = new Blob([audioBuffer], { type: resolvedMimeType });

  const formData = new FormData();
  formData.append('file', audioBlob, resolvedFilename);
  formData.append('model', 'saaras:v3');
  formData.append('language_code', 'unknown');

  // Exactly one ledger row per Sarvam request: set once a row is written so the
  // catch below doesn't add a second one for a post-response parse failure.
  let ledgered = false;
  try {
    const sarvamRes = await fetch(SARVAM_API_URL, {
      method: 'POST',
      headers: { 'api-subscription-key': apiKey },
      body: formData,
    });

    if (!sarvamRes.ok) {
      const errText = await sarvamRes.text();
      console.error('[Sarvam proxy] Error:', errText);
      // Forward Sarvam's Retry-After (when rate-limited) so the client can wait
      // the requested interval instead of a fixed backoff.
      const retryAfter = sarvamRes.headers.get('retry-after');
      if (retryAfter) res.setHeader('Retry-After', retryAfter);
      ledgered = true;
      await writeLedgerRow({ ...ledgerAudio, status: 'error', http_status: sarvamRes.status });
      return res.status(sarvamRes.status).json({
        error: `Sarvam error: ${errText}`,
        retryAfter: retryAfter || undefined,
      });
    }

    // Sarvam accepted (and billed) the audio — ledger it before parsing so a
    // malformed response body can't hide a billed call.
    ledgered = true;
    await writeLedgerRow({ ...ledgerAudio, status: 'ok', http_status: sarvamRes.status });
    const data = await sarvamRes.json();
    const transcript = data.transcript || data.text || '';
    return res.status(200).json({ transcript });
  } catch (err: any) {
    console.error('[Sarvam proxy] Fetch failed:', err.message);
    // Network failure reaching Sarvam: no HTTP status to record.
    if (!ledgered) await writeLedgerRow({ ...ledgerAudio, status: 'error', http_status: null });
    return res.status(500).json({ error: 'Failed to reach Sarvam API' });
  }
}
