import { GoogleGenAI, Type } from "@google/genai";
import type { QuestionItem, Assessment, AnalyzeFileResult, GenerationConfig, GeminiError } from './types'
import type { Reference } from './ai'
import { sanitizeQuestion, generateQuestionCode as sharedGenerateQuestionCode } from './sanitize'

function getAI(apiKey?: string) {
  return new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY || "" });
}

const SUBJECT_CODES: Record<string, string> = {
  'Mathematics': 'MAT', 'Biology': 'BIO', 'Physics': 'PHY', 'Chemistry': 'CHM',
}

// Re-export shared helper so callers can still import generateQuestionCode from gemini
export { sharedGenerateQuestionCode as generateQuestionCode }

const DIFFICULTY_CODES: Record<string, string> = {
  'Easy': 'EAS', 'Medium': 'MED', 'Challenging': 'CHL', 'Balanced': 'BAL',
}

export function generateAssessmentCode(subject: string, difficulty: string): string {
  const subj = SUBJECT_CODES[subject] ?? subject.substring(0, 3).toUpperCase()
  const diff = DIFFICULTY_CODES[difficulty] ?? difficulty.substring(0, 3).toUpperCase()
  const shortId = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `${subj}-${diff}-${shortId}`
}

export const IGCSE_SUBJECTS = ["Mathematics", "Biology", "Physics", "Chemistry"];

export const IGCSE_TOPICS: Record<string, string[]> = {
  "Mathematics": [
    "Number", "Algebra", "Functions", "Geometry", "Trigonometry",
    "Vectors & Transformations", "Mensuration", "Coordinate Geometry",
    "Statistics", "Probability", "Mixed Topics"
  ],
  "Biology": [
    "Characteristics of Living Organisms", "Cell Structure", "Biological Molecules",
    "Enzymes", "Plant Nutrition", "Human Nutrition", "Transport in Plants",
    "Transport in Animals", "Diseases & Immunity", "Gas Exchange", "Respiration",
    "Excretion", "Coordination & Response", "Drugs", "Reproduction", "Inheritance",
    "Variation & Selection", "Organisms & Environment", "Biotechnology", "Mixed Topics"
  ],
  "Physics": [
    "Motion, Forces & Energy", "Thermal Physics", "Waves",
    "Electricity & Magnetism", "Nuclear Physics", "Space Physics", "Mixed Topics"
  ],
  "Chemistry": [
    "States of Matter", "Atoms, Elements & Compounds", "Stoichiometry",
    "Electrochemistry", "Chemical Energetics", "Chemical Reactions",
    "Acids, Bases & Salts", "The Periodic Table", "Metals",
    "Chemistry of the Environment", "Organic Chemistry", "Experimental Techniques", "Mixed Topics"
  ]
};

export const DIFFICULTY_LEVELS = ["Easy", "Medium", "Challenging", "Balanced"];

export const DIFFICULTY_GUIDANCE: Record<string, string> = {
  Easy: `DIFFICULTY: Easy
- Target: 80–90% of students should answer correctly
- Bloom's Level: L1 Remember / L2 Understand
- Marks per question: 1–2
- Command words: State, Name, Define, List, Identify, Label
- Style: Single concept, direct recall, familiar textbook contexts, one-step calculations
- MCQ distractors: clearly wrong to a student who knows the topic`,

  Medium: `DIFFICULTY: Medium
- Target: 40–60% of students should answer correctly
- Bloom's Level: L3 Apply / L4 Analyse
- Marks per question: 2–4
- Command words: Describe, Explain, Calculate, Show, Draw
- Style: Apply knowledge to given scenarios, combine 2 concepts, 2–3 step calculations
- MCQ distractors: plausible but distinguishable with careful reasoning`,

  Challenging: `DIFFICULTY: Challenging — STRICTLY ENFORCE the following:
- Target: Only 10–20% of students should answer fully correctly (A* discriminator questions)
- Bloom's Level: L4 Analyse / L5 Evaluate / L6 Create
- Marks per question: 4–8 (multi-part questions encouraged)
- Command words: Evaluate, Discuss, Suggest, Compare, Deduce, Predict — NOT "State" or "Name"
- MANDATORY requirements for EVERY question:
  1. Place knowledge in UNFAMILIAR contexts (novel scenarios, not textbook examples)
  2. Require chaining 3+ concepts or calculation steps — no single-step answers
  3. Where possible, synthesise across two syllabus topics (e.g. stoichiometry + energetics)
  4. Extended response questions (≥4 marks) must demand a structured argument with evidence
  5. Calculations must require rearranging formulae and multi-stage working
  6. MCQ: all four options must be plausible misconceptions; correct answer requires rigorous reasoning
  7. Mark scheme must have 4+ distinct marking points
- A question that a student can answer from memory alone is NOT acceptable for this difficulty`,

  Balanced: `DIFFICULTY: Balanced — distribute across: Easy ~25% (80–90% pass rate), Medium ~50% (40–60% pass rate), Challenging ~25% (10–20% pass rate).
Include a variety of command words and mark ranges (1–6 marks).`,
}

export const CAMBRIDGE_COMMAND_WORDS = {
  "Describe": "State the points of a topic / give characteristics and main features.",
  "Explain": "Set out purposes or reasons / make the relationships between things evident / provide why and/or how and support with relevant evidence.",
  "Suggest": "Apply knowledge and understanding to situations where there are a range of valid responses in order to make proposals / put forward considerations.",
  "Evaluate": "Judge or calculate the quality, importance, amount, or value of something.",
  "Discuss": "Write about issue(s) or topic(s) in depth in a structured way.",
  "Compare": "Identify/comment on similarities and/or differences.",
  "State": "Express in clear terms.",
  "Calculate": "Work out from given facts, figures or information."
};

// ---- Error handling ----

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  onRetry?: (attempt: number) => void
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (err: any) {
      const status = err?.status ?? err?.code
      if (status === 429) {
        if (i < maxRetries - 1) {
          onRetry?.(i + 1)
          await new Promise(r => setTimeout(r, Math.pow(2, i) * 5000))
          continue
        }
        throw {
          type: 'rate_limit',
          retryable: false,
          message: 'Rate limit exceeded. Please wait a few minutes and try again.',
        } satisfies GeminiError
      }
      if (status === 503) {
        throw {
          type: 'model_overloaded',
          retryable: false,
          message: 'Model is currently overloaded. Try switching to a Flash model.',
        } satisfies GeminiError
      }
      if (status === 404) {
        throw {
          type: 'unknown',
          retryable: false,
          message: 'Model not found (404). Check your model selection — the selected model may not exist or your API key may not have access to it.',
        } satisfies GeminiError
      }
      if (status === 401 || status === 403) {
        throw {
          type: 'unknown',
          retryable: false,
          message: 'Invalid or unauthorized API key. Please check your key in API Settings.',
        } satisfies GeminiError
      }
      // Preserve original error message if available
      const originalMsg = err?.message && !err.message.startsWith('{') ? err.message : null
      throw {
        type: 'unknown',
        retryable: false,
        message: originalMsg ?? 'Generation failed. Please try again.',
      } satisfies GeminiError
    }
  }
  throw {
    type: 'rate_limit',
    retryable: false,
    message: 'Rate limit exceeded. Please wait a few minutes and try again.',
  } satisfies GeminiError
}
// -------------------------

// 48h minus 2h buffer
const GEMINI_URI_VALID_MS = 46 * 60 * 60 * 1000

const FILE_UPLOAD_TIMEOUT_MS = 120_000 // 2 minutes max for a file upload

export async function uploadToGeminiFileApi(
  base64: string,
  mimeType: string,
  displayName: string,
  apiKey: string
): Promise<string> {
  const ai = getAI(apiKey)
  const binaryStr = atob(base64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
  const blob = new Blob([bytes], { type: mimeType })

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`File upload timed out after ${FILE_UPLOAD_TIMEOUT_MS / 1000}s. Check your connection or try a smaller file.`)),
      FILE_UPLOAD_TIMEOUT_MS
    )
  )

  const uploaded = await Promise.race([
    ai.files.upload({ file: blob, config: { displayName, mimeType } }),
    timeoutPromise,
  ])
  return (uploaded as any).uri as string
}

export const PAST_PAPER_FOCUS: Record<string, string> = {
  Easy: `Focus EXCLUSIVELY on the easiest questions in these papers: opening questions, part (a) sub-parts, 1–2 mark items, and any question using "State", "Name", or "Define". Ignore all other questions.`,
  Medium: `Focus on the mid-section questions in these papers: 2–4 mark items, "Describe" and "Explain" questions, and calculation questions with 2–3 steps. Ignore both the very easy opening questions and the hardest final questions.`,
  Challenging: `Focus EXCLUSIVELY on the HARDEST questions in these papers: the final questions of each section, all questions worth 4+ marks, any "Evaluate", "Discuss", or extended writing question, and multi-part structured questions. These are the questions that differentiate A* from A students. Replicate ONLY this level of difficulty — completely ignore the easier questions in the papers.`,
  Balanced: `Use the full range of questions across the papers to represent all difficulty levels proportionally.`,
}

function buildReferenceParts(references: Reference[], difficulty?: string): any[] {
  const parts: any[] = []
  const pastPapers = references.filter(r => r.resourceType === 'past_paper')
  const syllabuses = references.filter(r => r.resourceType === 'syllabus')
  const others = references.filter(r => !r.resourceType || r.resourceType === 'other')

  if (pastPapers.length > 0) {
    const focusInstruction = difficulty ? (PAST_PAPER_FOCUS[difficulty] ?? '') : ''
    parts.push({ text: `REFERENCE PAST PAPERS (${pastPapers.length} document${pastPapers.length > 1 ? 's' : ''}): The following are authentic Cambridge IGCSE past papers. Study them carefully and replicate their exact question style, phrasing, command word usage, diagram style, and mark allocation patterns. Your generated questions MUST feel indistinguishable from these official papers.\n\n${focusInstruction}` })
    pastPapers.forEach(ref => {
      if (ref.pastPaperText) {
        // Use cached text extraction — much cheaper than sending the full PDF
        parts.push({ text: `PAST PAPER STYLE EXAMPLES (extracted):\n${ref.pastPaperText}` })
      } else if (ref.geminiFileUri && ref.geminiFileUploadedAt && Date.now() - ref.geminiFileUploadedAt < GEMINI_URI_VALID_MS) {
        parts.push({ fileData: { fileUri: ref.geminiFileUri, mimeType: ref.mimeType } })
      } else {
        parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data.split(',')[1] || ref.data } })
      }
    })
  }

  if (syllabuses.length > 0) {
    syllabuses.forEach(ref => {
      if (ref.syllabusText) {
        parts.push({ text: `OFFICIAL CAMBRIDGE IGCSE SYLLABUS OBJECTIVES:\nOnly generate questions that directly assess the following learning objectives. Every question must be explicitly aligned to a stated objective.\n\n${ref.syllabusText}` })
      } else {
        parts.push({ text: `OFFICIAL CAMBRIDGE IGCSE SYLLABUS: The following document is the official syllabus. Only generate questions that cover the stated learning objectives. Every question must be aligned to a specific objective listed in this syllabus.` })
        if (ref.geminiFileUri && ref.geminiFileUploadedAt && Date.now() - ref.geminiFileUploadedAt < GEMINI_URI_VALID_MS) {
          parts.push({ fileData: { fileUri: ref.geminiFileUri, mimeType: ref.mimeType } })
        } else {
          parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data.split(',')[1] || ref.data } })
        }
      }
    })
  }

  if (others.length > 0) {
    others.forEach(ref => {
      if (ref.geminiFileUri && ref.geminiFileUploadedAt && Date.now() - ref.geminiFileUploadedAt < GEMINI_URI_VALID_MS) {
        parts.push({ fileData: { fileUri: ref.geminiFileUri, mimeType: ref.mimeType } })
      } else {
        parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data.split(',')[1] || ref.data } })
      }
    })
  }

  return parts
}

export async function generateTest(
  config: GenerationConfig & { references?: Reference[]; apiKey?: string },
  onRetry?: (attempt: number) => void
): Promise<QuestionItem[]> {
  const ai = getAI(config.apiKey)
  const prompt = `Generate a Cambridge IGCSE ${config.subject} assessment.
Topic: ${config.topic}
${DIFFICULTY_GUIDANCE[config.difficulty] ?? `Difficulty: ${config.difficulty}`}
Number of Questions: ${config.count}
Question Type: ${config.type}
Calculator: ${config.calculator ? "Allowed" : "Not Allowed"}
${config.syllabusContext ? `Syllabus Context: ${config.syllabusContext}` : ""}

Rules:
1. Generate EXACTLY ${config.count} questions.
2. Each question must have: text (markdown, bold), answer, markScheme, marks (integer), commandWord, type (mcq/short_answer/structured), hasDiagram (boolean), syllabusObjective (string).
3. For diagrams, include SVG inside the 'text' field as \`\`\`svg ... \`\`\` using camelCase attributes.
4. CRITICAL: ALL mathematical expressions, variables, equations, and formulas MUST be wrapped in LaTeX inline delimiters: $x^2$, $3x^2 - 5x + 2 = 0$, $\frac{a}{b}$, $H_2O$. NEVER write math as plain text.
5. FOR MCQ QUESTIONS: Set type to "mcq". Provide exactly 4 answer choices in the "options" array (plain text, no letter prefix). The "answer" field must be ONLY the letter "A", "B", "C", or "D". If 4 distinct text-based options cannot be written, use short_answer instead.
6. syllabusObjective: the specific Cambridge IGCSE learning objective this question assesses. Format: "ref – objective statement" (e.g. "C4.1 – Define the term acid in terms of proton donation" or "B2.2 – Describe the structure of a mitochondrion"). Be precise and concise — one sentence max.
7. Do NOT add a separate Syllabus Reference line in the question text; the syllabusObjective field replaces it.
8. difficultyStars: rate this specific question's cognitive demand as 1, 2, or 3 — regardless of the overall assessment difficulty. 1 = recall/knowledge (State, Name, Define, 1-2 marks). 2 = application/analysis (Describe, Explain, Calculate, 2-4 marks). 3 = evaluation/synthesis (Evaluate, Discuss, Deduce, 4+ marks, multi-step or unfamiliar context).`

  const parts: any[] = config.references && config.references.length > 0
    ? buildReferenceParts(config.references, config.difficulty)
    : []

  parts.push({ text: prompt })

  const response = await withRetry(() => ai.models.generateContent({
    model: config.model || "gemini-3-flash-preview",
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                answer: { type: Type.STRING },
                markScheme: { type: Type.STRING },
                marks: { type: Type.NUMBER },
                commandWord: { type: Type.STRING },
                type: { type: Type.STRING },
                hasDiagram: { type: Type.BOOLEAN },
                syllabusObjective: { type: Type.STRING, nullable: true },
                difficultyStars: { type: Type.NUMBER, nullable: true },
                options: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
              },
              required: ['text', 'answer', 'markScheme', 'marks', 'commandWord', 'type', 'hasDiagram'],
            },
          },
        },
        required: ['questions'],
      },
      systemInstruction: `You are an expert Cambridge IGCSE Assessment Designer for ${config.subject}.
Your goal is to create high-quality, syllabus-aligned assessments.

**Cambridge Command Words Usage**:
- **Describe**: State the points of a topic / give characteristics and main features.
- **Explain**: Set out purposes or reasons / make the relationships between things evident / provide why and/or how and support with relevant evidence.
- **Suggest**: Apply knowledge and understanding to situations where there are a range of valid responses in order to make proposals / put forward considerations.
- **Evaluate**: Judge or calculate the quality, importance, amount, or value of something.
- **Calculate**: Work out from given facts, figures or information.

When generating SVG diagrams:
- Use a clean, professional "exam paper" style (black lines on white/transparent background).
- **CRITICAL**: Use **camelCase** for all SVG attributes (e.g., \`strokeWidth\`, \`fontSize\`, \`fontFamily\`, \`textAnchor\`, \`dominantBaseline\`).`,
    },
  }), 3, onRetry)

  const raw = safeJsonParse(response.text || '{}') as { questions: Omit<QuestionItem, 'id'>[] }
  let questions: QuestionItem[] = (raw.questions ?? []).map(q => {
    const sanitized = sanitizeQuestion(q)
    return {
      ...sanitized,
      id: crypto.randomUUID(),
      code: sharedGenerateQuestionCode(config.subject, {
        text: sanitized.text,
        syllabusObjective: sanitized.syllabusObjective,
      }),
    }
  })

  if (config.difficulty === 'Challenging' && questions.length > 0) {
    questions = await critiqueForDifficulty(questions, config.subject, config.model || 'gemini-3-flash-preview', ai, onRetry)
  }

  return questions
}

async function critiqueForDifficulty(
  questions: QuestionItem[],
  subject: string,
  model: string,
  ai: ReturnType<typeof getAI>,
  onRetry?: (attempt: number) => void,
): Promise<QuestionItem[]> {
  const questionsText = questions
    .map((q, i) => `Q${i + 1} [${q.marks} marks] (${q.commandWord})\n${q.text}\n\nAnswer: ${q.answer}\n\nMark Scheme: ${q.markScheme}`)
    .join('\n\n---\n\n')

  const prompt = `You are a Cambridge IGCSE Chief Examiner conducting a difficulty audit for ${subject}.

REQUIRED DIFFICULTY: Challenging
- Target: Only 10–20% of students answer fully correctly
- Must use higher-order thinking: Evaluate, Deduce, Predict, Suggest (NOT State/Name/Define)
- Must require 3+ cognitive steps or multi-stage synthesis
- Must place content in UNFAMILIAR contexts

QUESTIONS TO AUDIT:
${questionsText}

TASK:
1. Score each question 1–10 for difficulty (1 = trivial recall, 10 = A* discriminator)
2. Any question scoring below 7 MUST be rewritten to reach 7+
3. When rewriting: use unfamiliar context, require more synthesis steps, upgrade command word
4. Keep the same syllabus topic and mark value
5. Return ALL questions (revised or unchanged) as JSON`

  const response = await withRetry(() => ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                answer: { type: Type.STRING },
                markScheme: { type: Type.STRING },
                marks: { type: Type.NUMBER },
                commandWord: { type: Type.STRING },
                type: { type: Type.STRING },
                hasDiagram: { type: Type.BOOLEAN },
                syllabusObjective: { type: Type.STRING, nullable: true },
                difficultyStars: { type: Type.NUMBER, nullable: true },
                options: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
              },
              required: ['text', 'answer', 'markScheme', 'marks', 'commandWord', 'type', 'hasDiagram'],
            },
          },
        },
        required: ['questions'],
      },
      systemInstruction: `You are a Senior Cambridge IGCSE Chief Examiner. Your only job is to ensure questions are genuinely challenging — at the A* discrimination level. Be strict: if a question can be answered from memory, rewrite it.`,
    },
  }), 3, onRetry)

  const raw = safeJsonParse(response.text || '{}') as { questions: any[] }
  return (raw.questions ?? []).map((q, i) => {
    const sanitized = sanitizeQuestion(q)
    const existing = questions[i]
    return {
      ...sanitized,
      id: existing?.id ?? crypto.randomUUID(),
      code: existing?.code ?? sharedGenerateQuestionCode(subject, {
        text: sanitized.text,
        syllabusObjective: sanitized.syllabusObjective,
      }),
    }
  })
}

export async function auditTest(
  subject: string,
  assessment: Assessment,
  model: string = 'gemini-3.1-pro-preview',
  apiKey?: string
): Promise<QuestionItem[]> {
  const ai = getAI(apiKey)
  const questionsText = assessment.questions
    .map((q, i) => `**Q${i + 1}** [${q.marks} marks] (${q.commandWord})\n${q.text}\n\nAnswer: ${q.answer}\n\nMark Scheme: ${q.markScheme}`)
    .join('\n\n---\n\n')

  const prompt = `You are a Senior Cambridge IGCSE Examiner and Auditor for ${subject}.
Your task is to review the following assessment and ensure it meets the highest standards of accuracy, pedagogical precision, and formatting.

ASSESSMENT TO REVIEW:
---
${questionsText}
---

AUDIT CRITERIA:
1. **Command Words**: Ensure words like "Describe", "Explain", "Suggest" are used correctly according to IGCSE definitions.
2. **Mark Allocation**: Ensure the mark scheme points match the cognitive demand of the question.
3. **Accuracy**: Check for any scientific or mathematical errors.
4. **Formatting**: Ensure clean markdown question text and consistent MCQ option spacing. Do NOT add a separate Syllabus Reference line.
5. **SVG Diagrams**: Ensure SVG diagrams use camelCase attributes.

If you find errors, fix them and return the ENTIRE corrected assessment.
If the assessment is perfect, return it as is.`

  const response = await withRetry(() => ai.models.generateContent({
    model: model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                answer: { type: Type.STRING },
                markScheme: { type: Type.STRING },
                marks: { type: Type.NUMBER },
                commandWord: { type: Type.STRING },
                type: { type: Type.STRING },
                hasDiagram: { type: Type.BOOLEAN },
              },
              required: ['text', 'answer', 'markScheme', 'marks', 'commandWord', 'type', 'hasDiagram'],
            },
          },
        },
        required: ['questions'],
      },
    },
  }))

  const raw = JSON.parse(response.text || '{}') as { questions: Omit<QuestionItem, 'id'>[] }
  return (raw.questions ?? []).map((q, i) => {
    const sanitized = sanitizeQuestion(q)
    const existing = assessment.questions[i]
    return {
      ...sanitized,
      id: existing?.id ?? crypto.randomUUID(),
      code: existing?.code ?? sharedGenerateQuestionCode(assessment.subject, {
        text: sanitized.text,
        syllabusObjective: sanitized.syllabusObjective,
      }),
    }
  })
}

export async function getStudentFeedback(
  subject: string,
  assessment: Assessment,
  studentAnswers: string[],
  modelName: string = 'gemini-3-flash-preview',
  apiKey?: string
): Promise<string> {
  const ai = getAI(apiKey)
  const questionsText = assessment.questions
    .map((q, i) => `**Q${i + 1}** [${q.marks} marks]\n${q.text}\n\nMark Scheme: ${q.markScheme}`)
    .join('\n\n')
  const answersText = studentAnswers
    .map((a, i) => `Q${i + 1}: ${a || '(no answer)'}`)
    .join('\n')

  const prompt = `
    You are an expert Cambridge IGCSE Examiner for ${subject}.

    TASK:
    Evaluate the student's answers based on the provided questions and mark scheme.

    QUESTIONS AND MARK SCHEMES:
    ${questionsText}

    STUDENT ANSWERS:
    ${answersText}

    INSTRUCTIONS:
    1. Be strict but fair, following the Cambridge assessment objectives.
    2. For each question, indicate if it's correct, partially correct, or incorrect.
    3. Provide specific feedback on how to improve, referencing the "Command Words" if applicable.
    4. Give an estimated mark for each section.
    5. Summarize the student's performance and provide 3 key areas for improvement.
    6. Use Markdown for formatting.
  `

  const response = await withRetry(() => ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      systemInstruction: "You are a professional Cambridge IGCSE examiner. Provide constructive, precise feedback based on official mark schemes.",
    },
  }))

  return response.text || "Could not generate feedback."
}

// sanitizeQuestion is now imported from './sanitize'

function safeJsonParse(text: string) {
  if (!text) return {};

  let cleaned = text.trim();

  // Remove markdown code blocks if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }

  try {
    return JSON.parse(cleaned);
  } catch (e) {
    // Attempt to find the first '{' and last '}'
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start !== -1 && end !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.substring(start, end + 1));
      } catch (e2) {
        // If it's still failing, it might be an escaping issue or truncation
        // We'll throw the original error but with more context
        console.error("JSON Parse Error Context:", cleaned.substring(Math.max(0, cleaned.length - 500)));
        throw e;
      }
    }
    throw e;
  }
}

export async function analyzeFile(
  base64Data: string,
  mimeType: string,
  subject: string,
  count: number = 3,
  model: string = 'gemini-3-flash-preview',
  references?: Reference[],
  apiKey?: string
): Promise<AnalyzeFileResult> {
  const ai = getAI(apiKey)
  const isPdf = mimeType === "application/pdf"
  const prompt = `Analyze this ${isPdf ? "past paper PDF" : "screenshot"} of a Cambridge IGCSE ${subject} question.
1. Explain the topic and learning objectives it covers.
2. Generate EXACTLY ${count} similar questions with the same concept but different context.
3. For Science subjects, include SVG diagrams if appropriate. Use \`\`\`svg ... \`\`\` code blocks and **camelCase** attributes.
4. Each question must have: text, answer, markScheme, marks, commandWord, type (mcq/short_answer/structured), hasDiagram.
5. **FORMATTING**: Use clean markdown with clear spacing for options. Do NOT append a separate Syllabus Reference line.`

  const parts: any[] = references && references.length > 0
    ? buildReferenceParts(references)
    : []

  parts.push({
    inlineData: {
      mimeType: mimeType,
      data: base64Data.split(",")[1] || base64Data,
    },
  })

  parts.push({ text: prompt })

  const response = await withRetry(() => ai.models.generateContent({
    model: model,
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          analysis: { type: Type.STRING },
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                answer: { type: Type.STRING },
                markScheme: { type: Type.STRING },
                marks: { type: Type.NUMBER },
                commandWord: { type: Type.STRING },
                type: { type: Type.STRING },
                hasDiagram: { type: Type.BOOLEAN },
                options: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
              },
              required: ['text', 'answer', 'markScheme', 'marks', 'commandWord', 'type', 'hasDiagram'],
            },
          },
        },
        required: ['analysis', 'questions'],
      },
      systemInstruction: `You are an expert Cambridge IGCSE ${subject} assessment designer.
Analyze past paper questions with high precision and generate similar questions.
Use SVG for any diagrams using **camelCase** attributes.`,
    },
  }))

  const raw = safeJsonParse(response.text || '{}')
  return {
    analysis: raw.analysis ?? '',
    questions: (raw.questions ?? []).map((q: any) => {
      const sanitized = sanitizeQuestion(q)
      return {
        ...sanitized,
        id: crypto.randomUUID(),
        code: sharedGenerateQuestionCode(subject, {
          text: sanitized.text,
          syllabusObjective: sanitized.syllabusObjective,
        }),
      }
    }),
  }
}
