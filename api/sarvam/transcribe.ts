import type { VercelRequest, VercelResponse } from '@vercel/node';

// Increase body size limit for audio files
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '10mb',
    },
  },
};

const SARVAM_API_URL = 'https://api.sarvam.ai/speech-to-text';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfiguration: SARVAM_API_KEY not set' });
  }

  // Receive audio as base64 from the client, then re-construct FormData for Sarvam
  const { audioBase64, mimeType, filename } = req.body;
  if (!audioBase64 || !mimeType) {
    return res.status(400).json({ error: 'Missing audioBase64 or mimeType' });
  }

  try {
    // Convert base64 back to binary buffer
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const audioBlob = new Blob([audioBuffer], { type: mimeType });

    const formData = new FormData();
    formData.append('file', audioBlob, filename || 'audio.webm');
    formData.append('model', 'saaras:v3');
    formData.append('language_code', 'unknown');

    const sarvamResponse = await fetch(SARVAM_API_URL, {
      method: 'POST',
      headers: { 'api-subscription-key': apiKey },
      body: formData,
    });

    if (!sarvamResponse.ok) {
      const errorText = await sarvamResponse.text().catch(() => 'Unknown error');
      throw new Error(`Sarvam API error ${sarvamResponse.status}: ${errorText}`);
    }

    const data = await sarvamResponse.json();
    return res.status(200).json({ transcript: data.transcript || '' });
  } catch (error: any) {
    console.error('[API] Sarvam transcribe error:', error);
    return res.status(500).json({ error: error.message || 'Sarvam transcription failed' });
  }
}
