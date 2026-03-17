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

/** Strip LaTeX wrappers and normalise a raw option string so coordinate parsing works
 *  even when the model wraps values in $...$, \left(...\right), etc. */
function stripForCoordParse(s: string): string {
  return s
    .replace(/\$+/g, '')           // remove $ delimiters
    .replace(/\\left\s*\(/g, '(')  // \left( → (
    .replace(/\\right\s*\)/g, ')') // \right) → )
    .replace(/\\\s/g, ' ')         // escaped spaces
    .trim()
}

function parseCoord(s: string): { x: number; y: number } | null {
  const clean = stripForCoordParse(s)
  const m = clean.match(/^\(?\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)?$/)
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null
}

/** Scan question text for labeled coordinate points like A(-1, 4) or B(3, -2)
 *  and auto-generate a cartesian_grid with those points (and a connecting segment). */
function tryAutoCartesianFromText(text: string): DiagramSpec | undefined {
  // Strip LaTeX delimiters and normalise unicode minus before matching
  const clean = text.replace(/\$+/g, '').replace(/−/g, '-').replace(/\\left\s*\(/g, '(').replace(/\\right\s*\)/g, ')')
  const pointRe = /\b([A-Z])\s*\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g
  const matches = [...clean.matchAll(pointRe)]
  if (matches.length === 0) return undefined

  const seen = new Set<string>()
  const points: Array<{ label: string; x: number; y: number }> = []
  for (const m of matches) {
    if (!seen.has(m[1])) {
      seen.add(m[1])
      points.push({ label: m[1], x: Number(m[2]), y: Number(m[3]) })
    }
  }

  const allX = points.map(p => p.x)
  const allY = points.map(p => p.y)
  const boundX = Math.ceil(Math.max(...allX.map(Math.abs), 3)) + 1
  const boundY = Math.ceil(Math.max(...allY.map(Math.abs), 3)) + 1
  const segments = points.length >= 2
    ? [{ x1: points[0].x, y1: points[0].y, x2: points[1].x, y2: points[1].y }]
    : []

  return {
    diagramType: 'cartesian_grid',
    xMin: -boundX, xMax: boundX,
    yMin: -boundY, yMax: boundY,
    gridStep: 1,
    points: points.map(p => ({ label: p.label, x: p.x, y: p.y, color: '#7c3aed' })),
    segments,
    polygons: [],
  } as DiagramSpec
}

/** If all MCQ options are coordinate pairs and the answer is also a coordinate pair,
 *  auto-generate a cartesian_grid diagram so the question is actually answerable. */
function tryAutoCartesianDiagram(answer: string, options: string[]): DiagramSpec | undefined {
  const parsed = options.map(o => parseCoord(o))
  if (parsed.length < 2 || parsed.some(c => c === null)) return undefined

  // Answer may be "A", "(2, 3)", "$(-2, 3)$", "A) (2, 3)", etc.
  let px: number, py: number
  const directMatch = parseCoord(answer)
  if (directMatch) {
    px = directMatch.x; py = directMatch.y
  } else {
    const letter = stripForCoordParse(answer).match(/^[A-D]/i)?.[0]?.toUpperCase()
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

  // Auto-generate a cartesian_grid when the model didn't provide one
  const diagram = rawDiagram ?? (() => {
    // 1. All MCQ options are coordinate pairs → plot the correct answer point
    if (type === 'mcq' && options.length >= 2) {
      const fromOpts = tryAutoCartesianDiagram(fix(q.answer ?? ''), options)
      if (fromOpts) return fromOpts
    }
    // 2. Question text contains labeled coordinate points like A(-1, 4) → plot them
    if (q.hasDiagram) {
      return tryAutoCartesianFromText(normalizedText) ?? undefined
    }
    return undefined
  })()

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
