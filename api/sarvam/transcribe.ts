import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

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

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Sarvam API key not configured' });
  }

  const { audioBase64, audioPath, mimeType, filename } = req.body;

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
    resolvedMimeType = mimeType || blob.type || 'audio/wav';
    resolvedFilename = filename || audioPath.split('/').pop() || 'audio.wav';
  } else if (audioBase64) {
    audioBuffer = Buffer.from(audioBase64, 'base64');
    resolvedMimeType = mimeType || 'audio/wav';
    resolvedFilename = filename || 'audio.wav';
  } else {
    return res.status(400).json({ error: 'Missing audioBase64 or audioPath' });
  }

  const audioBlob = new Blob([audioBuffer], { type: resolvedMimeType });

  const formData = new FormData();
  formData.append('file', audioBlob, resolvedFilename);
  formData.append('model', 'saaras:v3');
  formData.append('language_code', 'unknown');

  try {
    const sarvamRes = await fetch(SARVAM_API_URL, {
      method: 'POST',
      headers: { 'api-subscription-key': apiKey },
      body: formData,
    });

    if (!sarvamRes.ok) {
      const errText = await sarvamRes.text();
      console.error('[Sarvam proxy] Error:', errText);
      return res.status(sarvamRes.status).json({ error: `Sarvam error: ${errText}` });
    }

    const data = await sarvamRes.json();
    const transcript = data.transcript || data.text || '';
    return res.status(200).json({ transcript });
  } catch (err: any) {
    console.error('[Sarvam proxy] Fetch failed:', err.message);
    return res.status(500).json({ error: 'Failed to reach Sarvam API' });
  }
}
