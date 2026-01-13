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
  // Extract Transcript specifically for the transcript tab
  const transcriptMatch = text.match(/🗣️\s*Full Transcript\s*([\s\S]*?)(?=📎\s*Additional Notes|$)/i);
  const transcript = transcriptMatch ? transcriptMatch[1].trim() : "";

  // Extract Action Items specifically for checkboxes
  const actionItemsMatch = text.match(/✅\s*Action Items\s*([\s\S]*?)(?=🎲\s*Decisions Made|🗣️\s*Full Transcript|$)/i);
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
  const apiKey = process.env.API_KEY;
  if (!apiKey) throw new Error("API Key is missing.");

  const ai = new GoogleGenAI({ apiKey });
  const base64Audio = await blobToBase64(audioBlob);
  const mimeType = audioBlob.type || 'audio/webm';

  const systemPrompt = `You are an expert meeting assistant that creates comprehensive, well-structured meeting notes in the style of Notion AI. Analyze this multilingual audio recording (which may contain English, Hindi, and Marathi) and provide detailed notes in the following format:

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

📎 Additional Notes
Any other relevant information.

FORMATTING INSTRUCTIONS:
- Use clear headers and sections with emoji for visual scanning.
- DO NOT use double asterisks (**) for bolding. Use plain text instead.
- Use bullet points and checkboxes.
- Preserve multilingual content. If something is said in Hindi or Marathi, transcribe it accurately and provide English translation in [brackets].
- Transcribe Hindi and Marathi in Devanagari script.
- Professional tone throughout.`;

  try {
    const response: GenerateContentResponse = await retryOperation(() => ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: {
        parts: [
          { inlineData: { mimeType: mimeType, data: base64Audio } },
          { text: systemPrompt }
        ]
      },
      config: {
        thinkingConfig: { thinkingBudget: 0 }
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