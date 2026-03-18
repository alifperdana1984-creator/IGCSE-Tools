import React, { useEffect, useRef, useState } from 'react'
import type {
  DiagramSpec, CartesianGridSpec, GeometricShapeSpec, NumberLineSpec, BarChartSpec, GeometryDiagramSpec,
  CircleTheoremSpec, ScienceGraphSpec, GeneticDiagramSpec, EnergyLevelDiagramSpec,
  FoodWebSpec, EnergyPyramidSpec, FlowchartSpec, SvgTemplateSpec, TikzSpec, GeoGebraSpec,
} from '../../lib/types'
import { SVG_TEMPLATES } from '../../lib/svgTemplates'
import { renderTikz } from '../../lib/quicklatex'

// ── CartesianGrid ────────────────────────────────────────────────────────────

function CartesianGrid({ spec }: { spec: CartesianGridSpec }) {
  const { xMin, xMax, yMin, yMax, gridStep = 1 } = spec
  const rangeX = (xMax ?? 0) - (xMin ?? 0) || 10
  const rangeY = (yMax ?? 0) - (yMin ?? 0) || 10

  const mL = 48, mR = 28, mT = 28, mB = 44
  const W = 400
  const cellSize = (W - mL - mR) / rangeX
  const pH = cellSize * rangeY
  const H = mT + pH + mB

  const tx = (x: number) => mL + (x - xMin) * cellSize
  const ty = (y: number) => H - mB - (y - yMin) * cellSize

  const axisInViewX = xMin <= 0 && 0 <= xMax
  const axisInViewY = yMin <= 0 && 0 <= yMax
  const ox = axisInViewX ? tx(0) : mL
  const oy = axisInViewY ? ty(0) : H - mB

  // tick values
  const xTicks: number[] = []
  for (let v = Math.ceil(xMin / gridStep) * gridStep; v <= xMax + 1e-9; v += gridStep)
    xTicks.push(Math.round(v * 1e6) / 1e6)
  const yTicks: number[] = []
  for (let v = Math.ceil(yMin / gridStep) * gridStep; v <= yMax + 1e-9; v += gridStep)
    yTicks.push(Math.round(v * 1e6) / 1e6)

  // skip tick label if spacing is tight (<18px)
  const labelEvery = cellSize < 18 ? Math.ceil(18 / cellSize) : 1

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 440, display: 'block' }}>
      {/* Grid */}
      {xTicks.map(x => (
        <line key={`gx${x}`} x1={tx(x)} y1={mT} x2={tx(x)} y2={H - mB}
          stroke="#e0e0e0" strokeWidth="0.6" />
      ))}
      {yTicks.map(y => (
        <line key={`gy${y}`} x1={mL} y1={ty(y)} x2={W - mR} y2={ty(y)}
          stroke="#e0e0e0" strokeWidth="0.6" />
      ))}

      {/* Polygons */}
      {spec.polygons?.map((poly, i) => (
        <g key={`poly${i}`}>
          <polygon
            points={poly.vertices.map(v => `${tx(v.x)},${ty(v.y)}`).join(' ')}
            fill={poly.fill ?? 'rgba(59,130,246,0.10)'}
            stroke="#444" strokeWidth="1.5"
          />
          {poly.vertices.filter(v => v.label).map((v, j) => (
            <text key={j} x={tx(v.x) + 7} y={ty(v.y) - 5} fontSize="12" fill="#444" fontWeight="600">{v.label}</text>
          ))}
        </g>
      ))}

      {/* Segments */}
      {spec.segments?.map((seg, i) => {
        const sx1 = tx(seg.x1), sy1 = ty(seg.y1), sx2 = tx(seg.x2), sy2 = ty(seg.y2)
        if (!isFinite(sx1) || !isFinite(sy1) || !isFinite(sx2) || !isFinite(sy2)) return null
        const mx = (sx1 + sx2) / 2, my = (sy1 + sy2) / 2
        return (
          <g key={`seg${i}`}>
            <line x1={sx1} y1={sy1} x2={sx2} y2={sy2}
              stroke="#333" strokeWidth="1.5"
              strokeDasharray={seg.dashed ? '5,3' : undefined} />
            {seg.label && <text x={mx + 6} y={my - 5} fontSize="11" fill="#555">{seg.label}</text>}
          </g>
        )
      })}

      {/* X axis */}
      {axisInViewX && <>
        <line x1={mL} y1={oy} x2={W - mR} y2={oy} stroke="#222" strokeWidth="1.8" />
        <polygon points={`${W - mR},${oy} ${W - mR - 8},${oy - 4} ${W - mR - 8},${oy + 4}`} fill="#222" />
        <text x={W - mR + 5} y={oy + 4} fontSize="14" fill="#222" fontStyle="italic">x</text>
      </>}
      {/* Y axis */}
      {axisInViewY && <>
        <line x1={ox} y1={mT} x2={ox} y2={H - mB} stroke="#222" strokeWidth="1.8" />
        <polygon points={`${ox},${mT} ${ox - 4},${mT + 8} ${ox + 4},${mT + 8}`} fill="#222" />
        <text x={ox + 5} y={mT - 5} fontSize="14" fill="#222" fontStyle="italic">y</text>
      </>}

      {/* Ticks + labels */}
      {xTicks.map((x, xi) => {
        const sx = tx(x)
        return (
          <g key={`tx${x}`}>
            {axisInViewX && <line x1={sx} y1={oy - 4} x2={sx} y2={oy + 4} stroke="#222" strokeWidth="1" />}
            {x !== 0 && xi % labelEvery === 0 &&
              <text x={sx} y={H - mB + 16} textAnchor="middle" fontSize="11" fill="#555">{x}</text>}
          </g>
        )
      })}
      {yTicks.map((y, yi) => {
        const sy = ty(y)
        return (
          <g key={`ty${y}`}>
            {axisInViewY && <line x1={ox - 4} y1={sy} x2={ox + 4} y2={sy} stroke="#222" strokeWidth="1" />}
            {y !== 0 && yi % labelEvery === 0 &&
              <text x={mL - 8} y={sy + 4} textAnchor="end" fontSize="11" fill="#555">{y}</text>}
          </g>
        )
      })}
      {axisInViewX && axisInViewY &&
        <text x={ox - 12} y={oy + 16} textAnchor="middle" fontSize="11" fill="#555">0</text>}

      {/* Points */}
      {spec.points?.map((pt, i) => {
        const sx = tx(pt.x), sy = ty(pt.y)
        if (!isFinite(sx) || !isFinite(sy)) return null
        const col = pt.color ?? '#dc2626'
        return (
          <g key={`pt${i}`}>
            <circle cx={sx} cy={sy} r={5} fill={col} />
            <text x={sx + 9} y={sy - 7} fontSize="14" fill={col} fontWeight="700">{pt.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ── GeometricShape ───────────────────────────────────────────────────────────

/** Returns SVG path data for a right-angle square marker at vertex (vx,vy)
 *  with adjacent vertices (ax,ay) and (bx,by). */
function rightAnglePath(vx: number, vy: number, ax: number, ay: number, bx: number, by: number, sz = 12) {
  const dax = ax - vx, day = ay - vy
  const lenA = Math.sqrt(dax * dax + day * day) || 1
  const dbx = bx - vx, dby = by - vy
  const lenB = Math.sqrt(dbx * dbx + dby * dby) || 1
  const uax = (dax / lenA) * sz, uay = (day / lenA) * sz
  const ubx = (dbx / lenB) * sz, uby = (dby / lenB) * sz
  const p1x = vx + uax, p1y = vy + uay
  const px = vx + uax + ubx, py = vy + uay + uby
  const p2x = vx + ubx, p2y = vy + uby
  return `M ${p1x} ${p1y} L ${px} ${py} L ${p2x} ${p2y}`
}

function GeometricShape({ spec }: { spec: GeometricShapeSpec }) {
  const VW = spec.viewWidth ?? 400
  const VH = spec.viewHeight ?? 300

  return (
    <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" style={{ maxWidth: VW, display: 'block' }}>
      {(spec.shapes ?? []).map((shape, si) => {
        const stroke = shape.stroke ?? '#1a1a1a'
        const fill = shape.fill ?? 'none'

        if (shape.kind === 'circle' && shape.cx != null && shape.cy != null && shape.radius != null
            && isFinite(Number(shape.cx)) && isFinite(Number(shape.cy)) && isFinite(Number(shape.radius))) {
          return (
            <g key={si}>
              <circle cx={shape.cx} cy={shape.cy} r={shape.radius}
                stroke={stroke} strokeWidth="2" fill={fill} />
              {shape.labels?.map((lbl, li) => (
                <text key={li} x={lbl.x} y={lbl.y} fontSize="14" textAnchor="middle"
                  fill="#1a1a1a" fontFamily="serif">{lbl.text}</text>
              ))}
            </g>
          )
        }

        if (shape.kind === 'rectangle' &&
          shape.x != null && shape.y != null && shape.width != null && shape.height != null) {
          const corners = [
            { x: shape.x, y: shape.y },
            { x: shape.x + shape.width, y: shape.y },
            { x: shape.x + shape.width, y: shape.y + shape.height },
            { x: shape.x, y: shape.y + shape.height },
          ]
          return (
            <g key={si}>
              <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height}
                stroke={stroke} strokeWidth="2" fill={fill} />
              {shape.sides?.map((s, sdi) => {
                const a = corners[s.fromVertex], b = corners[s.toVertex]
                if (!a || !b) return null
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
                const dx = b.x - a.x, dy = b.y - a.y
                const len = Math.sqrt(dx * dx + dy * dy) || 1
                const nx = (-dy / len) * 18, ny = (dx / len) * 18
                return (
                  <text key={sdi} x={mx + nx} y={my + ny + 5} textAnchor="middle"
                    fontSize="13" fill="#1a1a1a" fontFamily="serif">{s.label}</text>
                )
              })}
              {shape.labels?.map((lbl, li) => (
                <text key={li} x={lbl.x} y={lbl.y} fontSize="13" textAnchor="middle"
                  fill="#1a1a1a" fontFamily="serif">{lbl.text}</text>
              ))}
            </g>
          )
        }

        if ((shape.kind === 'triangle' || shape.kind === 'polygon') && shape.vertices?.length) {
          const verts = shape.vertices
          const cx = verts.reduce((s, v) => s + v.x, 0) / verts.length
          const cy = verts.reduce((s, v) => s + v.y, 0) / verts.length
          return (
            <g key={si}>
              <polygon points={verts.map(v => `${v.x},${v.y}`).join(' ')}
                stroke={stroke} strokeWidth="2" fill={fill} />

              {/* Right angle marker */}
              {shape.rightAngleAt != null && verts.length >= 3 && (() => {
                const idx = shape.rightAngleAt
                const v = verts[idx]
                const prev = verts[(idx - 1 + verts.length) % verts.length]
                const next = verts[(idx + 1) % verts.length]
                return <path d={rightAnglePath(v.x, v.y, prev.x, prev.y, next.x, next.y)}
                  stroke={stroke} strokeWidth="1.5" fill="none" />
              })()}

              {/* Side labels — offset away from centroid */}
              {shape.sides?.map((s, sdi) => {
                const a = verts[s.fromVertex], b = verts[s.toVertex]
                if (!a || !b) return null
                const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
                const dx = b.x - a.x, dy = b.y - a.y
                const len = Math.sqrt(dx * dx + dy * dy) || 1
                let nx = (-dy / len) * 20, ny = (dx / len) * 20
                // flip if pointing toward centroid
                if ((mx + nx - cx) * (mx - cx) + (my + ny - cy) * (my - cy) < 0) { nx = -nx; ny = -ny }
                return (
                  <text key={sdi} x={mx + nx} y={my + ny + 4} textAnchor="middle"
                    fontSize="13" fill="#1a1a1a" fontFamily="serif">{s.label}</text>
                )
              })}

              {/* Vertex labels — offset away from centroid */}
              {verts.map((v, vi) => {
                if (!v.label) return null
                const dx = v.x - cx, dy = v.y - cy
                const len = Math.sqrt(dx * dx + dy * dy) || 1
                const ox = (dx / len) * 20, oy = (dy / len) * 20
                return (
                  <text key={vi} x={v.x + ox} y={v.y + oy + 5} textAnchor="middle"
                    fontSize="14" fill="#1a1a1a" fontWeight="bold" fontFamily="serif">{v.label}</text>
                )
              })}

              {shape.labels?.map((lbl, li) => (
                <text key={li} x={lbl.x} y={lbl.y} fontSize="13" textAnchor="middle"
                  fill="#1a1a1a" fontFamily="serif">{lbl.text}</text>
              ))}
            </g>
          )
        }

        if (shape.kind === 'line' && shape.vertices?.length === 2) {
          const [a, b] = shape.vertices
          return <line key={si} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            stroke={stroke} strokeWidth="2" />
        }

        return null
      })}
    </svg>
  )
}

// ── NumberLine ───────────────────────────────────────────────────────────────

function NumberLine({ spec }: { spec: NumberLineSpec }) {
  const W = 400, H = 80
  const mL = 36, mR = 36, lineY = 38
  const { min, max, step = 1 } = spec
  const pW = W - mL - mR
  const toX = (v: number) => mL + ((v - min) / (max - min)) * pW

  const ticks: number[] = []
  for (let v = min; v <= max + 1e-9; v = Math.round((v + step) * 1e9) / 1e9)
    ticks.push(v)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }}>
      {/* Line + arrows */}
      <line x1={mL - 12} y1={lineY} x2={W - mR + 12} y2={lineY} stroke="#333" strokeWidth="2" />
      <polygon points={`${W - mR + 12},${lineY} ${W - mR + 4},${lineY - 4} ${W - mR + 4},${lineY + 4}`} fill="#333" />
      <polygon points={`${mL - 12},${lineY} ${mL - 4},${lineY - 4} ${mL - 4},${lineY + 4}`} fill="#333" />

      {/* Ranges */}
      {spec.ranges?.map((r, i) => (
        <line key={i} x1={toX(r.from)} y1={lineY} x2={toX(r.to)} y2={lineY}
          stroke="#2563eb" strokeWidth="5" strokeOpacity="0.45" />
      ))}

      {/* Ticks + labels */}
      {ticks.map(v => (
        <g key={v}>
          <line x1={toX(v)} y1={lineY - 7} x2={toX(v)} y2={lineY + 7} stroke="#333" strokeWidth="1.5" />
          <text x={toX(v)} y={lineY + 22} textAnchor="middle" fontSize="12" fill="#444">{v}</text>
        </g>
      ))}

      {/* Points (open/closed circles) */}
      {spec.nlPoints?.map((pt, i) => (
        <g key={i}>
          <circle cx={toX(pt.value)} cy={lineY} r={6.5}
            fill={pt.open ? 'white' : '#dc2626'}
            stroke="#dc2626" strokeWidth="2" />
          {pt.label && (
            <text x={toX(pt.value)} y={lineY - 13} textAnchor="middle"
              fontSize="12" fill="#dc2626" fontWeight="600">{pt.label}</text>
          )}
        </g>
      ))}
    </svg>
  )
}

// ── BarChart ─────────────────────────────────────────────────────────────────

const BAR_COLORS = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#be185d']

function BarChart({ spec }: { spec: BarChartSpec }) {
  const W = 400, mL = 56, mR = 16, mT = 36, mB = 60
  const { yMax, title, xLabel, yLabel } = spec
  const bars = spec.bars ?? []
  const maxVal = yMax ?? (bars.length > 0 ? Math.ceil(Math.max(...bars.map(b => b.value)) * 1.25) : 10)
  const pH = 200
  const H = mT + pH + mB
  const pW = W - mL - mR
  const slotW = pW / (bars.length || 1)
  const barW = slotW * 0.6
  const gap = slotW * 0.2
  const scaleY = pH / maxVal
  const toBarX = (i: number) => mL + i * slotW + gap
  const toBarH = (v: number) => v * scaleY

  const yTickCount = 5
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) =>
    Math.round((maxVal / yTickCount) * i * 10) / 10)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }}>
      {title && <text x={W / 2} y={20} textAnchor="middle" fontSize="13" fill="#1a1a1a" fontWeight="600">{title}</text>}

      {/* Grid */}
      {yTicks.map(v => (
        <line key={v} x1={mL} y1={H - mB - toBarH(v)} x2={W - mR} y2={H - mB - toBarH(v)}
          stroke="#e5e7eb" strokeWidth="0.7" />
      ))}

      {/* Axes */}
      <line x1={mL} y1={mT} x2={mL} y2={H - mB} stroke="#555" strokeWidth="1.5" />
      <line x1={mL} y1={H - mB} x2={W - mR} y2={H - mB} stroke="#555" strokeWidth="1.5" />

      {/* Y ticks */}
      {yTicks.map(v => (
        <g key={v}>
          <line x1={mL - 4} y1={H - mB - toBarH(v)} x2={mL} y2={H - mB - toBarH(v)}
            stroke="#555" strokeWidth="1" />
          <text x={mL - 8} y={H - mB - toBarH(v) + 4} textAnchor="end" fontSize="11" fill="#555">{v}</text>
        </g>
      ))}

      {/* Bars */}
      {bars.map((bar, i) => {
        const bx = toBarX(i)
        const bh = toBarH(bar.value)
        return (
          <g key={i}>
            <rect x={bx} y={H - mB - bh} width={barW} height={bh}
              fill={BAR_COLORS[i % BAR_COLORS.length]} rx="2" />
            <text x={bx + barW / 2} y={H - mB + 16} textAnchor="middle" fontSize="11" fill="#555">{bar.label}</text>
          </g>
        )
      })}

      {/* Axis labels */}
      {xLabel && <text x={mL + pW / 2} y={H - 6} textAnchor="middle" fontSize="12" fill="#555">{xLabel}</text>}
      {yLabel && (
        <text x={14} y={mT + pH / 2} textAnchor="middle" fontSize="12" fill="#555"
          transform={`rotate(-90, 14, ${mT + pH / 2})`}>{yLabel}</text>
      )}
    </svg>
  )
}

// ── GeometryDiagram ──────────────────────────────────────────────────────────

function GeometryDiagram({ spec }: { spec: GeometryDiagramSpec }) {
  const W = 380, H = 300
  const PAD = 44  // padding so labels don't clip

  // Find bounding box of all points to auto-scale
  const coords = Object.values(spec.points)
  if (coords.length === 0) return null
  const xs = coords.map(p => p[0]), ys = coords.map(p => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const rangeX = (maxX - minX) || 1, rangeY = (maxY - minY) || 1

  // Scale with padding so points are never at edge
  const tx = (x: number) => PAD + ((x - minX) / rangeX) * (W - PAD * 2)
  // SVG y is flipped — higher coordinate values go UP
  const ty = (y: number) => H - PAD - ((y - minY) / rangeY) * (H - PAD * 2)
  const pt = (name: string) => {
    const c = spec.points[name]
    return c ? { x: tx(c[0]), y: ty(c[1]) } : null
  }

  // Collect which segment pairs have parallel tick marks
  const parallelSegs = spec.parallel ?? []
  const parallelTickCount: Record<string, number> = {}
  parallelSegs.forEach((pair, i) => {
    parallelTickCount[pair[0]] = i + 1
    parallelTickCount[pair[1]] = i + 1
  })

  const segKey = (a: string, b: string) => [a, b].sort().join('')

  // Draw parallel tick marks on a segment midpoint
  function ParallelTicks({ a, b, count }: { a: { x: number; y: number }; b: { x: number; y: number }; count: number }) {
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
    const dx = b.x - a.x, dy = b.y - a.y
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const nx = (-dy / len) * 7, ny = (dx / len) * 7  // normal
    const ux = (dx / len) * 5, uy = (dy / len) * 5   // along segment
    const offsets = count === 1 ? [0] : count === 2 ? [-4, 4] : [-6, 0, 6]
    return (
      <g>
        {offsets.map((o, i) => (
          <line key={i}
            x1={mx + ux * o / 5 - nx} y1={my + uy * o / 5 - ny}
            x2={mx + ux * o / 5 + nx} y2={my + uy * o / 5 + ny}
            stroke="#555" strokeWidth="1.5" />
        ))}
      </g>
    )
  }

  // Right-angle square marker at vertex V between points A and B
  function RightAngleMarker({ v, a, b }: { v: { x: number; y: number }; a: { x: number; y: number }; b: { x: number; y: number } }) {
    const dax = a.x - v.x, day = a.y - v.y
    const lenA = Math.sqrt(dax * dax + day * day) || 1
    const dbx = b.x - v.x, dby = b.y - v.y
    const lenB = Math.sqrt(dbx * dbx + dby * dby) || 1
    const sz = 12
    const uax = (dax / lenA) * sz, uay = (day / lenA) * sz
    const ubx = (dbx / lenB) * sz, uby = (dby / lenB) * sz
    return (
      <path d={`M ${v.x + uax} ${v.y + uay} L ${v.x + uax + ubx} ${v.y + uay + uby} L ${v.x + ubx} ${v.y + uby}`}
        stroke="#333" strokeWidth="1.3" fill="none" />
    )
  }

  // Angle arc label
  function AngleArc({ at, between, label }: { at: string; between: [string, string]; label: string }) {
    const v = pt(at), a = pt(between[0]), b = pt(between[1])
    if (!v || !a || !b) return null
    const dax = a.x - v.x, day = a.y - v.y
    const dbx = b.x - v.x, dby = b.y - v.y
    const lenA = Math.sqrt(dax * dax + day * day) || 1
    const lenB = Math.sqrt(dbx * dbx + dby * dby) || 1
    const r = 18
    const ax = v.x + (dax / lenA) * r, ay = v.y + (day / lenA) * r
    const bx = v.x + (dbx / lenB) * r, by = v.y + (dby / lenB) * r
    // midpoint of arc for label position
    const mx = v.x + ((dax / lenA + dbx / lenB) / 2) * (r + 10)
    const my = v.y + ((day / lenA + dby / lenB) / 2) * (r + 10)
    return (
      <g>
        <path d={`M ${ax} ${ay} A ${r} ${r} 0 0 1 ${bx} ${by}`}
          stroke="#2563eb" strokeWidth="1.2" fill="none" />
        <text x={mx} y={my} textAnchor="middle" dominantBaseline="middle"
          fontSize="11" fill="#2563eb" fontFamily="serif">{label}</text>
      </g>
    )
  }

  const perpPairs = spec.perpendicular ?? []

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block' }}>
      {/* Segments */}
      {(spec.segments ?? []).map((seg, i) => {
        const a = pt(seg.from), b = pt(seg.to)
        if (!a || !b) return null
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        const dx = b.x - a.x, dy = b.y - a.y
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const nx = (-dy / len) * 14, ny = (dx / len) * 14
        const key = segKey(seg.from, seg.to)
        const ticks = parallelTickCount[`${seg.from}${seg.to}`] ?? parallelTickCount[`${seg.to}${seg.from}`]
        return (
          <g key={i}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
              stroke="#1a1a1a" strokeWidth="2"
              strokeDasharray={seg.dashed ? '6,3' : undefined} />
            {seg.label && (
              <text x={mx + nx} y={my + ny} textAnchor="middle" dominantBaseline="middle"
                fontSize="13" fill="#1a1a1a" fontFamily="serif">{seg.label}</text>
            )}
            {ticks && <ParallelTicks a={a} b={b} count={ticks} />}
          </g>
        )
      })}

      {/* Perpendicular right-angle markers */}
      {perpPairs.map((pair, i) => {
        // pair like ["AB","BC"] — find the shared vertex
        const [seg1, seg2] = pair
        // Parse segment names: first char = from, second = to
        const [a1, b1] = [seg1[0], seg1[1]]
        const [a2, b2] = [seg2[0], seg2[1]]
        const shared = [a1, b1].find(p => p === a2 || p === b2)
        if (!shared) return null
        const other1 = a1 === shared ? b1 : a1
        const other2 = a2 === shared ? b2 : a2
        const v = pt(shared), a = pt(other1), b = pt(other2)
        if (!v || !a || !b) return null
        return <RightAngleMarker key={i} v={v} a={a} b={b} />
      })}

      {/* Angle arcs */}
      {(spec.angles ?? []).map((ang, i) => (
        <AngleArc key={i} at={ang.at} between={ang.between} label={ang.label} />
      ))}

      {/* Point labels */}
      {Object.entries(spec.points).map(([name, coord]) => {
        const sx = tx(coord[0]), sy = ty(coord[1])
        // Nudge label away from centroid of all points
        const cx = coords.reduce((s, c) => s + tx(c[0]), 0) / coords.length
        const cy2 = coords.reduce((s, c) => s + ty(c[1]), 0) / coords.length
        const dx = sx - cx, dy = sy - cy2
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const ox = (dx / len) * 16, oy = (dy / len) * 16
        return (
          <text key={name} x={sx + ox} y={sy + oy} textAnchor="middle" dominantBaseline="middle"
            fontSize="14" fill="#1a1a1a" fontWeight="bold" fontFamily="serif">{name}</text>
        )
      })}

      {/* Extra labels */}
      {(spec.labels ?? []).map((lbl, i) => {
        const base = pt(lbl.at)
        if (!base) return null
        const ox = lbl.offset?.[0] ?? 0, oy = lbl.offset?.[1] ?? 0
        return (
          <text key={i} x={base.x + ox} y={base.y + oy} textAnchor="middle" dominantBaseline="middle"
            fontSize="13" fill="#1a1a1a" fontFamily="serif">{lbl.text}</text>
        )
      })}

      {/* Point dots */}
      {Object.entries(spec.points).map(([name, coord]) => (
        <circle key={`dot-${name}`} cx={tx(coord[0])} cy={ty(coord[1])} r={3} fill="#1a1a1a" />
      ))}
    </svg>
  )
}

// ── CircleTheoremDiagram ─────────────────────────────────────────────────────

function CircleTheoremDiagram({ spec }: { spec: CircleTheoremSpec }) {
  const W = 400, H = 400
  const cx = 200, cy = 200, R = 148

  // Convert angle (0°=right, 90°=top in math) to SVG coords
  const toSVG = (deg: number) => ({
    x: cx + R * Math.cos((deg * Math.PI) / 180),
    y: cy - R * Math.sin((deg * Math.PI) / 180),
  })

  const pts: Record<string, { x: number; y: number }> = {}
  for (const p of spec.pointsOnCircumference ?? []) pts[p.id] = toSVG(p.angleDegrees)
  if (spec.centre) pts[spec.centre.id] = { x: cx, y: cy }

  const angleArc = (ang: { vertex: string; rays: [string, string]; label: string }, idx: number) => {
    const v = pts[ang.vertex], a = pts[ang.rays[0]], b = pts[ang.rays[1]]
    if (!v || !a || !b) return null
    const arcR = ang.vertex === spec.centre?.id ? 28 : 20
    const ang1 = Math.atan2(a.y - v.y, a.x - v.x)
    const ang2 = Math.atan2(b.y - v.y, b.x - v.x)
    const x1 = v.x + arcR * Math.cos(ang1), y1 = v.y + arcR * Math.sin(ang1)
    const x2 = v.x + arcR * Math.cos(ang2), y2 = v.y + arcR * Math.sin(ang2)
    let dAng = ang2 - ang1
    while (dAng > Math.PI) dAng -= 2 * Math.PI
    while (dAng < -Math.PI) dAng += 2 * Math.PI
    const sweep = dAng > 0 ? 1 : 0
    const large = Math.abs(dAng) > Math.PI ? 1 : 0
    const midAng = ang1 + dAng / 2
    const lx = v.x + (arcR + 16) * Math.cos(midAng)
    const ly = v.y + (arcR + 16) * Math.sin(midAng)
    return (
      <g key={`angle-${idx}`}>
        <path d={`M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${arcR} ${arcR} 0 ${large} ${sweep} ${x2.toFixed(1)} ${y2.toFixed(1)}`}
          fill="none" stroke="#2563eb" strokeWidth="1.5" />
        <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="12" fill="#1d4ed8" fontStyle="italic">{ang.label}</text>
      </g>
    )
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: 420, display: 'block' }}>
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="#555" strokeWidth="1.8" />
      {(spec.chords ?? []).map(([a, b], i) => {
        const pa = pts[a], pb = pts[b]
        if (!pa || !pb) return null
        return <line key={`ch${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#333" strokeWidth="1.5" />
      })}
      {(spec.radii ?? []).map(([a, b], i) => {
        const pa = pts[a], pb = pts[b]
        if (!pa || !pb) return null
        return <line key={`rad${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke="#333" strokeWidth="1.5" />
      })}
      {(spec.tangentPoints ?? []).map((p, i) => {
        const pt = pts[p]
        if (!pt) return null
        const dx = pt.x - cx, dy = pt.y - cy
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const tx2 = (-dy / len) * 65, ty2 = (dx / len) * 65
        return <line key={`tan${i}`} x1={pt.x - tx2} y1={pt.y - ty2} x2={pt.x + tx2} y2={pt.y + ty2} stroke="#333" strokeWidth="1.5" />
      })}
      {(spec.angles ?? []).map((ang, i) => angleArc(ang, i))}
      {Object.entries(pts).map(([id, p]) => {
        const isCentre = spec.centre?.id === id
        const dx = p.x - cx, dy = p.y - cy
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const ox = isCentre ? 14 : (dx / dist) * 20
        const oy = isCentre ? 0 : (dy / dist) * 20
        return (
          <g key={`pt-${id}`}>
            <circle cx={p.x} cy={p.y} r={isCentre ? 3 : 4} fill="#1a1a1a" />
            <text x={p.x + ox} y={p.y + oy} textAnchor="middle" dominantBaseline="middle"
              fontSize="14" fontWeight="600" fill="#111">{id}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ── ScienceGraph ──────────────────────────────────────────────────────────────

function catmullRomPath(pts: Array<{ sx: number; sy: number }>): string {
  if (pts.length < 2) return ''
  const d: string[] = [`M ${pts[0].sx.toFixed(1)} ${pts[0].sy.toFixed(1)}`]
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i], p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    const cp1x = p1.sx + (p2.sx - p0.sx) / 6
    const cp1y = p1.sy + (p2.sy - p0.sy) / 6
    const cp2x = p2.sx - (p3.sx - p1.sx) / 6
    const cp2y = p2.sy - (p3.sy - p1.sy) / 6
    d.push(`C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)} ${cp2x.toFixed(1)} ${cp2y.toFixed(1)} ${p2.sx.toFixed(1)} ${p2.sy.toFixed(1)}`)
  }
  return d.join(' ')
}

function ScienceGraph({ spec }: { spec: ScienceGraphSpec }) {
  const mL = 58, mR = 20, mT = spec.title ? 38 : 22, mB = 48
  const plotW = 320, plotH = 210
  const W = mL + plotW + mR, H = mT + plotH + mB
  const [x0, x1] = spec.xRange, [y0, y1] = spec.yRange
  const rangeX = x1 - x0 || 1, rangeY = y1 - y0 || 1
  const tx = (x: number) => mL + ((x - x0) / rangeX) * plotW
  const ty = (y: number) => mT + plotH - ((y - y0) / rangeY) * plotH

  const colors = ['#2563eb', '#e11d48', '#16a34a', '#d97706', '#7c3aed']

  // Tick helpers
  const niceStep = (range: number, target = 5) => {
    const raw = range / target
    const mag = Math.pow(10, Math.floor(Math.log10(raw)))
    return [1, 2, 5, 10].map(f => f * mag).find(s => range / s <= target + 1) ?? mag
  }
  const xStep = niceStep(rangeX), yStep = niceStep(rangeY)
  const xTicks: number[] = []
  for (let v = Math.ceil(x0 / xStep) * xStep; v <= x1 + 1e-9; v = Math.round((v + xStep) * 1e6) / 1e6) xTicks.push(v)
  const yTicks: number[] = []
  for (let v = Math.ceil(y0 / yStep) * yStep; v <= y1 + 1e-9; v = Math.round((v + yStep) * 1e6) / 1e6) yTicks.push(v)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W + 40, display: 'block' }}>
      {spec.title && <text x={mL + plotW / 2} y={16} textAnchor="middle" fontSize="13" fontWeight="600" fill="#111">{spec.title}</text>}
      {/* Grid */}
      {xTicks.map(x => <line key={`gx${x}`} x1={tx(x)} y1={mT} x2={tx(x)} y2={mT + plotH} stroke="#e5e7eb" strokeWidth="0.7" />)}
      {yTicks.map(y => <line key={`gy${y}`} x1={mL} y1={ty(y)} x2={mL + plotW} y2={ty(y)} stroke="#e5e7eb" strokeWidth="0.7" />)}
      {/* Axes */}
      <line x1={mL} y1={mT} x2={mL} y2={mT + plotH} stroke="#333" strokeWidth="1.8" />
      <line x1={mL} y1={mT + plotH} x2={mL + plotW} y2={mT + plotH} stroke="#333" strokeWidth="1.8" />
      {/* X ticks */}
      {xTicks.map(x => (
        <g key={`xt${x}`}>
          <line x1={tx(x)} y1={mT + plotH} x2={tx(x)} y2={mT + plotH + 5} stroke="#333" strokeWidth="1" />
          <text x={tx(x)} y={mT + plotH + 16} textAnchor="middle" fontSize="10" fill="#555">{x}</text>
        </g>
      ))}
      {/* Y ticks */}
      {yTicks.map(y => (
        <g key={`yt${y}`}>
          <line x1={mL - 5} y1={ty(y)} x2={mL} y2={ty(y)} stroke="#333" strokeWidth="1" />
          <text x={mL - 8} y={ty(y)} textAnchor="end" dominantBaseline="middle" fontSize="10" fill="#555">{y}</text>
        </g>
      ))}
      {/* Axis labels */}
      {spec.xLabel && <text x={mL + plotW / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#444">{spec.xLabel}</text>}
      {spec.yLabel && <text x={12} y={mT + plotH / 2} textAnchor="middle" fontSize="11" fill="#444" transform={`rotate(-90, 12, ${mT + plotH / 2})`}>{spec.yLabel}</text>}
      {/* Datasets */}
      {spec.datasets.map((ds, di) => {
        const color = colors[di % colors.length]
        const svgPts = ds.dataPoints.map(p => ({ sx: tx(p.x), sy: ty(p.y) }))
        const pathD = ds.curve === 'smooth' ? catmullRomPath(svgPts)
          : `M ${svgPts.map(p => `${p.sx.toFixed(1)} ${p.sy.toFixed(1)}`).join(' L ')}`
        const last = svgPts[svgPts.length - 1]
        return (
          <g key={ds.id}>
            <path d={pathD} fill="none" stroke={color} strokeWidth="2.2"
              strokeDasharray={ds.style === 'dashed' ? '7,4' : undefined} />
            {ds.label && last && (
              <text x={last.sx + 5} y={last.sy} fontSize="10" fill={color} dominantBaseline="middle">{ds.label}</text>
            )}
          </g>
        )
      })}
      {/* Annotations */}
      {spec.annotations?.optimumPoint && (() => {
        const opt = spec.annotations!.optimumPoint!
        return (
          <g>
            <circle cx={tx(opt.x)} cy={ty(opt.y)} r={4} fill="#e11d48" />
            <text x={tx(opt.x) + 6} y={ty(opt.y) - 6} fontSize="10" fill="#e11d48">{opt.label}</text>
          </g>
        )
      })()}
      {spec.annotations?.plateaus?.map((pl, i) => (
        <g key={`pl${i}`}>
          <line x1={tx(pl.xStart)} y1={ty(pl.y)} x2={tx(pl.xEnd)} y2={ty(pl.y)} stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4,3" />
          <text x={(tx(pl.xStart) + tx(pl.xEnd)) / 2} y={ty(pl.y) - 7} textAnchor="middle" fontSize="9" fill="#64748b">{pl.label}</text>
        </g>
      ))}
    </svg>
  )
}

// ── GeneticDiagram ────────────────────────────────────────────────────────────

function PunnettSquare({ spec }: { spec: GeneticDiagramSpec }) {
  const g1 = spec.gametes1 ?? [], g2 = spec.gametes2 ?? []
  const grid = spec.punnettGrid ?? []
  const rows = g1.length || grid.length, cols = g2.length || (grid[0]?.length ?? 0)
  const cellSize = 64, headerSize = 36
  const legendH = 38
  const W = headerSize + cols * cellSize + 24
  const H = legendH + headerSize + rows * cellSize + 20
  const hiddenSet = new Map((spec.hiddenCells ?? []).map(c => [`${c.row},${c.col}`, c.pointer]))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W + 40, display: 'block' }}>
      {/* Parent labels */}
      {spec.parent1 && (
        <text x={headerSize / 2} y={18} textAnchor="middle" fontSize="11" fill="#555">
          {spec.parent1.label}: <tspan fontStyle="italic" fontWeight="600">{spec.parent1.genotype}</tspan>
        </text>
      )}
      {spec.parent2 && (
        <text x={headerSize + cols * cellSize / 2} y={18} textAnchor="middle" fontSize="11" fill="#555">
          {spec.parent2.label}: <tspan fontStyle="italic" fontWeight="600">{spec.parent2.genotype}</tspan>
        </text>
      )}
      {/* Column headers (parent2 gametes) */}
      {g2.map((g, j) => (
        <text key={`g2-${j}`} x={headerSize + j * cellSize + cellSize / 2} y={legendH + headerSize - 8}
          textAnchor="middle" fontSize="14" fontWeight="600" fontStyle="italic" fill="#111">{g}</text>
      ))}
      {/* Row headers (parent1 gametes) */}
      {g1.map((g, i) => (
        <text key={`g1-${i}`} x={headerSize - 8} y={legendH + headerSize + i * cellSize + cellSize / 2}
          textAnchor="end" dominantBaseline="middle" fontSize="14" fontWeight="600" fontStyle="italic" fill="#111">{g}</text>
      ))}
      {/* Grid */}
      {Array.from({ length: rows }).map((_, i) =>
        Array.from({ length: cols }).map((_, j) => {
          const key = `${i},${j}`
          const pointer = hiddenSet.get(key)
          const cell = grid[i]?.[j] ?? ''
          const x = headerSize + j * cellSize, y = legendH + headerSize + i * cellSize
          return (
            <g key={key}>
              <rect x={x} y={y} width={cellSize} height={cellSize} fill={pointer ? '#eff6ff' : 'white'} stroke="#aaa" strokeWidth="1" />
              <text x={x + cellSize / 2} y={y + cellSize / 2} textAnchor="middle" dominantBaseline="middle"
                fontSize="15" fontStyle="italic" fill={pointer ? '#2563eb' : '#111'}>{pointer ?? cell}</text>
            </g>
          )
        })
      )}
    </svg>
  )
}

function PedigreeDiagram({ spec }: { spec: GeneticDiagramSpec }) {
  const individuals = spec.individuals ?? []
  const relationships = spec.relationships ?? []
  const generations = [...new Set(individuals.map(i => i.generation))].sort()
  const W = 440, genH = 90
  const H = generations.length * genH + 40

  const nodePos: Record<string, { x: number; y: number }> = {}
  for (const gen of generations) {
    const group = individuals.filter(i => i.generation === gen)
    const genY = 30 + (gen - 1) * genH
    group.forEach((ind, idx) => {
      nodePos[ind.id] = { x: 50 + idx * (W - 80) / Math.max(group.length - 1, 1), y: genY }
    })
  }

  const r = 18
  const indMap = Object.fromEntries(individuals.map(i => [i.id, i]))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W + 40, display: 'block' }}>
      <defs>
        <marker id="ped-arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="#555" />
        </marker>
      </defs>
      {/* Relationship lines */}
      {relationships.map((rel, i) => {
        if (rel.type === 'mating' && rel.between?.length === 2) {
          const pa = nodePos[rel.between[0]], pb = nodePos[rel.between[1]]
          if (!pa || !pb) return null
          return <line key={`m${i}`} x1={pa.x + r} y1={pa.y} x2={pb.x - r} y2={pb.y} stroke="#555" strokeWidth="1.5" />
        }
        if (rel.type === 'offspring' && rel.parents && rel.children) {
          const p1 = nodePos[rel.parents[0]], p2 = nodePos[rel.parents[1] ?? rel.parents[0]]
          if (!p1) return null
          const midX = p2 ? (p1.x + p2.x) / 2 : p1.x
          const midY = p1.y
          const dropY = midY + genH / 2
          const children = (rel.children as string[]).map(c => nodePos[c]).filter(Boolean)
          return (
            <g key={`o${i}`}>
              <line x1={midX} y1={midY + r} x2={midX} y2={dropY} stroke="#555" strokeWidth="1.5" />
              {children.length > 1 && (
                <line x1={children[0].x} y1={dropY} x2={children[children.length - 1].x} y2={dropY} stroke="#555" strokeWidth="1.5" />
              )}
              {(rel.children as string[]).map(cid => {
                const cp = nodePos[cid]
                if (!cp) return null
                return <line key={cid} x1={cp.x} y1={dropY} x2={cp.x} y2={cp.y - r} stroke="#555" strokeWidth="1.5" />
              })}
            </g>
          )
        }
        return null
      })}
      {/* Individuals */}
      {individuals.map(ind => {
        const pos = nodePos[ind.id]
        if (!pos) return null
        const filled = ind.phenotype === 'affected'
        return (
          <g key={ind.id}>
            {ind.sex === 'male'
              ? <rect x={pos.x - r} y={pos.y - r} width={r * 2} height={r * 2} fill={filled ? '#1a1a1a' : 'white'} stroke="#555" strokeWidth="1.5" />
              : <circle cx={pos.x} cy={pos.y} r={r} fill={filled ? '#1a1a1a' : 'white'} stroke="#555" strokeWidth="1.5" />
            }
            <text x={pos.x} y={pos.y + r + 12} textAnchor="middle" fontSize="10" fill="#555">{ind.id}</text>
            {ind.showGenotype && ind.genotype && (
              <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="middle" fontSize="9" fill={filled ? 'white' : '#111'} fontStyle="italic">{ind.genotype}</text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

function GeneticDiagram({ spec }: { spec: GeneticDiagramSpec }) {
  if (spec.subtype === 'pedigree') return <PedigreeDiagram spec={spec} />
  return <PunnettSquare spec={spec} />
}

// ── EnergyLevelDiagram ────────────────────────────────────────────────────────

function EnergyLevelDiagram({ spec }: { spec: EnergyLevelDiagramSpec }) {
  const W = 420, mL = 55, mR = 90, mT = 28, mB = 44
  const plotW = W - mL - mR, plotH = 200, H = mT + plotH + mB

  const { reactants, products, activationEnergy, showCatalystPath, catalystPeak } = spec
  const rE = reactants.energyLevel, pE = products.energyLevel
  const peak = activationEnergy?.peak ?? (Math.max(rE, pE) + 30)
  const minE = Math.min(rE, pE, 0) - 10
  const maxE = peak + 15
  const range = maxE - minE || 1

  const ty = (e: number) => mT + plotH - ((e - minE) / range) * plotH
  const tx = (f: number) => mL + f * plotW  // f in 0..1

  // Main curve: reactant plateau → bezier to peak → bezier to product plateau
  const ry = ty(rE), py2 = ty(pE), ky = ty(peak)
  const mainPath = `M ${tx(0)} ${ry} L ${tx(0.18)} ${ry} C ${tx(0.35)} ${ry} ${tx(0.42)} ${ky} ${tx(0.5)} ${ky} C ${tx(0.58)} ${ky} ${tx(0.65)} ${py2} ${tx(0.82)} ${py2} L ${tx(1)} ${py2}`

  // Catalyst path (lower peak)
  const catPeak = catalystPeak ?? peak - (peak - Math.max(rE, pE)) * 0.4
  const cky = ty(catPeak)
  const catPath = showCatalystPath
    ? `M ${tx(0.18)} ${ry} C ${tx(0.35)} ${ry} ${tx(0.42)} ${cky} ${tx(0.5)} ${cky} C ${tx(0.58)} ${cky} ${tx(0.65)} ${py2} ${tx(0.82)} ${py2}`
    : null

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W + 20, display: 'block' }}>
      <defs>
        <marker id="el-arrow-r" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="#e11d48" />
        </marker>
        <marker id="el-arrow-ru" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto-start-reverse">
          <path d="M0,0 L7,3.5 L0,7 Z" fill="#e11d48" />
        </marker>
      </defs>
      {/* Axes */}
      <line x1={mL} y1={mT} x2={mL} y2={mT + plotH} stroke="#888" strokeWidth="1.5" />
      <line x1={mL} y1={mT + plotH} x2={mL + plotW} y2={mT + plotH} stroke="#888" strokeWidth="1.5" />
      <text x={14} y={mT + plotH / 2} textAnchor="middle" fontSize="11" fill="#555" transform={`rotate(-90, 14, ${mT + plotH / 2})`}>Energy</text>
      <text x={mL + plotW / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="#555">Progress of reaction</text>

      {/* Catalyst path */}
      {catPath && <path d={catPath} fill="none" stroke="#94a3b8" strokeWidth="1.8" strokeDasharray="6,4" />}
      {showCatalystPath && catalystPeak && (
        <text x={tx(0.5) + 5} y={cky - 6} fontSize="10" fill="#64748b">Ea (with catalyst)</text>
      )}

      {/* Main curve */}
      <path d={mainPath} fill="none" stroke="#333" strokeWidth="2.5" />

      {/* Horizontal dashed reference lines */}
      <line x1={mL} y1={ry} x2={tx(0.18)} y2={ry} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4,3" />
      <line x1={tx(0.82)} y1={py2} x2={mL + plotW} y2={py2} stroke="#94a3b8" strokeWidth="1" strokeDasharray="4,3" />

      {/* Reactants label */}
      <text x={mL + plotW + 5} y={ry} dominantBaseline="middle" fontSize="10" fill="#333">{reactants.label}</text>
      {/* Products label */}
      <text x={mL + plotW + 5} y={py2} dominantBaseline="middle" fontSize="10" fill="#333">{products.label}</text>

      {/* ΔH arrow */}
      {spec.energyChange && (
        <g>
          <line x1={tx(0.72)} y1={ry} x2={tx(0.72)} y2={py2}
            stroke="#e11d48" strokeWidth="1.8"
            markerStart="url(#el-arrow-ru)" markerEnd="url(#el-arrow-r)" />
          <text x={tx(0.72) + 6} y={(ry + py2) / 2} dominantBaseline="middle" fontSize="10" fill="#e11d48">{spec.energyChange.label ?? 'ΔH'}</text>
        </g>
      )}

      {/* Ea bracket */}
      {activationEnergy && (
        <g>
          <line x1={tx(0.15)} y1={ry} x2={tx(0.15)} y2={ky} stroke="#2563eb" strokeWidth="1.5" />
          <line x1={tx(0.13)} y1={ry} x2={tx(0.17)} y2={ry} stroke="#2563eb" strokeWidth="1.5" />
          <line x1={tx(0.13)} y1={ky} x2={tx(0.17)} y2={ky} stroke="#2563eb" strokeWidth="1.5" />
          <text x={tx(0.15) - 5} y={(ry + ky) / 2} textAnchor="end" dominantBaseline="middle" fontSize="11" fill="#2563eb" fontStyle="italic">
            {activationEnergy.label ?? 'Ea'}
          </text>
        </g>
      )}
    </svg>
  )
}

// ── FoodWebDiagram ────────────────────────────────────────────────────────────

function FoodWebDiagram({ spec }: { spec: FoodWebSpec }) {
  const W = 440, H = 340
  const pad = 48

  // Auto-layout: group by trophic level, arranged vertically
  const levelOrder = ['producer', 'primary_consumer', 'secondary_consumer', 'tertiary_consumer'] as const
  const groups: Record<string, typeof spec.organisms> = {}
  for (const org of spec.organisms) {
    if (!groups[org.trophicLevel]) groups[org.trophicLevel] = []
    groups[org.trophicLevel].push(org)
  }
  const activeLevels = levelOrder.filter(l => groups[l])

  const orgPos: Record<string, { x: number; y: number }> = {}

  if (spec.organisms.some(o => o.x !== undefined)) {
    // Use provided positions, scale to canvas
    const allX = spec.organisms.map(o => o.x ?? 5), allY = spec.organisms.map(o => o.y ?? 5)
    const maxX = Math.max(...allX) || 1, maxY = Math.max(...allY) || 1
    for (const org of spec.organisms) {
      orgPos[org.id] = {
        x: pad + ((org.x ?? 0) / maxX) * (W - 2 * pad),
        y: H - pad - ((org.y ?? 0) / maxY) * (H - 2 * pad),
      }
    }
  } else {
    activeLevels.forEach((level, li) => {
      const orgs = groups[level]
      const y = H - pad - (li / (activeLevels.length - 1 || 1)) * (H - 2 * pad)
      orgs.forEach((org, j) => {
        orgPos[org.id] = { x: pad + (j + 1) * (W - 2 * pad) / (orgs.length + 1), y }
      })
    })
  }

  const BOX_R = 14  // half-height of node box

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W + 20, display: 'block' }}>
      <defs>
        <marker id="fw-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#555" />
        </marker>
      </defs>
      {/* Arrows first (below nodes) */}
      {spec.arrows.map(({ from, to }, i) => {
        const pa = orgPos[from], pb = orgPos[to]
        if (!pa || !pb) return null
        const dx = pb.x - pa.x, dy = pb.y - pa.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const shrink = 30
        const x1 = pa.x + (dx / dist) * shrink, y1 = pa.y + (dy / dist) * shrink
        const x2 = pb.x - (dx / dist) * shrink, y2 = pb.y - (dy / dist) * shrink
        return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#555" strokeWidth="1.5" markerEnd="url(#fw-arrow)" />
      })}
      {/* Nodes */}
      {spec.organisms.map(org => {
        const pos = orgPos[org.id]
        if (!pos) return null
        const boxW = Math.max(org.label.length * 7 + 18, 60)
        return (
          <g key={org.id}>
            <rect x={pos.x - boxW / 2} y={pos.y - BOX_R} width={boxW} height={BOX_R * 2} rx="5"
              fill="white" stroke="#555" strokeWidth="1.5" />
            <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="middle" fontSize="12" fill="#111">{org.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ── EnergyPyramidDiagram ──────────────────────────────────────────────────────

function EnergyPyramidDiagram({ spec }: { spec: EnergyPyramidSpec }) {
  const n = spec.levels.length
  const W = 400, levelH = 46, gap = 3
  const mT = spec.title ? 36 : 18, mB = 18
  const H = mT + n * (levelH + gap) - gap + mB
  const cx = W / 2
  const bottomW = W - 32, topMinW = 36

  // levels[0] = producer (bottom, widest). Render top-to-bottom in SVG (top consumer first).
  const fills = ['#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a']

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W + 20, display: 'block' }}>
      {spec.title && <text x={cx} y={20} textAnchor="middle" fontSize="13" fontWeight="600" fill="#111">{spec.title}</text>}
      {[...spec.levels].reverse().map((level, vi) => {
        // vi=0 → top consumer (narrow), vi=n-1 → producer (wide)
        const specIdx = n - 1 - vi  // original index in spec.levels
        const y = mT + vi * (levelH + gap)
        const f = (vi + 0.5) / n   // width fraction: 0 at top, 1 at bottom
        const w = Math.max(topMinW, bottomW * f + topMinW * (1 - f))
        const wNext = Math.max(topMinW, bottomW * ((vi + 1.5) / n) + topMinW * (1 - (vi + 1.5) / n))
        // Trapezoid: top width = wPrev, bottom width = wNext
        const wPrev = vi === 0 ? topMinW : Math.max(topMinW, bottomW * ((vi - 0.5) / n) + topMinW * (1 - (vi - 0.5) / n))
        const topW = vi === 0 ? topMinW : wPrev
        const botW = wNext

        const x1t = cx - topW / 2, x2t = cx + topW / 2
        const x1b = cx - botW / 2, x2b = cx + botW / 2

        const hidden = spec.hiddenOrganisms?.find(h => h.levelIndex === specIdx)
        const displayOrg = hidden ? hidden.pointer : level.organism
        const fill = fills[Math.min(vi, fills.length - 1)]

        return (
          <g key={specIdx}>
            <polygon points={`${x1t},${y} ${x2t},${y} ${x2b},${y + levelH} ${x1b},${y + levelH}`}
              fill={fill} stroke="#555" strokeWidth="1.2" />
            <text x={cx} y={y + levelH / 2 - (level.value !== undefined ? 8 : 0)}
              textAnchor="middle" dominantBaseline="middle" fontSize="12" fontWeight="600" fill="#1a1a1a">
              {displayOrg}
            </text>
            {level.value !== undefined && (
              <text x={cx} y={y + levelH / 2 + 9} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="#374151">
                {level.value} {level.unit ?? ''}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ── FlowchartDiagram ──────────────────────────────────────────────────────────

function FlowchartDiagram({ spec }: { spec: FlowchartSpec }) {
  const nodeMap = Object.fromEntries(spec.nodes.map(n => [n.id, n]))
  const hasPositions = spec.nodes.some(n => n.x !== undefined)

  // Auto-layout: BFS topological layering
  const positions: Record<string, { x: number; y: number }> = {}
  if (hasPositions) {
    const allX = spec.nodes.map(n => n.x ?? 0), allY = spec.nodes.map(n => n.y ?? 0)
    const maxX = Math.max(...allX) || 1, maxY = Math.max(...allY) || 1
    for (const n of spec.nodes) {
      positions[n.id] = { x: 50 + ((n.x ?? 0) / maxX) * 320, y: 40 + ((n.y ?? 0) / maxY) * 300 }
    }
  } else {
    const inDegree: Record<string, number> = {}
    for (const n of spec.nodes) inDegree[n.id] = 0
    for (const c of spec.connections) inDegree[c.to] = (inDegree[c.to] ?? 0) + 1
    const roots = spec.nodes.filter(n => inDegree[n.id] === 0).map(n => n.id)
    const layers: string[][] = []
    const placed = new Set<string>()
    let frontier = roots.length > 0 ? roots : [spec.nodes[0]?.id].filter(Boolean) as string[]
    while (frontier.length > 0) {
      layers.push(frontier)
      frontier.forEach(id => placed.add(id))
      const next: string[] = []
      for (const c of spec.connections) {
        if (placed.has(c.from) && !placed.has(c.to) && !next.includes(c.to)) next.push(c.to)
      }
      frontier = next
    }
    for (const n of spec.nodes) if (!placed.has(n.id)) layers.push([n.id])
    const layerSpacing = 78, totalW = 380
    layers.forEach((layer, li) => {
      layer.forEach((id, j) => {
        positions[id] = { x: (totalW / (layer.length + 1)) * (j + 1) + 10, y: 40 + li * layerSpacing }
      })
    })
  }

  const allY = Object.values(positions).map(p => p.y)
  const W = 420, H = Math.max(...allY) + 72
  const hiddenSet = new Set(spec.hiddenNodes ?? [])

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W + 20, display: 'block' }}>
      <defs>
        <marker id="fc-arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 Z" fill="#555" />
        </marker>
      </defs>
      {spec.title && <text x={W / 2} y={18} textAnchor="middle" fontSize="13" fontWeight="600" fill="#111">{spec.title}</text>}
      {/* Connections */}
      {spec.connections.map((conn, i) => {
        const pa = positions[conn.from], pb = positions[conn.to]
        if (!pa || !pb) return null
        const dx = pb.x - pa.x, dy = pb.y - pa.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const shrink = 30
        const x1 = pa.x + (dx / dist) * shrink, y1 = pa.y + (dy / dist) * shrink
        const x2 = pb.x - (dx / dist) * shrink, y2 = pb.y - (dy / dist) * shrink
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2
        return (
          <g key={i}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#555" strokeWidth="1.5" markerEnd="url(#fc-arrow)" />
            {conn.label && <text x={mx + 5} y={my - 4} fontSize="10" fill="#444">{conn.label}</text>}
          </g>
        )
      })}
      {/* Nodes */}
      {spec.nodes.map(node => {
        const pos = positions[node.id]
        if (!pos) return null
        const isHidden = hiddenSet.has(node.id)
        const displayText = isHidden ? `[${node.id}]` : node.text
        const boxW = Math.min(Math.max(displayText.length * 6.5 + 18, 56), 150)
        const boxH = 32

        if (node.shape === 'diamond') {
          const hw = boxW * 0.58, hh = 22
          return (
            <g key={node.id}>
              <polygon points={`${pos.x},${pos.y - hh} ${pos.x + hw},${pos.y} ${pos.x},${pos.y + hh} ${pos.x - hw},${pos.y}`}
                fill={isHidden ? '#dbeafe' : 'white'} stroke="#555" strokeWidth="1.5" />
              <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill={isHidden ? '#1d4ed8' : '#111'}>{displayText}</text>
            </g>
          )
        }
        return (
          <g key={node.id}>
            <rect x={pos.x - boxW / 2} y={pos.y - boxH / 2} width={boxW} height={boxH}
              rx={node.shape === 'rounded_rectangle' ? 12 : 4}
              fill={isHidden ? '#dbeafe' : 'white'} stroke="#555" strokeWidth="1.5" />
            <text x={pos.x} y={pos.y} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill={isHidden ? '#1d4ed8' : '#111'}>{displayText}</text>
          </g>
        )
      })}
    </svg>
  )
}

// ── SvgTemplate ──────────────────────────────────────────────────────────────

function SvgTemplateDiagram({ spec }: { spec: SvgTemplateSpec }) {
  const template = SVG_TEMPLATES[spec.templateId]
  if (!template) {
    return (
      <div style={{ padding: '16px', color: '#6B7280', fontSize: '13px', border: '1px dashed #D1D5DB', borderRadius: '8px' }}>
        Unknown template: {spec.templateId}
      </div>
    )
  }

  const labels = spec.labels ?? []
  const LINE_LEN = 8  // short tick at label end

  return (
    <svg viewBox={template.viewBox} width="100%" style={{ maxWidth: 560, display: 'block' }}>
      <g dangerouslySetInnerHTML={{ __html: template.svgContent }} />
      {labels.map((label, i) => {
        const anchor = template.anchors[label.anchorId]
        if (!anchor) return null
        const { px, py, lx, ly, textAnchor = 'middle' } = anchor
        // Compute a short end-tick perpendicular to the label line
        const dx = lx - px, dy = ly - py
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const nx = -dy / len, ny = dx / len  // normal
        const tx = nx * LINE_LEN, ty = ny * LINE_LEN
        return (
          <g key={i}>
            <circle cx={px} cy={py} r="3" fill="#1F2937"/>
            <line x1={px} y1={py} x2={lx} y2={ly} stroke="#1F2937" strokeWidth="1.2"/>
            <line
              x1={lx - tx} y1={ly - ty}
              x2={lx + tx} y2={ly + ty}
              stroke="#1F2937" strokeWidth="1.2"
            />
            <text
              x={lx}
              y={ly}
              fontSize="12"
              textAnchor={textAnchor}
              dominantBaseline="auto"
              dy={textAnchor === 'middle' ? (ly < py ? '-4' : '14') : '4'}
              fill="#111827"
              fontFamily="sans-serif"
            >
              {label.text}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── TikZ (QuickLaTeX) ─────────────────────────────────────────────────────────

function TikzDiagram({ spec }: { spec: TikzSpec }) {
  const [state, setState] = useState<{ url?: string; width?: number; height?: number; error?: string; loading: boolean }>({ loading: true })

  useEffect(() => {
    let cancelled = false
    setState({ loading: true })
    renderTikz(spec.code)
      .then(result => { if (!cancelled) setState({ ...result, loading: false }) })
      .catch(err => { if (!cancelled) setState({ error: String(err), loading: false }) })
    return () => { cancelled = true }
  }, [spec.code])

  if (state.loading) {
    return (
      <div className="flex items-center gap-2 py-4 px-2 text-sm text-violet-400">
        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        Rendering diagram…
      </div>
    )
  }
  if (state.error) {
    return (
      <div className="text-xs text-red-400 py-2 px-1 font-mono whitespace-pre-wrap">
        TikZ error: {state.error}
      </div>
    )
  }
  return (
    <img
      src={state.url}
      alt="diagram"
      width={state.width}
      height={state.height}
      style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }}
    />
  )
}

// ── GeoGebra ──────────────────────────────────────────────────────────────────

let ggbScriptPromise: Promise<void> | null = null

const win = window as unknown as Record<string, unknown>

function loadGeoGebraScript(): Promise<void> {
  if (ggbScriptPromise) return ggbScriptPromise
  ggbScriptPromise = new Promise((resolve, reject) => {
    if (win.GGBApplet) { resolve(); return }
    const script = document.createElement('script')
    script.src = 'https://www.geogebra.org/apps/deployggb.js'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load GeoGebra script'))
    document.head.appendChild(script)
  })
  return ggbScriptPromise
}

let ggbCounter = 0

function GeoGebraDiagram({ spec }: { spec: GeoGebraSpec }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const idRef = useRef(`ggb-${++ggbCounter}`)

  useEffect(() => {
    let destroyed = false
    setLoading(true)
    setError(undefined)

    loadGeoGebraScript()
      .then(() => {
        if (destroyed || !containerRef.current) return
        const GGBApplet = win.GGBApplet as new (params: Record<string, unknown>, b: boolean) => { inject: (el: HTMLElement) => void; getAppletObject?: () => Record<string, (cmd: string) => void> }

        const params: Record<string, unknown> = {
          id: idRef.current,
          appName: 'geometry',
          width: spec.width ?? 480,
          height: spec.height ?? 360,
          showMenuBar: false,
          showAlgebraInput: false,
          showToolBar: false,
          showZoomButtons: true,
          enableLabelDrags: false,
          enableShiftDragZoom: true,
          enableRightClick: false,
          showResetIcon: true,
          scaleContainerClass: 'ggb-container',
          preventFocus: true,
          appletOnLoad() {
            if (destroyed) return
            const applet = win[idRef.current] as Record<string, (cmd: string) => void> | undefined
            if (!applet) return
            // Hide axes and grid for clean exam look
            applet.evalCommand?.('ShowAxes(false)')
            applet.evalCommand?.('ShowGrid(false)')
            for (const cmd of spec.commands) {
              applet.evalCommand?.(cmd)
            }
            // Fit all objects into view
            applet.evalCommand?.('ZoomIn(-1,-1,11,11)')
            setLoading(false)
          },
        }

        const applet = new GGBApplet(params, true)
        applet.inject(containerRef.current!)
      })
      .catch(err => {
        if (!destroyed) { setError(String(err)); setLoading(false) }
      })

    return () => { destroyed = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div style={{ position: 'relative' }}>
      {loading && (
        <div className="flex items-center gap-2 py-4 px-2 text-sm text-violet-400 absolute inset-0 bg-white/80 z-10">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
          </svg>
          Loading GeoGebra…
        </div>
      )}
      {error && (
        <div className="text-xs text-red-400 py-2 px-1 font-mono">{error}</div>
      )}
      <div ref={containerRef} className="ggb-container" />
    </div>
  )
}

// ── Main export ──────────────────────────────────────────────────────────────

export function DiagramRenderer({ spec }: { spec: DiagramSpec | undefined | null }) {
  if (!spec) return null
  if (spec.diagramType === 'svg_template') return <SvgTemplateDiagram spec={spec as SvgTemplateSpec} />
  if (spec.diagramType === 'tikz') return (
    <div className="my-3 border-t-2 border-b-2 border-violet-100 py-3 bg-violet-50/30 rounded-sm">
      <p className="text-xs font-semibold text-violet-400 mb-2 flex items-center gap-1.5 px-1">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-300 inline-block" />
        Diagram
      </p>
      <div className="px-1"><TikzDiagram spec={spec as TikzSpec} /></div>
    </div>
  )
  if (spec.diagramType === 'geogebra') return (
    <div className="my-3 border-t-2 border-b-2 border-violet-100 py-3 bg-violet-50/30 rounded-sm">
      <p className="text-xs font-semibold text-violet-400 mb-2 flex items-center gap-1.5 px-1">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-300 inline-block" />
        Diagram
      </p>
      <div className="px-1"><GeoGebraDiagram spec={spec as GeoGebraSpec} /></div>
    </div>
  )
  return (
    <div className="my-3 border-t-2 border-b-2 border-violet-100 py-3 bg-violet-50/30 rounded-sm">
      <p className="text-xs font-semibold text-violet-400 mb-2 flex items-center gap-1.5 px-1">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-300 inline-block" />
        Diagram
      </p>
      <div className="px-1">
        {spec.diagramType === 'cartesian_grid' && <CartesianGrid spec={spec} />}
        {spec.diagramType === 'geometric_shape' && <GeometricShape spec={spec} />}
        {spec.diagramType === 'number_line' && <NumberLine spec={spec} />}
        {spec.diagramType === 'bar_chart' && <BarChart spec={spec} />}
        {spec.diagramType === 'geometry' && <GeometryDiagram spec={spec} />}
        {spec.diagramType === 'circle_theorem' && <CircleTheoremDiagram spec={spec} />}
        {spec.diagramType === 'science_graph' && <ScienceGraph spec={spec} />}
        {spec.diagramType === 'genetic_diagram' && <GeneticDiagram spec={spec} />}
        {spec.diagramType === 'energy_level_diagram' && <EnergyLevelDiagram spec={spec} />}
        {spec.diagramType === 'food_web' && <FoodWebDiagram spec={spec} />}
        {spec.diagramType === 'energy_pyramid' && <EnergyPyramidDiagram spec={spec} />}
        {spec.diagramType === 'flowchart' && <FlowchartDiagram spec={spec} />}
      </div>
    </div>
  )
}
