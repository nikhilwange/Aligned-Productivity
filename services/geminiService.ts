import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { MeetingAnalysis } from "../types";

// ─── Blob helper ──────────────────────────────────────────────────────────────
const blobToBase64 = (blob: Blob): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      } else {
        reject(new Error('Failed to convert blob to base64'));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

// ─── JSON parser (replaces the fragile emoji-regex parseMarkdownResponse) ──────
//
// Gemini is now asked to return this exact JSON shape:
// {
//   "meetingType": string,
//   "detectedLanguages": string[],
//   "actionPoints": string[],       // plain text, no "- [ ]" prefix
//   "notes": string                 // full rich-markdown meeting notes document
// }
//
// The "notes" field is still rich markdown — all the emoji sections, tables,
// bullet points — exactly as before. Only the structured fields are now JSON.
// This means zero visual change in ResultsView while making parsing reliable.

interface GeminiAnalysisJSON {
  meetingType?: string;
  detectedLanguages?: string[];
  actionPoints?: string[];
  notes?: string;
}

const parseJsonResponse = (raw: string): MeetingAnalysis => {
  let parsed: GeminiAnalysisJSON = {};

  try {
    // Strip any accidental markdown code fences Gemini may wrap around JSON
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.warn('[parseJsonResponse] JSON.parse failed, attempting field extraction fallback.', e);

    // Graceful fallback: extract what we can with light regex on the raw text
    // so a partially malformed response still gives us something useful
    const actionItemsMatch = raw.match(/✅\s*Action Items\s*([\s\S]*?)(?=[📋🎯📝💬🔲❓📊📅🔗💡🧱📍📌🗣️📋]|$)/i);
    const actionPoints = actionItemsMatch
      ? actionItemsMatch[1]
          .split('\n')
          .filter(l => l.trim().startsWith('- [ ]') || l.trim().startsWith('- [x]'))
          .map(l => l.replace(/^- \[[ x]\]\s*/, '').trim())
          .filter(Boolean)
      : [];

    const meetingTypeMatch = raw.match(/Meeting Type\s*:\s*([^\n,}"]+)/i);
    const languagesMatch = raw.match(/detectedLanguages["\s:]+([^\n\]]+)/i);

    return {
      summary: raw, // surface the raw text so nothing is lost
      actionPoints,
      meetingType: meetingTypeMatch?.[1]?.trim(),
      detectedLanguages: languagesMatch?.[1]?.split(',').map(l => l.trim().replace(/["\]]/g, '')),
      transcript: '',
    };
  }

  return {
    summary: parsed.notes ?? '',
    actionPoints: (parsed.actionPoints ?? []).map(a => a.replace(/^- \[[ x]\]\s*/, '').trim()).filter(Boolean),
    meetingType: parsed.meetingType,
    detectedLanguages: parsed.detectedLanguages?.filter(Boolean),
    transcript: '', // transcript is set by the caller (Pass 1), not by this parser
  };
};

// ─── Retry helper ──────────────────────────────────────────────────────────────
export async function retryOperation<T>(
  operation: () => Promise<T>,
  retries = 3,
  delay = 1000,
  operationName = 'API call'
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    const isRetryable =
      error.status === 500 ||
      error.status === 503 ||
      error.status === 429 ||
      error.message?.includes('xhr error') ||
      error.message?.includes('fetch failed') ||
      error.message?.includes('code: 6');

    if (retries > 0 && isRetryable) {
      console.warn(`[Retry] ${operationName} failed, retrying in ${delay}ms... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryOperation(operation, retries - 1, delay * 2, operationName);
    }
    throw error;
  }
}

// ─── Pass 1: Extract verbatim transcript (unchanged — plain text is reliable) ──
export const extractTranscript = async (audioBlob: Blob): Promise<string> => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("API Key is missing.");

  const ai = new GoogleGenAI({ apiKey });
  const base64Audio = await blobToBase64(audioBlob);
  const mimeType = audioBlob.type || 'audio/webm';

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

  try {
    const response = await retryOperation(
      () =>
        ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: {
            parts: [
              { inlineData: { mimeType, data: base64Audio } },
              { text: transcriptPrompt },
            ],
          },
          generationConfig: {
            maxOutputTokens: 65536,
            temperature: 0.1,
          },
        }),
      3,
      1000,
      'Pass 1: Transcript extraction'
    );

    const transcriptText = response.text;
    if (!transcriptText) throw new Error("Empty transcript from Gemini.");

    const wasTruncated = response.candidates?.[0]?.finishReason === 'MAX_TOKENS';
    if (wasTruncated) {
      console.warn('⚠️ Transcript was truncated due to token limits.');
    }

    return transcriptText.trim();
  } catch (error) {
    console.error("Transcript extraction failed:", error);
    throw error;
  }
};

// ─── Pass 2: Analyze transcript — structured JSON response ────────────────────
export const analyzeTranscript = async (transcript: string): Promise<Omit<MeetingAnalysis, 'transcript'>> => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("API Key is missing.");

  const ai = new GoogleGenAI({ apiKey });

  const analysisPrompt = `You are an expert meeting assistant. Analyze the transcript below and respond with a single valid JSON object — no markdown fences, no extra text outside the JSON.

The JSON must match this exact shape:
{
  "meetingType": "<inferred type: standup | planning | brainstorm | review | 1on1 | all-hands | other>",
  "detectedLanguages": ["<language1>", "<language2>"],
  "actionPoints": ["<plain text action item>", "..."],
  "notes": "<full rich-markdown meeting notes document — see format below>"
}

RULES FOR actionPoints:
- Plain strings only — no "- [ ]" checkbox prefix
- Each item must be a clear, actionable task
- Empty array [] if no action items

RULES FOR notes (the full markdown document to show users):
Write a comprehensive meeting notes document in this exact format. The notes value must be a valid JSON string (escape newlines as \\n, quotes as \\"):

📋 Meeting Overview
**Date:** [Extract or use today's date]
**Duration:** [Estimate from transcript]
**Attendees:** [All speakers]
**Meeting Type:** [Same as meetingType field above]

🎯 Key Takeaways
- [3-5 bullet points of most important outcomes]

📝 Summary
[2-3 paragraph narrative summary]

💬 Discussion Points
[Organized by theme. For each theme:]
### [Theme Title]
**Context:** [description]
**Key Points:**
- point 1
- point 2
**Participants' Views:**
- **[Name]:** their view

✅ Action Items
- [ ] [Same items as actionPoints array above]

🔲 Decisions Made
| Decision Title | What was decided | Why | Impact |
| --- | --- | --- | --- |

❓ Open Questions
[Unresolved questions]

📊 Data & Metrics Mentioned
| Metric | Value | Context |
| --- | --- | --- |

📅 Important Dates & Deadlines
[All dates mentioned]

🔗 References & Resources
[Documents, links, tools mentioned]

💡 Ideas & Suggestions
[Brainstormed ideas]

🧱 Blockers & Risks
[Obstacles and risks]

📍 Next Steps
[Priority-ordered next steps]

📌 Additional Notes
[Any other relevant info]

IMPORTANT:
- Write ALL notes entirely in English — translate any Hindi, Marathi, or other non-English content
- Professional tone throughout
- Do NOT include the full transcript in the notes field

TRANSCRIPT:
${transcript}`;

  try {
    const response = await retryOperation(
      () =>
        ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: { parts: [{ text: analysisPrompt }] },
          generationConfig: {
            maxOutputTokens: 65536,
            temperature: 0.1,
            responseMimeType: 'application/json', // Forces Gemini to return valid JSON
          },
        }),
      3,
      1000,
      'Pass 2: Analysis generation'
    );

    const responseText = response.text;
    if (!responseText) throw new Error("Empty analysis response from Gemini.");

    const analysis = parseJsonResponse(responseText);
    const isTruncated = response.candidates?.[0]?.finishReason === 'MAX_TOKENS';

    return { ...analysis, isTruncated };
  } catch (error) {
    console.error("Transcript analysis failed:", error);
    throw error;
  }
};

// ─── Legacy single-pass fallback ───────────────────────────────────────────────
const legacyAnalyzeConversation = async (audioBlob: Blob): Promise<MeetingAnalysis> => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("API Key is missing.");

  const ai = new GoogleGenAI({ apiKey });
  const base64Audio = await blobToBase64(audioBlob);
  const mimeType = audioBlob.type || 'audio/webm';

  const systemPrompt = `You are an expert meeting assistant. Analyze this audio and respond with a single valid JSON object — no markdown fences, no extra text.

JSON shape:
{
  "meetingType": "<type>",
  "detectedLanguages": ["<lang>"],
  "actionPoints": ["<plain text action>"],
  "transcript": "<verbatim transcript>",
  "notes": "<full rich-markdown meeting notes — same format as the multi-section document with emoji headers>"
}

For the notes field, write comprehensive meeting notes using these emoji sections:
📋 Meeting Overview, 🎯 Key Takeaways, 📝 Summary, 💬 Discussion Points, ✅ Action Items, 🔲 Decisions Made, ❓ Open Questions, 📊 Data & Metrics, 📅 Important Dates, 🔗 References, 💡 Ideas & Suggestions, 🧱 Blockers & Risks, 📍 Next Steps, 📌 Additional Notes

Write ALL content in English. Professional tone.`;

  try {
    const response: GenerateContentResponse = await retryOperation(
      () =>
        ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: {
            parts: [
              { inlineData: { mimeType, data: base64Audio } },
              { text: systemPrompt },
            ],
          },
          generationConfig: {
            maxOutputTokens: 8192,
            temperature: 0.1,
            responseMimeType: 'application/json',
          },
        }),
      3,
      1000,
      'Legacy single-pass analysis'
    );

    const responseText = response.text;
    if (!responseText) throw new Error("Empty response from Gemini.");

    const parsed = parseJsonResponse(responseText);
    const isTruncated = response.candidates?.[0]?.finishReason === 'MAX_TOKENS';

    // For legacy mode, transcript comes inside the JSON
    let transcript = '';
    try {
      const raw = JSON.parse(responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
      transcript = raw.transcript ?? '';
    } catch {
      // ignore
    }

    return { ...parsed, transcript, isTruncated };
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};

// ─── Two-pass orchestrator (main export — unchanged logic) ────────────────────
export const analyzeConversation = async (audioBlob: Blob): Promise<MeetingAnalysis> => {
  let transcript: string | null = null;

  try {
    console.log('[Pass 1/2] Extracting transcript from audio...');
    transcript = await extractTranscript(audioBlob);
    console.log(`[Pass 1/2] ✅ Transcript extracted (${transcript.length} characters)`);
  } catch (pass1Error) {
    console.error('[Pass 1/2] ❌ Transcript extraction failed:', pass1Error);
    console.log('[Fallback] Attempting legacy single-pass analysis...');
    try {
      return await legacyAnalyzeConversation(audioBlob);
    } catch {
      throw pass1Error;
    }
  }

  try {
    console.log('[Pass 2/2] Generating structured analysis...');
    const analysis = await analyzeTranscript(transcript);
    console.log('[Pass 2/2] ✅ Analysis complete');
    return { ...analysis, transcript };
  } catch (pass2Error: any) {
    console.error('[Pass 2/2] ❌ Analysis generation failed:', pass2Error);
    return {
      transcript,
      summary: `Analysis generation failed. Raw transcript is available.\n\nError: ${pass2Error.message}`,
      actionPoints: [],
      isTruncated: false,
      meetingType: 'Unknown',
    };
  }
};

// ─── Dictation enhancement — JSON response ────────────────────────────────────
export const enhanceDictationText = async (text: string): Promise<MeetingAnalysis> => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("API Key is missing.");

  const ai = new GoogleGenAI({ apiKey });

  const systemPrompt = `You are an expert professional editor. Rewrite the raw dictation below into a polished document. Respond with a single valid JSON object — no markdown fences, no extra text.

JSON shape:
{
  "meetingType": "Dictation",
  "detectedLanguages": ["<primary language>"],
  "actionPoints": ["<plain text action if any>"],
  "transcript": "<clean version of dictation with punctuation fixed and fillers removed>",
  "notes": "<professionally rewritten text as a cohesive paragraph or document>"
}

RULES:
1. Remove filler words (um, uh, you know)
2. Fix grammar and punctuation
3. Improve flow and clarity while preserving original meaning
4. If Indian regional languages used, preserve meaning and rewrite professionally
5. actionPoints: empty array [] if no clear tasks were dictated

INPUT DICTATION:
${text}`;

  try {
    const response = await retryOperation(
      () =>
        ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: { parts: [{ text: systemPrompt }] },
          generationConfig: {
            responseMimeType: 'application/json',
          },
        }),
      3,
      1000,
      'Dictation enhancement'
    );

    const responseText = response.text;
    if (!responseText) throw new Error("Empty response from Gemini.");

    const analysis = parseJsonResponse(responseText);

    // Extract transcript field from the JSON (dictation returns it inside the object)
    let transcript = text; // fallback to original
    try {
      const raw = JSON.parse(responseText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
      if (raw.transcript) transcript = raw.transcript;
    } catch {
      // ignore, use fallback
    }

    return { ...analysis, transcript };
  } catch (error) {
    console.error("Gemini Dictation Error:", error);
    return {
      transcript: text,
      summary: text,
      actionPoints: [],
      meetingType: 'Dictation',
    };
  }
};
