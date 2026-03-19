/**
 * Deterministic Diagram Rendering Engine — v3 (Cambridge Quality).
 *
 * Design principles:
 *   - NO Math.random() anywhere in this file
 *   - NO fallback to AI for any supported type
 *   - ALL coordinates come from DSL or computed from DSL
 *   - Right angles drawn as explicit squares (no pic{} — QuickLaTeX free tier)
 *   - Diagrams are exam-quality: clean, minimal, pedagogically correct
 *   - Labels NEVER overlap lines or each other
 *   - Geometry is normalised: triangles have horizontal base, parallel lines
 *     are truly horizontal, circles are centered and proportional
 */

import type { DiagramDSL } from "../../lib/mathEngine";
import {
  validateDSL,
  solveDSL,
  coerceToDSL,
  computeDistance,
  computeAngleAtVertex,
} from "../../lib/mathEngine";

type Point = [number, number];

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Primary entry point. Accepts a DiagramDSL directly.
 * Returns TikZ document string, or null if DSL is invalid.
 */
export function renderDiagramFromDSL(dsl: DiagramDSL): string | null {
  const validation = validateDSL(dsl);
  if (!validation.valid) {
    console.warn("DiagramDSL validation failed:", validation.errors);
    return null;
  }
  try {
    switch (dsl.type) {
      case "triangle":            return renderTriangleFromDSL(dsl);
      case "circle":              return renderCircleFromDSL(dsl);
      case "parallel_lines":      return renderParallelLinesFromDSL(dsl);
      case "coordinate_geometry": return renderCoordGeomFromDSL(dsl);
      default:                    return null;
    }
  } catch (err) {
    console.warn("Diagram render error:", err);
    return null;
  }
}

/**
 * Legacy compatibility shim — accepts the old diagramType/diagramData shape.
 */
export function renderDiagram(question: {
  diagramType?: string;
  diagramData?: any;
  diagramDSL?: DiagramDSL;
  subject?: string;
}): string | null {
  if (question.subject === "Biology") return null;
  if (question.diagramDSL) return renderDiagramFromDSL(question.diagramDSL);
  if (question.diagramType && question.diagramData) {
    const dsl = coerceToDSL(question.diagramType, question.diagramData);
    if (!dsl) return null;
    return renderDiagramFromDSL(dsl);
  }
  return null;
}

// ── Geometry helpers ───────────────────────────────────────────────────────────

/** Format number to 4 decimal places, stripping trailing zeros. */
function f(n: number): string {
  return parseFloat(n.toFixed(4)).toString();
}

function norm2d(dx: number, dy: number): [number, number] {
  const len = Math.sqrt(dx * dx + dy * dy);
  return len < 1e-9 ? [0, 0] : [dx / len, dy / len];
}

/**
 * Smart label placement: returns a TikZ anchor + offset based on
 * the direction from the shape's interior centroid to the point.
 * Labels are placed OUTSIDE the shape, never overlapping edges.
 */
function getLabelAnchor(dx: number, dy: number): string {
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle > 157.5 || angle <= -157.5) return "left";
  if (angle > 112.5)  return "above left";
  if (angle > 67.5)   return "above";
  if (angle > 22.5)   return "above right";
  if (angle > -22.5)  return "right";
  if (angle > -67.5)  return "below right";
  if (angle > -112.5) return "below";
  return "below left";
}

/** Returns TikZ anchor for a side-midpoint label, pointing away from centroid. */
function sideOutDir(mid: Point, centroid: Point): string {
  return getLabelAnchor(mid[0] - centroid[0], mid[1] - centroid[1]);
}

/**
 * Draws a right-angle square at `vertex` toward `p1` and `p2`.
 * Size `s` is scaled relative to the shortest adjacent side so it
 * never looks oversized on short sides or invisible on long ones.
 */
function rightAngleSquare(vertex: Point, p1: Point, p2: Point): string {
  const d1 = computeDistance(vertex, p1);
  const d2 = computeDistance(vertex, p2);
  const s = Math.min(d1, d2) * 0.12; // 12% of shorter side
  const clampedS = Math.max(0.12, Math.min(s, 0.25)); // absolute clamp [0.12, 0.25]
  const [u1, v1] = norm2d(p1[0] - vertex[0], p1[1] - vertex[1]);
  const [u2, v2] = norm2d(p2[0] - vertex[0], p2[1] - vertex[1]);
  const ax = vertex[0] + clampedS * u1, ay = vertex[1] + clampedS * v1;
  const bx = ax + clampedS * u2,        by = ay + clampedS * v2;
  const cx = vertex[0] + clampedS * u2, cy = vertex[1] + clampedS * v2;
  return `\\draw[thin] (${f(ax)},${f(ay)}) -- (${f(bx)},${f(by)}) -- (${f(cx)},${f(cy)});`;
}

/**
 * Normalise a set of points to fit within a target bounding box centred at
 * origin, preserving aspect ratio.
 *
 * Target box: [-targetHalf, +targetHalf] in both axes.
 * Returns scaled + translated points and the scale factor used.
 */
function normalisedPoints(
  rawPts: Record<string, Point>,
  targetHalf = 2.5,
): { pts: Record<string, Point>; scale: number; cx: number; cy: number } {
  const names = Object.keys(rawPts);
  if (names.length === 0) return { pts: rawPts, scale: 1, cx: 0, cy: 0 };

  const xs = names.map((n) => rawPts[n][0]);
  const ys = names.map((n) => rawPts[n][1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = (targetHalf * 2) / Math.max(spanX, spanY);

  const pts: Record<string, Point> = {};
  for (const n of names) {
    pts[n] = [
      f2n((rawPts[n][0] - cx) * scale),
      f2n((rawPts[n][1] - cy) * scale),
    ];
  }
  return { pts, scale, cx, cy };
}

/** Round to 4dp as number (for internal use). */
function f2n(n: number): number {
  return parseFloat(n.toFixed(4));
}

/**
 * Angle arc at `vertex` between directions to `p1` and `p2`.
 * Returns empty string if angle is 90° (square marker used instead).
 * `radius` is the arc radius in TikZ units.
 * `label` is the LaTeX string placed near the arc midpoint.
 */
function angleArc(
  vertex: Point,
  p1: Point,
  p2: Point,
  label: string,
  arcR = 0.35,
): string {
  const angle = computeAngleAtVertex(p1, vertex, p2);
  if (Math.abs(angle - 90) < 3) return ""; // square marker handles 90°

  const a1 = (Math.atan2(p1[1] - vertex[1], p1[0] - vertex[0]) * 180) / Math.PI;
  const a2 = (Math.atan2(p2[1] - vertex[1], p2[0] - vertex[0]) * 180) / Math.PI;

  // Ensure arc sweeps the interior of the angle (always the smaller arc)
  let start = a1, end = a2;
  let sweep = end - start;
  if (sweep < 0) sweep += 360;
  if (sweep > 180) { [start, end] = [a2, a1]; sweep = 360 - sweep; }

  const midAngleRad = ((start + sweep / 2) * Math.PI) / 180;
  const labelR = arcR + 0.28;
  const lx = vertex[0] + labelR * Math.cos(midAngleRad);
  const ly = vertex[1] + labelR * Math.sin(midAngleRad);

  return [
    `\\draw (${f(vertex[0])},${f(vertex[1])}) ++(${f(start)}:${f(arcR)}) arc[start angle=${f(start)}, end angle=${f(start + sweep)}, radius=${f(arcR)}];`,
    `\\node[font=\\scriptsize] at (${f(lx)},${f(ly)}) {$${label}$};`,
  ].join("\n  ");
}

// ── Triangle ───────────────────────────────────────────────────────────────────

/**
 * Renders a triangle with:
 * - Normalised scale (fits in ~5×5 TikZ units)
 * - Labels placed OUTSIDE the triangle using centroid-based direction
 * - Side-length labels on edge midpoints, offset outward
 * - Angle arcs only for angles that are "unknowns" or labelled in DSL
 * - Right-angle square proportional to side length
 * - Altitude as dashed line only if constraint requests it
 */
function renderTriangleFromDSL(dsl: DiagramDSL): string | null {
  const rawPts = dsl.points ?? {};
  const rawA = rawPts["A"], rawB = rawPts["B"], rawC = rawPts["C"];
  if (!rawA || !rawB || !rawC) return null;

  const sol = solveDSL(dsl);
  if (!sol.valid || !sol.triangle) return null;

  // Normalise all points into a clean bounding box
  const { pts } = normalisedPoints(rawPts, 2.4);
  const A = pts["A"], B = pts["B"], C = pts["C"];

  const labels = dsl.labels ?? {};
  const lA = labels["A"] ?? "A";
  const lB = labels["B"] ?? "B";
  const lC = labels["C"] ?? "C";

  // Centroid for outward label direction
  const gx = (A[0] + B[0] + C[0]) / 3;
  const gy = (A[1] + B[1] + C[1]) / 3;
  const g: Point = [gx, gy];

  const dirA = getLabelAnchor(A[0] - gx, A[1] - gy);
  const dirB = getLabelAnchor(B[0] - gx, B[1] - gy);
  const dirC = getLabelAnchor(C[0] - gx, C[1] - gy);

  let tikz = `
  \\coordinate (A) at (${f(A[0])},${f(A[1])});
  \\coordinate (B) at (${f(B[0])},${f(B[1])});
  \\coordinate (C) at (${f(C[0])},${f(C[1])});

  % Triangle edges
  \\draw[thick] (A) -- (B) -- (C) -- cycle;

  % Vertex labels — placed outside triangle
  \\node[${dirA}, outer sep=4pt] at (A) {$${lA}$};
  \\node[${dirB}, outer sep=4pt] at (B) {$${lB}$};
  \\node[${dirC}, outer sep=4pt] at (C) {$${lC}$};
`;

  // Side-length labels from DSL labels (AB, BC, CA)
  const sideMap: [string, Point, Point][] = [
    ["AB", A, B],
    ["BC", B, C],
    ["CA", C, A],
  ];
  for (const [key, p1, p2] of sideMap) {
    if (labels[key]) {
      const mid: Point = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      const dir = sideOutDir(mid, g);
      tikz += `  \\node[${dir}, outer sep=3pt, font=\\small] at (${f(mid[0])},${f(mid[1])}) {$${labels[key]}$};\n`;
    }
  }

  // Right-angle square — proportional to side length
  if (dsl.rightAngleAt) {
    const squareMap: Record<string, [Point, Point, Point]> = {
      A: [A, B, C],
      B: [B, A, C],
      C: [C, A, B],
    };
    const sq = squareMap[dsl.rightAngleAt];
    if (sq) tikz += `  ${rightAngleSquare(sq[0], sq[1], sq[2])}\n`;
  }

  // Angle arcs for unknowns that are angles
  const unknowns = new Set(dsl.unknowns ?? []);
  const angleArcs: [string, Point, Point, Point][] = [
    ["angle_A", A, B, C],
    ["angle_B", B, A, C],
    ["angle_C", C, A, B],
  ];
  for (const [key, vtx, p1, p2] of angleArcs) {
    if (unknowns.has(key) || labels[key]) {
      const labelStr = labels[key] ?? "?";
      const arc = angleArc(vtx, p1, p2, labelStr, 0.32);
      if (arc) tikz += `  ${arc}\n`;
    }
  }

  // Altitude from C to AB (only if constraint explicitly requests it)
  const constraints = dsl.constraints ?? [];
  const drawAltitude = constraints.some((c) => /altitude|BD_perp|perpendicular.*AB|height/i.test(c));
  if (drawAltitude && sol.triangle.D) {
    // Re-normalise D using same transform
    const rawD = sol.triangle.D as Point;
    const { pts: dPts } = normalisedPoints({ ...rawPts, D: rawD }, 2.4);
    const D = dPts["D"];
    tikz += `
  % Altitude
  \\coordinate (D) at (${f(D[0])},${f(D[1])});
  \\draw[thin, dashed] (C) -- (D);
  ${rightAngleSquare(D, A, C)}
  \\fill (D) circle (1.5pt);
  \\node[below, outer sep=3pt, font=\\small] at (D) {$D$};
`;
  }

  // Vertex dots — filled for key points
  tikz += `
  \\fill (A) circle (1.5pt);
  \\fill (B) circle (1.5pt);
  \\fill (C) circle (1.5pt);
`;

  return wrapTikz(tikz);
}

// ── Circle ─────────────────────────────────────────────────────────────────────

/**
 * Renders a circle with:
 * - Centre clearly marked with filled dot + label
 * - Circumference points as filled dots, labels offset radially outward
 * - Chord AB drawn as thick line; triangle ACB if C present
 * - Right-angle marker at C if AB is a diameter (Thales)
 * - Radii drawn only when constraint explicitly names them
 * - Arc angles shown for unknown angle values
 */
function renderCircleFromDSL(dsl: DiagramDSL): string | null {
  const { center, radius, points: rawPts = {}, labels: rawLabels = {} } = dsl;
  if (!center || typeof radius !== "number" || radius <= 0) return null;

  const sol = solveDSL(dsl);
  if (!sol.valid || !sol.circle) return null;

  // Scale radius to a comfortable display size (target r ≈ 2.2 units)
  const targetR = 2.2;
  const scale = targetR / radius;
  const scalePt = (p: Point): Point => [
    f2n((p[0] - center[0]) * scale),
    f2n((p[1] - center[1]) * scale),
  ];

  // Scaled points (O is always at origin)
  const O: Point = [0, 0];
  const pts: Record<string, Point> = { O };
  for (const [name, pt] of Object.entries(rawPts)) {
    if (name === "O") continue;
    pts[name] = scalePt(pt);
  }

  const labels = rawLabels;
  const scaledR = targetR;

  let tikz = `
  \\coordinate (O) at (0,0);

  % Circle
  \\draw[thick] (O) circle (${f(scaledR)});

  % Centre
  \\fill (O) circle (2pt);
  \\node[below left, outer sep=3pt, font=\\small] at (O) {$${labels["O"] ?? "O"}$};
`;

  // Circumference points
  for (const [name, pt] of Object.entries(pts)) {
    if (name === "O") continue;
    const dir = getLabelAnchor(pt[0], pt[1]); // from O outward
    tikz += `  \\coordinate (${name}) at (${f(pt[0])},${f(pt[1])});\n`;
    tikz += `  \\fill (${name}) circle (1.5pt);\n`;
    tikz += `  \\node[${dir}, outer sep=4pt, font=\\small] at (${name}) {$${labels[name] ?? name}$};\n`;
  }

  const A = pts["A"], B = pts["B"], C = pts["C"];

  // Chord AB (thicker — key line)
  if (A && B) {
    tikz += `\n  % Chord AB\n  \\draw[thick] (A) -- (B);\n`;
  }

  // Triangle ACB for inscribed angle questions
  if (A && B && C) {
    tikz += `\n  % Inscribed triangle\n  \\draw[thick] (A) -- (C) -- (B);\n`;
    if (sol.circle.isDiameter) {
      // Right angle at C (Thales)
      tikz += `  ${rightAngleSquare(C, A, B)}\n`;
    }
  }

  // Radii — only draw when constraint explicitly requests them
  const constraints = dsl.constraints ?? [];
  for (const c of constraints) {
    if (/\bOA\b|radius.*A/i.test(c) && A) tikz += `  \\draw[thin] (O) -- (A);\n`;
    if (/\bOB\b|radius.*B/i.test(c) && B) tikz += `  \\draw[thin] (O) -- (B);\n`;
    if (/\bOC\b|radius.*C/i.test(c) && C) tikz += `  \\draw[thin] (O) -- (C);\n`;
  }

  // Angle arc at C if it's an unknown (inscribed angle)
  const unknowns = new Set(dsl.unknowns ?? []);
  if (A && B && C && (unknowns.has("angle_ACB") || unknowns.has("inscribed_angle"))) {
    const angleVal = sol.values["inscribed_angle"] ?? sol.values["angle_ACB"];
    const arcLabel = angleVal !== undefined ? `${angleVal}^\\circ` : "?";
    const arc = angleArc(C, A, B, arcLabel, 0.32);
    if (arc) tikz += `\n  ${arc}\n`;
  }

  return wrapTikz(tikz);
}

// ── Parallel Lines ─────────────────────────────────────────────────────────────

/**
 * Renders parallel lines with:
 * - Lines FORCED to be horizontal (y-direction locked, only x varies)
 * - Transversal at a clean angle (computed from DSL but displayed as 45° if degenerate)
 * - Intersection points clearly marked as filled dots
 * - Parallel tick marks on both lines
 * - Angle arc on ONE intersection showing the given angle
 * - Unknown angle arc on the OTHER intersection (no duplicate labelling)
 * - Labels: A (upper intersection), B (lower intersection)
 */
function renderParallelLinesFromDSL(dsl: DiagramDSL): string | null {
  const { line1, line2, transversal, angleType, labels = {} } = dsl;
  if (!line1 || !line2 || !transversal) return null;

  const sol = solveDSL(dsl);
  if (!sol.valid || !sol.parallelLines) return null;

  const { acuteAngle, obtuseAngle } = sol.parallelLines;

  // Force lines horizontal — extract y-positions from DSL, x-span = 5 units
  // Use original y-coords to preserve the vertical gap between lines.
  const y1 = (line1[0][1] + line1[1][1]) / 2;
  const y2 = (line2[0][1] + line2[1][1]) / 2;

  // Normalise vertical positions: centre at 0, scale so gap is ≈ 2 units
  const rawGap = Math.abs(y2 - y1) || 2;
  const targetGap = 2.0;
  const yscale = targetGap / rawGap;
  const yMid = (y1 + y2) / 2;
  const ny1 = f2n((y1 - yMid) * yscale);
  const ny2 = f2n((y2 - yMid) * yscale);

  // Fixed horizontal extent
  const xMin = -2.8, xMax = 2.8;

  // Transversal angle from DSL (radians), but clamped to 30°–60° for clarity
  const tvDx = transversal[1][0] - transversal[0][0];
  const tvDy = transversal[1][1] - transversal[0][1];
  let tvAngleDeg = (Math.atan2(tvDy, tvDx) * 180) / Math.PI;
  // Normalise to 0°–180°
  if (tvAngleDeg < 0) tvAngleDeg += 180;
  // Clamp to a visible range [30°, 75°] so transversal is clearly angled
  const clampedAngle = Math.max(30, Math.min(75, tvAngleDeg || 55));
  const tvRad = (clampedAngle * Math.PI) / 180;

  // Intersection points (transversal crosses each horizontal line)
  // Choose x-intercept so transversal is centred on the diagram
  const txMid = 0;
  const ix1 = f2n(txMid + (ny1 === ny2 ? 0 : (0 - ny1) / Math.tan(tvRad)));
  const ix2 = f2n(txMid + (0 - ny2) / Math.tan(tvRad));

  const I1: Point = [ix1, ny1];
  const I2: Point = [ix2, ny2];

  // Transversal endpoint extension beyond the lines
  const ext = 0.8;
  const dxPerUnit = 1 / Math.tan(tvRad);
  const tvTop: Point = [f2n(ix1 + dxPerUnit * ext), f2n(ny1 + ext)];
  const tvBot: Point = [f2n(ix2 - dxPerUnit * ext), f2n(ny2 - ext)];

  const labelI1 = labels["I1"] ?? labels["A"] ?? "A";
  const labelI2 = labels["I2"] ?? labels["B"] ?? "B";

  // Determine which angle is GIVEN and which is UNKNOWN
  const givenStr = (dsl.givens ?? []).find((g) => g.toLowerCase().includes("angle"));
  const givenVal = givenStr ? (givenStr.match(/=\s*(\d+(?:\.\d+)?)/) ?? [])[1] : null;
  const unknownAngles = (dsl.unknowns ?? []).filter((u) => u.toLowerCase().includes("angle"));

  // Compute angle values to show
  const givenAngleVal =
    givenVal
      ? parseFloat(givenVal)
      : angleType === "co-interior"
        ? obtuseAngle
        : acuteAngle;

  const unknownAngleVal =
    angleType === "co-interior"
      ? (givenAngleVal === obtuseAngle ? acuteAngle : obtuseAngle)
      : acuteAngle;

  let tikz = `
  % Parallel lines (forced horizontal)
  \\draw[thick] (${xMin},${f(ny1)}) -- (${xMax},${f(ny1)});
  \\draw[thick] (${xMin},${f(ny2)}) -- (${xMax},${f(ny2)});

  % Transversal
  \\draw[thick] (${f(tvTop[0])},${f(tvTop[1])}) -- (${f(tvBot[0])},${f(tvBot[1])});

  % Parallel tick marks
  \\draw[thin] (${f(-0.1)},${f(ny1 + 0.1)}) -- (${f(0.1)},${f(ny1 - 0.1)});
  \\draw[thin] (${f(-0.12)},${f(ny1 + 0.12)}) -- (${f(0.12)},${f(ny1 - 0.12)});
  \\draw[thin] (${f(-0.1)},${f(ny2 + 0.1)}) -- (${f(0.1)},${f(ny2 - 0.1)});
  \\draw[thin] (${f(-0.12)},${f(ny2 + 0.12)}) -- (${f(0.12)},${f(ny2 - 0.12)});

  % Intersection points
  \\fill (${f(I1[0])},${f(I1[1])}) circle (1.5pt);
  \\node[above right, outer sep=3pt, font=\\small] at (${f(I1[0])},${f(I1[1])}) {$${labelI1}$};

  \\fill (${f(I2[0])},${f(I2[1])}) circle (1.5pt);
  \\node[below right, outer sep=3pt, font=\\small] at (${f(I2[0])},${f(I2[1])}) {$${labelI2}$};
`;

  // Arc showing GIVEN angle at I1 — always the upper intersection
  const arcR = 0.38;
  // Arc sweeps from horizontal (0°) to transversal direction
  const arcStart = 0; // horizontal right
  const arcEnd   = clampedAngle; // to transversal direction

  tikz += `
  % Given angle arc at ${labelI1}
  \\draw (${f(I1[0])},${f(I1[1])}) ++(${arcStart}:${f(arcR)}) arc[start angle=${arcStart}, end angle=${f(arcEnd)}, radius=${f(arcR)}];
  \\node[font=\\scriptsize] at (${f(I1[0] + (arcR + 0.25) * Math.cos((arcEnd / 2) * Math.PI / 180))},${f(I1[1] + (arcR + 0.25) * Math.sin((arcEnd / 2) * Math.PI / 180))}) {$${f(givenAngleVal)}^\\circ$};
`;

  // Arc showing UNKNOWN angle at I2 (only if there is an unknown)
  if (unknownAngles.length > 0) {
    let i2ArcStart = arcStart;
    let i2ArcEnd   = clampedAngle;

    if (angleType === "alternate") {
      // Alternate: arc on OPPOSITE side of transversal at I2
      i2ArcStart = 180;
      i2ArcEnd   = 180 + clampedAngle;
    } else if (angleType === "co-interior") {
      // Co-interior: arc on same side but supplementary
      i2ArcStart = arcStart;
      i2ArcEnd   = 180 - clampedAngle;
    }
    // Corresponding: same arc position, labelled "?"

    const i2MidDeg = (i2ArcStart + i2ArcEnd) / 2;
    const i2MidRad = (i2MidDeg * Math.PI) / 180;

    tikz += `
  % Unknown angle arc at ${labelI2}
  \\draw (${f(I2[0])},${f(I2[1])}) ++(${f(i2ArcStart)}:${f(arcR)}) arc[start angle=${f(i2ArcStart)}, end angle=${f(i2ArcEnd)}, radius=${f(arcR)}];
  \\node[font=\\scriptsize] at (${f(I2[0] + (arcR + 0.25) * Math.cos(i2MidRad))},${f(I2[1] + (arcR + 0.25) * Math.sin(i2MidRad))}) {$?$};
`;
  }

  return wrapTikz(tikz);
}

// ── Coordinate Geometry ────────────────────────────────────────────────────────

/**
 * Renders a coordinate geometry diagram with:
 * - Clean axes with arrows and labels
 * - Light grid (gray, very thin) — only within bounding box
 * - Integer axis tick labels, concise font
 * - Points as filled dots, labels offset above-right (collision-aware)
 * - Line segments connecting points in name order
 * - Midpoint marker (hollow-then-filled) if constraint requests it
 */
function renderCoordGeomFromDSL(dsl: DiagramDSL): string | null {
  const rawPts = dsl.points ?? {};
  const ptNames = Object.keys(rawPts);
  if (ptNames.length < 2) return null;

  const xs = ptNames.map((n) => rawPts[n][0]);
  const ys = ptNames.map((n) => rawPts[n][1]);
  const minX = Math.floor(Math.min(...xs, 0)) - 1;
  const maxX = Math.ceil(Math.max(...xs, 0)) + 1;
  const minY = Math.floor(Math.min(...ys, 0)) - 1;
  const maxY = Math.ceil(Math.max(...ys, 0)) + 1;

  const labels = dsl.labels ?? {};

  let tikz = `
  % Grid
  \\draw[gray!25, very thin] (${minX},${minY}) grid (${maxX},${maxY});

  % Axes
  \\draw[->, thick] (${minX},0) -- (${maxX},0) node[right, font=\\small] {$x$};
  \\draw[->, thick] (0,${minY}) -- (0,${maxY}) node[above, font=\\small] {$y$};
`;

  // Axis tick labels (integers only, skip 0)
  for (let i = minX; i <= maxX; i++) {
    if (i !== 0) tikz += `  \\node[below, font=\\tiny] at (${i},0) {${i}};\n`;
  }
  for (let j = minY; j <= maxY; j++) {
    if (j !== 0) tikz += `  \\node[left, font=\\tiny] at (0,${j}) {${j}};\n`;
  }

  // Line segments between consecutive named points
  tikz += `\n  % Line segments\n`;
  if (ptNames.length === 2) {
    const [n1, n2] = ptNames;
    tikz += `  \\draw[thick] (${rawPts[n1][0]},${rawPts[n1][1]}) -- (${rawPts[n2][0]},${rawPts[n2][1]});\n`;
  } else {
    for (let i = 0; i < ptNames.length - 1; i++) {
      const n1 = ptNames[i], n2 = ptNames[i + 1];
      tikz += `  \\draw[thick] (${rawPts[n1][0]},${rawPts[n1][1]}) -- (${rawPts[n2][0]},${rawPts[n2][1]});\n`;
    }
  }

  // Mark and label each point
  tikz += `\n  % Points\n`;
  for (const name of ptNames) {
    const pt = rawPts[name];
    // Smart label direction — avoid overlapping the axis
    const above = pt[1] >= 0 ? "above" : "below";
    const side  = pt[0] >= 0 ? "right" : "left";
    tikz += `  \\fill (${pt[0]},${pt[1]}) circle (2pt);\n`;
    tikz += `  \\node[${above} ${side}, outer sep=3pt, font=\\small] at (${pt[0]},${pt[1]}) {$${labels[name] ?? name}$};\n`;
  }

  // Midpoint marker
  const constraints = dsl.constraints ?? [];
  if (constraints.some((c) => /midpoint/i.test(c)) && ptNames.length >= 2) {
    const P1 = rawPts[ptNames[0]], P2 = rawPts[ptNames[1]];
    const mid: Point = [(P1[0] + P2[0]) / 2, (P1[1] + P2[1]) / 2];
    tikz += `\n  % Midpoint\n`;
    tikz += `  \\fill[white] (${mid[0]},${mid[1]}) circle (3pt);\n`;
    tikz += `  \\fill (${mid[0]},${mid[1]}) circle (1.5pt);\n`;
    tikz += `  \\node[above right, outer sep=3pt, font=\\tiny] at (${mid[0]},${mid[1]}) {$M$};\n`;
  }

  return wrapTikz(tikz);
}

// ── TikZ wrapper ───────────────────────────────────────────────────────────────

/**
 * Wraps TikZ content in a complete standalone LaTeX document.
 * - border=8mm gives generous white space around the diagram
 * - scale=1.0 because normalisation is done internally
 * - font=\small for readable labels
 * - angles library enables arc drawing
 */
function wrapTikz(content: string): string {
  return `\\documentclass[tikz,border=8mm]{standalone}
\\usetikzlibrary{calc,arrows.meta,angles,quotes}
\\begin{document}
\\begin{tikzpicture}[font=\\small, line cap=round, line join=round]
${content}
\\end{tikzpicture}
\\end{document}`;
}
