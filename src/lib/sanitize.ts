import type { QuestionItem, DiagramSpec } from './types'
import { normalizeSvgMarkdown } from './svg'

const KNOWN_DIAGRAM_TYPES = new Set(['cartesian_grid', 'geometric_shape', 'number_line', 'bar_chart'])

export function normalizeDiagram(raw: unknown): DiagramSpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const d = raw as Record<string, unknown>
  const dt = d.diagramType as string
  if (!KNOWN_DIAGRAM_TYPES.has(dt)) return undefined

  // Coerce string numbers to actual numbers (AI sometimes returns "60" instead of 60)
  const toNum = (v: unknown) => (v == null ? v : Number(v))
  const isFiniteNum = (v: unknown) => typeof v === 'number' && isFinite(v)
  const coerceNum = (v: unknown) => { const n = toNum(v); return (n != null && isFiniteNum(n)) ? n : v }

  for (const key of ['xMin','xMax','yMin','yMax','gridStep','min','max','step','viewWidth','viewHeight'] as const) {
    if (d[key] != null) d[key] = coerceNum(d[key])
  }

  if (dt === 'cartesian_grid') {
    if (!isFiniteNum(d.xMin) || !isFiniteNum(d.xMax) || !isFiniteNum(d.yMin) || !isFiniteNum(d.yMax)) return undefined
  }
  if (dt === 'number_line') {
    if (!isFiniteNum(d.min) || !isFiniteNum(d.max)) return undefined
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
    // Coerce all numeric coordinate fields inside shapes so string coords become numbers
    for (const s of shapes) {
      for (const k of ['cx','cy','radius','x','y','width','height'] as const) {
        if (s[k] != null) s[k] = coerceNum(s[k])
      }
      if (Array.isArray(s.vertices)) {
        for (const v of s.vertices as Record<string, unknown>[]) {
          if (v.x != null) v.x = coerceNum(v.x)
          if (v.y != null) v.y = coerceNum(v.y)
        }
      }
    }
    // At least one shape must have valid renderable data
    const hasRenderable = shapes.some(s => {
      if (s.kind === 'circle')
        return isFiniteNum(s.cx) && isFiniteNum(s.cy) && isFiniteNum(s.radius)
      if (s.kind === 'rectangle')
        return isFiniteNum(s.x) && isFiniteNum(s.y) && isFiniteNum(s.width) && isFiniteNum(s.height)
      if (s.kind === 'triangle' || s.kind === 'polygon') {
        if (!Array.isArray(s.vertices) || (s.vertices as unknown[]).length < 3) return false
        return (s.vertices as Record<string, unknown>[]).every(v => isFiniteNum(v.x) && isFiniteNum(v.y))
      }
      if (s.kind === 'line') {
        if (!Array.isArray(s.vertices) || (s.vertices as unknown[]).length < 2) return false
        return (s.vertices as Record<string, unknown>[]).every(v => isFiniteNum(v.x) && isFiniteNum(v.y))
      }
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
  // Aggressively strip LaTeX so coordinates like $P(1,\, 8)$ become P(1, 8)
  const clean = text
    .replace(/\$+/g, '')                              // remove $ delimiters
    .replace(/−/g, '-')                               // unicode minus
    .replace(/\\left\s*\(/g, '(')                     // \left( → (
    .replace(/\\right\s*\)/g, ')')                    // \right) → )
    .replace(/\\[,;!]\s*/g, ' ')                      // LaTeX spacing \, \; \! → space
    .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1')         // \cmd{X} → X
    .replace(/\\[a-zA-Z]+/g, ' ')                     // remaining \cmd → space
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
  const gridStep = Math.max(boundX, boundY) > 8 ? 2 : 1
  const segments = points.length >= 2
    ? [{ x1: points[0].x, y1: points[0].y, x2: points[1].x, y2: points[1].y }]
    : []

  return {
    diagramType: 'cartesian_grid',
    xMin: -boundX, xMax: boundX,
    yMin: -boundY, yMax: boundY,
    gridStep,
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

  // Auto-generate a cartesian_grid when the model didn't provide one.
  // Text-based extraction takes priority: it uses the actual named points (P, Q, A, B)
  // from the question, which is more accurate than inferring from MCQ option values.
  const diagram = rawDiagram ?? (() => {
    // 1. Extract labeled coordinate points from question text, e.g. A(-1,4) or P(-4,1)
    if (q.hasDiagram) {
      const fromText = tryAutoCartesianFromText(normalizedText)
      if (fromText) return fromText
    }
    // 2. Fallback: all MCQ options are coordinate pairs → plot the correct answer as point P
    if (type === 'mcq' && options.length >= 2) {
      return tryAutoCartesianDiagram(fix(q.answer ?? ''), options) ?? undefined
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
