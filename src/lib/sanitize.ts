import type { QuestionItem } from './types'

const SUBJECT_CODES: Record<string, string> = {
  Mathematics: 'MAT', Biology: 'BIO', Physics: 'PHY', Chemistry: 'CHM',
}

/** Normalise a raw AI-generated question object into a typed QuestionItem (minus id). */
export function sanitizeQuestion(q: any): Omit<QuestionItem, 'id'> {
  const fix = (s: string) => (s ?? '').replace(/\\n/g, '\n')
  const stripNum = (s: string) =>
    fix(s).replace(/^(\*{0,2})\s*\d+[.)]\s*\*{0,2}\s*/, '$1').trimStart()

  let text = stripNum(q.text ?? '')
  // Merge options array into question text for MCQ if options aren't already embedded
  if (q.type === 'mcq' && Array.isArray(q.options) && q.options.length > 0 && !/\bA\)/.test(text)) {
    const letters = ['A', 'B', 'C', 'D']
    const optLines = q.options
      .slice(0, 4)
      .map((opt: string, i: number) => `${letters[i]}) ${opt}`)
      .join('\n\n')
    text = `${text}\n\n${optLines}`
  }

  const aoRaw = (q.assessmentObjective ?? '').toString().toUpperCase()
  const assessmentObjective = (['AO1', 'AO2', 'AO3'] as const).find(ao => aoRaw.includes(ao))

  return {
    text,
    answer: fix(q.answer),
    markScheme: fix(q.markScheme),
    marks: Number(q.marks) || 1,
    commandWord: q.commandWord ?? '',
    type: q.type ?? 'short_answer',
    hasDiagram: Boolean(q.hasDiagram),
    ...(q.code ? { code: q.code } : {}),
    ...(q.syllabusObjective ? { syllabusObjective: q.syllabusObjective } : {}),
    ...(assessmentObjective ? { assessmentObjective } : {}),
    ...(q.difficultyStars
      ? { difficultyStars: Math.min(3, Math.max(1, Number(q.difficultyStars))) as 1 | 2 | 3 }
      : {}),
  }
}

/** Generate a short question code like MAT-C4.1-A4BF.
 *  Prefer syllabusObjective reference, then fall back to question text parsing. */
export function generateQuestionCode(
  subject: string,
  opts: { text?: string; syllabusObjective?: string } = {}
): string {
  const subj = SUBJECT_CODES[subject] ?? subject.substring(0, 3).toUpperCase()
  const fromObjective = opts.syllabusObjective?.match(/^\s*([A-Za-z]?\d+(?:\.\d+)*)\s*[–-]/)?.[1]
    ?? opts.syllabusObjective?.match(/^\s*([A-Za-z]?\d+(?:\.\d+)*)\b/)?.[1]
  const fromText = opts.text?.match(/Syllabus Reference[:\s]+([A-Za-z]?\d+(?:\.\d+)*)/i)?.[1]
  const syl = fromObjective ?? fromText ?? 'GEN'
  const shortId = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `${subj}-${syl}-${shortId}`
}
