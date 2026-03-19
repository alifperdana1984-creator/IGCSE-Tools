/**
 * Deterministic Diagram Rendering Engine.
 *
 * Takes structured JSON data and produces exact, mathematically correct TikZ code.
 * Replaces AI-guessing with deterministic logic.
 */

type TuplePoint = [number, number];

interface TriangleData {
  A: TuplePoint;
  B: TuplePoint;
  C: TuplePoint;
  rightAngleAt?: "A" | "B" | "C";
  labels?: {
    A?: string;
    B?: string;
    C?: string;
    AB?: string; // side label between A and B
    BC?: string; // side label between B and C
    CA?: string; // side label between C and A
  };
}

interface CircleData {
  center: TuplePoint;
  radius: number;
  A: TuplePoint;
  B: TuplePoint; // Diameter endpoints
  C: TuplePoint; // Point on circumference
  labels?: { A?: string; B?: string; C?: string; O?: string };
}

interface ParallelLinesData {
  line1: [TuplePoint, TuplePoint];
  line2: [TuplePoint, TuplePoint];
  transversal: [TuplePoint, TuplePoint];
  labels?: Record<string, string>;
  angleType?: "corresponding" | "alternate" | "co-interior";
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
    const type = question.diagramType.toLowerCase().replace(/_/g, " ");
    switch (type) {
      case "triangle":
      case "geometry": // Handle AI alias
        return renderTriangle(question.diagramData);

      case "circle":
      case "circle geometry":
        return renderCircle(question.diagramData);

      case "parallel lines":
      case "parallel lines geometry":
        return renderParallelLines(question.diagramData);

      case "right triangle":
      case "right_triangle":
        return renderTriangle(question.diagramData);

      case "isosceles triangle":
      case "isosceles_triangle":
        return renderTriangle(question.diagramData);

      case "sector":
        // Sector requires AI generation — fall through
        return null;

      default:
        // Unknown type, fallback to AI generation
        return null;
    }
  } catch (err) {
    console.warn(
      `Deterministic diagram render failed (${question.diagramType}):`,
      err,
    );
    return null;
  }
}

function getIntersection(
  l1: [TuplePoint, TuplePoint],
  l2: [TuplePoint, TuplePoint]
): TuplePoint | null {
  const [p1, p2] = l1;
  const [p3, p4] = l2;

  const x1 = p1[0], y1 = p1[1], x2 = p2[0], y2 = p2[1];
  const x3 = p3[0], y3 = p3[1], x4 = p4[0], y4 = p4[1];

  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (Math.abs(denom) < 1e-6) return null; // Parallel

  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  return [x1 + ua * (x2 - x1), y1 + ua * (y2 - y1)];
}

function renderTriangle(data: TriangleData): string | null {
  const { A, B, C, rightAngleAt, labels } = data;

  if (!validatePoint(A) || !validatePoint(B) || !validatePoint(C)) {
    return null;
  }

  if (!validateTriangle(A, B, C, rightAngleAt)) {
    return null;
  }

  // Compute centroid to derive outward label directions for each vertex
  const gx = (A[0] + B[0] + C[0]) / 3;
  const gy = (A[1] + B[1] + C[1]) / 3;
  const dirA = tikzLabelDir(A[0] - gx, A[1] - gy);
  const dirB = tikzLabelDir(B[0] - gx, B[1] - gy);
  const dirC = tikzLabelDir(C[0] - gx, C[1] - gy);

  let tikz = `
  \\coordinate (A) at (${A[0]},${A[1]});
  \\coordinate (B) at (${B[0]},${B[1]});
  \\coordinate (C) at (${C[0]},${C[1]});

  \\draw[thick] (A) -- (B) -- (C) -- cycle;

  \\node[${dirA}] at (A) {$${labels?.A ?? "A"}$};
  \\node[${dirB}] at (B) {$${labels?.B ?? "B"}$};
  \\node[${dirC}] at (C) {$${labels?.C ?? "C"}$};
`;

  // Optional side length labels placed outward from centroid
  const g: TuplePoint = [gx, gy];
  if (labels?.AB) {
    const mid: TuplePoint = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
    tikz += `  \\node[${sideOutDir(mid, g)}] at (${mid[0]},${mid[1]}) {$${labels.AB}$};\n`;
  }
  if (labels?.BC) {
    const mid: TuplePoint = [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2];
    tikz += `  \\node[${sideOutDir(mid, g)}] at (${mid[0]},${mid[1]}) {$${labels.BC}$};\n`;
  }
  if (labels?.CA) {
    const mid: TuplePoint = [(C[0] + A[0]) / 2, (C[1] + A[1]) / 2];
    tikz += `  \\node[${sideOutDir(mid, g)}] at (${mid[0]},${mid[1]}) {$${labels.CA}$};\n`;
  }

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

function renderCircle(data: CircleData): string | null {
  const { center, radius, A, B, C, labels } = data;

  if (
    !validatePoint(center) ||
    !validatePoint(A) ||
    !validatePoint(B) ||
    !validatePoint(C)
  )
    return null;
  if (typeof radius !== "number" || radius <= 0) return null;
  if (!validateCircle(data)) return null;

  // Derive C label direction from center → C vector
  const dirC = tikzLabelDir(C[0] - center[0], C[1] - center[1]);

  let tikz = `
  \\coordinate (O) at (${center[0]},${center[1]});
  \\coordinate (A) at (${A[0]},${A[1]});
  \\coordinate (B) at (${B[0]},${B[1]});
  \\coordinate (C) at (${C[0]},${C[1]});

  \\draw[thick] (O) circle (${radius});
  \\draw[thick] (A) -- (B) node[midway, below] {}; % Diameter line
  \\draw[thick] (A) -- (C) -- (B); % Triangle

  \\fill (O) circle (1.5pt);
  \\node[below right] at (O) {$${labels?.O ?? "O"}$};
  \\node[left] at (A) {$${labels?.A ?? "A"}$};
  \\node[right] at (B) {$${labels?.B ?? "B"}$};
  \\node[${dirC}] at (C) {$${labels?.C ?? "C"}$};
`;

  // Thales' theorem: if AB is diameter, C is always 90 degrees
  if (isDiameter(A, B, center, radius)) {
    tikz += `  \\draw pic[draw, angle radius=3mm] {right angle = A--C--B};\n`;
  }

  return wrapTikz(tikz);
}

function renderParallelLines(data: ParallelLinesData): string | null {
  const { line1, line2, transversal, labels, angleType } = data;

  if (
    !validateLine(line1) ||
    !validateLine(line2) ||
    !validateLine(transversal)
  )
    return null;
  if (!validateParallel(line1, line2)) {
    console.warn("ParallelLines validation failed: Lines are not parallel.");
    return null;
  }

  const [p1, p2] = line1;
  const [p3, p4] = line2;
  const [t1, t2] = transversal;

  // Calculate intersections
  const int1 = getIntersection(line1, transversal);
  const int2 = getIntersection(line2, transversal);

  // Draw lines with arrows to indicate parallel nature
  let tikz = `
  \\draw[thick, <->] (${p1[0]},${p1[1]}) -- (${p2[0]},${p2[1]}) node[right] {};
  \\draw[thick, <->] (${p3[0]},${p3[1]}) -- (${p4[0]},${p4[1]}) node[right] {};
  \\draw[thick] (${t1[0]},${t1[1]}) -- (${t2[0]},${t2[1]});

  % Points
  ${int1 ? `\\coordinate (I1) at (${int1[0]},${int1[1]});` : ""}
  ${int2 ? `\\coordinate (I2) at (${int2[0]},${int2[1]});` : ""}

  ${int1 ? `\\fill (I1) circle (1.5pt) node[above right] {A};` : ""}
  ${int2 ? `\\fill (I2) circle (1.5pt) node[below right] {B};` : ""}

  % Angle Marking (geometry-derived)
  ${ (() => {
    if (!int1 || !int2) return "";

    // Compute the true acute angle between the transversal and line1
    const tvDx = t2[0] - t1[0];
    const tvDy = t2[1] - t1[1];
    const l1Dx = p2[0] - p1[0];
    const l1Dy = p2[1] - p1[1];
    const tvRad = Math.atan2(tvDy, tvDx);
    const l1Rad = Math.atan2(l1Dy, l1Dx);
    let angleDeg = Math.abs(((tvRad - l1Rad) * 180) / Math.PI);
    if (angleDeg > 180) angleDeg = 360 - angleDeg;
    if (angleDeg > 90) angleDeg = 180 - angleDeg;
    const angle = Math.round(angleDeg);
    if (angle < 1) return ""; // degenerate — skip arc

    // Default: mark one angle at the first intersection
    let code = `
    \\draw pic[draw, "${angle}^\\circ", angle eccentricity=1.5] {angle = I2--I1--${p2[0] > p1[0] ? `(${p2[0]},${p2[1]})` : `(${p1[0]},${p1[1]})`}};
    `;

    if (angleType === "corresponding") {
      // Same position relative to both intersections
      code += `\\draw pic[draw, "${angle}^\\circ", angle eccentricity=1.5] {angle = ${p2[0] > p1[0] ? `(${p4[0]},${p4[1]})` : `(${p3[0]},${p3[1]})`}--I2--I1};`;
    }
    else if (angleType === "alternate") {
      // Z-pattern (opposite side)
      code += `\\draw pic[draw, "${angle}^\\circ", angle eccentricity=1.5] {angle = I1--I2--${p2[0] > p1[0] ? `(${p3[0]},${p3[1]})` : `(${p4[0]},${p4[1]})`}};`;
    }
    else if (angleType === "co-interior") {
      // C-pattern (same side interior, sum to 180°)
      const suppl = 180 - angle;
      code += `\\draw pic[draw, "${suppl}^\\circ", angle eccentricity=1.5] {angle = I1--I2--${p2[0] > p1[0] ? `(${p4[0]},${p4[1]})` : `(${p3[0]},${p3[1]})`}};`;
    }

    return code;
  })() }

  % Mark parallel arrows
  \\draw[>->, thick] ($(${p1[0]},${p1[1]})!0.5!(${p2[0]},${p2[1]})$) -- ++(0.1,0);
  \\draw[>->, thick] ($(${p3[0]},${p3[1]})!0.5!(${p4[0]},${p4[1]})$) -- ++(0.1,0);
`;

  return wrapTikz(tikz);
}

function validatePoint(p: any): p is [number, number] {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    typeof p[0] === "number" &&
    typeof p[1] === "number" &&
    !isNaN(p[0]) &&
    !isNaN(p[1])
  );
}

function validateLine(l: any): l is [TuplePoint, TuplePoint] {
  return (
    Array.isArray(l) &&
    l.length === 2 &&
    validatePoint(l[0]) &&
    validatePoint(l[1])
  );
}

const dist = (p1: TuplePoint, p2: TuplePoint) =>
  Math.sqrt(Math.pow(p2[0] - p1[0], 2) + Math.pow(p2[1] - p1[1], 2));

/** Maps a direction vector to a TikZ anchor string (8-sector compass). */
function tikzLabelDir(dx: number, dy: number): string {
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI; // -180 to 180
  if (angle > 157.5 || angle <= -157.5) return "left";
  if (angle > 112.5) return "above left";
  if (angle > 67.5)  return "above";
  if (angle > 22.5)  return "above right";
  if (angle > -22.5) return "right";
  if (angle > -67.5) return "below right";
  if (angle > -112.5) return "below";
  return "below left";
}

/** Returns the TikZ anchor for a side label, pointing outward from the centroid. */
function sideOutDir(mid: TuplePoint, g: TuplePoint): string {
  return tikzLabelDir(mid[0] - g[0], mid[1] - g[1]);
}

function validateTriangle(
  A: TuplePoint,
  B: TuplePoint,
  C: TuplePoint,
  rightAngleAt?: string,
): boolean {
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
    let u: TuplePoint, v: TuplePoint;
    if (rightAngleAt === "A") {
      u = [B[0] - A[0], B[1] - A[1]];
      v = [C[0] - A[0], C[1] - A[1]];
    } else if (rightAngleAt === "B") {
      u = [A[0] - B[0], A[1] - B[1]];
      v = [C[0] - B[0], C[1] - B[1]];
    } else if (rightAngleAt === "C") {
      u = [A[0] - C[0], A[1] - C[1]];
      v = [B[0] - C[0], B[1] - C[1]];
    } else return true; // Ignore invalid label

    // Dot product should be close to 0
    const dot = u[0] * v[0] + u[1] * v[1];
    if (Math.abs(dot) > 1e-3) {
      console.warn(
        `Triangle validation failed: Angle at ${rightAngleAt} is not 90 degrees (dot=${dot}).`,
      );
      return false;
    }
  }

  return true;
}

function validateCircle(data: CircleData): boolean {
  const { center, radius, A, B, C } = data;
  const tolerance = 1e-2;

  // 1. Points on circle?
  if (Math.abs(dist(center, A) - radius) > tolerance) return false;
  if (Math.abs(dist(center, B) - radius) > tolerance) return false;
  if (Math.abs(dist(center, C) - radius) > tolerance) return false;

  // 2. Is AB a diameter? (Center must be midpoint of AB)
  if (!isDiameter(A, B, center, radius)) {
    console.warn("Circle validation: A and B do not form a valid diameter.");
  }

  return true;
}

function isDiameter(
  A: TuplePoint,
  B: TuplePoint,
  center: TuplePoint,
  radius: number,
): boolean {
  const midpoint: TuplePoint = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  return (
    dist(midpoint, center) < 1e-3 && Math.abs(dist(A, B) - 2 * radius) < 1e-2
  );
}

function validateParallel(
  l1: [TuplePoint, TuplePoint],
  l2: [TuplePoint, TuplePoint],
): boolean {
  const slope1 = (l1[1][1] - l1[0][1]) / (l1[1][0] - l1[0][0]);
  const slope2 = (l2[1][1] - l2[0][1]) / (l2[1][0] - l2[0][0]);

  // Handle vertical lines
  if (!isFinite(slope1) && !isFinite(slope2)) return true;

  return Math.abs(slope1 - slope2) < 1e-3;
}

function wrapTikz(content: string): string {
  return `\\documentclass[tikz,border=4mm]{standalone}
\\usetikzlibrary{calc,angles,quotes,arrows.meta,patterns}
\\begin{document}
\\begin{tikzpicture}[scale=0.8, every node/.style={scale=0.9}]
${content}
\\end{tikzpicture}
\\end{document}`;
}
