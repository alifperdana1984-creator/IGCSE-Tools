/**
 * Deterministic Math Engine for IGCSE Assessment Generation.
 *
 * ALL geometry computation happens here — never in AI.
 * AI is ONLY allowed to write question wording.
 *
 * This module is the single source of truth for:
 *   - coordinate geometry
 *   - triangle solving
 *   - circle geometry
 *   - parallel line angle relationships
 *   - DSL validation
 */

export type Point = [number, number];

// ── Core geometric primitives ──────────────────────────────────────────────────

export function computeDistance(A: Point, B: Point): number {
  return Math.sqrt((B[0] - A[0]) ** 2 + (B[1] - A[1]) ** 2);
}

export function computeMidpoint(A: Point, B: Point): Point {
  return [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
}

export function computeSlope(A: Point, B: Point): number | null {
  const dx = B[0] - A[0];
  if (Math.abs(dx) < 1e-9) return null; // vertical line
  return (B[1] - A[1]) / dx;
}

/**
 * Angle at vertex B in the triangle A-B-C, in degrees.
 */
export function computeAngleAtVertex(A: Point, B: Point, C: Point): number {
  const ux = A[0] - B[0];
  const uy = A[1] - B[1];
  const vx = C[0] - B[0];
  const vy = C[1] - B[1];
  const dot = ux * vx + uy * vy;
  const lenU = Math.sqrt(ux * ux + uy * uy);
  const lenV = Math.sqrt(vx * vx + vy * vy);
  if (lenU < 1e-9 || lenV < 1e-9) return 0;
  const cosVal = Math.max(-1, Math.min(1, dot / (lenU * lenV)));
  return (Math.acos(cosVal) * 180) / Math.PI;
}

export function isParallel(
  A: Point, B: Point,
  C: Point, D: Point,
  tolerance = 0.01,
): boolean {
  const dx1 = B[0] - A[0], dy1 = B[1] - A[1];
  const dx2 = D[0] - C[0], dy2 = D[1] - C[1];
  const cross = Math.abs(dx1 * dy2 - dy1 * dx2);
  const scale = Math.max(
    Math.sqrt(dx1 * dx1 + dy1 * dy1) * Math.sqrt(dx2 * dx2 + dy2 * dy2),
    1e-9,
  );
  return cross / scale < tolerance;
}

export function isPerpendicular(
  A: Point, B: Point,
  C: Point, D: Point,
  tolerance = 0.05,
): boolean {
  const dx1 = B[0] - A[0], dy1 = B[1] - A[1];
  const dx2 = D[0] - C[0], dy2 = D[1] - C[1];
  const dot = Math.abs(dx1 * dx2 + dy1 * dy2);
  const scale = Math.sqrt(dx1 * dx1 + dy1 * dy1) * Math.sqrt(dx2 * dx2 + dy2 * dy2);
  return scale > 1e-9 && dot / scale < tolerance;
}

/** Foot of perpendicular from P onto line AB. */
export function projectPointOntoLine(P: Point, A: Point, B: Point): Point {
  const dx = B[0] - A[0], dy = B[1] - A[1];
  const t = ((P[0] - A[0]) * dx + (P[1] - A[1]) * dy) / (dx * dx + dy * dy);
  return [A[0] + t * dx, A[1] + t * dy];
}

export function computeLineIntersection(
  A: Point, B: Point,
  C: Point, D: Point,
): Point | null {
  const x1 = A[0], y1 = A[1], x2 = B[0], y2 = B[1];
  const x3 = C[0], y3 = C[1], x4 = D[0], y4 = D[1];
  const denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
  if (Math.abs(denom) < 1e-9) return null;
  const ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
  return [x1 + ua * (x2 - x1), y1 + ua * (y2 - y1)];
}

// ── Triangle solver ────────────────────────────────────────────────────────────

export interface TriangleSolution {
  AB: number;
  BC: number;
  CA: number;
  angleA: number;
  angleB: number;
  angleC: number;
  area: number;
  perimeter: number;
  altitudeFromC?: number; // foot of altitude from C to AB (for BD problems)
  D?: Point;              // foot of altitude if BD⊥AC constraint
}

export function solveTriangle(A: Point, B: Point, C: Point): TriangleSolution {
  const AB = computeDistance(A, B);
  const BC = computeDistance(B, C);
  const CA = computeDistance(C, A);
  const angleA = computeAngleAtVertex(B, A, C);
  const angleB = computeAngleAtVertex(A, B, C);
  const angleC = computeAngleAtVertex(A, C, B);
  const area = Math.abs(
    (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]),
  ) / 2;
  // Foot of altitude from C to AB
  const D = projectPointOntoLine(C, A, B);
  const altitudeFromC = computeDistance(C, D);
  return {
    AB, BC, CA,
    angleA, angleB, angleC,
    area,
    perimeter: AB + BC + CA,
    altitudeFromC,
    D,
  };
}

// ── Circle solver ──────────────────────────────────────────────────────────────

export interface CircleSolution {
  radius: number;
  diameter: number;
  circumference: number;
  area: number;
  /** Angle subtended by arc AB at centre O */
  centralAngle?: number;
  /** Angle subtended by AB at circumference point C (inscribed angle theorem) */
  inscribedAngle?: number;
  isDiameter: boolean;
}

export function solveCircle(
  center: Point,
  radius: number,
  A?: Point,
  B?: Point,
  C?: Point,
): CircleSolution {
  const result: CircleSolution = {
    radius,
    diameter: 2 * radius,
    circumference: 2 * Math.PI * radius,
    area: Math.PI * radius * radius,
    isDiameter: false,
  };
  if (A && B) {
    // Check if AB is a diameter
    const mid = computeMidpoint(A, B);
    const distMidCenter = computeDistance(mid, center);
    result.isDiameter = distMidCenter < radius * 0.05 &&
      Math.abs(computeDistance(A, B) - 2 * radius) < radius * 0.05;
    result.centralAngle = computeAngleAtVertex(A, center, B);
  }
  if (A && B && C) {
    result.inscribedAngle = computeAngleAtVertex(A, C, B);
  }
  return result;
}

// ── Parallel lines solver ──────────────────────────────────────────────────────

export interface ParallelLinesSolution {
  acuteAngle: number;       // angle between transversal and line1
  obtuseAngle: number;      // supplement
  correspondingAngle: number;
  alternateAngle: number;
  coInteriorAngle: number;
  intersection1?: Point;
  intersection2?: Point;
}

export function solveParallelLines(
  line1: [Point, Point],
  line2: [Point, Point],
  transversal: [Point, Point],
): ParallelLinesSolution {
  const int1 = computeLineIntersection(line1[0], line1[1], transversal[0], transversal[1]);
  const int2 = computeLineIntersection(line2[0], line2[1], transversal[0], transversal[1]);

  const dx1 = line1[1][0] - line1[0][0], dy1 = line1[1][1] - line1[0][1];
  const dxt = transversal[1][0] - transversal[0][0], dyt = transversal[1][1] - transversal[0][1];
  const tvRad = Math.atan2(dyt, dxt);
  const l1Rad = Math.atan2(dy1, dx1);
  let angleDeg = Math.abs(((tvRad - l1Rad) * 180) / Math.PI);
  if (angleDeg > 180) angleDeg = 360 - angleDeg;
  if (angleDeg > 90) angleDeg = 180 - angleDeg;
  const acuteAngle = Math.round(angleDeg * 100) / 100;
  const obtuseAngle = Math.round((180 - acuteAngle) * 100) / 100;

  return {
    acuteAngle,
    obtuseAngle,
    correspondingAngle: acuteAngle,
    alternateAngle: acuteAngle,
    coInteriorAngle: obtuseAngle,
    intersection1: int1 ?? undefined,
    intersection2: int2 ?? undefined,
  };
}

// ── Coordinate geometry ────────────────────────────────────────────────────────

export interface CoordGeomSolution {
  length: number;
  midpoint: Point;
  slope: number | null;
  /** Slope of perpendicular bisector */
  perpBisectorSlope: number | null;
  angle: number; // angle with x-axis in degrees
}

export function solveCoordinateGeometry(A: Point, B: Point): CoordGeomSolution {
  const length = computeDistance(A, B);
  const midpoint = computeMidpoint(A, B);
  const slope = computeSlope(A, B);
  let perpBisectorSlope: number | null = null;
  if (slope === null) {
    perpBisectorSlope = 0; // perpendicular to vertical is horizontal
  } else if (Math.abs(slope) < 1e-9) {
    perpBisectorSlope = null; // perpendicular to horizontal is vertical
  } else {
    perpBisectorSlope = -1 / slope;
  }
  const angle = (Math.atan2(B[1] - A[1], B[0] - A[0]) * 180) / Math.PI;
  return { length, midpoint, slope, perpBisectorSlope, angle };
}

// ── DSL Definition ─────────────────────────────────────────────────────────────

export type DiagramType =
  | "triangle"
  | "circle"
  | "parallel_lines"
  | "coordinate_geometry";

export interface DiagramDSL {
  type: DiagramType;
  points?: Record<string, Point>;
  constraints?: string[];
  givens?: string[];
  unknowns?: string[];
  // type-specific fields
  rightAngleAt?: "A" | "B" | "C";
  center?: Point;
  radius?: number;
  line1?: [Point, Point];
  line2?: [Point, Point];
  transversal?: [Point, Point];
  angleType?: "corresponding" | "alternate" | "co-interior";
  labels?: Record<string, string>;
}

// ── DSL Validation ─────────────────────────────────────────────────────────────

export interface DSLValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validateDSL(dsl: DiagramDSL): DSLValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!dsl || typeof dsl !== "object") {
    return { valid: false, errors: ["DSL is null or not an object."], warnings };
  }

  const validTypes: DiagramType[] = ["triangle", "circle", "parallel_lines", "coordinate_geometry"];
  if (!validTypes.includes(dsl.type)) {
    errors.push(`Unknown diagram type: "${dsl.type}". Must be one of: ${validTypes.join(", ")}`);
    return { valid: false, errors, warnings };
  }

  const pts = dsl.points ?? {};

  switch (dsl.type) {
    case "triangle": {
      const A = pts["A"], B = pts["B"], C = pts["C"];
      if (!isValidPoint(A)) errors.push("Triangle missing point A.");
      if (!isValidPoint(B)) errors.push("Triangle missing point B.");
      if (!isValidPoint(C)) errors.push("Triangle missing point C.");
      if (isValidPoint(A) && isValidPoint(B) && isValidPoint(C)) {
        const AB = computeDistance(A, B);
        const BC = computeDistance(B, C);
        const CA = computeDistance(C, A);
        // Triangle inequality
        if (AB + BC <= CA || AB + CA <= BC || BC + CA <= AB) {
          errors.push(`Triangle inequality violated: AB=${round(AB)}, BC=${round(BC)}, CA=${round(CA)}.`);
        }
        // Degenerate check
        if (AB < 1e-6 || BC < 1e-6 || CA < 1e-6) {
          errors.push("Triangle has degenerate side (length ≈ 0).");
        }
        // Right angle check
        if (dsl.rightAngleAt) {
          let u: Point, v: Point, vertex: Point;
          if (dsl.rightAngleAt === "A") { vertex = A; u = B; v = C; }
          else if (dsl.rightAngleAt === "B") { vertex = B; u = A; v = C; }
          else { vertex = C; u = A; v = B; }
          const angle = computeAngleAtVertex(u, vertex, v);
          if (Math.abs(angle - 90) > 5) {
            errors.push(`rightAngleAt="${dsl.rightAngleAt}" but actual angle is ${round(angle)}°. Coordinates must form a 90° angle.`);
          }
        }
      }
      break;
    }

    case "circle": {
      const center = dsl.center;
      const radius = dsl.radius;
      if (!isValidPoint(center)) errors.push("Circle missing center.");
      if (typeof radius !== "number" || radius <= 0) errors.push("Circle must have positive radius.");
      if (isValidPoint(center) && typeof radius === "number" && radius > 0) {
        // Validate any labelled points are on the circle
        for (const [name, pt] of Object.entries(pts)) {
          if (name === "O") continue;
          const d = computeDistance(center!, pt);
          if (Math.abs(d - radius) > radius * 0.08) {
            errors.push(`Point ${name} is not on the circle (distance=${round(d)}, radius=${round(radius)}).`);
          }
        }
        // Diameter check
        const A = pts["A"], B = pts["B"];
        if (isValidPoint(A) && isValidPoint(B)) {
          const mid = computeMidpoint(A, B);
          const midDist = computeDistance(mid, center!);
          if (midDist < radius * 0.05) {
            // AB appears to be a diameter — check length
            const AB = computeDistance(A, B);
            if (Math.abs(AB - 2 * radius) > radius * 0.05) {
              warnings.push(`AB looks like a diameter but |AB|=${round(AB)} ≠ 2r=${round(2 * radius)}.`);
            }
          }
        }
      }
      break;
    }

    case "parallel_lines": {
      if (!dsl.line1 || !isValidPoint(dsl.line1[0]) || !isValidPoint(dsl.line1[1])) {
        errors.push("parallel_lines missing valid line1.");
      }
      if (!dsl.line2 || !isValidPoint(dsl.line2[0]) || !isValidPoint(dsl.line2[1])) {
        errors.push("parallel_lines missing valid line2.");
      }
      if (!dsl.transversal || !isValidPoint(dsl.transversal[0]) || !isValidPoint(dsl.transversal[1])) {
        errors.push("parallel_lines missing valid transversal.");
      }
      if (dsl.line1 && dsl.line2 && isValidPoint(dsl.line1[0]) && isValidPoint(dsl.line2[0])) {
        if (!isParallel(dsl.line1[0], dsl.line1[1], dsl.line2[0], dsl.line2[1])) {
          errors.push("line1 and line2 are not parallel (cross product too large).");
        }
      }
      break;
    }

    case "coordinate_geometry": {
      if (Object.keys(pts).length < 2) {
        errors.push("coordinate_geometry needs at least 2 labelled points.");
      }
      break;
    }
  }

  if (!dsl.unknowns || dsl.unknowns.length === 0) {
    warnings.push("DSL has no 'unknowns' defined — question may not require computation.");
  }
  if (!dsl.givens || dsl.givens.length === 0) {
    warnings.push("DSL has no 'givens' defined — ensure question provides sufficient information.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

// ── Full DSL solve (returns computed values for answer generation) ─────────────

export interface DSLSolution {
  valid: boolean;
  errors: string[];
  values: Record<string, number | Point | string>;
  triangle?: TriangleSolution;
  circle?: CircleSolution;
  parallelLines?: ParallelLinesSolution;
  coordGeom?: CoordGeomSolution;
}

/**
 * Computes ALL values in the DSL deterministically.
 * Returns a flat map of named values that can be used to write question text and answers.
 */
export function solveDSL(dsl: DiagramDSL): DSLSolution {
  const validation = validateDSL(dsl);
  if (!validation.valid) {
    return { valid: false, errors: validation.errors, values: {} };
  }

  const values: Record<string, number | Point | string> = {};
  const pts = dsl.points ?? {};

  try {
    switch (dsl.type) {
      case "triangle": {
        const A = pts["A"], B = pts["B"], C = pts["C"];
        const sol = solveTriangle(A, B, C);
        values["AB"] = round(sol.AB);
        values["BC"] = round(sol.BC);
        values["CA"] = round(sol.CA);
        values["angle_A"] = round(sol.angleA);
        values["angle_B"] = round(sol.angleB);
        values["angle_C"] = round(sol.angleC);
        values["area"] = round(sol.area);
        values["perimeter"] = round(sol.perimeter);
        if (sol.D) values["D"] = [round(sol.D[0]), round(sol.D[1])];
        if (sol.altitudeFromC !== undefined) values["altitude_from_C"] = round(sol.altitudeFromC);
        return { valid: true, errors: [], values, triangle: sol };
      }

      case "circle": {
        const center = dsl.center!;
        const radius = dsl.radius!;
        const A = pts["A"], B = pts["B"], C = pts["C"];
        const sol = solveCircle(center, radius, A, B, C);
        values["radius"] = round(radius);
        values["diameter"] = round(sol.diameter);
        values["circumference"] = round(sol.circumference, 4);
        values["area"] = round(sol.area, 4);
        if (sol.centralAngle !== undefined) values["central_angle"] = round(sol.centralAngle);
        if (sol.inscribedAngle !== undefined) values["inscribed_angle"] = round(sol.inscribedAngle);
        values["is_diameter_AB"] = sol.isDiameter ? "true" : "false";
        return { valid: true, errors: [], values, circle: sol };
      }

      case "parallel_lines": {
        const sol = solveParallelLines(dsl.line1!, dsl.line2!, dsl.transversal!);
        values["acute_angle"] = sol.acuteAngle;
        values["obtuse_angle"] = sol.obtuseAngle;
        values["corresponding_angle"] = sol.correspondingAngle;
        values["alternate_angle"] = sol.alternateAngle;
        values["co_interior_angle"] = sol.coInteriorAngle;
        if (sol.intersection1) values["I1"] = sol.intersection1;
        if (sol.intersection2) values["I2"] = sol.intersection2;
        return { valid: true, errors: [], values, parallelLines: sol };
      }

      case "coordinate_geometry": {
        const ptNames = Object.keys(pts);
        if (ptNames.length >= 2) {
          const A = pts[ptNames[0]], B = pts[ptNames[1]];
          const sol = solveCoordinateGeometry(A, B);
          values["length"] = round(sol.length);
          values["midpoint"] = [round(sol.midpoint[0]), round(sol.midpoint[1])];
          values["slope"] = sol.slope !== null ? round(sol.slope) : "undefined";
          values["angle_with_x_axis"] = round(sol.angle);
          return { valid: true, errors: [], values, coordGeom: sol };
        }
        return { valid: true, errors: [], values };
      }
    }
  } catch (err) {
    return {
      valid: false,
      errors: [`Computation error: ${err instanceof Error ? err.message : String(err)}`],
      values,
    };
  }

  return { valid: true, errors: [], values };
}

// ── Mark scheme generation (deterministic — no AI) ────────────────────────────

/**
 * Generates a Cambridge-style mark scheme from the DSL and its solution.
 *
 * Rules:
 *   triangle  → Pythagoras / angle-sum / trigonometry steps
 *   circle    → theorem identification + application + answer
 *   parallel  → angle rule + application + answer
 *   coord_geom→ formula + substitution + answer
 *
 * Returns null only if the DSL is invalid or has no unknowns.
 */
export function generateMarkSchemeFromDSL(dsl: DiagramDSL): string | null {
  const sol = solveDSL(dsl);
  if (!sol.valid || (dsl.unknowns ?? []).length === 0) return null;

  const unknowns = dsl.unknowns!;
  const vals = sol.values;
  const lines: string[] = [];

  switch (dsl.type) {
    case "triangle": {
      const tri = sol.triangle!;
      const isRight = dsl.rightAngleAt !== undefined ||
        (dsl.constraints ?? []).some((c) => c.toLowerCase().includes("right_angle"));

      for (const u of unknowns) {
        if (u === "AC" || u === "BC" || u === "AB" || u === "CA") {
          if (isRight) {
            const given = dsl.givens ?? [];
            const side1 = given[0]?.match(/=(\d+(?:\.\d+)?)/)?.[1] ?? "a";
            const side2 = given[1]?.match(/=(\d+(?:\.\d+)?)/)?.[1] ?? "b";
            lines.push(`M1: Applies Pythagoras' theorem: $${u}^2 = ${side1}^2 + ${side2}^2$`);
            lines.push(`A1: Correct substitution`);
          } else {
            lines.push(`M1: Applies cosine rule or correct geometric method to find $${u}$`);
            lines.push(`A1: Correct substitution`);
          }
          const answer = vals[u];
          if (answer !== undefined) {
            lines.push(`A1: $${u} = ${answer}$ (accept ${u} = ${answer} cm or equivalent units)`);
          }
        } else if (u.startsWith("angle_")) {
          const vertex = u.replace("angle_", "");
          if (isRight) {
            lines.push(`B1: Identifies right angle at ${dsl.rightAngleAt ?? "vertex"}`);
            lines.push(`M1: Uses angle sum of triangle: angles sum to $180°$`);
          } else {
            lines.push(`M1: Applies sine rule or angle-sum property to find angle at $${vertex}$`);
          }
          const answer = vals[u];
          if (answer !== undefined) {
            lines.push(`A1: Angle $${vertex} = ${answer}°$`);
          }
        } else if (u === "area") {
          lines.push(`M1: Uses area formula $\\frac{1}{2} \\times base \\times height$ or $\\frac{1}{2}ab\\sin C$`);
          const answer = vals["area"];
          if (answer !== undefined) lines.push(`A1: Area $= ${answer}$ cm$^2$`);
        } else if (u === "perimeter") {
          lines.push(`M1: Sums all three sides correctly`);
          const answer = vals["perimeter"];
          if (answer !== undefined)
            lines.push(`A1: Perimeter $= ${answer}$ cm`);
        } else {
          lines.push(`M1: Identifies correct method for $${u}$`);
          const answer = vals[u];
          if (answer !== undefined) lines.push(`A1: $${u} = ${answer}$`);
        }
      }
      break;
    }

    case "circle": {
      const cir = sol.circle!;
      for (const u of unknowns) {
        if (u === "angle_ACB" || u === "inscribed_angle") {
          const isDiameter = cir.isDiameter;
          if (isDiameter) {
            lines.push(`B1: States angle in a semicircle $= 90°$ (Thales' theorem)`);
            lines.push(`A1: Angle $ACB = 90°$`);
          } else {
            lines.push(`B1: States inscribed angle theorem: inscribed angle $=$ half central angle`);
            const ang = vals["inscribed_angle"] ?? vals["central_angle"];
            if (ang !== undefined)
              lines.push(`A1: Angle $= ${ang}°$`);
          }
        } else if (u === "central_angle") {
          lines.push(`B1: Identifies central angle subtended by arc $AB$`);
          lines.push(`M1: Applies central angle formula`);
          const ang = vals["central_angle"];
          if (ang !== undefined) lines.push(`A1: Central angle $= ${ang}°$`);
        } else if (u === "circumference") {
          lines.push(`M1: Uses $C = 2\\pi r$ with $r = ${dsl.radius}$`);
          lines.push(`A1: $C = ${vals["circumference"]}$ cm (allow $2\\pi \\times ${dsl.radius}$)`);
        } else if (u === "area") {
          lines.push(`M1: Uses $A = \\pi r^2$ with $r = ${dsl.radius}$`);
          lines.push(`A1: $A = ${vals["area"]}$ cm$^2$`);
        } else {
          lines.push(`M1: Identifies correct circle theorem or formula for $${u}$`);
          const answer = vals[u];
          if (answer !== undefined) lines.push(`A1: $${u} = ${answer}$`);
        }
      }
      break;
    }

    case "parallel_lines": {
      const par = sol.parallelLines!;
      const rule =
        dsl.angleType === "alternate"
          ? "alternate angles (Z-angles) are equal"
          : dsl.angleType === "corresponding"
            ? "corresponding angles (F-angles) are equal"
            : dsl.angleType === "co-interior"
              ? "co-interior angles sum to $180°$"
              : "parallel line angle relationship";

      for (const u of unknowns) {
        lines.push(`B1: States correct angle rule: ${rule}`);
        const answer =
          u.includes("angle_at_B") || u.includes("alternate") ? par.alternateAngle :
          u.includes("corresponding") ? par.correspondingAngle :
          u.includes("co_interior") || u.includes("co-interior") ? par.coInteriorAngle :
          vals[u];
        if (answer !== undefined)
          lines.push(`A1: $${u} = ${answer}°$`);
        else
          lines.push(`M1: Applies rule correctly`);
      }
      break;
    }

    case "coordinate_geometry": {
      const cg = sol.coordGeom!;
      for (const u of unknowns) {
        if (u === "length") {
          lines.push(`M1: Uses distance formula $d = \\sqrt{(x_2-x_1)^2+(y_2-y_1)^2}$`);
          lines.push(`A1: Correct substitution`);
          lines.push(`A1: $d = ${vals["length"]}$ units`);
        } else if (u === "midpoint") {
          lines.push(`M1: Uses midpoint formula $M = \\left(\\frac{x_1+x_2}{2}, \\frac{y_1+y_2}{2}\\right)$`);
          const mp = vals["midpoint"];
          if (Array.isArray(mp))
            lines.push(`A1: $M = (${mp[0]}, ${mp[1]})$`);
        } else if (u === "slope") {
          lines.push(`M1: Uses gradient formula $m = \\frac{y_2-y_1}{x_2-x_1}$`);
          lines.push(`A1: $m = ${vals["slope"]}$`);
        } else {
          lines.push(`M1: Applies correct formula for $${u}$`);
          const answer = vals[u];
          if (answer !== undefined) lines.push(`A1: $${u} = ${answer}$`);
        }
      }
      break;
    }
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

/**
 * Derives a canonical answer string from the DSL solution's unknowns.
 * Returns null if DSL is invalid or has no unknowns.
 *
 * The returned string is the AUTHORITATIVE answer — it overrides any AI output.
 */
export function computeAnswerFromDSL(dsl: DiagramDSL): string | null {
  const sol = solveDSL(dsl);
  if (!sol.valid || Object.keys(sol.values).length === 0) return null;
  const unknowns = dsl.unknowns ?? [];
  if (unknowns.length === 0) return null;

  const parts: string[] = [];
  for (const key of unknowns) {
    const val = sol.values[key];
    if (val === undefined) continue;
    if (Array.isArray(val)) {
      // Point value
      parts.push(`${key} = (${val[0]}, ${val[1]})`);
    } else {
      parts.push(`${key} = ${val}`);
    }
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

/**
 * Hard diagram-dependency check.
 *
 * For a diagram to be genuinely required, at least one unknown value computed
 * by the mathEngine must NOT appear in the question text (the student must
 * extract it visually from the diagram, not read it from the text).
 *
 * Returns true  → diagram dependency satisfied (at least one hidden value)
 * Returns false → all unknown values are already written in the text (broken)
 */
export function checkDiagramDependency(
  questionText: string,
  dsl: DiagramDSL,
): boolean {
  const sol = solveDSL(dsl);
  if (!sol.valid) return false;
  const unknowns = dsl.unknowns ?? [];
  if (unknowns.length === 0) return false;

  // At least one unknown value must be absent from the question text
  for (const key of unknowns) {
    const v = sol.values[key];
    if (v === undefined) continue;
    const numStr = Array.isArray(v) ? null : String(v);
    if (numStr && !questionText.includes(numStr)) return true; // found a hidden value
  }
  return false; // every computed unknown is already written in the text
}

/**
 * Validates that the question text does not contain numbers that are NOT in
 * the DSL (i.e. AI invented values not present in the diagram).
 *
 * Returns a list of "rogue" numbers found in text but absent from DSL.
 */
export function detectRogueNumbers(
  questionText: string,
  dsl: DiagramDSL,
): number[] {
  const sol = solveDSL(dsl);
  const dslNumbers = new Set<string>();

  // Helper: add all numeric strings from a value
  const addNumbers = (v: unknown) => {
    if (typeof v === "number") {
      dslNumbers.add(String(v));
      // Also add rounded variants (e.g. 5.66 → also allow "5.7", "6")
      dslNumbers.add(String(Math.round(v)));
      dslNumbers.add(v.toFixed(1));
    } else if (Array.isArray(v)) {
      v.forEach(addNumbers);
    } else if (typeof v === "string" && !isNaN(Number(v))) {
      dslNumbers.add(v);
    }
  };

  // All solved values
  Object.values(sol.values).forEach(addNumbers);

  // Raw givens
  (dsl.givens ?? []).forEach((g) => {
    const m = g.match(/-?\d+(?:\.\d+)?/g);
    if (m) m.forEach((n) => dslNumbers.add(n));
  });

  // DSL labels (e.g. { AB: "5", BC: "5.66" })
  Object.values(dsl.labels ?? {}).forEach((v) => {
    if (v && !isNaN(Number(v))) dslNumbers.add(v);
  });

  // Radius
  if (dsl.radius !== undefined) dslNumbers.add(String(dsl.radius));

  // Point coordinates — AI may reference these in questions
  Object.values(dsl.points ?? {}).forEach((pt) => {
    if (Array.isArray(pt)) {
      dslNumbers.add(String(pt[0]));
      dslNumbers.add(String(pt[1]));
    }
  });

  // Extract numbers from question text (skip year-like 4-digit numbers, skip 1 and 2
  // which appear in LaTeX/formatting contexts constantly)
  const textNumbers = (questionText.match(/-?\d+(?:\.\d+)?/g) ?? []).filter(
    (n) => !/^\d{4}$/.test(n) && n !== "1" && n !== "2",
  );

  const rogue: number[] = [];
  for (const n of textNumbers) {
    if (!dslNumbers.has(n)) {
      rogue.push(Number(n));
    }
  }
  return rogue;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isValidPoint(p: unknown): p is Point {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    typeof p[0] === "number" &&
    typeof p[1] === "number" &&
    !isNaN(p[0]) &&
    !isNaN(p[1]) &&
    isFinite(p[0]) &&
    isFinite(p[1])
  );
}

function round(n: number, decimals = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}

/**
 * Converts a legacy `diagramData` object (AI-produced, untyped) into a DiagramDSL.
 * Used during the transition period — prefer AI generating DSL directly.
 */
export function coerceToDSL(
  diagramType: string | undefined,
  diagramData: any,
): DiagramDSL | null {
  if (!diagramData || !diagramType) return null;
  const type = diagramType.toLowerCase().replace(/[\s_]+/g, "_");

  try {
    switch (type) {
      case "triangle":
      case "right_triangle":
      case "isosceles_triangle":
      case "geometry": {
        const pts: Record<string, Point> = {};
        if (isValidPoint(diagramData.A)) pts["A"] = diagramData.A;
        if (isValidPoint(diagramData.B)) pts["B"] = diagramData.B;
        if (isValidPoint(diagramData.C)) pts["C"] = diagramData.C;
        if (Object.keys(pts).length < 3) return null;
        const dsl: DiagramDSL = {
          type: "triangle",
          points: pts,
          labels: diagramData.labels,
        };
        if (diagramData.rightAngleAt) dsl.rightAngleAt = diagramData.rightAngleAt;
        return dsl;
      }

      case "circle":
      case "circle_geometry":
      case "circle geometry": {
        const pts: Record<string, Point> = {};
        if (isValidPoint(diagramData.A)) pts["A"] = diagramData.A;
        if (isValidPoint(diagramData.B)) pts["B"] = diagramData.B;
        if (isValidPoint(diagramData.C)) pts["C"] = diagramData.C;
        if (!isValidPoint(diagramData.center) || typeof diagramData.radius !== "number") return null;
        return {
          type: "circle",
          points: pts,
          center: diagramData.center,
          radius: diagramData.radius,
          labels: diagramData.labels,
        };
      }

      case "parallel_lines":
      case "parallel_lines_geometry":
      case "parallel lines":
      case "parallel lines geometry": {
        if (!diagramData.line1 || !diagramData.line2 || !diagramData.transversal) return null;
        return {
          type: "parallel_lines",
          line1: diagramData.line1,
          line2: diagramData.line2,
          transversal: diagramData.transversal,
          angleType: diagramData.angleType,
          labels: diagramData.labels,
        };
      }

      default:
        return null;
    }
  } catch {
    return null;
  }
}
