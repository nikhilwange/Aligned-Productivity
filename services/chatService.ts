import { RecordingSession, ChatMessage } from "../types";
import { retryOperation } from "./geminiService";
import { supabase } from "./supabaseService";

const TRANSCRIPT_CHAR_LIMIT = 20000;

const getAuthToken = async (): Promise<string> => {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) throw new Error("Not authenticated. Please log in.");
  return token;
};

/**
 * Build context string from ALL completed sessions (global chatbot).
 * Runs client-side — no API key needed here.
 */
export const buildGlobalChatContext = (recordings: RecordingSession[]): string => {
  const completed = recordings.filter((r) => r.status === "completed" && r.analysis);
  if (completed.length === 0) return "";

  let context = `# ALIGNED WORKSPACE — SESSION DATABASE\n\n`;
  context += `Total Sessions: ${completed.length}\n`;
  context += `Date Range: ${new Date(Math.min(...completed.map((r) => r.date))).toLocaleDateString()} — ${new Date(Math.max(...completed.map((r) => r.date))).toLocaleDateString()}\n\n`;
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
      rec.analysis!.actionPoints.forEach((a) => {
        context += `- ${a}\n`;
      });
      context += `\n`;
    }

    if (rec.analysis!.transcript) {
      const transcript =
        rec.analysis!.transcript.length > TRANSCRIPT_CHAR_LIMIT
          ? rec.analysis!.transcript.slice(0, TRANSCRIPT_CHAR_LIMIT) + "\n[...transcript truncated...]"
          : rec.analysis!.transcript;
      context += `### Transcript\n${transcript}\n\n`;
    }

    context += `---\n\n`;
  });

  return context;
};

/**
 * Build context string from a SINGLE session (per-session chatbot).
 * Runs client-side — no API key needed here.
 */
export const buildSessionChatContext = (session: RecordingSession): string => {
  if (!session.analysis) return "";

  let context = `# SESSION: ${session.title}\n\n`;
  context += `Date: ${new Date(session.date).toLocaleDateString()}\n`;
  context += `Type: ${session.analysis.meetingType || session.source}\n`;
  context += `Duration: ${Math.floor(session.duration / 60)}m ${session.duration % 60}s\n\n`;

  if (session.analysis.summary) {
    context += `## Summary\n${session.analysis.summary}\n\n`;
  }

  if (session.analysis.actionPoints?.length) {
    context += `## Action Items\n`;
    session.analysis.actionPoints.forEach((a) => {
      context += `- ${a}\n`;
    });
    context += `\n`;
  }

  if (session.analysis.transcript) {
    context += `## Full Transcript\n${session.analysis.transcript}\n\n`;
  }

  return context;
};

/**
 * Extract citation references from assistant response.
 */
export const extractCitations = (responseText: string, sessionTitles: string[]): string[] => {
  const citations: string[] = [];
  for (const title of sessionTitles) {
    if (responseText.includes(title)) {
      citations.push(title);
    }
  }
  return citations;
};

/**
 * Send a chat message and get a response via the secure API route.
 */
export const sendChatMessage = async (
  userMessage: string,
  chatHistory: ChatMessage[],
  context: string,
  scopeLabel: string
): Promise<{ text: string; citations: string[] }> => {
  const token = await getAuthToken();

  return retryOperation(
    async () => {
      const res = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userMessage,
          chatHistory,
          context,
          scopeLabel,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        const error: any = new Error(err.error || "Chat failed");
        error.status = res.status;
        throw error;
      }

      return res.json();
    },
    2,
    1000,
    "Ask Aligned chat"
  );
};
