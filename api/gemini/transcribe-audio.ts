import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

// Increase body size limit for audio files (up to 50MB)
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check — reject unauthenticated requests so strangers can't use your API key
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.GEMINI_API_KEY; // server-only, no VITE_ prefix
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfiguration: GEMINI_API_KEY not set' });
  }

  const { audioBase64, mimeType } = req.body;
  if (!audioBase64 || !mimeType) {
    return res.status(400).json({ error: 'Missing audioBase64 or mimeType' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const transcriptPrompt = `You are a professional transcription service.

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

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          { text: transcriptPrompt },
        ],
      },
      generationConfig: {
        maxOutputTokens: 65536,
        temperature: 0.1,
      },
    });

    const transcriptText = response.text;
    if (!transcriptText) {
      return res.status(500).json({ error: 'Empty transcript from Gemini' });
    }

    const wasTruncated = response.candidates?.[0]?.finishReason === 'MAX_TOKENS';

    return res.status(200).json({ transcript: transcriptText.trim(), wasTruncated });
  } catch (error: any) {
    console.error('[API] Gemini transcribe-audio error:', error);
    return res.status(500).json({ error: error.message || 'Transcription failed' });
  }
}
