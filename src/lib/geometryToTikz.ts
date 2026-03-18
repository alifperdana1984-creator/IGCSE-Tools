/**
 * Converts a GeometryDiagramSpec (AI-generated JSON) to valid TikZ code
 * for rendering via QuickLaTeX.
 *
 * Strategy: NO named coordinates (\coordinate), NO calc library, NO angles library.
 * Everything is computed numerically in TypeScript and emitted as raw (x,y) pairs.
 * This ensures compatibility with QuickLaTeX's older pgf version.
 *
 * Only core TikZ is required — no \usetikzlibrary needed.
 */

import type { GeometryDiagramSpec } from './types'

/** Scale: geometry units (0–10) → TikZ cm */
const S = 0.78

const f = (v: number) => (v * S).toFixed(3)
const tpt = (x: number, y: number) => `(${f(x)},${f(y)})`

function vlen(dx: number, dy: number) { return Math.sqrt(dx * dx + dy * dy) || 1 }

function unit(dx: number, dy: number): [number, number] {
  const len = vlen(dx, dy)
  return [dx / len, dy / len]
}

function mid(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
}

/** Find segment endpoints by segment name like "AB" */
function segEndpoints(
  name: string,
  segs: NonNullable<GeometryDiagramSpec['segments']>,
  pts: Record<string, [number, number]>,
): { from: [number, number]; to: [number, number] } | null {
  for (const seg of segs) {
    if (seg.from + seg.to === name || seg.to + seg.from === name) {
      if (pts[seg.from] && pts[seg.to]) return { from: pts[seg.from], to: pts[seg.to] }
    }
  }
  if (name.length >= 2) {
    const a = name[0], b = name.slice(1)
    if (pts[a] && pts[b]) return { from: pts[a], to: pts[b] }
  }
  return null
}

/** Draw n parallel tick marks at segment midpoint */
function drawParallelTicks(
  lines: string[],
  from: [number, number],
  to: [number, number],
  n: number,
) {
  const [mx, my] = mid(from, to)
  const [ux, uy] = unit(to[0] - from[0], to[1] - from[1])
  const [nx, ny] = [-uy, ux]           // perpendicular
  const ts = 0.14                       // tick half-length (geometry units)
  const gap = 0.09
  const start = -(n - 1) * gap / 2
  for (let i = 0; i < n; i++) {
    const ox = mx + ux * (start + i * gap)
    const oy = my + uy * (start + i * gap)
    lines.push(`  \\draw ${tpt(ox - nx * ts, oy - ny * ts)} -- ${tpt(ox + nx * ts, oy + ny * ts)};`)
  }
}

/** Draw right-angle square marker at vertex between two other points */
function drawRightAngleMarker(
  lines: string[],
  vertex: [number, number],
  p1: [number, number],
  p2: [number, number],
) {
  const [vx, vy] = vertex
  const [u1x, u1y] = unit(p1[0] - vx, p1[1] - vy)
  const [u2x, u2y] = unit(p2[0] - vx, p2[1] - vy)
  const sz = 0.20
  const ax = vx + u1x * sz, ay = vy + u1y * sz
  const bx = vx + u2x * sz, by = vy + u2y * sz
  const cx = ax + u2x * sz, cy = ay + u2y * sz
  lines.push(`  \\draw ${tpt(ax, ay)} -- ${tpt(cx, cy)} -- ${tpt(bx, by)};`)
}

/** Choose TikZ node anchor based on the average direction away from neighbors */
function labelAnchor(
  name: string,
  x: number,
  y: number,
  pts: Record<string, [number, number]>,
  segs: NonNullable<GeometryDiagramSpec['segments']>,
): string {
  const neighbors: [number, number][] = []
  for (const seg of segs) {
    if (seg.from === name && pts[seg.to]) neighbors.push(pts[seg.to])
    if (seg.to === name && pts[seg.from]) neighbors.push(pts[seg.from])
  }
  if (neighbors.length === 0) return 'above right'

  let sx = 0, sy = 0
  for (const [nx, ny] of neighbors) {
    const [ux, uy] = unit(x - nx, y - ny)
    sx += ux; sy += uy
  }
  const a = Math.atan2(sy, sx) * 180 / Math.PI
  if (a > 135 || a < -135) return 'left'
  if (a > 90) return 'above left'
  if (a > 45) return 'above'
  if (a > -45) return 'above right'
  if (a > -90) return 'right'
  if (a > -135) return 'below right'
  return 'below'
}

/** Format angle label for TikZ math mode: "72°" → "72^{\circ}", "x" → "x" */
function fmtAngleLabel(label: string): string {
  return label
    .replace(/°/g, '^{\\circ}')
    .replace(/\^(\d)/g, '^{$1}')    // ensure superscripts are braced
}

/**
 * Converts a GeometryDiagramSpec to a complete TikZ tikzpicture string.
 * Uses only raw numeric (x,y) coordinates — no named nodes, no extra libraries.
 * Ready to send to QuickLaTeX without any further escaping.
 */
export function geometryToTikz(spec: GeometryDiagramSpec): string {
  const pts = spec.points as Record<string, [number, number]>
  const segs = spec.segments ?? []
  const angles = spec.angles ?? []
  const labels = spec.labels ?? []

  const lines: string[] = []
  lines.push('\\begin{tikzpicture}[font=\\small]')

  // ── Segments (numeric coords only — no named node references) ────────────
  for (const seg of segs) {
    if (!pts[seg.from] || !pts[seg.to]) continue
    const style = seg.dashed ? '[dashed]' : ''
    lines.push(`  \\draw${style} ${tpt(...pts[seg.from])} -- ${tpt(...pts[seg.to])};`)

    // Segment length/label at midpoint, offset perpendicular to segment
    if (seg.label) {
      const [fx, fy] = pts[seg.from]
      const [tx2, ty2] = pts[seg.to]
      const [mx, my] = mid([fx, fy], [tx2, ty2])
      const [nx, ny] = unit(-(ty2 - fy), tx2 - fx) // left-hand perpendicular
      const lx = mx + nx * 0.38, ly = my + ny * 0.38
      lines.push(`  \\node[font=\\scriptsize] at ${tpt(lx, ly)} {${seg.label}};`)
    }
  }

  // ── Parallel tick marks ───────────────────────────────────────────────────
  const rawParallel: unknown[] = Array.isArray(spec.parallel) ? spec.parallel : []
  let tickGroup = 0
  for (const rawPair of rawParallel) {
    tickGroup++
    let s1: string, s2: string
    if (Array.isArray(rawPair)) {
      s1 = String(rawPair[0]); s2 = String(rawPair[1])
    } else if (rawPair && typeof rawPair === 'object') {
      const p = rawPair as { seg1: string; seg2: string }
      s1 = p.seg1; s2 = p.seg2
    } else continue

    for (const sn of [s1, s2]) {
      const ep = segEndpoints(sn, segs, pts)
      if (ep) drawParallelTicks(lines, ep.from, ep.to, tickGroup)
    }
  }

  // ── Perpendicular right-angle markers ─────────────────────────────────────
  const rawPerp: unknown[] = Array.isArray(spec.perpendicular) ? spec.perpendicular : []
  for (const rawPair of rawPerp) {
    let s1: string, s2: string
    if (Array.isArray(rawPair)) {
      s1 = String(rawPair[0]); s2 = String(rawPair[1])
    } else if (rawPair && typeof rawPair === 'object') {
      const p = rawPair as { seg1: string; seg2: string }
      s1 = p.seg1; s2 = p.seg2
    } else continue

    // Find common vertex from segment names
    const pts1 = s1.length >= 2 ? [s1[0], s1.slice(1)] : []
    const pts2 = s2.length >= 2 ? [s2[0], s2.slice(1)] : []
    const common = pts1.find(p => pts2.includes(p))
    if (!common || !pts[common]) continue
    const o1 = pts1.find(p => p !== common)
    const o2 = pts2.find(p => p !== common)
    if (!o1 || !o2 || !pts[o1] || !pts[o2]) continue
    drawRightAngleMarker(lines, pts[common], pts[o1], pts[o2])
  }

  // ── Angle arcs + labels ───────────────────────────────────────────────────
  // QuickLaTeX's old pgf may not support \draw (x,y) arc (a:b:r) reliably.
  // Instead, approximate the arc as N short line segments — works on any pgf.
  const arcR_geom = 0.42 / S  // geometry units → scales to exactly 0.42cm via tpt()
  const ARC_STEPS = 16
  for (const angle of angles) {
    const at = pts[angle.at]
    const [b0, b1] = angle.between
    const p0 = pts[b0], p1 = pts[b1]
    if (!at || !p0 || !p1) continue

    const a0_rad = Math.atan2(p0[1] - at[1], p0[0] - at[0])
    const a1_rad = Math.atan2(p1[1] - at[1], p1[0] - at[0])

    // Normalise sweep to (-180, 180] — non-reflex interior angle
    let sweep_rad = a1_rad - a0_rad
    while (sweep_rad > Math.PI)  sweep_rad -= 2 * Math.PI
    while (sweep_rad <= -Math.PI) sweep_rad += 2 * Math.PI

    // Build polyline approximation of the arc
    const arcPts: string[] = []
    for (let i = 0; i <= ARC_STEPS; i++) {
      const theta = a0_rad + sweep_rad * (i / ARC_STEPS)
      const px = at[0] + arcR_geom * Math.cos(theta)
      const py = at[1] + arcR_geom * Math.sin(theta)
      arcPts.push(tpt(px, py))
    }
    lines.push(`  \\draw ${arcPts.join(' -- ')};`)

    // Label on the bisector of the interior angle
    const bisector = a0_rad + sweep_rad / 2
    const labelR = 0.68 / S   // geometry units
    const lx = at[0] + Math.cos(bisector) * labelR
    const ly = at[1] + Math.sin(bisector) * labelR
    lines.push(`  \\node[font=\\scriptsize] at ${tpt(lx, ly)} {$${fmtAngleLabel(angle.label)}$};`)
  }

  // ── Point dots + labels (numeric coords) ─────────────────────────────────
  for (const [name, [x, y]] of Object.entries(pts)) {
    lines.push(`  \\fill ${tpt(x, y)} circle (1.5pt);`)
    const anchor = labelAnchor(name, x, y, pts, segs)
    lines.push(`  \\node[${anchor},font=\\small] at ${tpt(x, y)} {$${name}$};`)
  }

  // ── Extra text labels ─────────────────────────────────────────────────────
  for (const lbl of labels as Array<{ at: string; text: string; offset?: [number, number] }>) {
    const p = pts[lbl.at]
    if (!p) continue
    const off = lbl.offset ?? [0, 0.4]
    lines.push(`  \\node[font=\\scriptsize] at ${tpt(p[0] + off[0], p[1] + off[1])} {${lbl.text}};`)
  }

  lines.push('\\end{tikzpicture}')
  return lines.join('\n')
}
