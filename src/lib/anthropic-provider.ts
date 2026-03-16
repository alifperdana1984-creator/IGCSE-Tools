import type { QuestionItem, Assessment, AnalyzeFileResult, GenerationConfig } from './types'
import { withRetry } from './gemini'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

async function anthropicMessages(
  messages: { role: string; content: any }[],
  systemPrompt: string,
  model: string,
  apiKey: string,
): Promise<string> {
  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model, max_tokens: 8192, system: systemPrompt, messages }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const e: any = new Error(body.error?.message ?? `Anthropic error ${res.status}`)
    e.status = res.status
    throw e
  }

  const data = await res.json()
  return data.content[0].text as string
}

const QUESTION_SCHEMA = `{
  "questions": [
    {
      "text": "string (markdown, bold question text)",
      "answer": "string",
      "markScheme": "string",
      "marks": number,
      "commandWord": "string",
      "type": "mcq | short_answer | structured",
      "hasDiagram": boolean
    }
  ]
}`

function buildSystem(subject: string): string {
  return `You are an expert Cambridge IGCSE Assessment Designer for ${subject}.
Create high-quality, syllabus-aligned assessments.
ALWAYS respond with ONLY valid JSON — no markdown fences, no extra text outside the JSON object.

Cambridge Command Words:
- Describe: State the points of a topic / give characteristics and main features.
- Explain: Set out purposes or reasons / make relationships evident.
- Suggest: Apply knowledge to situations with a range of valid responses.
- Evaluate: Judge or calculate the quality, importance, amount, or value.
- Calculate: Work out from given facts, figures or information.`
}

function sanitize(q: any): Omit<QuestionItem, 'id'> {
  const fix = (s: string) => (s ?? '').replace(/\\n/g, '\n')
  const stripNum = (s: string) => fix(s).replace(/^(\*{0,2})\s*\d+[.)]\s*\*{0,2}\s*/, '$1').trimStart()
  return {
    text: stripNum(q.text),
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

function safeParseJson(text: string): any {
  const cleaned = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  try { return JSON.parse(cleaned) } catch {
    const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}')
    if (start !== -1 && end > start) return JSON.parse(cleaned.substring(start, end + 1))
    throw new Error('Failed to parse JSON from Anthropic response')
  }
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
2. CRITICAL: ALL mathematical expressions, variables, equations, and formulas MUST be wrapped in LaTeX inline delimiters: $x^2$, $3x^2 - 5x + 2 = 0$, $\frac{a}{b}$, $H_2O$. NEVER write math as plain text.
3. FOR MCQ QUESTIONS: The "text" field must end with the 4 options on separate lines: "\\n\\nA) ...\\n\\nB) ...\\n\\nC) ...\\n\\nD) ...". The "answer" field must be ONLY "A", "B", "C", or "D".
4. Add **Syllabus Reference:** at end of each question text.

Respond with ONLY this JSON structure (no other text):
${QUESTION_SCHEMA}`

  const content: any[] = []

  if (config.references) {
    config.references.forEach(ref => {
      const isImage = ref.mimeType.startsWith('image/')
      const isPdf = ref.mimeType === 'application/pdf'
      if (isImage) {
        content.push({ type: 'image', source: { type: 'base64', media_type: ref.mimeType, data: ref.data.split(',')[1] ?? ref.data } })
      } else if (isPdf) {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: ref.data.split(',')[1] ?? ref.data } })
      }
    })
  }

  content.push({ type: 'text', text: prompt })

  const raw = await withRetry(() =>
    anthropicMessages([{ role: 'user', content }], buildSystem(config.subject), config.model, key),
    3, onRetry
  )

  const parsed = safeParseJson(raw)
  return (parsed.questions ?? []).map((q: any) => ({
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
Return ONLY the corrected assessment as JSON (no other text):
{ "questions": [...] }

ASSESSMENT:
${questionsText}`

  const raw = await withRetry(() =>
    anthropicMessages([{ role: 'user', content: prompt }], buildSystem(subject), model, apiKey ?? '')
  )

  const parsed = safeParseJson(raw)
  return (parsed.questions ?? []).map((q: any, i: number) => ({
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

  const prompt = `Evaluate these student answers for Cambridge IGCSE ${subject}.

QUESTIONS AND MARK SCHEMES:
${questionsText}

STUDENT ANSWERS:
${answersText}

Provide detailed feedback in Markdown. Be strict but fair.`

  const raw = await withRetry(() =>
    anthropicMessages(
      [{ role: 'user', content: prompt }],
      `You are a professional Cambridge IGCSE ${subject} examiner.`,
      model,
      apiKey ?? ''
    )
  )

  return raw
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
  const prompt = `Analyze this Cambridge IGCSE ${subject} question.
1. Explain the topic and learning objectives.
2. Generate EXACTLY ${count} similar questions with different context.

Respond with ONLY this JSON (no other text):
{ "analysis": "string", "questions": ${QUESTION_SCHEMA.replace(/^{/, '[').replace(/}$/, ']')} }

Actually use this exact structure:
{ "analysis": "explanation text", "questions": [ { "text": "...", "answer": "...", "markScheme": "...", "marks": 1, "commandWord": "...", "type": "short_answer", "hasDiagram": false } ] }`

  const content: any[] = []

  if (references) {
    references.forEach(ref => {
      const isImage = ref.mimeType.startsWith('image/')
      const isPdf = ref.mimeType === 'application/pdf'
      if (isImage) content.push({ type: 'image', source: { type: 'base64', media_type: ref.mimeType, data: ref.data.split(',')[1] ?? ref.data } })
      else if (isPdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: ref.data.split(',')[1] ?? ref.data } })
    })
  }

  const isImage = mimeType.startsWith('image/')
  const isPdf = mimeType === 'application/pdf'
  if (isImage) content.push({ type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data.split(',')[1] ?? base64Data } })
  else if (isPdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data.split(',')[1] ?? base64Data } })

  content.push({ type: 'text', text: prompt })

  const raw = await withRetry(() =>
    anthropicMessages([{ role: 'user', content }], buildSystem(subject), model, apiKey ?? '')
  )

  const parsed = safeParseJson(raw)
  return {
    analysis: parsed.analysis ?? '',
    questions: (parsed.questions ?? []).map((q: any) => ({
      ...sanitize(q),
      id: crypto.randomUUID(),
      code: generateCode(subject),
    })),
  }
}
