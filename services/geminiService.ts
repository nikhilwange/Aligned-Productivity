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

export async function retryOperation<T>(
  operation: () => Promise<T>,
  retries = 3,
  delay = 1000,
  operationName = 'API call'
): Promise<T> {
  try {
    return await operation();
  } catch (error: any) {
    const isRetryable = error.status === 500 ||
                       error.status === 503 ||
                       error.status === 429 || // Add rate limit handling
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

// Pass 1: Extract verbatim transcript from audio
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
    const response = await retryOperation(() =>
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [
            { inlineData: { mimeType, data: base64Audio } },
            { text: transcriptPrompt }
          ]
        },
        generationConfig: {
          maxOutputTokens: 65536, // Gemini 2.5 Flash supports up to 65k tokens!
          temperature: 0.1,
        }
      }),
      3,
      1000,
      'Pass 1: Transcript extraction'
    );

    const transcriptText = response.text;
    if (!transcriptText) throw new Error("Empty transcript from Gemini.");

    const wasTruncated = response.candidates?.[0]?.finishReason === 'MAX_TOKENS';
    if (wasTruncated) {
      console.warn('⚠️ Transcript was truncated. Consider upgrading to Gemini 2.5 Flash.');
    }

    return transcriptText.trim();

  } catch (error) {
    console.error("Transcript extraction failed:", error);
    throw error;
  }
};

// Pass 2: Generate structured analysis from transcript text
export const analyzeTranscript = async (transcript: string): Promise<Omit<MeetingAnalysis, 'transcript'>> => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error("API Key is missing.");

  const ai = new GoogleGenAI({ apiKey });

  // Reuse the existing system prompt structure but adapted for text input
  const analysisPrompt = `You are an expert meeting assistant that creates comprehensive, well-structured meeting notes.

Analyze this meeting transcript and provide detailed notes in the following format:

📋 Meeting Overview
Date: [Extract or use today's date]
Duration: [Estimate from transcript length/timestamps]
Attendees: [List all speakers mentioned]
Meeting Type: [Infer: standup, planning, brainstorm, review, etc.]

🎯 Key Takeaways
Provide 3-5 concise bullet points highlighting the most important outcomes.

📝 Summary
Write a comprehensive 2-3 paragraph narrative summary.

💬 Discussion Points
Organize by themes with Context, Key Points, and Participants' Views.

✅ Action Items
List all tasks with checkboxes:
- [ ] [Clear, actionable task description]

🎲 Decisions Made
| Decision Title | What was decided | Why | Impact |

❓ Open Questions
Capture unresolved questions or items needing discussion.

📊 Data & Metrics Mentioned
| Metric | Value | Context |

📅 Important Dates & Deadlines
Extract all dates mentioned.

🔗 References & Resources
List documents, links, tools, or resources mentioned.

💡 Ideas & Suggestions
Capture brainstormed ideas or proposals.

🚧 Blockers & Risks
Identify obstacles, concerns, or risks discussed.

📌 Next Steps
Summarize what should happen next in priority order.

📎 Additional Notes
Any other relevant information.

FORMATTING INSTRUCTIONS:
- Use emoji headers (📋, 🎯, etc.) for each section — always followed by a space and the section title
- Use **bold** only for primary labels at the start of a line (e.g., **Date:** value, **Duration:** value, **Owner:** value)
- Every label MUST be followed by a colon and a space (e.g., **Attendees:** John, Sarah)
- Use standard Markdown tables with header rows and separator rows (| --- |)
- Use - for bullet points and - [ ] for action item checkboxes
- Preserve multilingual content with [English translation] in brackets
- Use ### for sub-section headers within a section
- Do NOT use bold for emphasis within sentences — only for labels at the start of lines
- Professional tone throughout
- DO NOT include the full transcript in output - I have it separately

TRANSCRIPT TO ANALYZE:
${transcript}`;

  try {
    const response = await retryOperation(() =>
      ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: {
          parts: [{ text: analysisPrompt }]
        },
        generationConfig: {
          maxOutputTokens: 65536, // Gemini 2.5 Flash supports up to 65k tokens!
          temperature: 0.1,
        }
      }),
      3,
      1000,
      'Pass 2: Analysis generation'
    );

    const responseText = response.text;
    if (!responseText) throw new Error("Empty analysis response from Gemini.");

    const analysis = parseMarkdownResponse(responseText);
    const isTruncated = response.candidates?.[0]?.finishReason === 'MAX_TOKENS';

    return {
      ...analysis,
      isTruncated,
    };

  } catch (error) {
    console.error("Transcript analysis failed:", error);
    throw error;
  }
};

// Legacy single-pass implementation (kept as fallback)
const legacyAnalyzeConversation = async (audioBlob: Blob): Promise<MeetingAnalysis> => {
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
- Use emoji headers (📋, 🎯, etc.) for each section — always followed by a space and the section title
- Use **bold** only for primary labels at the start of a line (e.g., **Date:** value, **Duration:** value, **Owner:** value)
- Every label MUST be followed by a colon and a space (e.g., **Attendees:** John, Sarah)
- Use standard Markdown tables with header rows and separator rows (| --- |)
- Use - for bullet points and - [ ] for action item checkboxes
- Preserve multilingual content. If something is said in an Indian regional language, transcribe it accurately in its native script and provide English translation in [brackets]
- Use ### for sub-section headers within a section
- Do NOT use bold for emphasis within sentences — only for labels at the start of lines
- Professional tone throughout.`;

  try {
    const response: GenerateContentResponse = await retryOperation(() => ai.models.generateContent({
      model: 'gemini-2.5-flash',
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
    }), 3, 1000, 'Legacy single-pass analysis');

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

// New two-pass orchestrator
export const analyzeConversation = async (audioBlob: Blob): Promise<MeetingAnalysis> => {
  let transcript: string | null = null;

  try {
    // PASS 1: Extract complete transcript from audio
    console.log('[Pass 1/2] Extracting transcript from audio...');
    transcript = await extractTranscript(audioBlob);
    console.log(`[Pass 1/2] ✓ Transcript extracted (${transcript.length} characters)`);

  } catch (pass1Error) {
    console.error('[Pass 1/2] ✗ Transcript extraction failed:', pass1Error);

    // FALLBACK: Try legacy single-pass method
    console.log('[Fallback] Attempting legacy single-pass analysis...');
    try {
      return await legacyAnalyzeConversation(audioBlob);
    } catch (fallbackError) {
      console.error('[Fallback] ✗ Legacy method also failed');
      throw pass1Error;
    }
  }

  try {
    // PASS 2: Generate structured analysis from transcript
    console.log('[Pass 2/2] Generating structured analysis...');
    const analysis = await analyzeTranscript(transcript);
    console.log('[Pass 2/2] ✓ Analysis complete');

    // Combine results
    return {
      ...analysis,
      transcript, // Add transcript from Pass 1
    };

  } catch (pass2Error) {
    console.error('[Pass 2/2] ✗ Analysis generation failed:', pass2Error);

    // PARTIAL SUCCESS: Return transcript even if analysis failed
    console.log('[Recovery] Returning transcript-only result');
    return {
      transcript: transcript,
      summary: `Analysis generation failed. Raw transcript is available.\n\nError: ${pass2Error.message}`,
      actionPoints: [],
      isTruncated: false,
      meetingType: 'Unknown'
    };
  }
};

export const enhanceDictationText = async (text: string): Promise<MeetingAnalysis> => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
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
      model: 'gemini-2.5-flash',
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