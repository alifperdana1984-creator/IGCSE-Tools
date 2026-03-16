import type { QuestionItem, Assessment, AnalyzeFileResult, GenerationConfig, AIError } from './types'
import type { Reference } from './ai'
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
      "text": "string (markdown, bold question text — do NOT embed A/B/C/D options here for MCQ)",
      "answer": "string (for MCQ: only the letter A, B, C, or D)",
      "markScheme": "string",
      "marks": number,
      "commandWord": "string (e.g. Describe, Explain, Calculate)",
      "type": "mcq | short_answer | structured",
      "hasDiagram": boolean,
      "options": ["string (option A text)", "string (option B text)", "string (option C text)", "string (option D text)"]
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
  const stripNum = (s: string) => fix(s).replace(/^(\*{0,2})\s*\d+[.)]\s*\*{0,2}\s*/, '$1').trimStart()
  let text = stripNum(q.text)
  if (q.type === 'mcq' && Array.isArray(q.options) && q.options.length > 0 && !/\bA\)/.test(text)) {
    const letters = ['A', 'B', 'C', 'D']
    const optLines = q.options.slice(0, 4).map((opt: string, i: number) => `${letters[i]}) ${opt}`).join('\n\n')
    text = `${text}\n\n${optLines}`
  }
  return {
    text,
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

function buildOpenAIReferenceContext(references: Reference[]): string {
  const pastPapers = references.filter(r => r.resourceType === 'past_paper')
  const syllabuses = references.filter(r => r.resourceType === 'syllabus')
  let context = ''
  if (pastPapers.length > 0) {
    context += `\nIMPORTANT: You have been provided ${pastPapers.length} authentic Cambridge IGCSE past paper(s) as image references. Match their exact question style, difficulty, command words, and mark allocation.\n`
  }
  if (syllabuses.length > 0) {
    const cached = syllabuses.filter(r => r.syllabusText)
    if (cached.length > 0) {
      context += `\nOFFICIAL SYLLABUS OBJECTIVES — only generate questions aligned to these:\n`
      cached.forEach(r => { context += r.syllabusText + '\n' })
    } else {
      context += `\nIMPORTANT: An official Cambridge IGCSE syllabus has been provided. Only generate questions that cover the stated learning objectives.\n`
    }
  }
  return context
}

export async function generateTest(
  config: GenerationConfig & { references?: Reference[]; apiKey?: string },
  onRetry?: (attempt: number) => void
): Promise<QuestionItem[]> {
  const key = config.apiKey ?? ''
  const refContext = config.references && config.references.length > 0
    ? buildOpenAIReferenceContext(config.references)
    : ''
  const prompt = `Generate a Cambridge IGCSE ${config.subject} assessment.
Topic: ${config.topic}
Difficulty: ${config.difficulty}
Number of Questions: ${config.count}
Question Type: ${config.type}
Calculator: ${config.calculator ? 'Allowed' : 'Not Allowed'}
${config.syllabusContext ? `Syllabus Context: ${config.syllabusContext}` : ''}
${refContext}
Rules:
1. Generate EXACTLY ${config.count} questions.
2. Each question must have: text (markdown, bold), answer, markScheme, marks (integer), commandWord, type (mcq/short_answer/structured), hasDiagram (boolean).
3. CRITICAL: ALL mathematical expressions, variables, equations, and formulas MUST be wrapped in LaTeX inline delimiters: $x^2$, $3x^2 - 5x + 2 = 0$, $\frac{a}{b}$, $H_2O$. NEVER write math as plain text.
4. FOR MCQ QUESTIONS: Set type to "mcq". Put the question stem in "text" (no A/B/C/D options embedded there). Put exactly 4 answer choices as plain strings in the "options" array. The "answer" field must be ONLY the letter "A", "B", "C", or "D". If 4 distinct text-based options cannot be written, use short_answer instead.
5. Add **Syllabus Reference:** at end of each question text.

Respond with JSON matching this schema: ${QUESTION_SCHEMA}`

  // For OpenAI, include image references (PDFs not supported in vision API)
  const imageRefs = config.references?.filter(r => r.mimeType.startsWith('image/')) ?? []
  const userContent: any[] = imageRefs.map(ref => ({
    type: 'image_url',
    image_url: { url: `data:${ref.mimeType};base64,${ref.data.split(',')[1] ?? ref.data}` },
  }))
  userContent.push({ type: 'text', text: prompt })

  const raw = await withRetry(() =>
    openaiChat([{ role: 'user', content: userContent }], config.model, key, buildSystemPrompt(config.subject)),
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

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const msg = body.error?.message ?? `OpenAI error ${res.status}`
    const e: any = new Error(msg)
    e.status = res.status
    throw e
  }
  const data = await res.json()
  return data.choices[0].message.content as string
}

export async function analyzeFile(
  base64Data: string,
  mimeType: string,
  subject: string,
  count: number,
  model: string,
  references?: Reference[],
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
