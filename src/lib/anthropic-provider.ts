import type { QuestionItem, Assessment, AnalyzeFileResult, GenerationConfig } from './types'
import type { Reference } from './ai'
import type { UsageCallback } from './ai'
import { withRetry, DIFFICULTY_GUIDANCE, PAST_PAPER_FOCUS, SUBJECT_SPECIFIC_RULES, MARK_SCHEME_FORMAT, CAMBRIDGE_COMMAND_WORDS } from './gemini'
import { sanitizeQuestion, generateQuestionCode } from './sanitize'
import { parseJsonWithRecovery } from './json'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'

interface AnthropicResult {
  text: string
  inputTokens: number
  outputTokens: number
}

async function anthropicMessages(
  messages: { role: string; content: any }[],
  systemPrompt: string,
  model: string,
  apiKey: string,
): Promise<AnthropicResult> {
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
  return {
    text: data.content[0].text as string,
    inputTokens: Number(data.usage?.input_tokens ?? 0),
    outputTokens: Number(data.usage?.output_tokens ?? 0),
  }
}

const QUESTION_SCHEMA = `{
  "questions": [
    {
      "text": "string (markdown question text — for structured: include stem paragraph then (a), (b), (c) sub-parts with [n] marks each)",
      "answer": "string (for MCQ: only the letter A, B, C, or D)",
      "markScheme": "string (numbered points: '1. ...\\n2. ...' with Accept:/Reject: lines)",
      "marks": number,
      "commandWord": "string (Cambridge command word)",
      "type": "mcq | short_answer | structured",
      "hasDiagram": boolean,
      "syllabusObjective": "string (e.g. 'C4.1 – Define the term acid in terms of proton donation')",
      "assessmentObjective": "AO1 | AO2 | AO3",
      "difficultyStars": 1 or 2 or 3,
      "options": ["option A text", "option B text", "option C text", "option D text"] (for MCQ: exactly 4 strings; for all other types: empty array [])
    }
  ]
}`

function buildSystem(subject: string): string {
  return `You are a Senior Cambridge IGCSE Chief Examiner and Assessment Designer for ${subject} with 20+ years of experience setting papers for Cambridge Assessment International Education (CAIE).
ALWAYS respond with ONLY valid JSON — no markdown fences, no extra text outside the JSON object.

CAMBRIDGE COMMAND WORDS (use precisely as defined by CAIE):
${Object.entries(CAMBRIDGE_COMMAND_WORDS).map(([w, d]) => `- ${w}: ${d}`).join('\n')}

ASSESSMENT OBJECTIVES:
- AO1 (Knowledge): recall, state, name, define — typically 1–2 mark questions
- AO2 (Application): apply, calculate, interpret data, deduce — typically 2–4 mark questions
- AO3 (Experimental): plan, evaluate methods, identify variables — typically 2–4 mark questions`
}

// sanitizeQuestion and generateQuestionCode imported from './sanitize'

function safeParseJson(text: string): any {
  return parseJsonWithRecovery(text, 'Anthropic')
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
  onRetry?: (attempt: number) => void,
  onUsage?: UsageCallback
): Promise<QuestionItem[]> {
  const key = config.apiKey ?? ''
  const subjectRules = SUBJECT_SPECIFIC_RULES[config.subject] ?? ''
  const prompt = `Generate a Cambridge IGCSE ${config.subject} assessment.

CONFIGURATION:
- Topic: ${config.topic}
- ${DIFFICULTY_GUIDANCE[config.difficulty] ?? `Difficulty: ${config.difficulty}`}
- Number of Questions: ${config.count}
- Question Type: ${config.type}
- Calculator: ${config.calculator ? 'Allowed' : 'Not Allowed'}
${config.syllabusContext ? `- Syllabus Context/Focus: ${config.syllabusContext}` : ''}

${subjectRules ? `${subjectRules}\n` : ''}${MARK_SCHEME_FORMAT}

GENERATION RULES:
1. Generate EXACTLY ${config.count} questions.
2. STRUCTURED QUESTIONS (type="structured", 4+ marks): Must use multi-part format with a shared context paragraph, then **(a)**, **(b)**, **(c)** sub-questions each with mark allocation **[n]**.
3. MCQ QUESTIONS (type="mcq"): Exactly 4 options in "options" array (no letter prefix). "answer" = only "A", "B", "C", or "D". All distractors must be plausible misconceptions. IMPORTANT: any math in an option MUST be in $...$, e.g. "$2x^2 + 7x$", "$120^{\\circ}$".
4. SHORT ANSWER (type="short_answer"): 1–3 marks, direct recall or simple application.
5. LaTeX: ALL mathematical/chemical expressions MUST use LaTeX delimiters: $x^2$, $\\frac{a}{b}$, $H_2O$. For currency amounts, write the number only ("1500") or use "USD 1500" — NEVER use bare $ as a currency symbol.
6. syllabusObjective: "REF – statement" format. Do NOT add it as a line in question text.
7. assessmentObjective: "AO1" (knowledge/recall), "AO2" (application/analysis), or "AO3" (experimental).
8. difficultyStars: 1 = recall (1–2 marks), 2 = application (2–4 marks), 3 = synthesis/eval (4+ marks).
9. marks: MCQ = 1; short_answer = 1–3; structured = sum of all sub-part marks.

Respond with ONLY this JSON structure (no other text):
${QUESTION_SCHEMA}`

  const content: any[] = config.references && config.references.length > 0
    ? buildAnthropicReferenceParts(config.references, config.difficulty)
    : []

  content.push({ type: 'text', text: prompt })

  const parsed = await withRetry(async () => {
    const res = await anthropicMessages([{ role: 'user', content }], buildSystem(config.subject), config.model, key)
    if (res.inputTokens > 0 || res.outputTokens > 0) onUsage?.(config.model, res.inputTokens, res.outputTokens)
    return safeParseJson(res.text)
  }, 3, onRetry)
  let questions: QuestionItem[] = (parsed.questions ?? []).map((q: any) => {
    const sanitized = sanitizeQuestion(q)
    return {
      ...sanitized,
      id: crypto.randomUUID(),
      code: generateQuestionCode(config.subject, {
        text: sanitized.text,
        syllabusObjective: sanitized.syllabusObjective,
      }),
    }
  })

  // critiqueForDifficulty omitted — extra API call hits rate limits on limited keys

  return questions
}

async function critiqueForDifficulty(
  questions: QuestionItem[],
  subject: string,
  model: string,
  apiKey: string,
  onRetry?: (attempt: number) => void,
  onUsage?: UsageCallback,
): Promise<QuestionItem[]> {
  const questionsText = questions
    .map((q, i) => `Q${i + 1} [${q.marks} marks] (${q.commandWord})\n${q.text}\n\nAnswer: ${q.answer}\n\nMark Scheme: ${q.markScheme}`)
    .join('\n\n---\n\n')

  const prompt = `You are a Cambridge IGCSE Chief Examiner conducting a strict difficulty audit for ${subject}.

REQUIRED: Challenging — A* discriminator level
- Target: Only 10–20% of students answer fully correctly
- Command words: Evaluate, Deduce, Predict, Suggest, Discuss — NEVER State/Name/Define
- Must require 3+ distinct cognitive steps or multi-stage synthesis
- Content must be in UNFAMILIAR context — novel scenario, not a textbook example
- Mark schemes must have 4+ distinct points for 4+ mark questions

QUESTIONS TO AUDIT:
${questionsText}

TASK:
1. Score each question 1–10 (1 = trivial recall, 10 = A* discriminator). Guide: 1–3 recall; 4–6 standard; 7–8 A grade; 9–10 A* discrimination.
2. Any question scoring 6 or below MUST be rewritten to reach 8+.
3. When rewriting: unfamiliar context, more synthesis steps, stronger command word, improved mark scheme.
4. Keep same syllabus topic and mark value.
5. If already 8+ — preserve exactly, do NOT simplify.
6. Return ALL ${questions.length} questions as JSON.

Respond with ONLY this JSON structure (no other text):
${QUESTION_SCHEMA}`

  const systemPrompt = `You are a Senior Cambridge IGCSE Chief Examiner. Your only job is to ensure questions discriminate between A and A* candidates. Be ruthless: any question answerable from memory must be rewritten.
ALWAYS respond with ONLY valid JSON — no markdown fences, no extra text outside the JSON object.`

  const parsed = await withRetry(async () => {
    const res = await anthropicMessages([{ role: 'user', content: prompt }], systemPrompt, model, apiKey)
    if (res.inputTokens > 0 || res.outputTokens > 0) onUsage?.(model, res.inputTokens, res.outputTokens)
    return safeParseJson(res.text)
  }, 3, onRetry)
  return (parsed.questions ?? []).map((q: any, i: number) => {
    const sanitized = sanitizeQuestion(q)
    return {
      ...sanitized,
      id: questions[i]?.id ?? crypto.randomUUID(),
      code: questions[i]?.code ?? generateQuestionCode(subject, {
        text: sanitized.text,
        syllabusObjective: sanitized.syllabusObjective,
      }),
    }
  })
}

export async function auditTest(
  subject: string,
  assessment: Assessment,
  model: string,
  apiKey?: string,
  onUsage?: UsageCallback
): Promise<QuestionItem[]> {
  const questionsText = assessment.questions
    .map((q, i) => `Q${i + 1} [${q.marks} marks] (${q.commandWord})\n${q.text}\n\nAnswer: ${q.answer}\n\nMark Scheme: ${q.markScheme}`)
    .join('\n\n---\n\n')

  const prompt = `You are a Principal Cambridge IGCSE Examiner for ${subject}. Audit this assessment and return a fully corrected version.

AUDIT CRITERIA (fix ALL violations):
1. Command words must match CAIE definitions exactly.
2. Mark scheme must use numbered points ("1. ...", "2. ...") with "Accept:" / "Reject:" lines. Fix paragraph-style mark schemes.
3. Mark point count must equal marks awarded. Fix mismatches.
4. Check all scientific/mathematical accuracy. Fix errors.
5. Structured questions (4+ marks) must have **(a)**, **(b)**, **(c)** sub-parts with **[n]** allocations.
6. All math/chemistry must use LaTeX delimiters.
7. syllabusObjective must follow "REF – statement" format.

Return the ENTIRE assessment (all questions corrected or unchanged) as JSON (no other text):
{ "questions": [...] }

ASSESSMENT TO AUDIT:
${questionsText}`

  const parsed = await withRetry(async () => {
    const res = await anthropicMessages([{ role: 'user', content: prompt }], buildSystem(subject), model, apiKey ?? '')
    if (res.inputTokens > 0 || res.outputTokens > 0) onUsage?.(model, res.inputTokens, res.outputTokens)
    return safeParseJson(res.text)
  })
  return (parsed.questions ?? []).map((q: any, i: number) => {
    const sanitized = sanitizeQuestion(q)
    return {
      ...sanitized,
      id: assessment.questions[i]?.id ?? crypto.randomUUID(),
      code: assessment.questions[i]?.code ?? generateQuestionCode(subject, {
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

  return raw.text
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

  const parsed = await withRetry(async () => {
    const res = await anthropicMessages([{ role: 'user', content }], buildSystem(subject), model, apiKey ?? '')
    return safeParseJson(res.text)
  })
  return {
    analysis: parsed.analysis ?? '',
    questions: (parsed.questions ?? []).map((q: any) => {
      const sanitized = sanitizeQuestion(q)
      return {
        ...sanitized,
        id: crypto.randomUUID(),
        code: generateQuestionCode(subject, {
          text: sanitized.text,
          syllabusObjective: sanitized.syllabusObjective,
        }),
      }
    }),
  }
}
