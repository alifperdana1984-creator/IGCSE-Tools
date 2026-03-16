import type { QuestionItem, Assessment, AnalyzeFileResult, GenerationConfig, AIError } from './types'
import { withRetry } from './gemini'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

async function openaiChat(
  messages: { role: string; content: any }[],
  model: string,
  apiKey: string,
  systemPrompt?: string,
): Promise<string> {
  const allMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: allMessages,
      max_tokens: 8192,
      response_format: { type: 'json_object' },
    }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const e: any = new Error(body.error?.message ?? `OpenAI error ${res.status}`)
    e.status = res.status
    throw e
  }

  const data = await res.json()
  return data.choices[0].message.content as string
}

const QUESTION_SCHEMA = `{
  "questions": [
    {
      "text": "string (markdown, bold question text)",
      "answer": "string",
      "markScheme": "string",
      "marks": number,
      "commandWord": "string (e.g. Describe, Explain, Calculate)",
      "type": "mcq | short_answer | structured",
      "hasDiagram": boolean
    }
  ]
}`

function buildSystemPrompt(subject: string): string {
  return `You are an expert Cambridge IGCSE Assessment Designer for ${subject}.
Create high-quality, syllabus-aligned assessments.
ALWAYS respond with ONLY valid JSON — no markdown fences, no explanation text outside the JSON.

Cambridge Command Words:
- Describe: State the points of a topic / give characteristics and main features.
- Explain: Set out purposes or reasons / make relationships evident / provide why and/or how.
- Suggest: Apply knowledge to situations with a range of valid responses.
- Evaluate: Judge or calculate the quality, importance, amount, or value.
- Calculate: Work out from given facts, figures or information.`
}

function sanitize(q: any): Omit<QuestionItem, 'id'> {
  const fix = (s: string) => (s ?? '').replace(/\\n/g, '\n')
  return {
    text: fix(q.text),
    answer: fix(q.answer),
    markScheme: fix(q.markScheme),
    marks: Number(q.marks) || 1,
    commandWord: q.commandWord ?? '',
    type: q.type ?? 'short_answer',
    hasDiagram: Boolean(q.hasDiagram),
  }
}

function generateCode(subject: string): string {
  const codes: Record<string, string> = { Mathematics: 'MAT', Biology: 'BIO', Physics: 'PHY', Chemistry: 'CHM' }
  const subj = codes[subject] ?? subject.substring(0, 3).toUpperCase()
  const shortId = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `${subj}-?-${shortId}`
}

export async function generateTest(
  config: GenerationConfig & { references?: { data: string; mimeType: string }[]; apiKey?: string },
  onRetry?: (attempt: number) => void
): Promise<QuestionItem[]> {
  const key = config.apiKey ?? ''
  const prompt = `Generate a Cambridge IGCSE ${config.subject} assessment.
Topic: ${config.topic}
Difficulty: ${config.difficulty}
Number of Questions: ${config.count}
Question Type: ${config.type}
Calculator: ${config.calculator ? 'Allowed' : 'Not Allowed'}
${config.syllabusContext ? `Syllabus Context: ${config.syllabusContext}` : ''}

Rules:
1. Generate EXACTLY ${config.count} questions.
2. Each question must have: text (markdown, bold), answer, markScheme, marks (integer), commandWord, type (mcq/short_answer/structured), hasDiagram (boolean).
3. CRITICAL: ALL mathematical expressions, variables, equations, and formulas MUST be wrapped in LaTeX inline delimiters: $x^2$, $3x^2 - 5x + 2 = 0$, $\frac{a}{b}$, $H_2O$. NEVER write math as plain text.
4. CRITICAL FOR MCQ: If type is "mcq", the question "text" field MUST include 4 labelled options formatted as:
   A) option text

   B) option text

   C) option text

   D) option text
   The correct answer in "answer" field must be "A", "B", "C", or "D" only.
5. Add **Syllabus Reference:** at end of each question text.

Respond with JSON matching this schema: ${QUESTION_SCHEMA}`

  const raw = await withRetry(() =>
    openaiChat([{ role: 'user', content: prompt }], config.model, key, buildSystemPrompt(config.subject)),
    3, onRetry
  )

  const parsed = JSON.parse(raw) as { questions: any[] }
  return (parsed.questions ?? []).map(q => ({
    ...sanitize(q),
    id: crypto.randomUUID(),
    code: generateCode(config.subject),
  }))
}

export async function auditTest(
  subject: string,
  assessment: Assessment,
  model: string,
  apiKey?: string
): Promise<QuestionItem[]> {
  const questionsText = assessment.questions
    .map((q, i) => `Q${i + 1} [${q.marks} marks] (${q.commandWord})\n${q.text}\n\nAnswer: ${q.answer}\n\nMark Scheme: ${q.markScheme}`)
    .join('\n\n---\n\n')

  const prompt = `Review this Cambridge IGCSE ${subject} assessment and fix any errors.
Check: command words, mark allocation, scientific accuracy, formatting.
Return the ENTIRE corrected assessment as JSON: ${QUESTION_SCHEMA}

ASSESSMENT:
${questionsText}`

  const raw = await withRetry(() =>
    openaiChat([{ role: 'user', content: prompt }], model, apiKey ?? '', buildSystemPrompt(subject))
  )

  const parsed = JSON.parse(raw) as { questions: any[] }
  return (parsed.questions ?? []).map((q, i) => ({
    ...sanitize(q),
    id: assessment.questions[i]?.id ?? crypto.randomUUID(),
    code: assessment.questions[i]?.code ?? generateCode(subject),
  }))
}

export async function getStudentFeedback(
  subject: string,
  assessment: Assessment,
  studentAnswers: string[],
  model: string,
  apiKey?: string
): Promise<string> {
  const questionsText = assessment.questions
    .map((q, i) => `Q${i + 1} [${q.marks} marks]\n${q.text}\n\nMark Scheme: ${q.markScheme}`)
    .join('\n\n')
  const answersText = studentAnswers.map((a, i) => `Q${i + 1}: ${a || '(no answer)'}`).join('\n')

  const res = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey ?? ''}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: `You are a Cambridge IGCSE ${subject} examiner. Be strict but fair.` },
        { role: 'user', content: `Evaluate these student answers.\n\nQUESTIONS:\n${questionsText}\n\nSTUDENT ANSWERS:\n${answersText}\n\nProvide detailed feedback in Markdown.` },
      ],
      max_tokens: 4096,
    }),
  })

  if (!res.ok) throw new Error(`OpenAI error ${res.status}`)
  const data = await res.json()
  return data.choices[0].message.content as string
}

export async function analyzeFile(
  base64Data: string,
  mimeType: string,
  subject: string,
  count: number,
  model: string,
  references?: { data: string; mimeType: string }[],
  apiKey?: string
): Promise<AnalyzeFileResult> {
  const isPdf = mimeType === 'application/pdf'
  const prompt = `Analyze this Cambridge IGCSE ${subject} question image.
1. Explain the topic and learning objectives.
2. Generate EXACTLY ${count} similar questions with different context.
3. Each question must have: text, answer, markScheme, marks, commandWord, type, hasDiagram.
Respond with JSON: { "analysis": "string", "questions": [...] } matching: ${QUESTION_SCHEMA}`

  const userContent: any[] = []

  if (!isPdf) {
    userContent.push({
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${base64Data.split(',')[1] ?? base64Data}` },
    })
  }

  if (references) {
    references.filter(r => !r.mimeType.includes('pdf')).forEach(ref => {
      userContent.push({
        type: 'image_url',
        image_url: { url: `data:${ref.mimeType};base64,${ref.data.split(',')[1] ?? ref.data}` },
      })
    })
  }

  userContent.push({ type: 'text', text: prompt + (isPdf ? '\n\n(Note: PDF provided as text context — analyze based on subject)' : '') })

  const raw = await withRetry(() =>
    openaiChat([{ role: 'user', content: userContent }], model, apiKey ?? '', buildSystemPrompt(subject))
  )

  const parsed = JSON.parse(raw)
  return {
    analysis: parsed.analysis ?? '',
    questions: (parsed.questions ?? []).map((q: any) => ({
      ...sanitize(q),
      id: crypto.randomUUID(),
      code: generateCode(subject),
    })),
  }
}
