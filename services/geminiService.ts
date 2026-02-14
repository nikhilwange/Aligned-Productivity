import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { MeetingAnalysis } from "../types";

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

const parseMarkdownResponse = (text: string): MeetingAnalysis => {
  // Use all possible section markers as lookahead for the transcript
  const transcriptMatch = text.match(/🗣️\s*Full Transcript\s*([\s\S]*?)(?=[📋🎯📝💬✅🎲❓📊📅🔗💡🚧📌📎]|$)/i);
  const transcript = transcriptMatch ? transcriptMatch[1].trim() : "";

  // Extract Action Items specifically for checkboxes
  const actionItemsMatch = text.match(/✅\s*Action Items\s*([\s\S]*?)(?=[📋🎯📝💬🎲❓📊📅🔗💡🚧📌🗣️📎]|$)/i);
  const actionPoints = actionItemsMatch
    ? actionItemsMatch[1]
      .split('\n')
      .filter(l => l.trim().startsWith('- [ ]') || l.trim().startsWith('- [x]'))
      .map(l => l.replace(/^- \[[ x]\]\s*/, '').trim())
    : [];

  // Extract Meeting Type specifically to update session title
  const meetingTypeMatch = text.match(/Meeting Type\s*:\s*([^\n]+)/i);
  const meetingType = meetingTypeMatch ? meetingTypeMatch[1].trim() : undefined;

  // The rest of the content (excluding transcript for brevity in the summary field)
  // We use the first occurrence of Transcript as the split point
  const notesDocument = text.split(/🗣️\s*Full Transcript/i)[0].trim();

  // Extract detected languages if mentioned
  const languagesMatch = text.match(/Detected Languages\s*:\s*([\s\S]*?)(?=\n|$)/i);
  const detectedLanguages = languagesMatch
    ? languagesMatch[1].split(',').map(l => l.trim())
    : undefined;

  return {
    summary: notesDocument,
    actionPoints,
    detectedLanguages,
    transcript,
    meetingType
  };
};

async function retryOperation<T>(operation: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    if (retries > 0 && (error.status === 500 || error.status === 503 || error.message?.includes('xhr error') || error.message?.includes('fetch failed') || error.message?.includes('code: 6'))) {
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryOperation(operation, retries - 1, delay * 2);
    }
    throw error;
  }
}

export const analyzeConversation = async (audioBlob: Blob): Promise<MeetingAnalysis> => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("API Key is missing.");

  const ai = new GoogleGenAI({ apiKey });
  const base64Audio = await blobToBase64(audioBlob);
  const mimeType = audioBlob.type || 'audio/webm';

  const systemPrompt = `You are an expert meeting assistant that creates comprehensive, well-structured meeting notes in a professional documentation format. Analyze this multilingual audio recording (which may contain English and major Indian languages like Hindi, Marathi, Gujarati, Tamil, Telugu, Kannada, Bengali, Malayalam, and Punjabi) and provide detailed notes in the following format (ensure the output ALWAYS starts with the Meeting Overview):

📋 Meeting Overview
Date: [Extract or use today's date]
Duration: [Calculate from audio length]
Attendees: [List all speakers mentioned or identified]
Meeting Type: [Infer: standup, planning, brainstorm, review, etc.]

🎯 Key Takeaways
Provide 3-5 concise bullet points highlighting the most important outcomes, decisions, or insights from this meeting.

📝 Summary
Write a comprehensive 2-3 paragraph narrative summary of the meeting.

💬 Discussion Points
Organize the meeting content into thematic sections with "Context", "Key Points", and "Participants' Views".

✅ Action Items
List all tasks, follow-ups, and commitments made during the meeting. Each action item should include a checkbox:
- [ ] [Clear, actionable task description]

🎲 Decisions Made
List all firm decisions, agreements, or conclusions reached in a tabular format with the following columns:
| Decision Title | What was decided | Why | Impact |

❓ Open Questions
Capture any unresolved questions, concerns, or items that need further discussion.

📊 Data & Metrics Mentioned
Use a markdown table: | Metric | Value | Context |

📅 Important Dates & Deadlines
Extract all dates mentioned.

🔗 References & Resources
List any documents, links, tools, or resources mentioned.

💡 Ideas & Suggestions
Capture any brainstormed ideas, suggestions, or proposals.

🚧 Blockers & Risks
Identify any obstacles, concerns, or risks discussed.

📌 Next Steps
Summarize what should happen next in priority order.

🗣️ Full Transcript
Format: [Speaker Name/Role] (MM:SS): [What they said]
IMPORTANT: Provide a complete, verbatim transcript of the entire meeting. Do not summarize or skip any parts. This section is critical.

📎 Additional Notes
Any other relevant information.

FORMATTING INSTRUCTIONS:
- Use clear headers and sections with emoji for visual scanning.
- DO NOT use double asterisks (**) for bolding. Use plain text instead.
- Use bullet points and checkboxes.
- Preserve multilingual content. If something is said in an Indian regional language, transcribe it accurately in its native script and provide English translation in [brackets].
- Professional tone throughout.`;

  try {
    const response: GenerateContentResponse = await retryOperation(() => ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: {
        parts: [
          { inlineData: { mimeType: mimeType, data: base64Audio } },
          { text: systemPrompt }
        ]
      },
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.1, // Low temperature for high fidelity transcription
      }
    }));

    const responseText = response.text;
    if (!responseText) throw new Error("Empty response from Gemini.");

    const analysis = parseMarkdownResponse(responseText);
    const candidate = response.candidates?.[0];
    const isTruncated = candidate?.finishReason === 'MAX_TOKENS';

    return { ...analysis, isTruncated };
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};

export const enhanceDictationText = async (text: string): Promise<MeetingAnalysis> => {
  const apiKey = process.env.API_KEY || (import.meta.env.VITE_GEMINI_API_KEY as string);
  if (!apiKey) throw new Error("API Key is missing.");

  const ai = new GoogleGenAI({ apiKey });

  const systemPrompt = `You are an expert professional editor. Your task is to rewrite the following raw dictation (which may contain English or major Indian languages) into a polished, professional document.
  
  Rules:
  1. Remove filler words (um, uh, you know).
  2. Fix grammar and punctuation.
  3. Improve flow and clarity while maintaining the original meaning.
  4. Format the output as a clean document.
  5. Detect the primary language(s) used.
  6. If Indian regional languages are used, preserve the original meaning but rewrite in a professional manner (you may provide the polished version in English or the original script depending on the context).

  Output Format:
  Return the result in the following structure:
  
  📝 Summary
  [The professionally rewritten text goes here. Do not use bullet points unless the user explicitly dictated a list. Write it as a cohesive paragraph or document.]

  🗣️ Full Transcript
  [The dictation text with auto-punctuation and fillers removed. Format it as a clean text block.]

  ✅ Action Items
  [If any clear tasks were dictated, list them here. Otherwise, leave empty.]
  
  detectedLanguages: [Language]
  meetingType: Dictation

  Input Text:
  ${text}
  `;

  try {
    const response = await retryOperation(() => ai.models.generateContent({
      model: 'gemini-2.0-flash-exp',
      contents: {
        parts: [{ text: systemPrompt }]
      }
    }));

    const responseText = response.text;
    if (!responseText) throw new Error("Empty response from Gemini.");

    // Reuse existing parser or fallback
    const analysis = parseMarkdownResponse(responseText);

    // Ensure the transcribed text we passed is preserved if the model didn't return it exactly
    if (!analysis.transcript) analysis.transcript = text;

    return analysis;
  } catch (error) {
    console.error("Gemini Dictation Error:", error);
    // Fallback if enhancement fails
    return {
      transcript: text,
      summary: text, // Fallback to original
      actionPoints: [],
      meetingType: 'Dictation'
    };
  }
};