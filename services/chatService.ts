import { GoogleGenAI } from "@google/genai";
import { RecordingSession, ChatMessage } from "../types";
import { retryOperation } from "./geminiService";

const TRANSCRIPT_CHAR_LIMIT = 20000;

/**
 * Build context string from ALL completed sessions (global chatbot)
 */
export const buildGlobalChatContext = (recordings: RecordingSession[]): string => {
  const completed = recordings.filter(
    r => r.status === 'completed' && r.analysis
  );

  if (completed.length === 0) return '';

  let context = `# ALIGNED WORKSPACE — SESSION DATABASE\n\n`;
  context += `Total Sessions: ${completed.length}\n`;
  context += `Date Range: ${new Date(Math.min(...completed.map(r => r.date))).toLocaleDateString()} — ${new Date(Math.max(...completed.map(r => r.date))).toLocaleDateString()}\n\n`;
  context += `---\n\n`;

  completed.forEach((rec, i) => {
    context += `## SESSION ${i + 1}: ${rec.title}\n`;
    context += `Date: ${new Date(rec.date).toLocaleDateString()}\n`;
    context += `Type: ${rec.analysis!.meetingType || rec.source}\n`;
    context += `Duration: ${Math.floor(rec.duration / 60)}m ${rec.duration % 60}s\n\n`;

    if (rec.analysis!.summary) {
      context += `### Summary\n${rec.analysis!.summary}\n\n`;
    }

    if (rec.analysis!.actionPoints?.length) {
      context += `### Action Items\n`;
      rec.analysis!.actionPoints.forEach(a => { context += `- ${a}\n`; });
      context += `\n`;
    }

    if (rec.analysis!.transcript) {
      const transcript = rec.analysis!.transcript.length > TRANSCRIPT_CHAR_LIMIT
        ? rec.analysis!.transcript.slice(0, TRANSCRIPT_CHAR_LIMIT) + '\n[...transcript truncated...]'
        : rec.analysis!.transcript;
      context += `### Transcript\n${transcript}\n\n`;
    }

    context += `---\n\n`;
  });

  return context;
};

/**
 * Build context string from a SINGLE session (per-session chatbot)
 */
export const buildSessionChatContext = (session: RecordingSession): string => {
  if (!session.analysis) return '';

  let context = `# SESSION: ${session.title}\n\n`;
  context += `Date: ${new Date(session.date).toLocaleDateString()}\n`;
  context += `Type: ${session.analysis.meetingType || session.source}\n`;
  context += `Duration: ${Math.floor(session.duration / 60)}m ${session.duration % 60}s\n\n`;

  if (session.analysis.summary) {
    context += `## Summary\n${session.analysis.summary}\n\n`;
  }

  if (session.analysis.actionPoints?.length) {
    context += `## Action Items\n`;
    session.analysis.actionPoints.forEach(a => { context += `- ${a}\n`; });
    context += `\n`;
  }

  if (session.analysis.transcript) {
    context += `## Full Transcript\n${session.analysis.transcript}\n\n`;
  }

  return context;
};

/**
 * Extract citation references from assistant response
 */
export const extractCitations = (responseText: string, sessionTitles: string[]): string[] => {
  const citations: string[] = [];
  for (const title of sessionTitles) {
    // Match **[Title]** or [Title] patterns
    if (responseText.includes(title)) {
      citations.push(title);
    }
  }
  return citations;
};

/**
 * Send a chat message and get a response using Gemini multi-turn chat
 */
export const sendChatMessage = async (
  userMessage: string,
  chatHistory: ChatMessage[],
  context: string,
  scopeLabel: string
): Promise<{ text: string; citations: string[] }> => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("API Key is missing.");

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
7. You are scoped to ${scopeLabel}. Only reference data within that scope.
8. If there are no sessions in the knowledge base above, let the user know they need to record sessions first.

Now answer user questions based on the session data above.`;

  // Build Gemini multi-turn conversation history
  // Inject the system preamble + first user question as the opening turn,
  // then alternate user/model for the rest of chat history.
  const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

  if (chatHistory.length === 0) {
    // First message: combine preamble with user question
    contents.push({
      role: 'user',
      parts: [{ text: `${systemPreamble}\n\nUser question: ${userMessage}` }],
    });
  } else {
    // Subsequent messages: preamble was in the first turn, replay history
    contents.push({
      role: 'user',
      parts: [{ text: `${systemPreamble}\n\nUser question: ${chatHistory[0].content}` }],
    });

    for (let i = 1; i < chatHistory.length; i++) {
      contents.push({
        role: chatHistory[i].role === 'assistant' ? 'model' : 'user',
        parts: [{ text: chatHistory[i].content }],
      });
    }

    // Add the new user message
    contents.push({
      role: 'user',
      parts: [{ text: userMessage }],
    });
  }

  const response = await retryOperation(
    () =>
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents,
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.3,
        },
      }),
    2,
    1000,
    'Ask Aligned chat'
  );

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

  return { text: responseText, citations };
};
