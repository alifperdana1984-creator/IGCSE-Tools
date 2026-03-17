import type { QuestionItem, Assessment, AnalyzeFileResult, GenerationConfig, AIError } from './types'
import type { Reference } from './ai'
import type { UsageCallback } from './ai'
import { withRetry, DIFFICULTY_GUIDANCE, PAST_PAPER_FOCUS, SUBJECT_SPECIFIC_RULES, MARK_SCHEME_FORMAT, CAMBRIDGE_COMMAND_WORDS, ASSESSMENT_OBJECTIVES } from './gemini'
import { sanitizeQuestion, generateQuestionCode } from './sanitize'
import { parseJsonWithRecovery } from './json'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

interface OpenAIChatResult {
  text: string
  inputTokens: number
  outputTokens: number
}

async function openaiChat(
  messages: { role: string; content: any }[],
  model: string,
  apiKey: string,
  systemPrompt?: string,
): Promise<OpenAIChatResult> {
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
  return {
    text: data.choices[0].message.content as string,
    inputTokens: Number(data.usage?.prompt_tokens ?? 0),
    outputTokens: Number(data.usage?.completion_tokens ?? 0),
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

function buildSystemPrompt(subject: string): string {
  return `You are a Senior Cambridge IGCSE Chief Examiner and Assessment Designer for ${subject} with 20+ years of experience setting papers for Cambridge Assessment International Education (CAIE).
ALWAYS respond with ONLY valid JSON — no markdown fences, no explanation text outside the JSON.

CAMBRIDGE COMMAND WORDS (use precisely as defined by CAIE):
${Object.entries(CAMBRIDGE_COMMAND_WORDS).map(([w, d]) => `- ${w}: ${d}`).join('\n')}

ASSESSMENT OBJECTIVES:
- AO1 (Knowledge): recall, state, name, define — typically 1–2 mark questions
- AO2 (Application): apply, calculate, interpret data, deduce — typically 2–4 mark questions
- AO3 (Experimental): plan, evaluate methods, identify variables — typically 2–4 mark questions`
}

// sanitizeQuestion and generateQuestionCode imported from './sanitize'

function buildOpenAIReferenceContext(references: Reference[], difficulty?: string): string {
  const pastPapers = references.filter(r => r.resourceType === 'past_paper')
  const syllabuses = references.filter(r => r.resourceType === 'syllabus')
  const others = references.filter(r => !r.resourceType || r.resourceType === 'other')
  let context = ''

  if (pastPapers.length > 0) {
    const focusInstruction = difficulty ? (PAST_PAPER_FOCUS[difficulty] ?? '') : ''
    context += `\nIMPORTANT: You have been provided ${pastPapers.length} authentic Cambridge IGCSE past paper reference(s). Match their exact question style, command words, and mark allocation.\n${focusInstruction}\n`

    const extracted = pastPapers.filter(r => r.pastPaperText && r.pastPaperText.trim().length > 0)
    if (extracted.length > 0) {
      context += `\nPAST PAPER STYLE EXCERPTS (authoritative references):\n`
      extracted.forEach((r, i) => {
        context += `\n[Past Paper ${i + 1}] ${r.name ?? 'Unnamed'}\n${r.pastPaperText}\n`
      })
    }

    const pdfWithoutText = pastPapers.filter(r => r.mimeType === 'application/pdf' && !r.pastPaperText)
    if (pdfWithoutText.length > 0) {
      const names = pdfWithoutText.map(r => r.name ?? 'Unnamed PDF').join(', ')
      context += `\nNOTE: ${pdfWithoutText.length} PDF past paper(s) are attached but not text-extracted (${names}). Prioritize extracted references and image references for style fidelity.\n`
    }
  }

  if (syllabuses.length > 0) {
    const cached = syllabuses.filter(r => r.syllabusText)
    if (cached.length > 0) {
      context += `\nOFFICIAL SYLLABUS OBJECTIVES - only generate questions aligned to these:\n`
      cached.forEach(r => { context += r.syllabusText + '\n' })
    } else {
      context += `\nIMPORTANT: An official Cambridge IGCSE syllabus has been provided. Only generate questions that cover the stated learning objectives.\n`
    }
  }

  if (others.length > 0) {
    const named = others.map(r => r.name).filter(Boolean)
    if (named.length > 0) context += `\nADDITIONAL REFERENCES: ${named.join(', ')}.\n`
  }

  return context
}
export async function generateTest(
  config: GenerationConfig & { references?: Reference[]; apiKey?: string },
  onRetry?: (attempt: number) => void,
  onUsage?: UsageCallback
): Promise<QuestionItem[]> {
  const key = config.apiKey ?? ''
  const refContext = config.references && config.references.length > 0
    ? buildOpenAIReferenceContext(config.references, config.difficulty)
    : ''
  const subjectRules = SUBJECT_SPECIFIC_RULES[config.subject] ?? ''
  const prompt = `Generate a Cambridge IGCSE ${config.subject} assessment.

CONFIGURATION:
- Topic: ${config.topic}
- ${DIFFICULTY_GUIDANCE[config.difficulty] ?? `Difficulty: ${config.difficulty}`}
- Number of Questions: ${config.count}
- Question Type: ${config.type}
- Calculator: ${config.calculator ? 'Allowed' : 'Not Allowed'}
${config.syllabusContext ? `- Syllabus Context/Focus: ${config.syllabusContext}` : ''}
${refContext}
${subjectRules ? `${subjectRules}\n` : ''}${MARK_SCHEME_FORMAT}

GENERATION RULES:
1. Generate EXACTLY ${config.count} questions.
2. STRUCTURED QUESTIONS (type="structured", 4+ marks): Must use multi-part format with a shared context paragraph, then **(a)**, **(b)**, **(c)** sub-questions each with mark allocation **[n]**.
3. MCQ QUESTIONS (type="mcq"): Exactly 4 options in the "options" array (no letter prefix). "answer" = only "A", "B", "C", or "D". All distractors must be plausible misconceptions. IMPORTANT: any math in an option MUST be in $...$, e.g. "$2x^2 + 7x$", "$120^{\\circ}$".
4. SHORT ANSWER (type="short_answer"): 1–3 marks, direct recall or simple application.
5. LaTeX: ALL mathematical/chemical expressions MUST use LaTeX delimiters: $x^2$, $\\frac{a}{b}$, $H_2O$. For currency amounts, write the number only ("1500") or use "USD 1500" — NEVER use bare $ as a currency symbol.
6. syllabusObjective: "REF – statement" format. Do NOT add it as a line in question text.
7. assessmentObjective: "AO1" (knowledge/recall), "AO2" (application/analysis), or "AO3" (experimental).
8. difficultyStars: 1 = recall (1–2 marks), 2 = application (2–4 marks), 3 = synthesis/eval (4+ marks).
9. marks: MCQ = 1; short_answer = 1–3; structured = sum of all sub-part marks.

Respond with JSON matching this schema: ${QUESTION_SCHEMA}`

  // For OpenAI, include image references (PDFs not supported in vision API)
  const imageRefs = config.references?.filter(r => r.mimeType.startsWith('image/')) ?? []
  const userContent: any[] = imageRefs.map(ref => ({
    type: 'image_url',
    image_url: { url: `data:${ref.mimeType};base64,${ref.data.split(',')[1] ?? ref.data}` },
  }))
  userContent.push({ type: 'text', text: prompt })

  const parsed = await withRetry(async () => {
    const res: any = await openaiChat([{ role: 'user', content: userContent }], config.model, key, buildSystemPrompt(config.subject))
    if ((res.inputTokens ?? 0) > 0 || (res.outputTokens ?? 0) > 0) onUsage?.(config.model, res.inputTokens, res.outputTokens)
    return parseJsonWithRecovery<{ questions: any[] }>(res.text, 'OpenAI')
  }, 3, onRetry)
  let questions: QuestionItem[] = (parsed.questions ?? []).map(q => {
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
6. Return ALL ${questions.length} questions as JSON matching: ${QUESTION_SCHEMA}`

  const systemPrompt = `You are a Senior Cambridge IGCSE Chief Examiner. Your only job is to ensure questions discriminate between A and A* candidates. Be ruthless: any question answerable from memory must be rewritten.
ALWAYS respond with ONLY valid JSON — no markdown fences, no extra text outside the JSON object.`

  const parsed = await withRetry(async () => {
    const res: any = await openaiChat([{ role: 'user', content: prompt }], model, apiKey, systemPrompt)
    if ((res.inputTokens ?? 0) > 0 || (res.outputTokens ?? 0) > 0) onUsage?.(model, res.inputTokens, res.outputTokens)
    return parseJsonWithRecovery<{ questions: any[] }>(res.text, 'OpenAI')
  }, 3, onRetry)
  return (parsed.questions ?? []).map((q, i) => {
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

Return the ENTIRE assessment (all questions corrected or unchanged) as JSON: ${QUESTION_SCHEMA}

ASSESSMENT TO AUDIT:
${questionsText}`

  const parsed = await withRetry(async () => {
    const res: any = await openaiChat([{ role: 'user', content: prompt }], model, apiKey ?? '', buildSystemPrompt(subject))
    if ((res.inputTokens ?? 0) > 0 || (res.outputTokens ?? 0) > 0) onUsage?.(model, res.inputTokens, res.outputTokens)
    return parseJsonWithRecovery<{ questions: any[] }>(res.text, 'OpenAI')
  })
  return (parsed.questions ?? []).map((q, i) => {
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
  const refContext = references?.length
    ? buildOpenAIReferenceContext(references)
    : ''
  const prompt = `Analyze this Cambridge IGCSE ${subject} question ${isPdf ? 'PDF' : 'image'}.
1. Explain the topic and learning objectives.
2. Generate EXACTLY ${count} similar questions with different context.
3. Each question must have: text, answer, markScheme, marks, commandWord, type, hasDiagram.
${refContext}
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

  const parsed = await withRetry(async () => {
    const res: any = await openaiChat([{ role: 'user', content: userContent }], model, apiKey ?? '', buildSystemPrompt(subject))
    return parseJsonWithRecovery<{ analysis?: string; questions?: any[] }>(res.text, 'OpenAI')
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

