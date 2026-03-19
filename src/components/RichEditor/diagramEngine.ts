/**
 * Deterministic Diagram Rendering Engine.
 *
 * Takes structured JSON data and produces exact, mathematically correct TikZ code.
 * Replaces AI-guessing with deterministic logic.
 */

interface Point {
  x: number;
  y: number;
}

interface TriangleData {
  A: [number, number];
  B: [number, number];
  C: [number, number];
  rightAngleAt?: "A" | "B" | "C";
  labels?: { A?: string; B?: string; C?: string };
}

export function renderDiagram(question: {
  diagramType?: string;
  diagramData?: any;
  subject?: string;
}): string | null {
  if (!question.diagramData || !question.diagramType) return null;

  // Subject-aware routing
  if (question.subject === "Biology") {
    // Biology requires complex organic drawings, force AI
    return null;
  }

  try {
    switch (question.diagramType.toLowerCase()) {
      case "triangle":
      case "geometry": // Handle AI alias
        return renderTriangle(question.diagramData);

      // Future deterministic renderers (e.g., 'graph', 'number_line') can be added here

      default:
        // If type is unknown, return null to fallback to AI generation
        return null;
    }
  } catch (err) {
    console.warn("Deterministic diagram render failed:", err);
    return null;
  }
}

function renderTriangle(data: TriangleData): string | null {
  const { A, B, C, rightAngleAt, labels } = data;

  if (!validatePoint(A) || !validatePoint(B) || !validatePoint(C)) {
    return null;
  }

  if (!validateTriangle(A, B, C, rightAngleAt)) {
    return null;
  }

  // Calculate centroids or midpoints if needed for labeling, but standard positioning works for now.

  // Construct TikZ
  // We use the 'standalone' class for consistent rendering pipeline compatibility
  let tikz = `
  \\coordinate (A) at (${A[0]},${A[1]});
  \\coordinate (B) at (${B[0]},${B[1]});
  \\coordinate (C) at (${C[0]},${C[1]});

  \\draw[thick] (A) -- (B) -- (C) -- cycle;

  \\node[above left] at (A) {$${labels?.A ?? "A"}$};
  \\node[below left] at (B) {$${labels?.B ?? "B"}$};
  \\node[below right] at (C) {$${labels?.C ?? "C"}$};
`;

  if (rightAngleAt) {
    let anglePath = "";
    if (rightAngleAt === "A") anglePath = "C--A--B";
    if (rightAngleAt === "B") anglePath = "A--B--C";
    if (rightAngleAt === "C") anglePath = "B--C--A";

    if (anglePath) {
      tikz += `  \\draw pic[draw, angle radius=3mm] {right angle = ${anglePath}};\n`;
    }
  }

  return wrapTikz(tikz);
}

function validatePoint(p: any): p is [number, number] {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    typeof p[0] === "number" &&
    typeof p[1] === "number"
  );
}

function validateTriangle(
  A: [number, number],
  B: [number, number],
  C: [number, number],
  rightAngleAt?: string
): boolean {
  const dist = (p1: [number, number], p2: [number, number]) =>
    Math.sqrt(Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2));

  const ab = dist(A, B);
  const bc = dist(B, C);
  const ac = dist(A, C);

  // 1. Check distances (basic existence and non-degenerate check)
  if (ab < 1e-6 || bc < 1e-6 || ac < 1e-6) {
    console.warn("Triangle validation failed: Side length too small/zero.");
    return false;
  }

  // 2. Verify right angle if asserted
  if (rightAngleAt) {
    let u: [number, number], v: [number, number];
    if (rightAngleAt === "A") { u = [B[0]-A[0], B[1]-A[1]]; v = [C[0]-A[0], C[1]-A[1]]; }
    else if (rightAngleAt === "B") { u = [A[0]-B[0], A[1]-B[1]]; v = [C[0]-B[0], C[1]-B[1]]; }
    else if (rightAngleAt === "C") { u = [A[0]-C[0], A[1]-C[1]]; v = [B[0]-C[0], B[1]-C[1]]; }
    else return true; // Ignore invalid label

    // Dot product should be close to 0
    const dot = u[0] * v[0] + u[1] * v[1];
    if (Math.abs(dot) > 1e-3) {
      console.warn(`Triangle validation failed: Angle at ${rightAngleAt} is not 90 degrees (dot=${dot}).`);
      return false;
    }
  }

  return true;
}

function wrapTikz(content: string): string {
  return `\\documentclass[tikz,border=4mm]{standalone}
\\usetikzlibrary{calc,angles,quotes}
\\begin{document}
\\begin{tikzpicture}[scale=0.8, every node/.style={scale=0.9}]
${content}
\\end{tikzpicture}
\\end{document}`;
}
