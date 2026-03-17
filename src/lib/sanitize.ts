import type { QuestionItem, DiagramSpec } from './types'
import { normalizeSvgMarkdown } from './svg'

const KNOWN_DIAGRAM_TYPES = new Set(['cartesian_grid', 'geometric_shape', 'number_line', 'bar_chart'])

function normalizeDiagram(raw: unknown): DiagramSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const d = raw as Record<string, unknown>
  const dt = d.diagramType as string
  if (!KNOWN_DIAGRAM_TYPES.has(dt)) return undefined
  // Ensure required numeric ranges exist for types that need them
  if (dt === 'cartesian_grid') {
    if (d.xMin == null || d.xMax == null || d.yMin == null || d.yMax == null) return undefined
  }
  if (dt === 'number_line') {
    if (d.min == null || d.max == null) return undefined
  }
  // Normalise nullable arrays to empty arrays so renderers never call .map() on null/undefined
  for (const key of ['points', 'segments', 'polygons', 'shapes', 'nlPoints', 'ranges', 'bars'] as const) {
    if (d[key] == null) d[key] = []
  }
  // Reject diagrams with no renderable content (avoid blank boxes)
  if (dt === 'bar_chart' && (d.bars as unknown[]).length === 0) return undefined
  if (dt === 'geometric_shape') {
    const shapes = d.shapes as Record<string, unknown>[]
    if (shapes.length === 0) return undefined
    // At least one shape must have enough data to actually render
    const hasRenderable = shapes.some(s => {
      if (s.kind === 'circle') return s.cx != null && s.cy != null && s.radius != null
      if (s.kind === 'rectangle') return s.x != null && s.y != null && s.width != null && s.height != null
      if (s.kind === 'triangle' || s.kind === 'polygon')
        return Array.isArray(s.vertices) && (s.vertices as unknown[]).length >= 3
      if (s.kind === 'line')
        return Array.isArray(s.vertices) && (s.vertices as unknown[]).length >= 2
      return false
    })
    if (!hasRenderable) return undefined
  }
  return raw as DiagramSpec
}

/** If all MCQ options are coordinate pairs and the answer is also a coordinate pair,
 *  auto-generate a cartesian_grid diagram so the question is actually answerable. */
function tryAutoCartesianDiagram(answer: string, options: string[]): DiagramSpec | undefined {
  const coordRe = /^\s*\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?\s*$/
  const parsed = options.map(o => {
    const m = o.match(coordRe)
    return m ? { x: Number(m[1]), y: Number(m[2]) } : null
  })
  if (parsed.length < 2 || parsed.some(c => c === null)) return undefined

  // Answer may be "A", "(2, 3)", "A) (2, 3)", etc.
  let px: number, py: number
  const directMatch = answer.match(coordRe)
  if (directMatch) {
    px = Number(directMatch[1]); py = Number(directMatch[2])
  } else {
    const letter = answer.trim().match(/^[A-D]/i)?.[0]?.toUpperCase()
    if (!letter) return undefined
    const idx = ['A', 'B', 'C', 'D'].indexOf(letter)
    const opt = parsed[idx]
    if (!opt) return undefined
    px = opt.x; py = opt.y
  }

  const allX = (parsed.filter(Boolean) as { x: number; y: number }[]).map(c => c.x)
  const allY = (parsed.filter(Boolean) as { x: number; y: number }[]).map(c => c.y)
  const maxAbs = Math.max(...allX.map(Math.abs), ...allY.map(Math.abs), Math.abs(px), Math.abs(py), 3)
  const bound = Math.ceil(maxAbs) + 1

  return {
    diagramType: 'cartesian_grid',
    xMin: -bound, xMax: bound,
    yMin: -bound, yMax: bound,
    gridStep: 1,
    points: [{ label: 'P', x: px, y: py, color: '#7c3aed' }],
    segments: [], polygons: [],
  } as DiagramSpec
}

const SUBJECT_CODES: Record<string, string> = {
  Mathematics: 'MAT', Biology: 'BIO', Physics: 'PHY', Chemistry: 'CHM',
}

function normalizeQuestionType(raw: unknown): QuestionItem['type'] {
  const v = String(raw ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (v === 'mcq' || v === 'multiple_choice' || v === 'multiplechoice') return 'mcq'
  if (v === 'structured' || v === 'essay' || v === 'long_answer') return 'structured'
  return 'short_answer'
}

function extractMcqOptionsFromText(text: string): string[] {
  const matches = Array.from(text.matchAll(/^\s*([A-D])[).:\-]\s+(.+)\s*$/gmi))
  const byLetter: Record<string, string> = {}
  for (const m of matches) byLetter[m[1].toUpperCase()] = m[2].trim()
  const ordered = ['A', 'B', 'C', 'D']
    .map(letter => byLetter[letter])
    .filter((x): x is string => Boolean(x))
  return ordered.length === 4 ? ordered : []
}

function hasMcqLabelsInText(text: string): boolean {
  return /^\s*A[).:\-]\s+/mi.test(text) && /^\s*D[).:\-]\s+/mi.test(text)
}

/** Normalise a raw AI-generated question object into a typed QuestionItem (minus id). */
export function sanitizeQuestion(q: any): Omit<QuestionItem, 'id'> {
  const fix = (s: string) => (s ?? '').replace(/\\n/g, '\n')
  const stripNum = (s: string) =>
    fix(s).replace(/^(\*{0,2})\s*\d+[.)]\s*\*{0,2}\s*/, '$1').trimStart()

  let text = stripNum(q.text ?? '')
  const type = normalizeQuestionType(q.type)
  const stripOptionPrefix = (s: string) => s.replace(/^\s*\(?[A-D]\)?[).:\-]\s+/i, '').trim()
  const optionsFromModel = Array.isArray(q.options) ? q.options.slice(0, 4).map((x: unknown) => stripOptionPrefix(String(x ?? '').trim())).filter(Boolean) : []
  const extractedOptions = extractMcqOptionsFromText(text)
  const options = type === 'mcq'
    ? (optionsFromModel.length === 4 ? optionsFromModel : extractedOptions)
    : []

  // Merge options array into question text for MCQ if options aren't already embedded
  if (type === 'mcq' && options.length === 4 && !hasMcqLabelsInText(text)) {
    const letters = ['A', 'B', 'C', 'D']
    const optLines = options
      .map((opt: string, i: number) => `${letters[i]}) ${opt}`)
      .join('\n\n')
    text = `${text}\n\n${optLines}`
  }

  const aoRaw = (q.assessmentObjective ?? '').toString().toUpperCase()
  const assessmentObjective = (['AO1', 'AO2', 'AO3'] as const).find(ao => aoRaw.includes(ao))

  const normalizedText = normalizeSvgMarkdown(text)
  const rawDiagram = normalizeDiagram(q.diagram)

  // Auto-generate a cartesian_grid for coordinate MCQ questions when the model didn't provide one
  const diagram = rawDiagram ?? (
    type === 'mcq' && options.length >= 2
      ? tryAutoCartesianDiagram(fix(q.answer ?? ''), options)
      : undefined
  )

  // Detect questions that say "in the diagram" but have no SVG or structured diagram field.
  const referencesDiagram = /\b(in the diagram|the diagram shows|refer to the diagram|as shown in the diagram|from the diagram|on the diagram|shown on the (grid|diagram|figure|graph)|the (grid|figure|graph) shows|shown in the (figure|graph|grid)|as shown (below|above)|on the (grid|graph) (below|above|shown)|shown on a (grid|graph)|coordinates? (?:of|shown)|point [A-Z] shown)\b/i.test(normalizedText)
  const hasSvg = /```svg/i.test(normalizedText)
  const diagramMissing = (referencesDiagram || Boolean(q.hasDiagram)) && !hasSvg && !diagram

  return {
    text: normalizedText,
    answer: normalizeSvgMarkdown(fix(q.answer)),
    markScheme: normalizeSvgMarkdown(fix(q.markScheme)),
    marks: Number(q.marks) || 1,
    commandWord: q.commandWord ?? '',
    type,
    hasDiagram: diagramMissing ? false : Boolean(q.hasDiagram),
    ...(diagramMissing ? { diagramMissing: true } : {}),
    ...(diagram ? { diagram } : {}),
    ...(type === 'mcq' && options.length === 4 ? { options } : {}),
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
