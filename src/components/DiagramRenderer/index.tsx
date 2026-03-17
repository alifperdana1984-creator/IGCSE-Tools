import React from 'react'
import type {
  DiagramSpec, CartesianGridSpec, GeometricShapeSpec, NumberLineSpec, BarChartSpec,
} from '../../lib/types'

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

// ── Main export ──────────────────────────────────────────────────────────────

export function DiagramRenderer({ spec }: { spec: DiagramSpec | undefined | null }) {
  if (!spec) return null
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
      </div>
    </div>
  )
}
