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

  const { userMessage, chatHistory, context, scopeLabel } = req.body;
  if (!userMessage || !context) {
    return res.status(400).json({ error: 'Missing userMessage or context' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey });

    const systemPreamble = `You are "Ask Aligned", a knowledgeable AI assistant for the Aligned productivity app.

You have access to the following session data as your KNOWLEDGE BASE. Use ONLY this data to answer questions.

${context}

RULES:
1. ONLY answer based on the session data provided above. Do NOT make up information or claim you don't have access — the data IS above.
2. When referencing a specific session, cite it using **[Session Title]** format (bold brackets).
3. If asked about something NOT covered in the session data above, clearly say: "I don't have information about that in your recorded sessions."
4. Be concise but thorough. Use markdown formatting for readability.
5. When listing action items or decisions, preserve the original wording from the sessions.
6. End your responses with 1-2 suggested follow-up questions the user might find useful.
7. You are scoped to ${scopeLabel || 'all sessions'}. Only reference data within that scope.
8. If there are no sessions in the knowledge base above, let the user know they need to record sessions first.

Now answer user questions based on the session data above.`;

    const history = chatHistory || [];

    // Build Gemini multi-turn conversation history
    const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    if (history.length === 0) {
      contents.push({
        role: 'user',
        parts: [{ text: `${systemPreamble}\n\nUser question: ${userMessage}` }],
      });
    } else {
      contents.push({
        role: 'user',
        parts: [{ text: `${systemPreamble}\n\nUser question: ${history[0].content}` }],
      });

      for (let i = 1; i < history.length; i++) {
        contents.push({
          role: history[i].role === 'assistant' ? 'model' : 'user',
          parts: [{ text: history[i].content }],
        });
      }

      contents.push({
        role: 'user',
        parts: [{ text: userMessage }],
      });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents,
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.3,
      },
    });

    const responseText = response.text || '';

    // Extract citations from the response
    const sessionTitlePattern = /\*\*\[([^\]]+)\]\*\*/g;
    const citations: string[] = [];
    let match;
    while ((match = sessionTitlePattern.exec(responseText)) !== null) {
      if (!citations.includes(match[1])) {
        citations.push(match[1]);
      }
    }

    return res.status(200).json({ text: responseText, citations });
  } catch (error: any) {
    console.error('[API] Gemini chat error:', error);
    return res.status(500).json({ error: error.message || 'Chat failed' });
  }
}
