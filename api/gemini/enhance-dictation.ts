import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

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

  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Missing text' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const systemPrompt = `You are an expert professional editor. Your task is to rewrite the following raw dictation (which may contain English or major Indian languages) into a polished, professional document.

Rules:
1. Remove filler words (um, uh, you know).
2. Fix grammar and punctuation.
3. Improve flow and clarity while maintaining the original meaning.
4. Format the output as a clean document.
5. Detect the primary language(s) used.
6. If Indian regional languages are used, preserve the original meaning but rewrite in a professional manner.

Output Format:
Return the result in the following structure:

📝 Summary
[The professionally rewritten text goes here. Write it as a cohesive paragraph or document.]

🗣️ Full Transcript
[The dictation text with auto-punctuation and fillers removed. Format it as a clean text block.]

✅ Action Items
[If any clear tasks were dictated, list them here. Otherwise, leave empty.]

detectedLanguages: [Language]
meetingType: Dictation

Input Text:
${text}`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: {
        parts: [{ text: systemPrompt }],
      },
    });

    const responseText = response.text;
    if (!responseText) {
      return res.status(500).json({ error: 'Empty response from Gemini' });
    }

    return res.status(200).json({ responseText });
  } catch (error: any) {
    console.error('[API] Gemini enhance-dictation error:', error);
    return res.status(500).json({ error: error.message || 'Enhancement failed' });
  }
}
