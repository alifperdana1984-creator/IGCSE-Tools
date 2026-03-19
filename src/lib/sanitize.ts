import type { QuestionItem, TikzSpec } from "./types";

/** Validates and normalises a raw diagram object into a TikzSpec, or returns undefined. */
export function normalizeDiagram(raw: unknown): TikzSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const d = raw as Record<string, unknown>;
  if (d.diagramType !== "tikz") return undefined;
  // Support flat `tikzCode` field name from older data
  const code =
    typeof d.code === "string"
      ? d.code
      : typeof d.tikzCode === "string"
        ? d.tikzCode
        : "";
  if (!code.trim()) return undefined;
  return { diagramType: "tikz", code };
}

const SUBJECT_CODES: Record<string, string> = {
  Mathematics: "MAT",
  Biology: "BIO",
  Physics: "PHY",
  Chemistry: "CHM",
};

function normalizeQuestionType(raw: unknown): QuestionItem["type"] {
  const v = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (v === "mcq" || v === "multiple_choice" || v === "multiplechoice")
    return "mcq";
  if (v === "structured" || v === "essay" || v === "long_answer")
    return "structured";
  return "short_answer";
}

function extractMcqOptionsFromText(text: string): string[] {
  const matches = Array.from(text.matchAll(/^\s*([A-D])[).:\-]\s+(.+)\s*$/gim));
  const byLetter: Record<string, string> = {};
  for (const m of matches) byLetter[m[1].toUpperCase()] = m[2].trim();
  const ordered = ["A", "B", "C", "D"]
    .map((letter) => byLetter[letter])
    .filter((x): x is string => Boolean(x));
  return ordered.length === 4 ? ordered : [];
}

function hasMcqLabelsInText(text: string): boolean {
  return /^\s*A[).:\-]\s+/im.test(text) && /^\s*D[).:\-]\s+/im.test(text);
}

function normalizeOptionMath(opt: string): string {
  let s = opt.trim();
  s = s.replace(/^\$\$(.+?)\$\$$/s, "$1").trim();
  s = s.replace(/^\$(.+?)\$$/s, "$1").trim();
  s = s.replace(/\$\$([^$]+?)\$\$/g, (_, inner) => `$${inner.trim()}$`);
  if (/\\[a-zA-Z]/.test(s) || /\^|_/.test(s)) {
    s = s.replace(/\$\$/g, "$");
    const stripped = s
      .replace(/\$[^$]+\$/g, "")
      .replace(/\\[a-zA-Z]+(?:\{[^}]*\})?/g, "");
    const isSentence = /[a-zA-Z]{3,}\s+[a-zA-Z]{3,}/.test(stripped);
    if (!isSentence) {
      s = s.includes("$") ? "$" + s.replace(/\$/g, "") + "$" : `$${s}$`;
    }
  }
  return s;
}

function extractTikzFromText(text: string): {
  cleanedText: string;
  tikzCode?: string;
} {
  const tikzRegex = /```tikz\s*([\s\S]*?)```/i;
  const match = text.match(tikzRegex);
  if (match && match[1].trim().length > 0) {
    return {
      cleanedText: text.replace(tikzRegex, "").trim(),
      tikzCode: match[1].trim(),
    };
  }
  return { cleanedText: text };
}

/** Normalise a raw AI-generated question object into a typed QuestionItem (minus id). */
export function sanitizeQuestion(q: any): Omit<QuestionItem, "id"> {
  const fix = (s: string) => (s ?? "").replace(/\\n/g, "\n");
  const stripNum = (s: string) =>
    fix(s)
      .replace(/^(\*{0,2})\s*\d+[.)]\s*\*{0,2}\s*/, "$1")
      .trimStart();

  let text = stripNum(q.text ?? "");
  const type = normalizeQuestionType(q.type);
  const stripOptionPrefix = (s: string) =>
    s.replace(/^\s*\(?[A-D]\)?[).:\-]\s+/i, "").trim();
  const optionsFromModel = Array.isArray(q.options)
    ? q.options
        .slice(0, 4)
        .map((x: unknown) => stripOptionPrefix(String(x ?? "").trim()))
        .filter(Boolean)
    : [];
  const extractedOptions = extractMcqOptionsFromText(text);
  const options =
    type === "mcq"
      ? optionsFromModel.length === 4
        ? optionsFromModel
        : extractedOptions
      : [];

  if (type === "mcq" && options.length === 4 && !hasMcqLabelsInText(text)) {
    const letters = ["A", "B", "C", "D"];
    const optLines = options
      .map(
        (opt: string, i: number) =>
          `${letters[i]}) ${normalizeOptionMath(opt)}`,
      )
      .join("\n\n");
    text = `${text}\n\n${optLines}`;
  }

  const aoRaw = (q.assessmentObjective ?? "").toString().toUpperCase();
  const assessmentObjective = (["AO1", "AO2", "AO3"] as const).find((ao) =>
    aoRaw.includes(ao),
  );

  // First extract any TikZ code embedded in text (common model behavior)
  const { cleanedText, tikzCode: extractedTikz } = extractTikzFromText(text);
  const normalizedText = cleanedText;

  // Accept diagram from either q.diagram (normalised) or legacy flat tikzCode field
  // Also accept extracted TikZ from text as a fallback
  const diagram =
    normalizeDiagram(q.diagram) ??
    normalizeDiagram({ diagramType: "tikz", tikzCode: q.tikzCode }) ??
    (extractedTikz ? { diagramType: "tikz", code: extractedTikz } : undefined);

  const referencesDiagram =
    /\b(in the diagram|the diagram shows|refer to the diagram|as shown in the diagram|from the diagram|on the diagram|shown on the (grid|diagram|figure|graph)|the (grid|figure|graph) shows|shown in the (figure|graph|grid)|as shown (below|above)|on the (grid|graph) (below|above|shown)|shown on a (grid|graph)|coordinates? (?:of|shown)|point [A-Z] shown|in the (triangle|circle|polygon|quadrilateral|rectangle|trapezium|parallelogram)|the (triangle|circle|polygon|quadrilateral) [A-Z]{2,}|angle [A-Z]{2,3}\s*=|triangle [A-Z]{3}|bearing of|three-figure bearings?|is parallel to|transversal|straight line|tangent|diameter [A-Z]{2}|centre of the circle|center of the circle|rotational symmetry|line symmetry|shape shown)\b/i.test(
      normalizedText,
    );
  const isMeasurementBoundsQuestion =
    /\b(?:range of (?:the )?actual|correct to (?:the )?nearest (?:millimetre|centimetre|mm|cm)|upper bound|lower bound|error interval|bounds of accuracy)\b/i.test(
      normalizedText,
    );
  // If we found a diagram (TikZ or SVG), we definitely want it.
  const wantsDiagram =
    !isMeasurementBoundsQuestion &&
    (referencesDiagram || Boolean(q.hasDiagram) || !!diagram);
  const diagramMissing = wantsDiagram && !diagram;

  return {
    text: normalizedText,
    answer: fix(q.answer),
    markScheme: fix(q.markScheme),
    marks: Number(q.marks) || 1,
    commandWord: q.commandWord ?? "",
    type,
    hasDiagram: wantsDiagram,
    ...(diagram ? { diagram } : {}),
    ...(q.diagramType ? { diagramType: q.diagramType } : {}),
    ...(q.diagramData ? { diagramData: q.diagramData } : {}),
    ...(diagramMissing ? { diagramMissing } : {}),
    ...(type === "mcq" && options.length === 4 ? { options } : {}),
    ...(q.code ? { code: q.code } : {}),
    ...(q.syllabusObjective ? { syllabusObjective: q.syllabusObjective } : {}),
    ...(assessmentObjective ? { assessmentObjective } : {}),
    ...(q.difficultyStars
      ? {
          difficultyStars: Math.min(
            3,
            Math.max(1, Number(q.difficultyStars)),
          ) as 1 | 2 | 3,
        }
      : {}),
  };
}

/** Repairs missing/stale fields on an existing QuestionItem by re-running sanitize,
 *  while preserving stable identity fields (id, code, diagram). */
export function repairQuestionItem<T extends QuestionItem>(q: T): T {
  const sanitized = sanitizeQuestion(q);
  return {
    ...q,
    ...sanitized,
    id: q.id,
    // Preserve diagram from the question itself — sanitize re-derives it from tikzCode
    // only if q.diagram is absent, so this is a no-op when diagram already exists.
    ...(q.diagram ? { diagram: q.diagram } : {}),
    ...(q.code ? { code: q.code } : {}),
  } as T;
}

/** Generate a short question code like MAT-C4.1-A4BF. */
export function generateQuestionCode(
  subject: string,
  opts: { text?: string; syllabusObjective?: string } = {},
): string {
  const subj = SUBJECT_CODES[subject] ?? subject.substring(0, 3).toUpperCase();
  const fromObjective =
    opts.syllabusObjective?.match(/^\s*([A-Za-z]?\d+(?:\.\d+)*)\s*[–-]/)?.[1] ??
    opts.syllabusObjective?.match(/^\s*([A-Za-z]?\d+(?:\.\d+)*)\b/)?.[1];
  const fromText = opts.text?.match(
    /Syllabus Reference[:\s]+([A-Za-z]?\d+(?:\.\d+)*)/i,
  )?.[1];
  const syl = fromObjective ?? fromText ?? "GEN";
  const shortId = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `${subj}-${syl}-${shortId}`;
}
