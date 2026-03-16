import type { QuestionItem, Assessment, AnalyzeFileResult, GenerationConfig } from './types'
import type { Reference } from './ai'
import { withRetry, DIFFICULTY_GUIDANCE, PAST_PAPER_FOCUS } from './gemini'
import { sanitizeQuestion, generateQuestionCode } from './sanitize'

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
      "text": "string (markdown, bold question text — do NOT embed A/B/C/D options here for MCQ)",
      "answer": "string (for MCQ: only the letter A, B, C, or D)",
      "markScheme": "string",
      "marks": number,
      "commandWord": "string",
      "type": "mcq | short_answer | structured",
      "hasDiagram": boolean,
      "syllabusObjective": "string (the specific Cambridge IGCSE learning objective, e.g. 'C4.1 – Define the term acid in terms of proton donation')",
      "difficultyStars": 1 or 2 or 3,
      "options": ["string (option A text)", "string (option B text)", "string (option C text)", "string (option D text)"]
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

// sanitizeQuestion and generateQuestionCode imported from './sanitize'

function safeParseJson(text: string): any {
  const cleaned = text.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  try { return JSON.parse(cleaned) } catch {
    const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}')
    if (start !== -1 && end > start) return JSON.parse(cleaned.substring(start, end + 1))
    throw new Error('Failed to parse JSON from Anthropic response')
  }
}

function refData(ref: Reference): string {
  const raw = ref.data ?? ''
  return raw.includes(',') ? raw.split(',')[1] : raw
}

function buildAnthropicReferenceParts(references: Reference[], difficulty?: string): any[] {
  const parts: any[] = []
  const pastPapers = references.filter(r => r.resourceType === 'past_paper')
  const syllabuses = references.filter(r => r.resourceType === 'syllabus')
  const others = references.filter(r => !r.resourceType || r.resourceType === 'other')

  if (pastPapers.length > 0) {
    const focusInstruction = difficulty ? (PAST_PAPER_FOCUS[difficulty] ?? '') : ''
    parts.push({ type: 'text', text: `REFERENCE PAST PAPERS (${pastPapers.length} document${pastPapers.length > 1 ? 's' : ''}): The following are authentic Cambridge IGCSE past papers. Study them carefully and replicate their exact question style, phrasing, command word usage, and mark allocation patterns. Your generated questions MUST feel indistinguishable from these official papers.\n\n${focusInstruction}` })
    pastPapers.forEach(ref => {
      if (ref.pastPaperText) {
        parts.push({ type: 'text', text: `PAST PAPER CONTENT:\n${ref.pastPaperText}` })
      } else {
        const data = refData(ref)
        if (!data) return
        const isImage = ref.mimeType.startsWith('image/')
        const isPdf = ref.mimeType === 'application/pdf'
        if (isImage) parts.push({ type: 'image', source: { type: 'base64', media_type: ref.mimeType, data } })
        else if (isPdf) parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } })
      }
    })
  }

  if (syllabuses.length > 0) {
    syllabuses.forEach(ref => {
      if (ref.syllabusText) {
        parts.push({ type: 'text', text: `OFFICIAL CAMBRIDGE IGCSE SYLLABUS OBJECTIVES:\nOnly generate questions that directly assess the following learning objectives.\n\n${ref.syllabusText}` })
      } else {
        const data = refData(ref)
        if (!data) return
        parts.push({ type: 'text', text: `OFFICIAL CAMBRIDGE IGCSE SYLLABUS: Only generate questions covering the stated learning objectives in this syllabus document.` })
        if (ref.mimeType === 'application/pdf') parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } })
      }
    })
  }

  others.forEach(ref => {
    const data = refData(ref)
    if (!data) return
    const isImage = ref.mimeType.startsWith('image/')
    const isPdf = ref.mimeType === 'application/pdf'
    if (isImage) parts.push({ type: 'image', source: { type: 'base64', media_type: ref.mimeType, data } })
    else if (isPdf) parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } })
  })

  return parts
}

export async function generateTest(
  config: GenerationConfig & { references?: Reference[]; apiKey?: string },
  onRetry?: (attempt: number) => void
): Promise<QuestionItem[]> {
  const key = config.apiKey ?? ''
  const prompt = `Generate a Cambridge IGCSE ${config.subject} assessment.
Topic: ${config.topic}
${DIFFICULTY_GUIDANCE[config.difficulty] ?? `Difficulty: ${config.difficulty}`}
Number of Questions: ${config.count}
Question Type: ${config.type}
Calculator: ${config.calculator ? 'Allowed' : 'Not Allowed'}
${config.syllabusContext ? `Syllabus Context: ${config.syllabusContext}` : ''}

Rules:
1. Generate EXACTLY ${config.count} questions.
2. CRITICAL: ALL mathematical expressions, variables, equations, and formulas MUST be wrapped in LaTeX inline delimiters: $x^2$, $3x^2 - 5x + 2 = 0$, $\frac{a}{b}$, $H_2O$. NEVER write math as plain text.
3. FOR MCQ QUESTIONS: Set type to "mcq". Put the question stem in "text" (no A/B/C/D options embedded there). Put exactly 4 answer choices as plain strings in the "options" array. The "answer" field must be ONLY the letter "A", "B", "C", or "D". If 4 distinct text-based options cannot be written, use short_answer instead.
4. syllabusObjective: the specific Cambridge IGCSE learning objective this question assesses. Format: "ref – objective statement" (e.g. "C4.1 – Define the term acid in terms of proton donation"). One sentence max. Do NOT add a Syllabus Reference line in the question text.
5. difficultyStars: rate this specific question's cognitive demand as 1, 2, or 3. 1 = recall (State/Name/Define, 1-2 marks). 2 = application (Describe/Explain/Calculate, 2-4 marks). 3 = evaluation/synthesis (Evaluate/Discuss/Deduce, 4+ marks, multi-step).

Respond with ONLY this JSON structure (no other text):
${QUESTION_SCHEMA}`

  const content: any[] = config.references && config.references.length > 0
    ? buildAnthropicReferenceParts(config.references, config.difficulty)
    : []

  content.push({ type: 'text', text: prompt })

  const raw = await withRetry(() =>
    anthropicMessages([{ role: 'user', content }], buildSystem(config.subject), config.model, key),
    3, onRetry
  )

  const parsed = safeParseJson(raw)
  let questions: QuestionItem[] = (parsed.questions ?? []).map((q: any) => ({
    ...sanitizeQuestion(q),
    id: crypto.randomUUID(),
    code: generateQuestionCode(config.subject),
  }))

  if (config.difficulty === 'Challenging' && questions.length > 0) {
    questions = await critiqueForDifficulty(questions, config.subject, config.model, key, onRetry)
  }

  return questions
}

async function critiqueForDifficulty(
  questions: QuestionItem[],
  subject: string,
  model: string,
  apiKey: string,
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
5. Return ALL questions (revised or unchanged) as JSON

Respond with ONLY this JSON structure (no other text):
${QUESTION_SCHEMA}`

  const systemPrompt = `You are a Senior Cambridge IGCSE Chief Examiner. Your only job is to ensure questions are genuinely challenging — at the A* discrimination level. Be strict: if a question can be answered from memory, rewrite it.
ALWAYS respond with ONLY valid JSON — no markdown fences, no extra text outside the JSON object.`

  const raw = await withRetry(() =>
    anthropicMessages([{ role: 'user', content: prompt }], systemPrompt, model, apiKey),
    3, onRetry
  )

  const parsed = safeParseJson(raw)
  return (parsed.questions ?? []).map((q: any, i: number) => ({
    ...sanitizeQuestion(q),
    id: questions[i]?.id ?? crypto.randomUUID(),
    code: questions[i]?.code ?? generateQuestionCode(subject),
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
    ...sanitizeQuestion(q),
    id: assessment.questions[i]?.id ?? crypto.randomUUID(),
    code: assessment.questions[i]?.code ?? generateQuestionCode(subject),
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
  references?: Reference[],
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
      const data = refData(ref)
      if (!data) return
      const isImage = ref.mimeType.startsWith('image/')
      const isPdf = ref.mimeType === 'application/pdf'
      if (isImage) content.push({ type: 'image', source: { type: 'base64', media_type: ref.mimeType, data } })
      else if (isPdf) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } })
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
      ...sanitizeQuestion(q),
      id: crypto.randomUUID(),
      code: generateQuestionCode(subject),
    })),
  }
}
