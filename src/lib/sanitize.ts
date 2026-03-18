import type { QuestionItem, DiagramSpec } from './types'
import { normalizeSvgMarkdown } from './svg'
import { SVG_TEMPLATES } from './svgTemplates'

const KNOWN_DIAGRAM_TYPES = new Set([
  'cartesian_grid', 'geometric_shape', 'number_line', 'bar_chart', 'geometry',
  'circle_theorem', 'science_graph', 'genetic_diagram', 'energy_level_diagram',
  'food_web', 'energy_pyramid', 'flowchart', 'svg_template',
])

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
  if (dt === 'geometry') {
    let pts = d.points
    // Gemini schema forces points to be an array — convert [{name,x,y}] → {name: [x,y]}
    if (Array.isArray(pts)) {
      const dict: Record<string, [number, number]> = {}
      for (const p of pts as Record<string, unknown>[]) {
        const name = String(p.name ?? p.label ?? p.id ?? '')
        if (!name) return undefined
        const x = Number(p.x), y = Number(p.y)
        if (!isFiniteNum(x) || !isFiniteNum(y)) return undefined
        dict[name] = [x, y]
      }
      if (Object.keys(dict).length < 2) return undefined
      d.points = dict
      pts = dict
    } else if (!pts || typeof pts !== 'object') {
      return undefined
    } else {
      // Object dict format — coerce coordinates
      const entries = Object.entries(pts as Record<string, unknown>)
      if (entries.length < 2) return undefined
      for (const [, coord] of entries) {
        if (Array.isArray(coord) && coord.length >= 2) {
          (coord as unknown[])[0] = Number((coord as unknown[])[0])
          ;(coord as unknown[])[1] = Number((coord as unknown[])[1])
          if (!isFiniteNum((coord as unknown[])[0]) || !isFiniteNum((coord as unknown[])[1])) return undefined
        } else {
          return undefined
        }
      }
    }
    // Normalize parallel/perpendicular: convert [{seg1,seg2}] objects → [string,string] tuples
    for (const key of ['parallel', 'perpendicular'] as const) {
      if (Array.isArray(d[key])) {
        d[key] = (d[key] as Record<string, unknown>[]).map(item => {
          if (Array.isArray(item)) return item  // already tuple
          return [String(item.seg1 ?? item[0] ?? ''), String(item.seg2 ?? item[1] ?? '')]
        }).filter((pair: unknown[]) => pair[0] && pair[1])
      }
    }

    // Auto-repair: if parallel/perpendicular references a 2-letter segment name (e.g. "PQ")
    // but the corresponding segment {from:"P", to:"Q"} is missing, add it if both endpoints exist.
    // This fixes the case where AI provides parallel=["PQ","RS"] but forgets to list PQ and RS segments.
    const existingSegments = Array.isArray(d.segments)
      ? (d.segments as Record<string, unknown>[])
      : []
    const pointsDict = d.points as Record<string, unknown>
    const segPairExists = (a: string, b: string) =>
      existingSegments.some(s => (s.from === a && s.to === b) || (s.from === b && s.to === a))

    const segNamesToRepair = new Set<string>()
    for (const key of ['parallel', 'perpendicular'] as const) {
      if (Array.isArray(d[key])) {
        for (const pair of d[key] as [string, string][]) {
          segNamesToRepair.add(pair[0])
          segNamesToRepair.add(pair[1])
        }
      }
    }

    const addedSegments: Array<{ from: string; to: string }> = []
    for (const segName of segNamesToRepair) {
      if (segName.length === 2) {
        const [p1, p2] = segName.split('')
        if (pointsDict[p1] && pointsDict[p2] && !segPairExists(p1, p2)) {
          addedSegments.push({ from: p1, to: p2 })
        }
      }
    }
    if (addedSegments.length > 0) {
      d.segments = [...existingSegments, ...addedSegments]
    }

    // After repair attempt: if parallel still references segments with no endpoints in points dict,
    // reject the diagram so the text-based fallback can generate a complete one instead.
    if (Array.isArray(d.parallel) && (d.parallel as [string, string][]).length > 0) {
      const allSegNames = (d.segments as Record<string, unknown>[]).map(s => `${s.from}${s.to}`)
      const allSegNamesRev = (d.segments as Record<string, unknown>[]).map(s => `${s.to}${s.from}`)
      const hasOrphanParallel = (d.parallel as [string, string][]).some(
        ([s1, s2]) =>
          !allSegNames.includes(s1) && !allSegNamesRev.includes(s1) ||
          !allSegNames.includes(s2) && !allSegNamesRev.includes(s2)
      )
      if (hasOrphanParallel) return undefined
    }

    // Reject trivially simple geometry: ≤2 points with no angle labels is just a line segment —
    // not useful as a diagram. Let the text-based fallback generate something meaningful.
    const ptCount = Object.keys(d.points as Record<string, unknown>).length
    const angCount = Array.isArray(d.angles) ? (d.angles as unknown[]).length : 0
    if (ptCount < 3 && angCount === 0) return undefined

    return raw as DiagramSpec
  }
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

  // ── New Layer 1 types ────────────────────────────────────────────────────
  if (dt === 'circle_theorem') {
    if (!Array.isArray(d.pointsOnCircumference) || (d.pointsOnCircumference as unknown[]).length < 2) return undefined
    // Normalize chords/radii: [{s1,s2}] → [string,string]
    for (const key of ['chords', 'radii'] as const) {
      if (Array.isArray(d[key])) {
        d[key] = (d[key] as unknown[]).map(item =>
          Array.isArray(item) ? item : [String((item as Record<string,unknown>).s1 ?? ''), String((item as Record<string,unknown>).s2 ?? '')]
        ).filter((p: unknown[]) => p[0] && p[1])
      }
    }
  }

  if (dt === 'science_graph') {
    if (!Array.isArray(d.datasets) || (d.datasets as unknown[]).length === 0) return undefined
    if (!Array.isArray(d.xRange) || !Array.isArray(d.yRange)) return undefined
  }

  if (dt === 'genetic_diagram') {
    // Restore punnettGrid from Firestore serialized form [{row:[...]}, ...]
    if (Array.isArray(d.punnettGridRows)) {
      d.punnettGrid = (d.punnettGridRows as Record<string,unknown>[]).map(r =>
        Array.isArray(r.row) ? r.row : []
      )
      delete d.punnettGridRows
    }
    if (!d.subtype) return undefined
  }

  if (dt === 'energy_level_diagram') {
    if (!d.reactants || !d.products) return undefined
    // Coerce energy levels
    const r = d.reactants as Record<string,unknown>
    const p = d.products as Record<string,unknown>
    if (r.energyLevel != null) r.energyLevel = coerceNum(r.energyLevel)
    if (p.energyLevel != null) p.energyLevel = coerceNum(p.energyLevel)
    if (d.activationEnergy) {
      const ae = d.activationEnergy as Record<string,unknown>
      if (ae.peak != null) ae.peak = coerceNum(ae.peak)
    }
  }

  if (dt === 'food_web') {
    if (!Array.isArray(d.organisms) || (d.organisms as unknown[]).length === 0) return undefined
    if (!Array.isArray(d.arrows)) d.arrows = []
  }

  if (dt === 'energy_pyramid') {
    if (!Array.isArray(d.levels) || (d.levels as unknown[]).length === 0) return undefined
  }

  if (dt === 'flowchart') {
    if (!Array.isArray(d.nodes) || (d.nodes as unknown[]).length === 0) return undefined
    if (!Array.isArray(d.connections)) d.connections = []
  }

  if (dt === 'svg_template') {
    if (!d.templateId || !SVG_TEMPLATES[d.templateId as string]) return undefined
    // Normalize svgLabels (flat Gemini field) → labels
    if (Array.isArray(d.svgLabels) && !Array.isArray(d.labels)) {
      d.labels = d.svgLabels
      delete d.svgLabels
    }
    if (!Array.isArray(d.labels)) d.labels = []
    // Validate anchor IDs against template
    const template = SVG_TEMPLATES[d.templateId as string]
    d.labels = (d.labels as Array<Record<string, unknown>>).filter(
      l => l.anchorId && template.anchors[l.anchorId as string]
    )
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

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function formatBearingLabel(value: number): string {
  const deg = ((Math.round(value) % 360) + 360) % 360
  return `${String(deg).padStart(3, '0')}°`
}

function inferNumericAnswer(answer: string, options: string[]): number | undefined {
  const direct = answer.match(/-?\d+(?:\.\d+)?/)
  if (direct) return Number(direct[0])
  const letter = answer.trim().match(/^[A-D]/i)?.[0]?.toUpperCase()
  if (!letter) return undefined
  const idx = ['A', 'B', 'C', 'D'].indexOf(letter)
  if (idx < 0 || !options[idx]) return undefined
  const fromOption = options[idx].match(/-?\d+(?:\.\d+)?/)
  return fromOption ? Number(fromOption[0]) : undefined
}

function inferAnswerOption(answer: string, options: string[]): string | undefined {
  const letter = answer.trim().match(/^[A-D]/i)?.[0]?.toUpperCase()
  if (letter) {
    const idx = ['A', 'B', 'C', 'D'].indexOf(letter)
    if (idx >= 0 && options[idx]) return options[idx]
  }
  const a = answer.trim().toLowerCase()
  if (!a) return undefined
  const exact = options.find(opt => opt.trim().toLowerCase() === a)
  return exact
}

function regularPolygonGeometry(sides: number): DiagramSpec {
  const n = Math.max(3, Math.min(10, Math.round(sides)))
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, n).split('')
  const cx = 5, cy = 5, r = 3.8
  const points: Record<string, [number, number]> = {}
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / n
    points[letters[i]] = [cx + r * Math.cos(ang), cy + r * Math.sin(ang)]
  }
  const segments = Array.from({ length: n }, (_, i) => ({
    from: letters[i],
    to: letters[(i + 1) % n],
  }))
  return { diagramType: 'geometry', points, segments } as DiagramSpec
}

function layoutGeometryPoints(names: string[]): Record<string, [number, number]> {
  const uniq = Array.from(new Set(names)).slice(0, 12)
  if (uniq.length === 0) return {}
  if (uniq.length === 1) return { [uniq[0]]: [5, 5] }
  const cx = 5, cy = 5, r = 3.8
  const pts: Record<string, [number, number]> = {}
  uniq.forEach((name, i) => {
    const ang = -Math.PI / 2 + (2 * Math.PI * i) / uniq.length
    pts[name] = [cx + r * Math.cos(ang), cy + r * Math.sin(ang)]
  })
  return pts
}

function tryUltraFallbackGeometry(text: string): DiagramSpec | undefined {
  const clean = text
    .replace(/\$+/g, '')
    .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+/g, ' ')

  const linePairs = Array.from(clean.matchAll(/\b(?:line\s+)?([A-Z]{2})\b/g)).map(m => m[1].toUpperCase())
  const angleTriples = Array.from(clean.matchAll(/\b(?:angle|∠)\s*([A-Z]{3})\b/gi)).map(m => m[1].toUpperCase())
  const pointMentions = Array.from(clean.matchAll(/\b(?:point|town|vertex|centre|center)\s+([A-Z])\b/gi)).map(m => m[1].toUpperCase())

  const namesFromPairs = linePairs.flatMap(s => s.split(''))
  const namesFromTriples = angleTriples.flatMap(s => s.split(''))
  const names = Array.from(new Set([...namesFromPairs, ...namesFromTriples, ...pointMentions])).slice(0, 8)
  if (names.length < 2) return undefined

  const points = layoutGeometryPoints(names)
  const segments = (linePairs.length >= 1 ? linePairs : names.slice(0, 3).map((_, i, arr) => `${arr[i]}${arr[(i + 1) % arr.length]}`))
    .slice(0, 8)
    .filter(s => s.length === 2 && points[s[0]] && points[s[1]])
    .map(s => ({ from: s[0], to: s[1] }))

  const primaryAngle = angleTriples[0]
  const angles = primaryAngle && points[primaryAngle[1]] && points[primaryAngle[0]] && points[primaryAngle[2]]
    ? [{ at: primaryAngle[1], between: [primaryAngle[0], primaryAngle[2]] as [string, string], label: 'x' }]
    : undefined

  return {
    diagramType: 'geometry',
    points,
    ...(segments.length > 0 ? { segments } : {}),
    ...(angles ? { angles } : {}),
  } as DiagramSpec
}

/** Build a simple geometry diagram from common angle/triangle phrasings so
 *  diagram-referenced questions remain answerable even when provider omits diagram JSON. */
function tryAutoGeometryFromText(text: string, answer = '', options: string[] = []): DiagramSpec | undefined {
  const clean = text
    .replace(/\$+/g, '')
    .replace(/\\angle/g, '∠')
    .replace(/\\triangle/g, 'triangle')
    .replace(/\\degree/g, '°')
    .replace(/\\left/g, '')
    .replace(/\\right/g, '')
    .replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/âˆ’/g, '-')

  // Pattern: "AB is a straight line. C is a point on AB. ∠ACD = 110°"
  // Pattern: generic rotational symmetry prompts that reference "the shape shown".
  if (/\border of rotational symmetry\b/i.test(clean) && /\bshape\b/i.test(clean)) {
    const inferredOrder = inferNumericAnswer(answer, options)
    if (inferredOrder && inferredOrder >= 3 && inferredOrder <= 10) {
      return regularPolygonGeometry(inferredOrder)
    }
    return regularPolygonGeometry(4)
  }

  // Pattern: "Name the mathematical name of the quadrilateral shown..."
  if (/\bquadrilateral\b/i.test(clean) && /\bname\b/i.test(clean)) {
    const chosen = (inferAnswerOption(answer, options) ?? '').toLowerCase()
    let verts: Array<{ x: number; y: number; label?: string }>
    if (chosen.includes('rhombus')) {
      verts = [{ x: 200, y: 70, label: 'A' }, { x: 320, y: 150, label: 'B' }, { x: 200, y: 230, label: 'C' }, { x: 80, y: 150, label: 'D' }]
    } else if (chosen.includes('kite')) {
      verts = [{ x: 200, y: 60, label: 'A' }, { x: 300, y: 155, label: 'B' }, { x: 200, y: 245, label: 'C' }, { x: 140, y: 155, label: 'D' }]
    } else if (chosen.includes('parallelogram')) {
      verts = [{ x: 110, y: 220, label: 'A' }, { x: 290, y: 220, label: 'B' }, { x: 340, y: 120, label: 'C' }, { x: 160, y: 120, label: 'D' }]
    } else if (chosen.includes('trapezium') || chosen.includes('trapezoid')) {
      verts = [{ x: 90, y: 220, label: 'A' }, { x: 310, y: 220, label: 'B' }, { x: 250, y: 120, label: 'C' }, { x: 150, y: 120, label: 'D' }]
    } else {
      // Default to a clear non-degenerate quadrilateral.
      verts = [{ x: 90, y: 220, label: 'A' }, { x: 310, y: 220, label: 'B' }, { x: 270, y: 120, label: 'C' }, { x: 140, y: 120, label: 'D' }]
    }
    return {
      diagramType: 'geometric_shape',
      viewWidth: 400,
      viewHeight: 300,
      shapes: [{ kind: 'polygon', vertices: verts }],
    } as DiagramSpec
  }

  // Pattern: "A circle has diameter AB. Point C is on the circumference."
  const diameterMatch = clean.match(/\b(?:a\s+)?circle\s+has\s+diameter\s+([A-Z]{2})\b/i)
  if (diameterMatch) {
    const [d1, d2] = diameterMatch[1].toUpperCase().split('')
    const cOnCirc = clean.match(/\bpoint\s+([A-Z])\s+is on the circumference\b/i)?.[1]?.toUpperCase()
    const cName = cOnCirc && cOnCirc !== d1 && cOnCirc !== d2 ? cOnCirc : 'C'

    const cx = 200, cy = 140, r = 90
    const ax = cx + r, ay = cy
    const bx = cx - r, by = cy
    const theta = -125 * Math.PI / 180
    const px = cx + r * Math.cos(theta), py = cy + r * Math.sin(theta)

    return {
      diagramType: 'geometric_shape',
      viewWidth: 400,
      viewHeight: 300,
      shapes: [
        {
          kind: 'circle',
          cx, cy, radius: r,
          labels: [{ text: 'O', x: cx + 12, y: cy - 8 }],
        },
        { kind: 'line', vertices: [{ x: ax, y: ay, label: d1 }, { x: bx, y: by, label: d2 }] },
        { kind: 'line', vertices: [{ x: ax, y: ay, label: d1 }, { x: px, y: py, label: cName }] },
        { kind: 'line', vertices: [{ x: bx, y: by, label: d2 }, { x: px, y: py, label: cName }] },
      ],
    } as DiagramSpec
  }

  // Pattern: "The bearing of town B from town A is 055°"
  const bearingMatch = clean.match(/\bbearing of (?:town|point)?\s*([A-Z])\s+from (?:town|point)?\s*([A-Z])\s+is\s*(\d{2,3})\s*°?/i)
  if (bearingMatch) {
    const toPoint = bearingMatch[1].toUpperCase()
    const fromPoint = bearingMatch[2].toUpperCase()
    const bearing = clamp(Number(bearingMatch[3]), 0, 359)
    const theta = (bearing * Math.PI) / 180

    const ax = 4.2, ay = 4.3
    const bx = clamp(ax + 3.2 * Math.sin(theta), 0.8, 9.2)
    const by = clamp(ay + 3.2 * Math.cos(theta), 0.8, 9.2)

    const points: Record<string, [number, number]> = {
      [fromPoint]: [ax, ay],
      [toPoint]: [bx, by],
      N: [ax, 8.8],
    }

    return {
      diagramType: 'geometry',
      points,
      segments: [
        { from: fromPoint, to: 'N', dashed: true },
        { from: fromPoint, to: toPoint },
      ],
      angles: [{ at: fromPoint, between: ['N', toPoint], label: formatBearingLabel(bearing) }],
    } as DiagramSpec
  }

  const straightAngle = clean.match(/\b([A-Z])([A-Z])\s+is a straight line\b[\s\S]*?\b([A-Z])\s+is a point on\s+([A-Z])([A-Z])\b[\s\S]*?(?:∠|angle)\s*([A-Z]{3})\s*=\s*(\d+(?:\.\d+)?)\s*°?/i)
  if (straightAngle) {
    const line1 = straightAngle[1].toUpperCase()
    const line2 = straightAngle[2].toUpperCase()
    const pointOnLine = straightAngle[3].toUpperCase()
    const on1 = straightAngle[4].toUpperCase()
    const on2 = straightAngle[5].toUpperCase()
    const angleName = straightAngle[6].toUpperCase()
    const angleValue = clamp(Number(straightAngle[7]), 10, 170)
    if ((line1 !== on1 || line2 !== on2) && (line1 !== on2 || line2 !== on1)) return undefined
    if (angleName[1] !== pointOnLine) return undefined

    const points: Record<string, [number, number]> = {
      [line1]: [1.5, 5],
      [pointOnLine]: [5, 5],
      [line2]: [8.5, 5],
    }
    const rad = (180 - angleValue) * Math.PI / 180
    const dx = 3 * Math.cos(rad)
    const dy = 3 * Math.sin(rad)
    const rayPoint = angleName[2]
    points[rayPoint] = [clamp(5 + dx, 0.5, 9.5), clamp(5 + dy, 0.5, 9.5)]

    return {
      diagramType: 'geometry',
      points,
      segments: [
        { from: line1, to: line2 },
        { from: pointOnLine, to: rayPoint },
      ],
      angles: [{ at: pointOnLine, between: [angleName[0], angleName[2]], label: `${angleValue}°` }],
    } as DiagramSpec
  }

  // Pattern: Generic "straight line … angle of X°" — e.g. "A straight line has an angle of 55° on one side."
  // Generates a horizontal line A-B-C with ray BP and both angles labeled.
  if (/\bstraight\s+line\b/i.test(clean)) {
    const degMatch = clean.match(/\b(\d+(?:\.\d+)?)\s*°/)
    if (degMatch) {
      const angleValue = clamp(Number(degMatch[1]), 10, 170)
      const rad = (Math.PI * (180 - angleValue)) / 180
      const dx = 3 * Math.cos(rad)
      const dy = 3 * Math.sin(rad)
      return {
        diagramType: 'geometry',
        points: {
          A: [1.5, 5],
          B: [5, 5],
          C: [8.5, 5],
          P: [clamp(5 + dx, 0.5, 9.5), clamp(5 + dy, 0.5, 9.5)],
        },
        segments: [
          { from: 'A', to: 'C' },
          { from: 'B', to: 'P' },
        ],
        angles: [
          { at: 'B', between: ['A', 'P'], label: `${angleValue}°` },
          { at: 'B', between: ['P', 'C'], label: 'x' },
        ],
      } as DiagramSpec
    }
  }

  // Pattern: "∠ACD = 110°" (or "angle ACD = 110")
  const namedAngle = clean.match(/(?:∠|angle)\s*([A-Z]{3})\s*=\s*(\d+(?:\.\d+)?)\s*°?/i)
  if (namedAngle) {
    const [a, v, b] = namedAngle[1].toUpperCase().split('')
    const angleValue = clamp(Number(namedAngle[2]), 10, 170)
    const rad = (180 - angleValue) * Math.PI / 180
    const d2x = 3 * Math.cos(rad)
    const d2y = 3 * Math.sin(rad)
    return {
      diagramType: 'geometry',
      points: {
        [v]: [5, 5],
        [a]: [2, 5],
        [b]: [clamp(5 + d2x, 0.5, 9.5), clamp(5 + d2y, 0.5, 9.5)],
      },
      segments: [
        { from: v, to: a },
        { from: v, to: b },
      ],
      angles: [{ at: v, between: [a, b], label: `${angleValue}°` }],
    } as DiagramSpec
  }

  // Pattern: "triangle ABC"
  const tri = clean.match(/\btriangle\s+([A-Z]{3})\b/i)
  if (tri) {
    const [a, b, c] = tri[1].toUpperCase().split('')
    return {
      diagramType: 'geometry',
      points: {
        [a]: [1.5, 1.5],
        [b]: [5, 8.5],
        [c]: [8.5, 1.8],
      },
      segments: [
        { from: a, to: b },
        { from: b, to: c },
        { from: a, to: c },
      ],
    } as DiagramSpec
  }

  // Pattern: regular polygon symmetry questions (e.g. regular pentagon)
  const regPoly = clean.match(/\bregular\s+(pentagon|hexagon|heptagon|octagon|nonagon|decagon)\b/i)
  if (regPoly) {
    const sidesByName: Record<string, number> = {
      pentagon: 5, hexagon: 6, heptagon: 7, octagon: 8, nonagon: 9, decagon: 10,
    }
    const n = sidesByName[regPoly[1].toLowerCase()]
    return regularPolygonGeometry(n)
  }

  // Pattern: "line AB is parallel to line CD. Line EF is a straight line."
  // Build a standard parallel-lines-with-transversal geometry diagram.
  // Pattern: circle + center + tangent style questions.
  if (/\bcentre of the circle\b/i.test(clean) && /\btangent\b/i.test(clean)) {
    const centerLetter = clean.match(/\b([A-Z])\s+is the centre of the circle\b/i)?.[1]?.toUpperCase() ?? 'O'
    const onCirc = clean.match(/\bpoint\s+([A-Z])\s+is on the circumference\b/i)?.[1]?.toUpperCase() ?? 'A'
    const tangentLine = clean.match(/\bline\s+([A-Z]{2})\s+is a tangent\b/i)?.[1]?.toUpperCase() ?? 'BC'
    const centralAngle = clean.match(/\bangle\s+([A-Z]{3})\s*(?:=|is)\s*(\d+(?:\.\d+)?)\s*°?/i)
    const centralAngleName = centralAngle?.[1]?.toUpperCase()
    const centralAngleLabel = centralAngle ? `${clamp(Number(centralAngle[2]), 1, 359)}°` : undefined

    const O = centerLetter
    const A = onCirc
    const [B, C] = tangentLine.split('')
    const radialOther = centralAngleName && centralAngleName[1] === O ? centralAngleName[2] : 'C'

    const points: Record<string, [number, number]> = {
      [O]: [5, 5],
      [A]: [5, 1.4],
      [B]: [1.6, 1.4],
      [C]: [8.6, 1.4],
      [radialOther]: [8.1, 6.9],
    }

    return {
      diagramType: 'geometry',
      points,
      segments: [
        { from: B, to: C },
        { from: O, to: A },
        { from: O, to: radialOther },
      ],
      perpendicular: [[`${O}${A}`, `${B}${C}`]],
      ...(centralAngleLabel ? { angles: [{ at: O, between: [A, radialOther], label: centralAngleLabel }] } : {}),
    } as DiagramSpec
  }

  // Pattern: "AB is parallel to CD. Line EF intersects AB at X and CD at Y."
  const intersectingParallel = clean.match(/\b(?:line\s+)?([A-Z]{2})\s+is parallel to\s+(?:line\s+)?([A-Z]{2})[\s\S]*?(?:line\s+)?([A-Z]{2})\s+intersects\s+(?:line\s+)?\1\s+at\s+([A-Z])\s+and\s+(?:line\s+)?\2\s+at\s+([A-Z])/i)
  if (intersectingParallel) {
    const [a, b] = intersectingParallel[1].toUpperCase().split('')
    const [c, d] = intersectingParallel[2].toUpperCase().split('')
    const [t, u] = intersectingParallel[3].toUpperCase().split('')
    const vOnFirst = intersectingParallel[4].toUpperCase()
    const wOnSecond = intersectingParallel[5].toUpperCase()

    const points: Record<string, [number, number]> = {
      [a]: [1.0, 3.0],
      [b]: [9.0, 3.0],
      [c]: [1.0, 7.0],
      [d]: [9.0, 7.0],
      [vOnFirst]: [7.0, 3.0],
      [wOnSecond]: [5.4, 7.0],
      [t]: [4.4, 9.0],
      [u]: [8.0, 1.0],
    }

    const namedParallelAngle = clean.match(/\b(?:angle|∠)\s*([A-Z]{3})\s*(?:=|is)?\s*(\d+(?:\.\d+)?)\s*°?/i)
    const angles = namedParallelAngle && points[namedParallelAngle[1][1]] && points[namedParallelAngle[1][0]] && points[namedParallelAngle[1][2]]
      ? [{
        at: namedParallelAngle[1][1].toUpperCase(),
        between: [namedParallelAngle[1][0].toUpperCase(), namedParallelAngle[1][2].toUpperCase()] as [string, string],
        label: `${clamp(Number(namedParallelAngle[2]), 1, 359)}°`,
      }]
      : undefined

    return {
      diagramType: 'geometry',
      points,
      segments: [
        { from: a, to: b },
        { from: c, to: d },
        { from: t, to: u },
      ],
      parallel: [[`${a}${b}`, `${c}${d}`]],
      ...(angles ? { angles } : {}),
    } as DiagramSpec
  }

  const parallelLines = clean.match(/\b(?:line\s+)?([A-Z]{2})\s+is parallel to\s+(?:line\s+)?([A-Z]{2})\b/i)
  if (parallelLines) {
    const l1 = parallelLines[1].toUpperCase()
    const l2 = parallelLines[2].toUpperCase()
    const t = clean.match(/\b(?:line\s+)?([A-Z]{2})\s+(?:is\s+)?(?:a\s+)?(?:transversal|straight line)\b/i)?.[1]?.toUpperCase()

    const [a, b] = l1.split('')
    const [c, d] = l2.split('')
    const [e, f] = (t && t.length === 2 ? t : 'EF').split('')

    const points: Record<string, [number, number]> = {
      [a]: [1, 7.5],
      [b]: [9, 7.5],
      [c]: [1, 3],
      [d]: [9, 3],
      [e]: [6.8, 9],
      [f]: [3.6, 1.5],
    }

    const namedParallelAngle = clean.match(/\b(?:angle|∠)\s*([A-Z]{3})\s*(?:=|is)?\s*(\d+(?:\.\d+)?)\s*°?/i)
    let angles: Array<{ at: string; between: [string, string]; label: string }> | undefined
    if (namedParallelAngle) {
      const name = namedParallelAngle[1].toUpperCase()
      const at = name[1]
      const p1 = name[0]
      const p2 = name[2]
      if (points[at] && points[p1] && points[p2]) {
        angles = [{ at, between: [p1, p2], label: `${clamp(Number(namedParallelAngle[2]), 1, 359)}°` }]
      }
    } else if (/\bx\b/i.test(clean)) {
      angles = [{ at: e, between: [a, f] as [string, string], label: 'x' }]
    }

    return {
      diagramType: 'geometry',
      points,
      segments: [
        { from: a, to: b },
        { from: c, to: d },
        { from: e, to: f },
      ],
      parallel: [[l1, l2]],
      ...(angles ? { angles } : {}),
    } as DiagramSpec
  }

  // Pattern: "angle a" / "angle α" classification style question
  const symbolicAngle = clean.match(/\bangle\s+([a-zα-ω])\b/i)
  if (symbolicAngle) {
    const label = symbolicAngle[1]
    return {
      diagramType: 'geometry',
      points: { O: [5, 5], A: [2, 8], B: [8.5, 5.8] },
      segments: [{ from: 'O', to: 'A' }, { from: 'O', to: 'B' }],
      angles: [{ at: 'O', between: ['A', 'B'], label }],
    } as DiagramSpec
  }

  // Generic fallback: build a valid geometry diagram from named segments/angles.
  const rawPairs = Array.from(clean.matchAll(/\b([A-Z]{2})\b/g)).map(m => m[1].toUpperCase())
  const segmentCodes = Array.from(new Set(rawPairs.filter(p => p.length === 2))).slice(0, 8)
  if (segmentCodes.length >= 2) {
    const pointNames = segmentCodes.flatMap(s => s.split(''))
    const points = layoutGeometryPoints(pointNames)
    const segments = segmentCodes
      .filter(s => points[s[0]] && points[s[1]])
      .map(s => ({ from: s[0], to: s[1] }))

    const parallelMatch = clean.match(/\b(?:line\s+)?([A-Z]{2})\s+is parallel to\s+(?:line\s+)?([A-Z]{2})\b/i)
    const parallel = parallelMatch
      ? [[parallelMatch[1].toUpperCase(), parallelMatch[2].toUpperCase()] as [string, string]]
      : undefined

    const angleMatch = clean.match(/\b(?:angle|∠)\s*([A-Z]{3})\s*(?:=|is)?\s*(\d+(?:\.\d+)?)?\s*°?/i)
    const angles = angleMatch && points[angleMatch[1][1]] && points[angleMatch[1][0]] && points[angleMatch[1][2]]
      ? [{
        at: angleMatch[1][1].toUpperCase(),
        between: [angleMatch[1][0].toUpperCase(), angleMatch[1][2].toUpperCase()] as [string, string],
        label: angleMatch[2] ? `${clamp(Number(angleMatch[2]), 1, 359)}°` : 'x',
      }]
      : undefined

    return {
      diagramType: 'geometry',
      points,
      segments,
      ...(parallel ? { parallel } : {}),
      ...(angles ? { angles } : {}),
    } as DiagramSpec
  }

  return tryUltraFallbackGeometry(clean)
}

/** Public entry-point for text-based diagram generation (used as fallback in regenerate flow). */
export function generateDiagramFromText(text: string, answer = '', options: string[] = []): DiagramSpec | undefined {
  return tryAutoCartesianFromText(text)
    ?? tryAutoGeometryFromText(text, answer, options)
    ?? undefined
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
  const referencesDiagram = /\b(in the diagram|the diagram shows|refer to the diagram|as shown in the diagram|from the diagram|on the diagram|shown on the (grid|diagram|figure|graph)|the (grid|figure|graph) shows|shown in the (figure|graph|grid)|as shown (below|above)|on the (grid|graph) (below|above|shown)|shown on a (grid|graph)|coordinates? (?:of|shown)|point [A-Z] shown|in the (triangle|circle|polygon|quadrilateral|rectangle|trapezium|parallelogram)|the (triangle|circle|polygon|quadrilateral) [A-Z]{2,}|angle [A-Z]{2,3}\s*=|triangle [A-Z]{3}|bearing of|three-figure bearings?|is parallel to|transversal|straight line|tangent|diameter [A-Z]{2}|centre of the circle|center of the circle|rotational symmetry|line symmetry|shape shown)\b/i.test(normalizedText)
  const rawDiagram = normalizeDiagram(q.diagram)

  // Auto-generate a cartesian_grid when the model didn't provide one.
  // Text-based extraction takes priority: it uses the actual named points (P, Q, A, B)
  // from the question, which is more accurate than inferring from MCQ option values.
  const diagram = rawDiagram ?? (() => {
    // 1. Extract labeled coordinate points from question text, e.g. A(-1,4) or P(-4,1)
    if (q.hasDiagram || referencesDiagram) {
      const fromText = tryAutoCartesianFromText(normalizedText)
      if (fromText) return fromText
      const fromGeometry = tryAutoGeometryFromText(normalizedText, fix(q.answer ?? ''), options)
      if (fromGeometry) return fromGeometry
    }
    // 2. Fallback: all MCQ options are coordinate pairs → plot the correct answer as point P
    if (type === 'mcq' && options.length >= 2) {
      return tryAutoCartesianDiagram(fix(q.answer ?? ''), options) ?? undefined
    }
    return undefined
  })()

  // Detect questions that say "in the diagram" but have no SVG or structured diagram field.
  const hasSvg = /```svg/i.test(normalizedText)
  const diagramMissing = (referencesDiagram || Boolean(q.hasDiagram)) && !hasSvg && !diagram

  return {
    text: normalizedText,
    answer: normalizeSvgMarkdown(fix(q.answer)),
    markScheme: normalizeSvgMarkdown(fix(q.markScheme)),
    marks: Number(q.marks) || 1,
    commandWord: q.commandWord ?? '',
    type,
    hasDiagram: diagramMissing ? false : Boolean(q.hasDiagram || diagram),
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

/** Repairs missing diagram fields on an existing QuestionItem by re-running
 *  sanitize fallback inference, while preserving stable identity fields. */
export function repairQuestionItem<T extends QuestionItem>(q: T): T {
  const sanitized = sanitizeQuestion(q)
  return {
    ...q,
    ...sanitized,
    id: q.id,
    ...(q.code ? { code: q.code } : {}),
  } as T
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
