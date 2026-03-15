import { GoogleGenAI, Type } from "@google/genai";
import type { QuestionItem, Assessment, AnalyzeFileResult, GenerationConfig, GeminiError } from './types'

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

const SUBJECT_CODES: Record<string, string> = {
  'Mathematics': 'MAT', 'Biology': 'BIO', 'Physics': 'PHY', 'Chemistry': 'CHM',
}

function generateQuestionCode(subject: string, text: string): string {
  const subj = SUBJECT_CODES[subject] ?? subject.substring(0, 3).toUpperCase()
  const sylMatch = text.match(/Syllabus Reference[:\s]+([\d.]+)/i)
  const syl = sylMatch ? sylMatch[1] : '?'
  const shortId = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `${subj}-${syl}-${shortId}`
}

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

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  onRetry?: (attempt: number) => void
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (err: any) {
      const status = err?.status ?? err?.code
      if (status === 429 && i < maxRetries - 1) {
        onRetry?.(i + 1)
        await new Promise(r => setTimeout(r, Math.pow(2, i) * 1000))
        continue
      }
      if (status === 503) {
        throw {
          type: 'model_overloaded',
          retryable: false,
          message: 'Model şu an meşgul. Flash modele geçmeyi deneyin.',
        } satisfies GeminiError
      }
      throw err
    }
  }
  throw {
    type: 'rate_limit',
    retryable: false,
    message: 'Rate limit aşıldı. Birkaç dakika bekleyip tekrar deneyin.',
  } satisfies GeminiError
}
// -------------------------

export async function generateTest(
  config: GenerationConfig & { references?: { data: string; mimeType: string }[] },
  onRetry?: (attempt: number) => void
): Promise<QuestionItem[]> {
  const prompt = `Generate a Cambridge IGCSE ${config.subject} assessment.
Topic: ${config.topic}
Difficulty: ${config.difficulty}
Number of Questions: ${config.count}
Question Type: ${config.type}
Calculator: ${config.calculator ? "Allowed" : "Not Allowed"}
${config.syllabusContext ? `Syllabus Context: ${config.syllabusContext}` : ""}

Rules:
1. Generate EXACTLY ${config.count} questions.
2. Each question must have: text (markdown, bold), answer, markScheme, marks (integer), commandWord, type (mcq/short_answer/structured), hasDiagram (boolean).
3. For diagrams, include SVG inside the 'text' field as \`\`\`svg ... \`\`\` using camelCase attributes.
4. Use LaTeX for math ($H_2O$, $x^2$).
5. For MCQ: put options A/B/C/D each on new line with double newlines between them.
6. Add **Syllabus Reference:** at end of each question text.`

  const parts: any[] = []

  if (config.references && config.references.length > 0) {
    config.references.forEach(ref => {
      parts.push({
        inlineData: {
          mimeType: ref.mimeType,
          data: ref.data.split(",")[1] || ref.data,
        },
      })
    })
  }

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
  return (raw.questions ?? []).map(q => {
    const sanitized = sanitizeQuestion(q)
    return { ...sanitized, id: crypto.randomUUID(), code: generateQuestionCode(config.subject, sanitized.text) }
  })
}

export async function auditTest(
  subject: string,
  assessment: Assessment,
  model: string = 'gemini-3.1-pro-preview'
): Promise<QuestionItem[]> {
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
4. **Formatting**: Ensure bold question text, double newlines for MCQ options, and bold Syllabus References.
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
      code: existing?.code ?? generateQuestionCode(assessment.subject, sanitized.text),
    }
  })
}

export async function getStudentFeedback(
  subject: string,
  assessment: Assessment,
  studentAnswers: string[],
  modelName: string = 'gemini-3-flash-preview'
): Promise<string> {
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

function sanitizeQuestion(q: Omit<QuestionItem, 'id'>): Omit<QuestionItem, 'id'> {
  const fix = (s: string) => s.replace(/\\n/g, '\n')
  return { ...q, text: fix(q.text), answer: fix(q.answer), markScheme: fix(q.markScheme) }
}

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
  references?: { data: string; mimeType: string }[]
): Promise<AnalyzeFileResult> {
  const isPdf = mimeType === "application/pdf"
  const prompt = `Analyze this ${isPdf ? "past paper PDF" : "screenshot"} of a Cambridge IGCSE ${subject} question.
1. Explain the topic and learning objectives it covers.
2. Generate EXACTLY ${count} similar questions with the same concept but different context.
3. For Science subjects, include SVG diagrams if appropriate. Use \`\`\`svg ... \`\`\` code blocks and **camelCase** attributes.
4. Each question must have: text, answer, markScheme, marks, commandWord, type (mcq/short_answer/structured), hasDiagram.
5. **FORMATTING**: Bold question text, double newlines for MCQ options, bold Syllabus Reference at end.`

  const parts: any[] = []

  if (references && references.length > 0) {
    references.forEach(ref => {
      parts.push({
        inlineData: {
          mimeType: ref.mimeType,
          data: ref.data.split(",")[1] || ref.data,
        },
      })
    })
  }

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
      return { ...sanitized, id: crypto.randomUUID(), code: generateQuestionCode(subject, sanitized.text) }
    }),
  }
}
