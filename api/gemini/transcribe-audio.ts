import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

export const config = {
  maxDuration: 300,
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

const LARGE_AUDIO_THRESHOLD_BYTES = 15 * 1024 * 1024;
const FILES_API_READY_TIMEOUT_MS = 5 * 60_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Server misconfiguration: GEMINI_API_KEY not set' });
  }

  const { audioBase64, mimeType, audioSizeBytes } = req.body;
  if (!audioBase64 || !mimeType) {
    return res.status(400).json({ error: 'Missing audioBase64 or mimeType' });
  }

  const ai = new GoogleGenAI({ apiKey });
  const cleanMimeType = (mimeType || 'audio/webm').split(';')[0];
  const sizeBytes = typeof audioSizeBytes === 'number'
    ? audioSizeBytes
    : Buffer.byteLength(audioBase64, 'base64');
  const useFilesApi = sizeBytes > LARGE_AUDIO_THRESHOLD_BYTES;

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

  let fileName: string | undefined;

  try {
    let audioPart: any;

    if (useFilesApi) {
      const audioBuffer = Buffer.from(audioBase64, 'base64');
      const blob = new Blob([audioBuffer], { type: cleanMimeType });

      console.log(`[API /gemini/transcribe-audio] Uploading ${(audioBuffer.length / 1024 / 1024).toFixed(1)} MB via Files API...`);
      const uploaded = await ai.files.upload({
        file: blob,
        config: { mimeType: cleanMimeType, displayName: `aligned-recording-${Date.now()}` },
      });

      if (!uploaded.name) throw new Error('Gemini Files API: upload returned no file name');
      fileName = uploaded.name;

      const start = Date.now();
      let file = uploaded;
      while (file.state !== 'ACTIVE') {
        if (file.state === 'FAILED') throw new Error('Gemini Files API rejected the audio file');
        if (Date.now() - start > FILES_API_READY_TIMEOUT_MS) {
          throw new Error('Gemini file upload timed out during preprocessing (waited 5 min)');
        }
        await new Promise((r) => setTimeout(r, 2000));
        file = await ai.files.get({ name: uploaded.name });
      }

      if (!file.uri) throw new Error('Gemini Files API: uploaded file has no URI');
      console.log(`[API /gemini/transcribe-audio] ✅ File ACTIVE: ${file.name}`);
      audioPart = { fileData: { fileUri: file.uri, mimeType: file.mimeType || cleanMimeType } };
    } else {
      audioPart = { inlineData: { mimeType: cleanMimeType, data: audioBase64 } };
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts: [audioPart, { text: transcriptPrompt }] },
      config: { maxOutputTokens: 65536, temperature: 0.0 },
    });

    const transcriptText = response.text?.trim();
    if (!transcriptText) {
      return res.status(500).json({ error: 'Empty transcript from Gemini' });
    }

    const lines = transcriptText.split('\n').filter((l) => l.trim());
    if (lines.length > 5) {
      const lineCounts = new Map<string, number>();
      for (const line of lines) {
        lineCounts.set(line, (lineCounts.get(line) ?? 0) + 1);
      }
      const maxRepeat = Math.max(...lineCounts.values());
      if (maxRepeat >= 10 || maxRepeat / lines.length > 0.4) {
        return res.status(422).json({
          error: 'Transcription produced repetitive output — the audio may be too quiet, unclear, or silent. Please re-record with the microphone closer.',
        });
      }
    }

    const wasTruncated = response.candidates?.[0]?.finishReason === 'MAX_TOKENS';
    return res.status(200).json({ transcript: transcriptText, wasTruncated });
  } catch (error: any) {
    console.error('[API /gemini/transcribe-audio] Error:', error);
    return res.status(500).json({ error: error.message || 'Transcription failed' });
  } finally {
    if (fileName) {
      ai.files.delete({ name: fileName }).catch((e) => console.warn('[API /gemini/transcribe-audio] Cleanup failed:', e));
    }
  }
}
