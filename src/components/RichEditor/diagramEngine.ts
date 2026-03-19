/**
 * Deterministic Diagram Rendering Engine — v2.
 *
 * Single source of truth: DiagramDSL (never AI coordinates).
 * All geometry is computed via mathEngine before rendering.
 *
 * Rules:
 *   - NO Math.random() anywhere in this file
 *   - NO fallback to AI for any supported type
 *   - ALL coordinates come from DSL or are computed from DSL
 *   - Right angles drawn as explicit squares (no pic{} — QuickLaTeX free tier)
 *   - Renders ALL constraints: perpendicular markers, parallel ticks, altitude lines
 */

import type { DiagramDSL } from "../../lib/mathEngine";
import {
  validateDSL,
  solveDSL,
  coerceToDSL,
  computeDistance,
  computeLineIntersection,
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
      case "triangle":       return renderTriangleFromDSL(dsl);
      case "circle":         return renderCircleFromDSL(dsl);
      case "parallel_lines": return renderParallelLinesFromDSL(dsl);
      case "coordinate_geometry": return renderCoordGeomFromDSL(dsl);
      default:               return null;
    }
  } catch (err) {
    console.warn("Diagram render error:", err);
    return null;
  }
}

/**
 * Legacy compatibility shim — accepts the old diagramType/diagramData shape.
 * Coerces to DSL, validates, then delegates to renderDiagramFromDSL.
 * Returns null for Biology or unknown types.
 */
export function renderDiagram(question: {
  diagramType?: string;
  diagramData?: any;
  diagramDSL?: DiagramDSL;
  subject?: string;
}): string | null {
  // Biology requires complex organic drawings — no deterministic renderer
  if (question.subject === "Biology") return null;

  // Prefer explicit DSL if provided
  if (question.diagramDSL) {
    return renderDiagramFromDSL(question.diagramDSL);
  }

  // Coerce legacy diagramData → DSL
  if (question.diagramType && question.diagramData) {
    const dsl = coerceToDSL(question.diagramType, question.diagramData);
    if (!dsl) return null;
    return renderDiagramFromDSL(dsl);
  }

  return null;
}

// ── Triangle ───────────────────────────────────────────────────────────────────

function renderTriangleFromDSL(dsl: DiagramDSL): string | null {
  const pts = dsl.points ?? {};
  const A = pts["A"], B = pts["B"], C = pts["C"];
  if (!A || !B || !C) return null;

  const sol = solveDSL(dsl);
  if (!sol.valid) return null;

  const g: Point = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3];
  const dirA = tikzLabelDir(A[0] - g[0], A[1] - g[1]);
  const dirB = tikzLabelDir(B[0] - g[0], B[1] - g[1]);
  const dirC = tikzLabelDir(C[0] - g[0], C[1] - g[1]);

  const labels = dsl.labels ?? {};
  const lA = labels["A"] ?? "A";
  const lB = labels["B"] ?? "B";
  const lC = labels["C"] ?? "C";

  let tikz = `
  \\coordinate (A) at (${A[0]},${A[1]});
  \\coordinate (B) at (${B[0]},${B[1]});
  \\coordinate (C) at (${C[0]},${C[1]});

  \\draw[thick] (A) -- (B) -- (C) -- cycle;

  \\node[${dirA}, outer sep=3pt] at (A) {$${lA}$};
  \\node[${dirB}, outer sep=3pt] at (B) {$${lB}$};
  \\node[${dirC}, outer sep=3pt] at (C) {$${lC}$};
`;

  // Side length labels from DSL labels
  if (labels["AB"]) {
    const mid: Point = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    tikz += `  \\node[${sideOutDir(mid, g)}, outer sep=2pt] at (${f(mid[0])},${f(mid[1])}) {$${labels["AB"]}$};\n`;
  }
  if (labels["BC"]) {
    const mid: Point = [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2];
    tikz += `  \\node[${sideOutDir(mid, g)}, outer sep=2pt] at (${f(mid[0])},${f(mid[1])}) {$${labels["BC"]}$};\n`;
  }
  if (labels["CA"]) {
    const mid: Point = [(C[0] + A[0]) / 2, (C[1] + A[1]) / 2];
    tikz += `  \\node[${sideOutDir(mid, g)}, outer sep=2pt] at (${f(mid[0])},${f(mid[1])}) {$${labels["CA"]}$};\n`;
  }

  // Right-angle square — ONLY if coordinates actually satisfy the 90° constraint
  if (dsl.rightAngleAt) {
    let sq = "";
    if (dsl.rightAngleAt === "A") sq = rightAngleSquare(A, B, C);
    else if (dsl.rightAngleAt === "B") sq = rightAngleSquare(B, A, C);
    else if (dsl.rightAngleAt === "C") sq = rightAngleSquare(C, A, B);
    if (sq) tikz += `  ${sq}\n`;
  }

  // Altitude from C to AB (if BD_perpendicular_AC or altitude constraint)
  const constraints = dsl.constraints ?? [];
  const drawAltitude =
    constraints.some((c) => /altitude|BD_perp|perpendicular.*AC|height/i.test(c));
  if (drawAltitude && sol.triangle?.D) {
    const D = sol.triangle.D;
    tikz += `  \\coordinate (D) at (${f(D[0])},${f(D[1])});\n`;
    tikz += `  \\draw[thin,dashed] (C) -- (D);\n`;
    tikz += `  ${rightAngleSquare(D, A, C)}\n`;
    tikz += `  \\fill (D) circle (1.5pt);\n`;
    tikz += `  \\node[below, outer sep=2pt] at (D) {$D$};\n`;
  }

  return wrapTikz(tikz);
}

// ── Circle ─────────────────────────────────────────────────────────────────────

function renderCircleFromDSL(dsl: DiagramDSL): string | null {
  const { center, radius, points: pts = {}, labels: labels_ = {} } = dsl;
  if (!center || typeof radius !== "number" || radius <= 0) return null;

  const sol = solveDSL(dsl);
  if (!sol.valid) return null;

  const labels = labels_;
  let tikz = `
  \\coordinate (O) at (${center[0]},${center[1]});
  \\draw[thick] (O) circle (${radius});
  \\fill (O) circle (1.5pt);
  \\node[below, outer sep=2pt] at (O) {$${labels["O"] ?? "O"}$};
`;

  // Draw and label all circumference points
  for (const [name, pt] of Object.entries(pts)) {
    if (name === "O") continue;
    const dir = tikzLabelDir(pt[0] - center[0], pt[1] - center[1]);
    tikz += `  \\coordinate (${name}) at (${pt[0]},${pt[1]});\n`;
    tikz += `  \\fill (${name}) circle (1.5pt);\n`;
    tikz += `  \\node[${dir}, outer sep=3pt] at (${name}) {$${labels[name] ?? name}$};\n`;
  }

  // Draw chord AB (diameter if applicable)
  const A = pts["A"], B = pts["B"], C = pts["C"];
  if (A && B) {
    tikz += `  \\draw[thick] (A) -- (B);\n`;
  }
  // Draw triangle ACB (inscribed angle)
  if (A && B && C) {
    tikz += `  \\draw[thick] (A) -- (C) -- (B);\n`;
    // Right angle at C if AB is diameter (Thales' theorem)
    if (sol.circle?.isDiameter) {
      tikz += `  ${rightAngleSquare(C, A, B)}\n`;
    }
  }

  // Draw radii for any constraints
  const constraints = dsl.constraints ?? [];
  for (const c of constraints) {
    if (/OA|radius.*A/i.test(c) && A) tikz += `  \\draw[thin] (O) -- (A);\n`;
    if (/OB|radius.*B/i.test(c) && B) tikz += `  \\draw[thin] (O) -- (B);\n`;
    if (/OC|radius.*C/i.test(c) && C) tikz += `  \\draw[thin] (O) -- (C);\n`;
  }

  return wrapTikz(tikz);
}

// ── Parallel Lines ─────────────────────────────────────────────────────────────

function renderParallelLinesFromDSL(dsl: DiagramDSL): string | null {
  const { line1, line2, transversal, angleType, labels = {} } = dsl;
  if (!line1 || !line2 || !transversal) return null;

  const sol = solveDSL(dsl);
  if (!sol.valid || !sol.parallelLines) return null;

  const [p1, p2] = line1;
  const [p3, p4] = line2;
  const [t1, t2] = transversal;
  const { acuteAngle, obtuseAngle } = sol.parallelLines;
  const int1 = sol.parallelLines.intersection1;
  const int2 = sol.parallelLines.intersection2;

  const l1Dx = p2[0] - p1[0], l1Dy = p2[1] - p1[1];
  const mid1: Point = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const mid2: Point = [(p3[0] + p4[0]) / 2, (p3[1] + p4[1]) / 2];
  const l1len = Math.sqrt(l1Dx * l1Dx + l1Dy * l1Dy);
  const nx = (-l1Dy / l1len) * 0.15;
  const ny = (l1Dx / l1len) * 0.15;

  let tikz = `
  \\draw[thick] (${p1[0]},${p1[1]}) -- (${p2[0]},${p2[1]});
  \\draw[thick] (${p3[0]},${p3[1]}) -- (${p4[0]},${p4[1]});
  \\draw[thick] (${t1[0]},${t1[1]}) -- (${t2[0]},${t2[1]});
`;

  // Parallel tick marks
  tikz += `  \\draw[thin] (${f(mid1[0] + nx)},${f(mid1[1] + ny)}) -- (${f(mid1[0] - nx)},${f(mid1[1] - ny)});\n`;
  tikz += `  \\draw[thin] (${f(mid2[0] + nx)},${f(mid2[1] + ny)}) -- (${f(mid2[0] - nx)},${f(mid2[1] - ny)});\n`;

  const labelI1 = labels["I1"] ?? labels["A"] ?? "A";
  const labelI2 = labels["I2"] ?? labels["B"] ?? "B";

  if (int1) {
    tikz += `  \\fill (${f(int1[0])},${f(int1[1])}) circle (1.5pt);\n`;
    tikz += `  \\node[above right, outer sep=2pt] at (${f(int1[0])},${f(int1[1])}) {$${labelI1}$};\n`;
  }
  if (int2) {
    tikz += `  \\fill (${f(int2[0])},${f(int2[1])}) circle (1.5pt);\n`;
    tikz += `  \\node[below right, outer sep=2pt] at (${f(int2[0])},${f(int2[1])}) {$${labelI2}$};\n`;
  }

  // Angle arcs — computed values only (no AI guessing)
  const tvDx = t2[0] - t1[0], tvDy = t2[1] - t1[1];
  const startDeg = (Math.atan2(tvDy, tvDx) * 180) / Math.PI;

  if (int1 && acuteAngle >= 1) {
    tikz += `  \\draw (${f(int1[0])},${f(int1[1])}) ++(${f(startDeg)}:0.3) arc[start angle=${f(startDeg)}, end angle=${f(startDeg + acuteAngle)}, radius=0.3];\n`;
    tikz += `  \\node at (${f(int1[0] + 0.5 * Math.cos((startDeg + acuteAngle / 2) * Math.PI / 180))},${f(int1[1] + 0.5 * Math.sin((startDeg + acuteAngle / 2) * Math.PI / 180))}) {\\small $${acuteAngle}^\\circ$};\n`;

    if (int2) {
      if (angleType === "corresponding") {
        tikz += `  \\draw (${f(int2[0])},${f(int2[1])}) ++(${f(startDeg)}:0.3) arc[start angle=${f(startDeg)}, end angle=${f(startDeg + acuteAngle)}, radius=0.3];\n`;
        tikz += `  \\node at (${f(int2[0] + 0.5 * Math.cos((startDeg + acuteAngle / 2) * Math.PI / 180))},${f(int2[1] + 0.5 * Math.sin((startDeg + acuteAngle / 2) * Math.PI / 180))}) {\\small $${acuteAngle}^\\circ$};\n`;
      } else if (angleType === "alternate") {
        const altStart = startDeg + 180;
        tikz += `  \\draw (${f(int2[0])},${f(int2[1])}) ++(${f(altStart)}:0.3) arc[start angle=${f(altStart)}, end angle=${f(altStart + acuteAngle)}, radius=0.3];\n`;
        tikz += `  \\node at (${f(int2[0] + 0.5 * Math.cos((altStart + acuteAngle / 2) * Math.PI / 180))},${f(int2[1] + 0.5 * Math.sin((altStart + acuteAngle / 2) * Math.PI / 180))}) {\\small $${acuteAngle}^\\circ$};\n`;
      } else if (angleType === "co-interior") {
        tikz += `  \\draw (${f(int2[0])},${f(int2[1])}) ++(${f(startDeg)}:0.3) arc[start angle=${f(startDeg)}, end angle=${f(startDeg - obtuseAngle)}, radius=0.3];\n`;
        tikz += `  \\node at (${f(int2[0] + 0.5 * Math.cos((startDeg - obtuseAngle / 2) * Math.PI / 180))},${f(int2[1] + 0.5 * Math.sin((startDeg - obtuseAngle / 2) * Math.PI / 180))}) {\\small $${obtuseAngle}^\\circ$};\n`;
      }
    }
  }

  return wrapTikz(tikz);
}

// ── Coordinate Geometry ────────────────────────────────────────────────────────

function renderCoordGeomFromDSL(dsl: DiagramDSL): string | null {
  const pts = dsl.points ?? {};
  const ptNames = Object.keys(pts);
  if (ptNames.length < 2) return null;

  // Determine bounding box for axes
  const xs = ptNames.map((n) => pts[n][0]);
  const ys = ptNames.map((n) => pts[n][1]);
  const minX = Math.floor(Math.min(...xs)) - 1;
  const maxX = Math.ceil(Math.max(...xs)) + 1;
  const minY = Math.floor(Math.min(...ys)) - 1;
  const maxY = Math.ceil(Math.max(...ys)) + 1;

  let tikz = `
  \\draw[->] (${minX},0) -- (${maxX},0) node[right] {$x$};
  \\draw[->] (0,${minY}) -- (0,${maxY}) node[above] {$y$};
`;

  // Grid lines (light)
  tikz += `  \\draw[gray!30, very thin] (${minX},${minY}) grid (${maxX},${maxY});\n`;

  // Axis labels
  for (let i = minX + 1; i < maxX; i++) {
    if (i !== 0) tikz += `  \\node[below, font=\\tiny] at (${i},0) {${i}};\n`;
  }
  for (let j = minY + 1; j < maxY; j++) {
    if (j !== 0) tikz += `  \\node[left, font=\\tiny] at (0,${j}) {${j}};\n`;
  }

  // Connect points in order and label them
  if (ptNames.length === 2) {
    const [n1, n2] = ptNames;
    tikz += `  \\draw[thick] (${pts[n1][0]},${pts[n1][1]}) -- (${pts[n2][0]},${pts[n2][1]});\n`;
  } else {
    for (let i = 0; i < ptNames.length - 1; i++) {
      const n1 = ptNames[i], n2 = ptNames[i + 1];
      tikz += `  \\draw[thick] (${pts[n1][0]},${pts[n1][1]}) -- (${pts[n2][0]},${pts[n2][1]});\n`;
    }
  }

  // Mark and label each point
  const labels = dsl.labels ?? {};
  for (const name of ptNames) {
    const pt = pts[name];
    tikz += `  \\fill (${pt[0]},${pt[1]}) circle (2pt);\n`;
    tikz += `  \\node[above right, outer sep=2pt] at (${pt[0]},${pt[1]}) {$${labels[name] ?? name}$};\n`;
  }

  // Midpoint marker if requested
  const constraints = dsl.constraints ?? [];
  if (constraints.some((c) => /midpoint/i.test(c)) && ptNames.length >= 2) {
    const A = pts[ptNames[0]], B = pts[ptNames[1]];
    const mid: Point = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    tikz += `  \\fill[white] (${mid[0]},${mid[1]}) circle (2.5pt);\n`;
    tikz += `  \\fill (${mid[0]},${mid[1]}) circle (1.5pt);\n`;
    tikz += `  \\node[above right, outer sep=2pt, font=\\tiny] at (${mid[0]},${mid[1]}) {M};\n`;
  }

  return wrapTikz(tikz);
}

// ── Geometry helpers ───────────────────────────────────────────────────────────

/** Maps direction vector to TikZ anchor (8-sector compass). */
function tikzLabelDir(dx: number, dy: number): string {
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angle > 157.5 || angle <= -157.5) return "left";
  if (angle > 112.5) return "above left";
  if (angle > 67.5) return "above";
  if (angle > 22.5) return "above right";
  if (angle > -22.5) return "right";
  if (angle > -67.5) return "below right";
  if (angle > -112.5) return "below";
  return "below left";
}

/** Returns TikZ anchor for a side label, pointing outward from centroid. */
function sideOutDir(mid: Point, g: Point): string {
  return tikzLabelDir(mid[0] - g[0], mid[1] - g[1]);
}

/**
 * Draws a right-angle square at `vertex` in the corner formed by
 * unit vectors toward `p1` and `p2`. Size = `s` TikZ units.
 * Uses only \draw (no pic), compatible with QuickLaTeX free tier.
 */
function rightAngleSquare(vertex: Point, p1: Point, p2: Point, s = 0.18): string {
  const norm = (dx: number, dy: number): [number, number] => {
    const len = Math.sqrt(dx * dx + dy * dy);
    return len < 1e-9 ? [0, 0] : [dx / len, dy / len];
  };
  const [u1, v1] = norm(p1[0] - vertex[0], p1[1] - vertex[1]);
  const [u2, v2] = norm(p2[0] - vertex[0], p2[1] - vertex[1]);
  const ax = vertex[0] + s * u1, ay = vertex[1] + s * v1;
  const bx = ax + s * u2, by = ay + s * v2;
  const cx = vertex[0] + s * u2, cy = vertex[1] + s * v2;
  return `\\draw[thin] (${f(ax)},${f(ay)}) -- (${f(bx)},${f(by)}) -- (${f(cx)},${f(cy)});`;
}

// ── TikZ wrapper ───────────────────────────────────────────────────────────────

function wrapTikz(content: string): string {
  return `\\documentclass[tikz,border=6mm]{standalone}
\\usetikzlibrary{calc,arrows.meta}
\\begin{document}
\\begin{tikzpicture}[scale=1.2, font=\\small]
${content}
\\end{tikzpicture}
\\end{document}`;
}

/** Format number to 4 decimal places, stripping trailing zeros. */
function f(n: number): string {
  return parseFloat(n.toFixed(4)).toString();
}
