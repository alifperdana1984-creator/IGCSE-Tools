import { GoogleGenAI, Type } from "@google/genai";
import type {
  QuestionItem,
  Assessment,
  AnalyzeFileResult,
  GenerationConfig,
  GeminiError,
  TikzSpec,
} from "./types";
import type { Reference } from "./ai";
import type { UsageCallback } from "./ai";
import {
  sanitizeQuestion,
  generateQuestionCode as sharedGenerateQuestionCode,
} from "./sanitize";
import { parseJsonWithRecovery } from "./json";
import { renderDiagramFromDSL } from "../components/RichEditor/diagramEngine";
import { validateDSL, solveDSL, computeAnswerFromDSL, detectRogueNumbers, generateMarkSchemeFromDSL, checkDiagramDependency } from "./mathEngine";
import type { DiagramDSL } from "./mathEngine";

function getAI(apiKey?: string) {
  if (!apiKey) {
    throw {
      type: "unknown",
      retryable: false,
      message:
        "No Gemini API key provided. Please add your key in API Settings.",
    };
  }
  return new GoogleGenAI({ apiKey });
}


function hasMultiStepStructure(q: QuestionItem): boolean {
  return (
    q.text.includes("(a)") ||
    q.text.includes("(b)") ||
    /show that|hence|deduce|explain why/i.test(q.text)
  );
}

function requiresGeometricUse(q: QuestionItem): boolean {
  const text = q.text.toLowerCase();
  return (
    /angle|triangle|circle|radius|diameter|parallel|line/.test(text) &&
    /calculate|determine|deduce|show|prove|justify/.test(text)
  );
}

function hasCognitiveLoad(q: QuestionItem): boolean {
  return (
    q.text.split(".").length >= 2 || // multi-sentence
    q.text.includes("(a)") ||
    q.text.includes("(b)") ||
    /hence|deduce|explain why|show that/i.test(q.text)
  );
}

function isAStarLevel(q: QuestionItem, difficulty?: string): boolean {
  if (difficulty === "Challenging") {
    // Strict: all conditions required for A* level
    return (
      q.marks >= 3 &&
      hasMultiStepStructure(q) &&
      hasCognitiveLoad(q) &&
      /deduce|justify|prove|show that|explain/i.test(q.text)
    );
  }
  if (difficulty === "Medium" || difficulty === "Balanced") {
    // Softer: multi-step structure and cognitive load sufficient
    return hasMultiStepStructure(q) && hasCognitiveLoad(q);
  }
  // Easy: always pass
  return true;
}

function requiresDiagramExtraction(q: QuestionItem): boolean {
  return !q.text.toLowerCase().includes("given") && q.hasDiagram;
}

/**
 * Hard Validation Layer for Cambridge IGCSE A* Quality
 */
export function enforceQuestionQuality(q: QuestionItem): {
  isValid: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];

  // 1. DIAGRAM DEPENDENCY
  if (q.hasDiagram) {
    const diagramRefs =
      /\b(diagram|figure|shown|point\s+[A-Z]|angle\s+[A-Z]{2,3}|triangle\s+[A-Z]{3})\b/i;
    if (!diagramRefs.test(q.text)) {
      reasons.push(
        "Diagram provided but not referenced in text (must use 'diagram', 'figure', or specific points).",
      );
    }

    if (!requiresGeometricUse(q)) {
      reasons.push("Diagram is mentioned but not used geometrically.");
    }
  }

  // 1.5 FAKE DIAGRAM DEPENDENCY
  // Uses DSL-based check: if all unknown values appear in text, diagram is redundant.
  if (q.hasDiagram && q.diagramDSL && !checkDiagramDependency(q.text, q.diagramDSL)) {
    reasons.push("Diagram dependency violated — all unknown values already present in question text.");
  }

  // 2. MULTI-STEP CHECK & 6. DIFFICULTY ENFORCER
  const reasoningVerbs =
    /\b(explain|deduce|determine|justify|show|prove|calculate)\b/i;
  if (
    q.marks <= 2 &&
    !reasoningVerbs.test(q.commandWord || "") &&
    !reasoningVerbs.test(q.text)
  ) {
    reasons.push(
      "Question is too simple (low marks and no reasoning required).",
    );
  }

  if (q.type !== "mcq" && !hasMultiStepStructure(q)) {
    reasons.push("Question lacks multi-step reasoning structure.");
  }

  if (!hasCognitiveLoad(q)) {
    reasons.push("Low cognitive load (too direct / single-step).");
  }

  // 3. TEXTBOOK DETECTION
  const textbookPatterns =
    /^(find\s+[a-z]+|calculate\s+[a-z]{1,2}|what\s+is\s+the\s+value\s+of)\s*$/i;
  if (textbookPatterns.test(q.text.trim()) && q.text.length < 60) {
    reasons.push("Question lacks context (textbook style 'Find x').");
  }

  if (q.hasDiagram && !requiresDiagramExtraction(q)) {
    reasons.push(
      "Question provides values in text (avoid 'given', force extraction).",
    );
  }

  return { isValid: reasons.length === 0, reasons };
}

function isTooEasy(q: QuestionItem): boolean {
  // Check if question is trivial (1-2 marks and no cognitive verbs)
  return (
    q.marks <= 2 &&
    !/explain|justify|deduce|determine|prove|calculate/i.test(
      q.commandWord + " " + q.text,
    )
  );
}

const SUBJECT_CODES: Record<string, string> = {
  Mathematics: "MAT",
  Biology: "BIO",
  Physics: "PHY",
  Chemistry: "CHM",
};

// Re-export shared helper so callers can still import generateQuestionCode from gemini
export { sharedGenerateQuestionCode as generateQuestionCode };

const DIFFICULTY_CODES: Record<string, string> = {
  Easy: "EAS",
  Medium: "MED",
  Challenging: "CHL",
  Balanced: "BAL",
};

/** Deterministic short hash — no Math.random(). */
function deterministicId(seed: string): string {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return h.toString(36).toUpperCase().padStart(4, "0").substring(0, 4);
}

export function generateAssessmentCode(
  subject: string,
  difficulty: string,
): string {
  const subj = SUBJECT_CODES[subject] ?? subject.substring(0, 3).toUpperCase();
  const diff =
    DIFFICULTY_CODES[difficulty] ?? difficulty.substring(0, 3).toUpperCase();
  const shortId = deterministicId(`${subject}-${difficulty}-${Date.now()}`);
  return `${subj}-${diff}-${shortId}`;
}

export const IGCSE_SUBJECTS = [
  "Mathematics",
  "Biology",
  "Physics",
  "Chemistry",
];

export const IGCSE_TOPICS: Record<string, string[]> = {
  Mathematics: [
    "Number",
    "Algebra",
    "Functions",
    "Geometry",
    "Trigonometry",
    "Vectors & Transformations",
    "Mensuration",
    "Coordinate Geometry",
    "Statistics",
    "Probability",
    "Mixed Topics",
  ],
  Biology: [
    "Characteristics of Living Organisms",
    "Cell Structure",
    "Biological Molecules",
    "Enzymes",
    "Plant Nutrition",
    "Human Nutrition",
    "Transport in Plants",
    "Transport in Animals",
    "Diseases & Immunity",
    "Gas Exchange",
    "Respiration",
    "Excretion",
    "Coordination & Response",
    "Drugs",
    "Reproduction",
    "Inheritance",
    "Variation & Selection",
    "Organisms & Environment",
    "Biotechnology",
    "Mixed Topics",
  ],
  Physics: [
    "Motion, Forces & Energy",
    "Thermal Physics",
    "Waves",
    "Electricity & Magnetism",
    "Nuclear Physics",
    "Space Physics",
    "Mixed Topics",
  ],
  Chemistry: [
    "States of Matter",
    "Atoms, Elements & Compounds",
    "Stoichiometry",
    "Electrochemistry",
    "Chemical Energetics",
    "Chemical Reactions",
    "Acids, Bases & Salts",
    "The Periodic Table",
    "Metals",
    "Chemistry of the Environment",
    "Organic Chemistry",
    "Experimental Techniques",
    "Mixed Topics",
  ],
};

export const DIFFICULTY_LEVELS = ["Easy", "Medium", "Challenging", "Balanced"];

export const DIFFICULTY_GUIDANCE: Record<string, string> = {
  Easy: `DIFFICULTY: Easy
- Target: 80–90% of students should answer correctly
- Bloom's Level: L1 Remember / L2 Understand
- Marks per question: 1–2
- Command words: State, Name, Define, List, Identify, Label
- Style: Single concept, direct recall, familiar textbook contexts, one-step calculations
- MCQ distractors: clearly wrong to a student who knows the topic
- AO distribution: ~70% AO1 (recall/knowledge), ~30% AO2 (simple application), no AO3`,

  Medium: `DIFFICULTY: Medium
- Target: 40–60% of students should answer correctly
- Bloom's Level: L3 Apply / L4 Analyse
- Marks per question: 2–4
- Command words: Describe, Explain, Calculate, Show, Draw
- Style: Apply knowledge to given scenarios, combine 2 concepts, 2–3 step calculations
- MCQ distractors: plausible but distinguishable with careful reasoning
- AO distribution: ~20% AO1, ~60% AO2 (application/calculation), ~20% AO3 (experimental)`,

  Challenging: `DIFFICULTY: Challenging — STRICTLY ENFORCE the following:
- Target: Only 10–20% of students should answer fully correctly (A* discriminator questions)
- Bloom's Level: L4 Analyse / L5 Evaluate / L6 Create
- Marks per question: 4–8 (multi-part questions encouraged)
- Command words: Evaluate, Discuss, Suggest, Compare, Deduce, Predict — NOT "State" or "Name"
- AO distribution: ≤10% AO1, ~60% AO2 (complex analysis/synthesis), ~30% AO3 (experimental design/evaluation)
- MANDATORY requirements for EVERY question:
  1. Place knowledge in UNFAMILIAR contexts (novel scenarios, not textbook examples)
  2. Require chaining 3+ concepts or calculation steps — no single-step answers
  3. Where possible, synthesise across two syllabus topics (e.g. stoichiometry + energetics)
  4. Extended response questions (≥4 marks) must demand a structured argument with evidence
  5. Calculations must require rearranging formulae and multi-stage working
  6. MCQ: all four options must be plausible misconceptions; correct answer requires rigorous reasoning
  7. Mark scheme must have 4+ distinct marking points
- A question that a student can answer from memory alone is NOT acceptable for this difficulty`,

  Balanced: `DIFFICULTY: Balanced — distribute across: Easy ~25% (80–90% pass rate), Medium ~50% (40–60% pass rate), Challenging ~25% (10–20% pass rate).
Include a variety of command words and mark ranges (1–6 marks).
AO distribution (strictly enforce): ~30% AO1 (recall/knowledge), ~50% AO2 (application/analysis/calculation), ~20% AO3 (experimental/evaluation).
For a set of 4 questions: at least 1 AO1, 2 AO2, 1 AO3. Scale proportionally for larger sets.`,
};

export const CAMBRIDGE_COMMAND_WORDS: Record<string, string> = {
  State: "Express in clear terms.",
  Name: "Identify using a recognised technical term.",
  List: "Give a number of points with no explanation.",
  Define: "Give the meaning of a term precisely.",
  Label: "Add names or identifiers to a diagram.",
  Identify: "Name or otherwise characterise.",
  Describe:
    "State the points of a topic / give characteristics and main features.",
  Explain:
    "Set out purposes or reasons / make the relationships between things evident / provide why and/or how and support with relevant evidence.",
  Suggest:
    "Apply knowledge and understanding to situations where there are a range of valid responses in order to make proposals / put forward considerations.",
  Evaluate:
    "Judge or calculate the quality, importance, amount, or value of something.",
  Discuss: "Write about issue(s) or topic(s) in depth in a structured way.",
  Compare: "Identify/comment on similarities and/or differences.",
  Calculate: "Work out from given facts, figures or information.",
  Show: "Provide structured evidence that leads to a given result.",
  Deduce: "Reach a conclusion from the information given.",
  Predict: "Give an expected result.",
  Draw: "Produce a diagram.",
  Sketch: "Make a simple freehand drawing showing key features.",
  Determine: "Establish with certainty from information given.",
  Outline: "Set out the main points.",
  Justify: "Support a case with evidence/reasoning.",
  Plot: "Mark on a graph using data provided.",
};

/** Cambridge IGCSE Assessment Objectives — used to tag questions */
export const ASSESSMENT_OBJECTIVES: Record<string, string> = {
  AO1: "Knowledge and understanding — recall, name, state, define, describe facts and concepts.",
  AO2: "Handling information and problem solving — apply knowledge, analyse, interpret data, calculate, deduce, predict.",
  AO3: "Experimental skills and investigations — plan, observe, measure, record, evaluate experimental procedures.",
};

/** Subject-specific rules that must be applied when generating questions */
export const SUBJECT_SPECIFIC_RULES: Record<string, string> = {
  Chemistry: `CHEMISTRY-SPECIFIC RULES (strictly enforce):
- Chemical equations must be balanced; include state symbols (s), (l), (g), (aq) in all equations.
- Use IUPAC nomenclature for compound names.
- Half-equations for electrolysis must show correct electrons: e.g. Cu²⁺ + 2e⁻ → Cu.
- Thermochemistry questions must specify units (kJ mol⁻¹) and sign conventions (exothermic = negative ΔH).
- Organic chemistry: use displayed/structural formulae instructions precisely; specify chain length.
- Precipitation reactions: write ionic equations, not just word equations.
- Titration/stoichiometry calculations: mark scheme must use M1 (mole ratio / method) + A1 (correct answer with unit).`,

  Physics: `PHYSICS-SPECIFIC RULES (strictly enforce):
- ALL numerical answers must include SI units. Penalise missing units explicitly in mark scheme.
- Equations must be stated before substitution (this scores a B1 mark in mark scheme).
- Mark scheme for calculations: B1 correct equation, M1 correct substitution, A1 correct answer with unit.
- Use standard notation: m s⁻¹ (not m/s), kg m⁻³ (not kg/m³), N m⁻² or Pa.
- For circuits: distinguish clearly between series and parallel; label EMF vs terminal p.d.
- Graphs: axes must be labelled with quantity and unit (e.g. "Force / N").
- Vectors vs scalars: define direction for vector quantities.
- Wave calculations: state formula (v = fλ) before substituting values.`,

  Biology: `BIOLOGY-SPECIFIC RULES (strictly enforce):
- Use precise biological terminology: "partially permeable membrane" not "semi-permeable"; "mitosis" not "cell division".
- Photosynthesis/respiration equations must use correct reactants and products.
- Genetics: use Punnett squares where required; clearly define allele notation (capital = dominant).
- Mark scheme must credit specific named structures (e.g. "villus" not just "small intestine lining").
- For experimental questions: always include a control variable and state what it controls for.
- Evolution questions: reference natural selection mechanism (variation → selection pressure → survival → reproduction → inheritance).
- For calculations (e.g. magnification, percentage change): use M1/A1 mark notation.`,

  Mathematics: `MATHEMATICS-SPECIFIC RULES (strictly enforce):
- All algebraic expressions must use correct LaTeX: $3x^2 - 5x + 2 = 0$, not plain text.
- Mark scheme for ALL calculation questions MUST use M1/A1/B1 Cambridge notation:
  • B1: correct formula or expression stated (e.g. "B1: $v^2 = u^2 + 2as$")
  • M1: correct substitution / method step (e.g. "M1: substitutes $u=0$, $a=9.8$, $s=5$")
  • A1: correct final answer with units (e.g. "A1: $v = 9.9$ m s⁻¹ (3 s.f.)")
  • If a student uses a correct method but makes an arithmetic slip, they still earn M1 (not A1).
- "Show that" questions: mark scheme must show full working chain; final line must match the given answer.
- Geometry: state theorem names in mark scheme (e.g. "B1: angle in semicircle = 90°").
- Statistics: if using calculator — accept equivalent exact fractions or rounded decimals (specify 3 s.f. or 2 d.p.).
- Probability: answers must be as fractions, decimals, or percentages — penalise "ratio" form in mark scheme.
- Constructions: specify tolerance (e.g. ±2mm, ±2°).`,
};

/** Cambridge mark scheme formatting rules — applied to ALL subjects */
export const MARK_SCHEME_FORMAT = `MARK SCHEME FORMAT RULES (strictly enforce for every question):
1. List each marking point on its own numbered line: "1. [point]", "2. [point]", etc.
2. Mark types — use Cambridge M/A/B notation for ALL calculation questions (Maths, Physics, Chemistry):
   - M1: Method mark — correct approach/formula/substitution, awarded even if arithmetic slip follows.
     Format: "M1: [description of method, e.g. 'substitutes correctly into v = u + at']"
   - A1: Accuracy mark — correct numerical answer following a correct method. Always paired with preceding M1.
     Format: "A1: [value with unit, e.g. '12.5 m s⁻¹']"
   - B1: Independent mark — not dependent on method (e.g. correct formula stated alone, correct graph reading, correct unit).
     Format: "B1: [point]"
   - FT: Follow-through — if a previous wrong answer is carried forward correctly, award FT mark.
   For knowledge/descriptive questions: use plain numbered "1. [point]" format (1 mark each).
3. Accepted alternatives: write "Accept: [alternative]" on the same line or line after the point.
4. Rejected responses: write "Reject: [wrong answer / common misconception]" if relevant.
5. For multi-step calculations: each step is a separate M1 or A1 line showing full working.
6. For extended writing (≥3 marks, descriptive/explain/evaluate): use a LEVEL descriptor approach:
   - Level 3 (3 marks): Clear, detailed, well-structured response with all key points.
   - Level 2 (2 marks): Mostly correct with some detail missing.
   - Level 1 (1 mark): Basic response, limited scientific language, key points missing.
   Then list the "indicative content" — the ideas that earn credit.
7. Do NOT write mark scheme as a paragraph. Use M1/A1/B1 or numbered bullets only.
8. Final answer line must state the correct value with SI unit (for calculations).`;

// ---- Error handling ----

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  onRetry?: (attempt: number) => void,
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const status = err?.status ?? err?.code;

      // Rate limit (429) — exponential backoff: 15s, 30s, 60s
      if (status === 429) {
        if (i < maxRetries - 1) {
          onRetry?.(i + 1);
          await new Promise((r) => setTimeout(r, Math.pow(2, i + 1) * 7500));
          continue;
        }
        throw {
          type: "rate_limit",
          retryable: false,
          message:
            "Rate limit exceeded. Please wait a few minutes and try again.",
        } satisfies GeminiError;
      }

      // Model overloaded (503) — retry with backoff
      if (status === 503) {
        if (i < maxRetries - 1) {
          onRetry?.(i + 1);
          await new Promise((r) => setTimeout(r, Math.pow(2, i) * 5000));
          continue;
        }
        throw {
          type: "model_overloaded",
          retryable: false,
          message:
            "Model is currently overloaded. Try switching to a Flash model.",
        } satisfies GeminiError;
      }

      // Not found (404) — no retry
      if (status === 404) {
        throw {
          type: "unknown",
          retryable: false,
          message:
            "Model not found (404). Check your model selection — the selected model may not exist or your API key may not have access to it.",
        } satisfies GeminiError;
      }

      // Auth errors — no retry
      if (status === 401 || status === 403) {
        throw {
          type: "unknown",
          retryable: false,
          message:
            "Invalid or unauthorized API key. Please check your key in API Settings.",
        } satisfies GeminiError;
      }

      // Invalid response / JSON / MAX_TOKENS — retry with short delay
      if (status === 422 || err?.type === "invalid_response") {
        if (i < maxRetries - 1) {
          onRetry?.(i + 1);
          await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
          continue;
        }
        throw {
          type: "invalid_response",
          retryable: true,
          message:
            err?.message ??
            "Model returned an incomplete response. Please retry.",
        } satisfies GeminiError;
      }

      // Preserve original error message if available
      const originalMsg =
        err?.message && !err.message.startsWith("{") ? err.message : null;
      throw {
        type: "unknown",
        retryable: false,
        message: originalMsg ?? "Generation failed. Please try again.",
      } satisfies GeminiError;
    }
  }
  throw {
    type: "rate_limit",
    retryable: false,
    message: "Rate limit exceeded. Please wait a few minutes and try again.",
  } satisfies GeminiError;
}
// -------------------------

// 48h minus 2h buffer
const GEMINI_URI_VALID_MS = 46 * 60 * 60 * 1000;

const FILE_UPLOAD_TIMEOUT_MS = 120_000; // 2 minutes max for a file upload

export async function uploadToGeminiFileApi(
  base64: string,
  mimeType: string,
  displayName: string,
  apiKey: string,
): Promise<string> {
  const ai = getAI(apiKey);
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  const blob = new Blob([bytes], { type: mimeType });

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () =>
        reject(
          new Error(
            `File upload timed out after ${FILE_UPLOAD_TIMEOUT_MS / 1000}s. Check your connection or try a smaller file.`,
          ),
        ),
      FILE_UPLOAD_TIMEOUT_MS,
    ),
  );

  const uploaded = await Promise.race([
    ai.files.upload({ file: blob, config: { displayName, mimeType } }),
    timeoutPromise,
  ]);
  return (uploaded as any).uri as string;
}

export const PAST_PAPER_FOCUS: Record<string, string> = {
  Easy: `Focus EXCLUSIVELY on the easiest questions in these papers: opening questions, part (a) sub-parts, 1–2 mark items, and any question using "State", "Name", or "Define". Ignore all other questions.`,
  Medium: `Focus on the mid-section questions in these papers: 2–4 mark items, "Describe" and "Explain" questions, and calculation questions with 2–3 steps. Ignore both the very easy opening questions and the hardest final questions.`,
  Challenging: `Focus EXCLUSIVELY on the HARDEST questions in these papers: the final questions of each section, all questions worth 4+ marks, any "Evaluate", "Discuss", or extended writing question, and multi-part structured questions. These are the questions that differentiate A* from A students. Replicate ONLY this level of difficulty — completely ignore the easier questions in the papers.`,
  Balanced: `Use the full range of questions across the papers to represent all difficulty levels proportionally.`,
};

function buildReferenceParts(
  references: Reference[],
  difficulty?: string,
  syllabusOnly?: boolean,
): any[] {
  const parts: any[] = [];
  const pastPapers = references.filter((r) => r.resourceType === "past_paper");
  const syllabuses = references.filter((r) => r.resourceType === "syllabus");
  const others = references.filter(
    (r) => !r.resourceType || r.resourceType === "other",
  );

  if (!syllabusOnly && pastPapers.length > 0) {
    const focusInstruction = difficulty
      ? (PAST_PAPER_FOCUS[difficulty] ?? "")
      : "";
    parts.push({
      text: `REFERENCE PAST PAPERS (${pastPapers.length} document${pastPapers.length > 1 ? "s" : ""}): The following are authentic Cambridge IGCSE past papers. Study them carefully and replicate their exact question style, phrasing, command word usage, diagram style, and mark allocation patterns. Your generated questions MUST feel indistinguishable from these official papers.\n\n${focusInstruction}`,
    });
    pastPapers.forEach((ref) => {
      if (ref.pastPaperText) {
        // Use cached text extraction — much cheaper than sending the full PDF
        parts.push({
          text: `PAST PAPER STYLE EXAMPLES (extracted):\n${ref.pastPaperText}`,
        });
      } else if (
        ref.geminiFileUri &&
        ref.geminiFileUploadedAt &&
        Date.now() - ref.geminiFileUploadedAt < GEMINI_URI_VALID_MS
      ) {
        parts.push({
          fileData: { fileUri: ref.geminiFileUri, mimeType: ref.mimeType },
        });
      } else {
        parts.push({
          inlineData: {
            mimeType: ref.mimeType,
            data: ref.data.split(",")[1] || ref.data,
          },
        });
      }
    });
  }

  if (syllabuses.length > 0) {
    syllabuses.forEach((ref) => {
      if (ref.syllabusText) {
        parts.push({
          text: `OFFICIAL CAMBRIDGE IGCSE SYLLABUS OBJECTIVES:\nOnly generate questions that directly assess the following learning objectives. Every question must be explicitly aligned to a stated objective.\n\n${ref.syllabusText}`,
        });
      } else {
        parts.push({
          text: `OFFICIAL CAMBRIDGE IGCSE SYLLABUS: The following document is the official syllabus. Only generate questions that cover the stated learning objectives. Every question must be aligned to a specific objective listed in this syllabus.`,
        });
        if (
          ref.geminiFileUri &&
          ref.geminiFileUploadedAt &&
          Date.now() - ref.geminiFileUploadedAt < GEMINI_URI_VALID_MS
        ) {
          parts.push({
            fileData: { fileUri: ref.geminiFileUri, mimeType: ref.mimeType },
          });
        } else {
          parts.push({
            inlineData: {
              mimeType: ref.mimeType,
              data: ref.data.split(",")[1] || ref.data,
            },
          });
        }
      }
    });
  }

  if (!syllabusOnly && others.length > 0) {
    others.forEach((ref) => {
      if (
        ref.geminiFileUri &&
        ref.geminiFileUploadedAt &&
        Date.now() - ref.geminiFileUploadedAt < GEMINI_URI_VALID_MS
      ) {
        parts.push({
          fileData: { fileUri: ref.geminiFileUri, mimeType: ref.mimeType },
        });
      } else {
        parts.push({
          inlineData: {
            mimeType: ref.mimeType,
            data: ref.data.split(",")[1] || ref.data,
          },
        });
      }
    });
  }

  return parts;
}

/** Fixes formatting, LaTeX, and wording issues in an existing question without changing its content.
 *  Used by the UI "Repair" button. */
export async function repairQuestionText(
  question: QuestionItem,
  subject: string,
  model: string = "gemini-2.0-flash",
  apiKey?: string,
): Promise<Partial<QuestionItem> | null> {
  const ai = getAI(apiKey);

  const prompt = `You are proofreading a Cambridge IGCSE ${subject} exam question. Fix ONLY formatting and LaTeX issues — do NOT change the meaning, difficulty, or content.

COMMON ISSUES TO FIX:
- Broken LaTeX: e.g. "$\\text{ cm}$$" → "$\\text{cm}$", "$$5.8 \\text{ cm}$$" → "$5.8\\text{ cm}$"
- Double dollar signs where single should be used inline
- Missing or extra spaces inside math mode
- Inconsistent notation (e.g. mix of $x$ and x)
- MCQ option lines that start with "A)" but contain raw LaTeX artifacts
- Mark scheme lines with broken math formatting

QUESTION TEXT:
${question.text}

ANSWER:
${question.answer}

MARK SCHEME:
${question.markScheme}

Return JSON with exactly these fields (fix all three, return original if nothing to fix):
{
  "text": "...",
  "answer": "...",
  "markScheme": "..."
}`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 2048,
      },
    });
    const raw = response.text?.trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      text?: string;
      answer?: string;
      markScheme?: string;
    };
    const updates: Partial<QuestionItem> = {};
    if (parsed.text && parsed.text !== question.text)
      updates.text = parsed.text;
    if (parsed.answer && parsed.answer !== question.answer)
      updates.answer = parsed.answer;
    if (parsed.markScheme && parsed.markScheme !== question.markScheme)
      updates.markScheme = parsed.markScheme;
    return Object.keys(updates).length > 0 ? updates : null;
  } catch {
    return null;
  }
}

/** Used by the UI "Regenerate Diagram" button — regenerates diagrams for already-written questions.
 *  This is the repair path, not the main generation path. */
export async function regenerateDiagramsForQuestions(
  questions: QuestionItem[],
  subject: string,
  model: string = "gemini-2.0-flash",
  apiKey?: string,
  _onUsage?: UsageCallback,
  onLog?: (msg: string) => void,
): Promise<Array<{ id: string; diagram: TikzSpec }>> {
  const ai = getAI(apiKey);
  const results = await Promise.all(
    questions.map(async (q) => {
      const tikzCode = await generateTikzCode(
        q,
        subject,
        model,
        ai,
        onLog,
        q.diagram?.code,
      );
      if (tikzCode) {
        return {
          id: q.id,
          diagram: { diagramType: "tikz" as const, code: tikzCode },
        };
      }
      return null;
    }),
  );
  return results.filter((v): v is { id: string; diagram: TikzSpec } =>
    Boolean(v),
  );
}

// ── Three-phase question generation ────────────────────────────────────────────
// Phase 1 (Planning): Decide question topics and types (lightweight).
// Phase 2 (Writing): Write the questions freely.
// Phase 3 (Visualization): Generate TikZ code for questions that require a diagram.
// ───────────────────────────────────────────────────────────────────────────────

/** Internal descriptor produced in Phase 1 for each question slot. */
interface QuestionSlot {
  index: number;
  /** Short description of what the question will test, chosen by Phase 1 */
  topic: string;
  questionType: "mcq" | "short_answer" | "structured";
  /** Whether this question needs a diagram */
  hasDiagram: boolean;
  /** Structured DSL — single source of truth for geometry; replaces diagramData */
  diagramDSL?: DiagramDSL;
  /** Question intent generated in Step 1 of the 5-step diagram pipeline */
  intent?: QuestionIntent;
}

/**
 * Step 1 output: AI describes WHAT to ask before geometry is decided.
 * This ensures the DSL is generated to fit the question, not vice versa.
 */
interface QuestionIntent {
  /** What the student must find (e.g. "missing side AC using Pythagoras") */
  skillTested: string;
  /** Most appropriate diagram type for this intent */
  diagramType: "triangle" | "circle" | "parallel_lines" | "coordinate_geometry";
  /** Angle type for parallel_lines questions */
  angleType?: "corresponding" | "alternate" | "co-interior";
  /** Whether the triangle should be right-angled */
  rightAngle?: boolean;
  /** Rough magnitudes for diagram values (not exact — just guides DSL generation) */
  valueBand: "small" | "medium" | "large";
  /** A representative given value (angle in degrees, or side length) */
  given: number;
}

export async function generateTest(
  config: GenerationConfig & { references?: Reference[]; apiKey?: string },
  onRetry?: (attempt: number) => void,
  onUsage?: UsageCallback,
  onLog?: (msg: string) => void,
): Promise<QuestionItem[]> {
  const ai = getAI(config.apiKey);
  const model = config.model || "gemini-2.5-flash";
  const subjectRules = SUBJECT_SPECIFIC_RULES[config.subject] ?? "";

  // Normalise question type from UI display string to clean internal value
  const rawType = config.type.toLowerCase();
  const cleanType: "mcq" | "short_answer" | "structured" | "mixed" =
    rawType.includes("mcq") || rawType.includes("multiple")
      ? "mcq"
      : rawType.includes("short")
        ? "short_answer"
        : rawType.includes("structured")
          ? "structured"
          : "mixed";

  // ── Phase 1: Plan question slots (lightweight — no diagram data yet) ──────

  onLog?.("Phase 1: planning question slots…");

  const phase1Prompt = `You are a Cambridge IGCSE ${config.subject} Chief Examiner planning an assessment.

CONFIGURATION:
- Topic: ${config.topic}
- ${DIFFICULTY_GUIDANCE[config.difficulty] ?? `Difficulty: ${config.difficulty}`}
- Number of Questions: ${config.count}
- Question Type: ${cleanType === "mixed" ? "Mixed (any of: mcq, short_answer, structured)" : cleanType}
- Calculator: ${config.calculator ? "Allowed" : "Not Allowed"}
${config.syllabusContext ? `- Syllabus Context/Focus: ${config.syllabusContext}` : ""}

TASK: For each of the ${config.count} question slots, output ONLY:
- index: 0-based slot number
- topic: specific sub-topic to assess (must be DIFFERENT for every slot)
- questionType: one of "mcq", "short_answer", "structured" — match the configured type
- hasDiagram: true only if a visual diagram is VITAL for this sub-topic

DO NOT generate any DSL, coordinates, or geometry here.
Geometry is generated separately in a later step.

SUB-TOPIC DIVERSITY (strictly enforce):
- Each slot MUST test a DIFFERENT sub-topic or skill within ${config.topic}.
- Spread across the widest possible range.
Return EXACTLY ${config.count} slots.`;

  const phase1Schema = {
    type: Type.OBJECT,
    properties: {
      slots: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            index: { type: Type.NUMBER },
            topic: { type: Type.STRING },
            questionType: { type: Type.STRING },
            hasDiagram: { type: Type.BOOLEAN },
          },
          required: ["index", "topic", "questionType", "hasDiagram"],
        },
      },
    },
    required: ["slots"],
  };

  // Phase 1 uses syllabus only (past papers add tokens without helping slot planning).
  // Phase 2+ uses all references (style replication from past papers matters for writing).
  const syllabusRefParts: any[] =
    config.references && config.references.length > 0
      ? buildReferenceParts(config.references, config.difficulty, true)
      : [];

  const allRefParts: any[] =
    config.references && config.references.length > 0
      ? buildReferenceParts(config.references, config.difficulty, false)
      : [];

  const rawSlots = await withRetry(
    async () => {
      const response = await ai.models.generateContent({
        model,
        contents: { parts: [...syllabusRefParts, { text: phase1Prompt }] },
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: 65536,
          temperature: 0.4,
          responseSchema: phase1Schema,
        },
      });
      const usage = getGeminiUsage(response);
      if (usage) onUsage?.(model, usage.inputTokens, usage.outputTokens);
      const finishReason = (response as any)?.candidates?.[0]?.finishReason;
      const thoughtTokens =
        (response as any)?.usageMetadata?.thoughtsTokenCount ?? 0;
      onLog?.(
        `[Phase 1] length=${response.text?.length ?? 0} finishReason=${finishReason} thoughtTokens=${thoughtTokens}`,
      );
      if (finishReason === "MAX_TOKENS") {
        throw {
          type: "invalid_response",
          retryable: true,
          message: `Phase 1 hit token limit (thinking used ${thoughtTokens} tokens). Retrying…`,
        };
      }
      const parsed = safeJsonParse(response.text || "{}");
      if (!parsed.slots || parsed.slots.length < config.count) {
        throw {
          type: "invalid_response",
          retryable: true,
          message: `Phase 1 returned ${parsed.slots?.length ?? 0} slots, expected ${config.count}. Retrying…`,
        };
      }
      return parsed.slots;
    },
    3,
    onRetry,
  );

  // ── 5-Step Diagram Pipeline ──────────────────────────────────────────────────
  //
  // Step 1 — generateQuestionIntent: AI decides WHAT to ask, not HOW to draw it.
  // Step 2 — generateDSLFromIntent: AI generates geometry GUIDED by the intent.
  // Step 3 — validateDSL: hard validation; retries once on failure.
  // Step 4 — solveDSL: deterministic computation (mathEngine).
  // Step 5 — writeQuestionFromDSL: AI writes question wording only.
  //
  // This pipeline guarantees the diagram fits the question because the DSL
  // is generated AFTER the question intent is known.

  const intentSchema = {
    type: Type.OBJECT,
    properties: {
      skillTested: { type: Type.STRING },
      diagramType: { type: Type.STRING },
      angleType: { type: Type.STRING, nullable: true },
      rightAngle: { type: Type.BOOLEAN, nullable: true },
      valueBand: { type: Type.STRING },
      given: { type: Type.NUMBER },
    },
    required: ["skillTested", "diagramType", "valueBand", "given"],
  };


  /**
   * Step 1: AI decides what the question will ask, which diagram type fits best,
   * and rough value magnitudes. No coordinates here — pure intent.
   */
  async function generateQuestionIntent(topic: string, slotIndex: number): Promise<QuestionIntent> {
    const topicLower = topic.toLowerCase();

    // Infer diagram type from topic keywords as a starting hint
    let typeHint = "triangle";
    if (/circle|arc|chord|diameter|radius|tangent|inscribed|semicircle/i.test(topicLower)) {
      typeHint = "circle";
    } else if (/parallel|transversal|alternate|corresponding|co.interior|z.angle|f.angle/i.test(topicLower)) {
      typeHint = "parallel_lines";
    } else if (/coordinate|gradient|midpoint|distance|locus|line.*equation/i.test(topicLower)) {
      typeHint = "coordinate_geometry";
    }

    const intentPrompt = `You are planning a Cambridge IGCSE ${config.subject} question.

Topic: "${topic}"
Difficulty: ${config.difficulty}
Suggested diagram type: "${typeHint}"

Your job: describe WHAT the question will ask the student to do.

Rules:
- skillTested: one concrete skill (e.g. "find missing side using Pythagoras", "calculate inscribed angle using circle theorem", "identify alternate angles between parallel lines")
- diagramType: choose the most appropriate from: triangle | circle | parallel_lines | coordinate_geometry
- angleType: only for parallel_lines — one of: corresponding | alternate | co-interior
- rightAngle: only for triangle — true if the triangle should have a right angle
- valueBand: "small" (lengths 2–4, angles 30–45°) | "medium" (lengths 4–7, angles 45–65°) | "large" (lengths 6–10, angles 60–75°)
- given: a single representative numeric value for this diagram (angle in degrees for parallel_lines, side length or radius for triangle/circle, coordinate value for coordinate_geometry). Integer between 2 and 75.

The diagram type MUST match the skill being tested.`;

    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: intentPrompt }] }],
        config: { responseMimeType: "application/json", maxOutputTokens: 256, temperature: 0.5, responseSchema: intentSchema },
      });
      const usage = getGeminiUsage(response);
      if (usage) onUsage?.(model, usage.inputTokens, usage.outputTokens);
      const parsed = safeJsonParse(response.text || "{}");
      const validDiagramTypes = ["triangle", "circle", "parallel_lines", "coordinate_geometry"];
      const validValueBands = ["small", "medium", "large"];
      const givenVal = typeof parsed.given === "number" && parsed.given >= 2 && parsed.given <= 75 ? parsed.given : null;
      if (parsed.skillTested && validDiagramTypes.includes(parsed.diagramType) && validValueBands.includes(parsed.valueBand) && givenVal) {
        onLog?.(`[Intent] Slot ${slotIndex}: ${parsed.diagramType} — "${parsed.skillTested}" (${parsed.valueBand}, given=${givenVal})`);
        return { ...parsed, given: givenVal } as QuestionIntent;
      }
    } catch {
      /* fall through */
    }

    // Fallback: sensible intent derived from topic hint
    onLog?.(`[Intent] Slot ${slotIndex}: using fallback intent (type=${typeHint})`);
    const fallbackGivens = [35, 50, 65, 45, 55, 40, 60, 70];
    return {
      skillTested: `apply ${typeHint.replace("_", " ")} properties to find a missing value`,
      diagramType: typeHint as QuestionIntent["diagramType"],
      valueBand: ["small", "medium", "large"][slotIndex % 3] as QuestionIntent["valueBand"],
      given: fallbackGivens[slotIndex % fallbackGivens.length],
      ...(typeHint === "parallel_lines" ? { angleType: (["corresponding", "alternate", "co-interior"] as const)[slotIndex % 3] } : {}),
      ...(typeHint === "triangle" ? { rightAngle: slotIndex % 2 === 0 } : {}),
    };
  }

  /**
   * Step 2: Deterministic DSL builder — no AI call, guaranteed valid geometry.
   * `seed` varies per slot for diversity (based on slot index).
   * `intent.given` provides the key numeric value (angle or length) chosen in Step 1.
   */
  function buildDSL(intent: QuestionIntent, seed: number): DiagramDSL {
    const g = intent.given;

    if (intent.diagramType === "parallel_lines") {
      const ang = Math.max(25, Math.min(75, g));
      const s = (seed % 3) + 1; // 1, 2, or 3
      // Rotate baseline lines so they're not always horizontal
      const rotationAngle = seed * 15; // 0°, 15°, 30°, 45°…
      const baseLine1: [[number, number], [number, number]] = [[0, 0], [10, 0]];
      const baseLine2: [[number, number], [number, number]] = [[0, 5], [10, 5]];
      const line1 = baseLine1.map((p) => rotate(p, rotationAngle)) as [[number, number], [number, number]];
      const line2 = baseLine2.map((p) => rotate(p, rotationAngle)) as [[number, number], [number, number]];
      return {
        type: "parallel_lines",
        line1,
        line2,
        transversal: [[2 + s, -2], [8 - s, 8]],
        angleType: intent.angleType ?? "alternate",
        constraints: ["parallel_lines"],
        givens: [`angle_at_A=${ang}`],
        unknowns: ["angle_at_B"],
      };
    }

    if (intent.diagramType === "circle") {
      const r = Math.max(3, Math.min(6, Math.round(g / 10) + 3 + (seed % 2)));
      // Vary center so it's not always at origin
      const cx = seed % 2 === 0 ? seed : -seed;
      const cy = seed % 3 === 0 ? seed : -(seed % 2);
      return {
        type: "circle",
        center: [cx, cy],
        radius: r,
        points: {
          A: [cx - r, cy],
          B: [cx + r, cy],
          C: [cx, cy + r],
        },
        constraints: ["AB_is_diameter"],
        givens: [`radius=${r}`],
        unknowns: ["angle_ACB"],
      };
    }

    if (intent.diagramType === "coordinate_geometry") {
      const x2 = Math.max(2, Math.min(8, Math.round(g / 8) + 2 + (seed % 3)));
      const y2 = Math.max(2, Math.min(8, Math.round(g / 10) + 3 + ((seed + 1) % 3)));
      return {
        type: "coordinate_geometry",
        points: { A: [0, 0], B: [x2, y2] },
        constraints: [],
        givens: [`A=(0,0)`, `B=(${x2},${y2})`],
        unknowns: ["length", "midpoint"],
      };
    }

    // triangle (default)
    const a = Math.max(2, Math.min(8, Math.round(g / 10) + 2 + (seed % 3)));
    const b = Math.max(2, Math.min(8, a + 1 + (seed % 2))); // ensure a ≠ b
    if (intent.rightAngle) {
      // Vary A position so it's not always at [0, a]
      return {
        type: "triangle",
        points: { A: [seed, a], B: [seed, 0], C: [seed + b, 0] },
        rightAngleAt: "B",
        constraints: ["right_angle_at_B"],
        givens: [`AB=${a}`, `BC=${b}`],
        unknowns: ["AC", "angle_A"],
      };
    }
    // Oblique triangle: non-right, balanced
    const cx = Math.max(1, Math.round(b / 2) + (seed % 2));
    const cy = Math.max(2, a - 1 + (seed % 2));
    return {
      type: "triangle",
      points: { A: [seed, seed], B: [seed + b, seed], C: [seed + cx, seed + cy] },
      constraints: [],
      givens: [`AB=${b}`, `BC=${Math.round(Math.sqrt((b - cx) ** 2 + cy ** 2))}`],
      unknowns: ["angle_A", "angle_B"],
    };
  }

  /** Rotate a 2D point by `angle` degrees around the origin. */
  function rotate([x, y]: [number, number], angle: number): [number, number] {
    const rad = angle * Math.PI / 180;
    return [
      Math.round((x * Math.cos(rad) - y * Math.sin(rad)) * 100) / 100,
      Math.round((x * Math.sin(rad) + y * Math.cos(rad)) * 100) / 100,
    ];
  }

  // ── Slot normalisation — SEQUENTIAL (rate-limit safe) ───────────────────────
  // For each slot: if hasDiagram, run the 5-step pipeline.
  // Non-diagram slots pass through immediately.

  const validTypes = ["mcq", "short_answer", "structured"];
  const slots: QuestionSlot[] = [];

  for (let i = 0; i < Math.min(rawSlots.length, config.count); i++) {
    const s = rawSlots[i];
    let diagramDSL: DiagramDSL | undefined;
    let intent: QuestionIntent | undefined;

    if (s.hasDiagram) {
      // Step 1 — Question Intent (AI: topic → skill + diagram type + given value)
      intent = await generateQuestionIntent(s.topic ?? config.topic, i);

      // Step 2 — Build DSL deterministically from intent (no AI, always valid geometry)
      const dsl = buildDSL(intent, i);

      // Step 3 — Validate (should always pass — templates are pre-verified)
      const validation = validateDSL(dsl);
      if (validation.valid) {
        diagramDSL = dsl;
        onLog?.(`[Slot ${i}] hasDiagram=true — DSL ready (${dsl.type}, given=${intent.given})`);
      } else {
        onLog?.(`[Slot ${i}] buildDSL produced invalid DSL (${validation.errors.join("; ")}) — no diagram`);
      }
    }

    slots.push({
      index: i,
      topic: s.topic ?? config.topic,
      questionType: (validTypes.includes(s.questionType)
        ? s.questionType
        : cleanType === "mixed"
          ? "short_answer"
          : cleanType) as QuestionSlot["questionType"],
      hasDiagram: Boolean(s.hasDiagram) && !!diagramDSL,
      diagramDSL,
      intent,
    });

    // Rate-limit protection between slots
    if (i < config.count - 1) await new Promise((r) => setTimeout(r, 300));
  }

  // ── Phase 2 shared config ────────────────────────────────────────────────────

  const phase2SystemInstruction = `You are a Senior Cambridge IGCSE Chief Examiner for ${config.subject} with 20+ years of experience.

CAMBRIDGE COMMAND WORDS:
${Object.entries(CAMBRIDGE_COMMAND_WORDS)
  .map(([w, d]) => `- **${w}**: ${d}`)
  .join("\n")}

ASSESSMENT OBJECTIVES:
- AO1: recall, state, name, define — 1–2 mark questions
- AO2: apply, calculate, interpret, deduce — 2–4 mark questions
- AO3: plan experiments, identify variables, evaluate — 2–4 mark questions
`;

  const questionSchema = {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING },
      answer: { type: Type.STRING },
      markScheme: { type: Type.STRING },
      marks: { type: Type.NUMBER },
      commandWord: { type: Type.STRING },
      type: { type: Type.STRING },
      hasDiagram: { type: Type.BOOLEAN },
      syllabusObjective: { type: Type.STRING, nullable: true },
      assessmentObjective: { type: Type.STRING, nullable: true },
      difficultyStars: { type: Type.NUMBER, nullable: true },
      options: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ["text", "answer", "markScheme", "marks", "commandWord", "type", "hasDiagram", "options"],
  };

  /**
   * Step 5: Writes ONE question using a focused DSL-first prompt.
   * Intent from Step 1 is included so the wording aligns with the intended skill.
   */
  async function writeQuestionFromDSL(slot: QuestionSlot, sol: ReturnType<typeof solveDSL>): Promise<any> {
    const dsl = slot.diagramDSL!;
    const intent = slot.intent;

    // Build human-readable given/unknown blocks
    const givenLines = (dsl.givens ?? []).map((g) => `  ${g}`);
    const pts = dsl.points ?? {};
    Object.entries(pts).forEach(([name, pt]) => givenLines.push(`  ${name} = (${pt[0]}, ${pt[1]})`));
    if (dsl.radius !== undefined) givenLines.push(`  radius = ${dsl.radius}`);
    if (dsl.line1) givenLines.push(`  line1 = ${JSON.stringify(dsl.line1)}`);
    if (dsl.line2) givenLines.push(`  line2 = ${JSON.stringify(dsl.line2)}`);
    if (dsl.transversal) givenLines.push(`  transversal = ${JSON.stringify(dsl.transversal)}`);

    const unknownLines = (dsl.unknowns ?? []).map((u) => {
      const v = sol.values[u];
      return `  ${u}${v !== undefined ? ` = ${Array.isArray(v) ? `(${v[0]}, ${v[1]})` : v} ← STUDENT FINDS THIS` : ""}`;
    });

    const prompt = `You are a Cambridge IGCSE ${config.subject} question writer.

You are given a DiagramDSL and a question intent. Your ONLY job is to write the question wording.

════════════════════════════════════
QUESTION INTENT (what this question must test)

Skill: ${intent?.skillTested ?? slot.topic}
Diagram type: ${dsl.type}

════════════════════════════════════
INPUT DSL

${JSON.stringify(dsl, null, 2)}

════════════════════════════════════
COMPUTED VALUES (from mathEngine — do NOT output these)

GIVEN VALUES (you MAY reference these in the question text):
${givenLines.join("\n") || "  (none)"}

UNKNOWN VALUES (student must find — NEVER write in question text):
${unknownLines.join("\n") || "  (none)"}

════════════════════════════════════
CONTEXT

- Subject: ${config.subject}
- Topic: ${slot.topic}
- Question type: ${slot.questionType}
- ${DIFFICULTY_GUIDANCE[config.difficulty] ?? `Difficulty: ${config.difficulty}`}
- Calculator: ${config.calculator ? "Allowed" : "Not Allowed"}
${config.syllabusContext ? `- Syllabus focus: ${config.syllabusContext}` : ""}

════════════════════════════════════
CRITICAL RULES — READ BEFORE WRITING

⛔ You MUST use ONLY the values provided in the DSL above.
- DO NOT introduce new numbers
- DO NOT change given values
- DO NOT invent angles, lengths, or coordinates

All numerical values in the question text MUST come from GIVEN VALUES above.
If you introduce ANY new number → the answer is INVALID.

The diagram MUST be REQUIRED to solve the question.
Do NOT reveal all values in text.
At least one value must be obtained ONLY from the diagram.

════════════════════════════════════
STRICT RULES

❌ NOT allowed:
- Invent any number not in GIVEN VALUES above
- Write the UNKNOWN VALUES in the question text
- Ignore the diagram
- Single-step questions

✅ REQUIRED:
- Reference the diagram (points by letter: A, B, C, O)
- Require the diagram to solve (at least one value only visible in diagram)
- Multi-step reasoning (≥ 2 steps)
- Cambridge command word appropriate for difficulty

════════════════════════════════════
MARK SCHEME FORMAT

Use Cambridge notation:
- B1: independent fact/formula
- M1: method step (awarded even if arithmetic slip follows)
- A1: correct answer with unit

════════════════════════════════════
STRUCTURED QUESTIONS (if type=structured):
- 2–4 sentence stem, then **(a)**, **(b)** sub-parts each with **[n]** marks
- Each sub-part uses a different command word

MCQ (if type=mcq):
- 4 options in "options" array (no letter prefix)
- "answer" = "A", "B", "C", or "D" only
- All distractors must be plausible misconceptions

════════════════════════════════════
SELF-CHECK (mandatory before output):
1. Every number in question text is in GIVEN VALUES → if not, remove it
2. Diagram is required → at least one value only from diagram
3. Labels are single letters only: A, B, C, O (no "OABC", no merged text)
4. Question needs ≥ 2 reasoning steps

════════════════════════════════════
ANSWER FIELD:
- MCQ: single letter "A"/"B"/"C"/"D"
- All others: brief METHOD description only — no numbers
  (e.g. "Apply Pythagoras' theorem, then use angle sum of triangle")
  The system computes the numeric answer from the DSL automatically.

LaTeX: ALL math in $...$. Never plain-text math.
syllabusObjective: "REF – statement" format, one sentence.
assessmentObjective: "AO1" | "AO2" | "AO3"
difficultyStars: 1 | 2 | 3
marks: MCQ=1, short_answer=1–3, structured=sum of sub-parts
hasDiagram: true`;

    return withRetry(async () => {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [...allRefParts, { text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          temperature: 0.6,
          responseSchema: questionSchema,
          systemInstruction: phase2SystemInstruction,
        },
      });
      const usage = getGeminiUsage(response);
      if (usage) onUsage?.(model, usage.inputTokens, usage.outputTokens);
      const finishReason = (response as any)?.candidates?.[0]?.finishReason;
      if (finishReason === "MAX_TOKENS") {
        throw { type: "invalid_response", retryable: true, message: `DSL question hit token limit. Retrying…` };
      }
      const parsed = safeJsonParse(response.text || "{}");
      if (!parsed.text) throw { type: "invalid_response", retryable: true, message: "Empty question text returned." };
      return parsed;
    }, 3, onRetry);
  }

  /**
   * Writes all non-diagram questions (or diagram-less slots) in a single batch call.
   * This mirrors the original Phase 2 approach but only for non-DSL slots.
   */
  async function writeQuestionsWithoutDSL(batchSlots: QuestionSlot[]): Promise<any[]> {
    if (batchSlots.length === 0) return [];

    const batchDescriptions = batchSlots
      .map((s) => `Q${s.index + 1}: topic="${s.topic}", type="${s.questionType}"`)
      .join("\n");

    const prompt = `Generate a Cambridge IGCSE ${config.subject} assessment.

CONFIGURATION:
- Topic: ${config.topic}
- ${DIFFICULTY_GUIDANCE[config.difficulty] ?? `Difficulty: ${config.difficulty}`}
- Calculator: ${config.calculator ? "Allowed" : "Not Allowed"}
${config.syllabusContext ? `- Syllabus Context/Focus: ${config.syllabusContext}` : ""}

${subjectRules ? `${subjectRules}\n` : ""}${MARK_SCHEME_FORMAT}

QUESTION SLOTS (write EXACTLY ${batchSlots.length} questions in this order):
${batchDescriptions}

RULES:
1. Multi-step reasoning required (≥ 2 steps).
2. Avoid textbook phrasing. Use Cambridge command words.
3. MCQ: 4 options (no letter prefix); answer = "A"/"B"/"C"/"D".
4. Short answer: 1–3 marks, no sub-parts.
5. Structured: stem + (a),(b),(c) sub-parts with [n] marks each.
6. LaTeX: all math in $...$. syllabusObjective: "REF – statement" format.
7. assessmentObjective: "AO1" | "AO2" | "AO3". difficultyStars: 1|2|3.
8. hasDiagram: false for all these questions.
9. answer field: MCQ = letter; others = method description only (no numbers).`;

    return withRetry(async () => {
      const response = await ai.models.generateContent({
        model,
        contents: { parts: [...allRefParts, { text: prompt }] },
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: 32768,
          temperature: 0.75,
          responseSchema: {
            type: Type.OBJECT,
            properties: { questions: { type: Type.ARRAY, items: questionSchema } },
            required: ["questions"],
          },
          systemInstruction: phase2SystemInstruction,
        },
      });
      const usage = getGeminiUsage(response);
      if (usage) onUsage?.(model, usage.inputTokens, usage.outputTokens);
      const finishReason = (response as any)?.candidates?.[0]?.finishReason;
      const thoughtTokens = (response as any)?.usageMetadata?.thoughtsTokenCount ?? 0;
      onLog?.(`[Phase 2 batch] length=${response.text?.length ?? 0} finishReason=${finishReason} thoughtTokens=${thoughtTokens}`);
      if (finishReason === "MAX_TOKENS") {
        throw { type: "invalid_response", retryable: true, message: `Phase 2 batch hit token limit. Retrying…` };
      }
      const parsed = safeJsonParse(response.text || "{}");
      if (!parsed.questions || parsed.questions.length < batchSlots.length) {
        throw { type: "invalid_response", retryable: true, message: `Phase 2 batch returned ${parsed.questions?.length ?? 0} questions, expected ${batchSlots.length}.` };
      }
      return parsed.questions;
    }, 3, onRetry);
  }

  // ── Phase 2: Write questions (per-slot for DSL, batch for non-DSL) ───────────

  onLog?.("Phase 2: writing questions…");

  // Separate DSL slots from non-DSL slots
  const dslSlots    = slots.filter((s) => s.hasDiagram && s.diagramDSL);
  const nonDslSlots = slots.filter((s) => !s.hasDiagram || !s.diagramDSL);

  // Write DSL questions SEQUENTIALLY — one focused call per question.
  // Sequential execution prevents rate limit bursts and keeps each prompt minimal.
  const rawQuestionsMap: Record<number, any> = {};
  for (let di = 0; di < dslSlots.length; di++) {
    const slot = dslSlots[di];
    const sol = solveDSL(slot.diagramDSL!);
    onLog?.(`[Phase 2] Q${slot.index + 1}: writing DSL question (${slot.diagramDSL!.type})`);
    const q = await writeQuestionFromDSL(slot, sol);
    rawQuestionsMap[slot.index] = q;
    // Rate limit protection between questions
    if (di < dslSlots.length - 1) await new Promise((r) => setTimeout(r, 500));
  }

  // Write non-DSL questions in one batch (no diagram = no heavy DSL context)
  const nonDslResults = await writeQuestionsWithoutDSL(nonDslSlots);
  nonDslSlots.forEach((slot, batchIdx) => { rawQuestionsMap[slot.index] = nonDslResults[batchIdx]; });

  const rawQuestions = { questions: slots.map((s) => rawQuestionsMap[s.index]).filter(Boolean) };

  // Stitch: sanitize questions and attach DSL from Phase 1
  let questions: QuestionItem[] = await Promise.all((rawQuestions.questions ?? []).map(async (q: any, i: number) => {
    const sanitized = sanitizeQuestion(q);
    const slot = slots[i];
    // CRITICAL: hasDiagram is only true if a valid DSL exists.
    // If the slot lost its DSL (all retries failed), force hasDiagram=false on the question too.
    const hasDiagram = (slot?.hasDiagram || sanitized.hasDiagram) && !!slot?.diagramDSL;
    const dsl = slot?.diagramDSL;

    // ── HARD DIAGRAM REQUIREMENT ─────────────────────────────────────────────
    // If the question claims hasDiagram but has no valid DSL, regenerate it as
    // a non-diagram question. A diagram-based question without a diagram is NEVER allowed.
    if ((slot?.hasDiagram || sanitized.hasDiagram) && !dsl) {
      onLog?.(`[REJECT] Q${i + 1}: hasDiagram=true but no valid DSL — regenerating as non-diagram question`);
      const fallback = await regenerateSingleQuestion(
        { ...sanitized, hasDiagram: false, id: crypto.randomUUID(), code: "" } as QuestionItem,
        ["DiagramDSL is missing or invalid. Generate this as a non-diagram question instead. Do NOT set hasDiagram=true."],
        { ...config, topic: slot?.topic ?? config.topic },
        ai,
        model,
      );
      if (fallback) {
        onLog?.(`[FALLBACK] Q${i + 1}: replaced with non-diagram question`);
        return fallback;
      }
      // If even fallback fails, force hasDiagram=false on the original
      onLog?.(`[FALLBACK] Q${i + 1}: regeneration failed — stripping hasDiagram`);
      return {
        ...sanitized,
        hasDiagram: false,
        id: crypto.randomUUID(),
        code: sharedGenerateQuestionCode(config.subject, {
          text: sanitized.text,
          syllabusObjective: sanitized.syllabusObjective,
        }),
      } as QuestionItem;
    }

    // ── MATH ENGINE ENFORCEMENT ──────────────────────────────────────────────
    // For non-MCQ with a DSL: answer and markScheme are ALWAYS from mathEngine.
    // AI-generated values are discarded entirely.
    let enforcedAnswer = sanitized.answer;
    let enforcedMarkScheme = sanitized.markScheme;

    if (dsl && sanitized.type !== "mcq") {
      const computedAns = computeAnswerFromDSL(dsl);
      if (computedAns) {
        enforcedAnswer = computedAns;
        onLog?.(`[Enforce] Q${i + 1}: answer set from mathEngine → ${computedAns}`);
      }
      const computedMS = generateMarkSchemeFromDSL(dsl);
      if (computedMS) {
        enforcedMarkScheme = computedMS;
        onLog?.(`[Enforce] Q${i + 1}: markScheme set from mathEngine (${computedMS.split("\n").length} lines)`);
      }
    }

    // ── ROGUE NUMBER HARD REJECTION ──────────────────────────────────────────
    // If AI invented numbers not in the DSL, flag the question so the UI
    // surfaces it as broken. Do NOT silently pass.
    if (dsl) {
      const rogues = detectRogueNumbers(sanitized.text, dsl);
      if (rogues.length > 0) {
        onLog?.(`[REJECT] Q${i + 1}: rogue numbers in text: ${rogues.join(", ")} — flagged`);
        (sanitized as any).diagramMissing = true;
        (sanitized as any).rogueNumbers = rogues;
      }

      // ── DIAGRAM DEPENDENCY HARD CHECK ─────────────────────────────────────
      // At least one unknown value must be absent from the question text.
      // If all unknowns appear in the text, the diagram is not actually required.
      if (hasDiagram && !checkDiagramDependency(sanitized.text, dsl)) {
        onLog?.(`[REJECT] Q${i + 1}: diagram dependency violated — all unknown values present in text`);
        (sanitized as any).diagramMissing = true;
      }
    }

    return {
      ...sanitized,
      answer: enforcedAnswer,
      markScheme: enforcedMarkScheme,
      hasDiagram,
      ...(dsl ? { diagramDSL: dsl } : {}),
      id: crypto.randomUUID(),
      code: sharedGenerateQuestionCode(config.subject, {
        text: sanitized.text,
        syllabusObjective: sanitized.syllabusObjective,
      }),
    };
  }));

  // ── Phase 3: Generate TikZ diagrams for questions that need them ─────────
  const diagramQuestions = questions.filter((q) => q.hasDiagram);
  if (diagramQuestions.length > 0) {
    onLog?.(`Phase 3: rendering ${diagramQuestions.length} diagrams…`);
    await Promise.all(
      questions.map(async (q) => {
        if (q.hasDiagram && q.diagramDSL) {
          // Deterministic render only — no AI fallback (core principle)
          const tikzCode = renderDiagramFromDSL(q.diagramDSL);
          if (tikzCode) {
            q.diagram = { diagramType: "tikz", code: tikzCode };
          } else {
            // DSL render failed → mark diagram missing, log for debugging
            q.diagramMissing = true;
            onLog?.(`[Phase 3] Q${questions.indexOf(q) + 1}: DSL render failed — diagram marked missing`);
          }
        }
      }),
    );
  }

  // Phase 4: Mandatory Critique & Refine (Diagram Dependency & Quality)
  if (questions.length > 0) {
    questions = await critiqueAndRefine(
      questions,
      config.subject,
      model,
      ai,
      onRetry,
      onUsage,
    );
  }

  // Phase 4.5: Auto-Regeneration Loop (Hard Validation — Challenging only)
  // For Easy/Medium/Balanced the critiqueAndRefine pass (Phase 4) is sufficient.
  if (questions.length > 0 && config.difficulty === "Challenging") {
    for (let i = 0; i < questions.length; i++) {
      let q = questions[i];
      let attempts = 0;

      while (attempts < 2) {
        const qualityCheck = enforceQuestionQuality(q);
        const tooEasy = isTooEasy(q);
        const isAStar = isAStarLevel(q, config.difficulty);
        const hasCognitive = hasCognitiveLoad(q);

        if (qualityCheck.isValid && !tooEasy && isAStar && hasCognitive) break;

        const issues = [...qualityCheck.reasons];
        if (tooEasy)
          issues.push("Question is too easy/recall-based for A* level.");
        if (!isAStar)
          issues.push(
            "Not A* level difficulty (requires multi-step deduction/proof).",
          );
        if (!hasCognitive) issues.push("Cognitive load too low.");

        onLog?.(
          `Regenerating Q${i + 1} (Attempt ${attempts + 1}): ${issues.join(", ")}`,
        );

        const newQ = await regenerateSingleQuestion(
          q,
          issues,
          config,
          ai,
          model,
        );
        if (newQ) {
          questions[i] = newQ;
          q = newQ;
        }
        attempts++;
      }
    }
  }

  return questions;
}

/** Generates complete LaTeX/TikZ code for a single question */
async function generateTikzCode(
  question: { text: string; answer: string; diagramType?: string; diagramData?: any },
  subject: string,
  model: string,
  ai: ReturnType<typeof getAI>,
  onLog?: (msg: string) => void,
  previousCode?: string,
): Promise<string | null> {
  const improvementBlock = previousCode
    ? `
PREVIOUS VERSION (improve accuracy — keep it concise, max 25 lines inside tikzpicture):
${previousCode}

IMPROVE BY:
- Fix any incorrect coordinates or proportions
- Add missing labels, angle marks, or tick marks
- Keep total line count inside tikzpicture ≤ 25 — do not add unnecessary commands
- Still end with \\end{tikzpicture} and \\end{document}
`
    : "";

  const diagramSpecBlock =
    question.diagramType || question.diagramData
      ? `\nDIAGRAM SPECIFICATION:
- Type: ${question.diagramType ?? "unspecified"}
- Data (use these exact coordinates): ${question.diagramData ? JSON.stringify(question.diagramData) : "none"}
`
      : "";

  const prompt = `Generate a concise, exam-quality LaTeX/TikZ diagram for this ${subject} question.
${improvementBlock}${diagramSpecBlock}
QUESTION: ${question.text}
ANSWER: ${question.answer}

STRICT REQUIREMENTS — follow exactly:
1. Output ONLY raw LaTeX: start with \\documentclass[tikz,border=4mm]{standalone}, end with \\end{document}.
2. Only \\usetikzlibrary{...} is allowed — do NOT use \\usepackage.
3. MAXIMUM 25 lines inside \\begin{tikzpicture}...\\end{tikzpicture}. Keep it short and complete.
4. Use ONLY plain numeric coordinates — NO trig functions (cos/sin). Pre-compute: cos30°=0.866, sin30°=0.5, cos45°=0.707, cos60°=0.5, sin60°=0.866.
5. Label key points and values using \\node. Mark right angles with a small square.
6. CRITICAL: every \\draw command MUST end with a semicolon on the same line. Never leave a command unfinished.
7. You MUST output the complete file ending with \\end{tikzpicture} and \\end{document} — never truncate.
8. If no diagram is needed, output nothing (empty string).`;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { temperature: 0.2, maxOutputTokens: 8192 },
    });
    const text = response.text?.trim();
    // Try to extract fenced code block first to handle preamble text like "Here is the code:"
    const fencedMatch = text?.match(/```(?:latex|tex)?\s*([\s\S]*?)```/i);
    const clean = fencedMatch ? fencedMatch[1].trim() : text?.replace(/^```(latex|tex)?/i, "").replace(/```$/, "").trim();

    return clean || null;
  } catch (err) {
    onLog?.(`TikZ generation error: ${err}`);
    return null;
  }
}

/** Regenerate a single failing question with strict feedback */
async function regenerateSingleQuestion(
  original: QuestionItem,
  issues: string[],
  config: GenerationConfig,
  ai: any,
  model: string,
): Promise<QuestionItem | null> {
  const difficultyRequirements =
    config.difficulty === "Challenging"
      ? "Multi-step reasoning, minimum 3 steps, unfamiliar context, 4–6 marks."
      : config.difficulty === "Medium"
        ? "2-step reasoning, apply concepts to a given scenario, 2–4 marks."
        : "Clear, direct, single-concept question appropriate for recall level, 1–2 marks.";

  const prompt = `
    REGENERATE this specific Cambridge IGCSE ${config.subject} question.
    TARGET DIFFICULTY: ${config.difficulty}

    PREVIOUS FAILED VERSION:
    "${original.text}"
    (Type: ${original.type}, Marks: ${original.marks})

    ISSUES DETECTED (MUST FIX):
    ${issues.map((s) => `- ${s}`).join("\n")}

    STRICT REQUIREMENTS:
    1. Match the target difficulty: ${difficultyRequirements}
    2. Use Cambridge command words appropriate for ${config.difficulty} difficulty.
    3. Ensure diagram is REQUIRED (if present).
    4. Do NOT output markdown. Output ONLY the JSON object for the question.

    Return JSON matching the schema:
    { "text": "...", "answer": "...", "markScheme": "...", "marks": 4, "commandWord": "...", "type": "...", "hasDiagram": ${original.hasDiagram}, "options": [...] }
  `;

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        temperature: 0.8,
      },
    });
    const parsed = safeJsonParse(response.text || "{}");
    if (!parsed.text) return null;

    const sanitized = sanitizeQuestion(parsed);
    const dsl = original.diagramDSL;

    // Re-enforce answer and markScheme from mathEngine — AI regeneration is wording-only
    let enforcedAnswer = sanitized.answer;
    let enforcedMarkScheme = sanitized.markScheme;
    if (dsl && sanitized.type !== "mcq") {
      const computedAns = computeAnswerFromDSL(dsl);
      if (computedAns) enforcedAnswer = computedAns;
      const computedMS = generateMarkSchemeFromDSL(dsl);
      if (computedMS) enforcedMarkScheme = computedMS;
    }

    // Rogue number + diagram dependency checks on regenerated text
    let diagramMissing = false;
    if (dsl) {
      const rogues = detectRogueNumbers(sanitized.text, dsl);
      if (rogues.length > 0) diagramMissing = true;
      if (original.hasDiagram && !checkDiagramDependency(sanitized.text, dsl)) diagramMissing = true;
    }

    const updated: QuestionItem = {
      ...sanitized,
      answer: enforcedAnswer,
      markScheme: enforcedMarkScheme,
      id: original.id,
      code: original.code,
      diagram: undefined,
      ...(dsl ? { diagramDSL: dsl } : {}),
      hasDiagram: original.hasDiagram,
      ...(diagramMissing ? { diagramMissing } : {}),
    };

    if (original.hasDiagram && original.diagramDSL) {
      // Deterministic render only — no AI fallback
      const tikzCode = renderDiagramFromDSL(original.diagramDSL);
      if (tikzCode) {
        updated.diagram = { diagramType: "tikz", code: tikzCode };
      } else {
        updated.diagramMissing = true;
      }
    }
    return updated;
  } catch (e) {
    console.warn("Regeneration failed:", e);
    return null;
  }
}

async function critiqueAndRefine(
  questions: QuestionItem[],
  subject: string,
  model: string,
  ai: ReturnType<typeof getAI>,
  onRetry?: (attempt: number) => void,
  onUsage?: UsageCallback,
): Promise<QuestionItem[]> {
  const questionsText = questions
    .map((q, i) => {
      const diagramNote = q.diagram
        ? `\n[This question has a diagram: ${q.diagram.diagramType}. Do NOT change the diagram — only rewrite the text/markScheme/commandWord if needed.]`
        : "";
      return `Q${i + 1} [${q.marks} marks] (${q.commandWord})\n${q.text}\n\nAnswer: ${q.answer}\n\nMark Scheme: ${q.markScheme}${diagramNote}`;
    })
    .join("\n\n---\n\n");

  const prompt = `You are a Cambridge IGCSE Chief Examiner conducting a strict quality audit for ${subject}.

REQUIRED STANDARD: Cambridge IGCSE
- Target: Only 10–20% of students answer fully correctly
- Command words: Evaluate, Deduce, Predict, Suggest, Discuss, Justify — NEVER State/Name/Define
- Must require 3+ distinct cognitive steps or multi-stage synthesis
- Content must be in UNFAMILIAR context — novel scenario, never a textbook example
- Mark schemes must have 4+ distinct marking points for 4+ mark questions

REWRITE ANY QUESTION THAT:
- does not require diagram
- duplicates diagram values in text
- can be solved in 1 step
- looks like textbook
- lacks reasoning chain
- a student can answer from memory alone

CRITICAL DIAGRAM CHECK:
- If a question has a diagram, is the diagram ESSENTIAL?
- If the question can be solved without looking at the diagram, it is BROKEN. Rewrite it so the diagram contains vital info (e.g. lengths, angles, relationships) not in the text.

REWRITE if:
- diagram is not essential
- values are duplicated in text
- question is solvable in one step
- question looks like textbook

REWRITE ANY QUESTION THAT:
- Can be solved in 1 step
- Does not require diagram (if present)
- Looks like a textbook example ("Find x")
- Uses predictable patterns
- Is too easy for A* candidates

QUESTIONS TO AUDIT:
${questionsText}

TASK:
1. Audit each question for quality, difficulty, and diagram dependency.
2. REWRITE any question that:
   - Is too easy (recall only).
   - Does not require the diagram (if present).
   - Uses textbook phrasing.
3. When rewriting:
   - Place in unfamiliar context.
   - Increase synthesis steps.
   - Ensure diagram is vital to the solution.
4. Keep the same syllabus topic and mark allocation.
5. Return ALL ${questions.length} questions (revised or unchanged).`;

  const raw = await withRetry(
    async () => {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          maxOutputTokens: 65536,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING },
                    answer: { type: Type.STRING },
                    markScheme: { type: Type.STRING },
                    marks: { type: Type.NUMBER },
                    commandWord: { type: Type.STRING },
                    type: { type: Type.STRING },
                    hasDiagram: { type: Type.BOOLEAN },
                    syllabusObjective: { type: Type.STRING, nullable: true },
                    assessmentObjective: { type: Type.STRING, nullable: true },
                    difficultyStars: { type: Type.NUMBER, nullable: true },
                    options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: [
                    "text",
                    "answer",
                    "markScheme",
                    "marks",
                    "commandWord",
                    "type",
                    "hasDiagram",
                    "options",
                  ],
                },
              },
            },
            required: ["questions"],
          },
          systemInstruction: `You are a Senior Cambridge IGCSE Chief Examiner. Your job is to ensure questions meet Cambridge standards. Be ruthless: any question solvable without its diagram (if present) or answerable from memory must be rewritten.`,
        },
      });
      const usage = getGeminiUsage(response);
      if (usage) onUsage?.(model, usage.inputTokens, usage.outputTokens);
      return safeJsonParse(response.text || "{}") as { questions: any[] };
    },
    3,
    onRetry,
  );
  return (raw.questions ?? []).map((q, i) => {
    const sanitized = sanitizeQuestion(q);
    const existing = questions[i];
    const dsl = existing?.diagramDSL;

    // Always re-enforce answer and markScheme from mathEngine — critique may rewrite
    // text/markScheme, but computed values are the single source of truth.
    let enforcedAnswer = sanitized.answer;
    let enforcedMarkScheme = sanitized.markScheme;
    if (dsl && sanitized.type !== "mcq") {
      const computedAns = computeAnswerFromDSL(dsl);
      if (computedAns) enforcedAnswer = computedAns;
      const computedMS = generateMarkSchemeFromDSL(dsl);
      if (computedMS) enforcedMarkScheme = computedMS;
    }

    // Rogue number + diagram dependency checks after critique rewrite
    let diagramMissing = existing?.diagramMissing ?? false;
    if (dsl) {
      const rogues = detectRogueNumbers(sanitized.text, dsl);
      if (rogues.length > 0) diagramMissing = true;
      const hasDiagram = existing?.hasDiagram ?? sanitized.hasDiagram;
      if (hasDiagram && !checkDiagramDependency(sanitized.text, dsl)) diagramMissing = true;
    }

    return {
      ...sanitized,
      answer: enforcedAnswer,
      markScheme: enforcedMarkScheme,
      diagram: existing?.diagram,
      hasDiagram: existing?.hasDiagram ?? sanitized.hasDiagram,
      ...(dsl ? { diagramDSL: dsl } : {}),
      ...(diagramMissing ? { diagramMissing } : {}),
      id: existing?.id ?? crypto.randomUUID(),
      code:
        existing?.code ??
        sharedGenerateQuestionCode(subject, {
          text: sanitized.text,
          syllabusObjective: sanitized.syllabusObjective,
        }),
    };
  });
}

export async function auditTest(
  subject: string,
  assessment: Assessment,
  model: string = "gemini-3.1-pro-preview",
  apiKey?: string,
  onUsage?: UsageCallback,
): Promise<QuestionItem[]> {
  const ai = getAI(apiKey);
  const questionsText = assessment.questions
    .map(
      (q, i) =>
        `**Q${i + 1}** [${q.marks} marks] (${q.commandWord})\n${q.text}\n\nAnswer: ${q.answer}\n\nMark Scheme: ${q.markScheme}`,
    )
    .join("\n\n---\n\n");

  const prompt = `You are a Principal Cambridge IGCSE Examiner and Chief Moderator for ${subject}.
Your task: rigorously audit this assessment against CAIE standards and return a corrected version.

ASSESSMENT TO REVIEW:
---
${questionsText}
---

AUDIT CRITERIA (fix ALL violations):
1. **Command Words**: Verify each command word matches its CAIE definition. "Describe" ≠ "Explain". "State" ≠ "Describe". Fix mismatches.
2. **Mark Scheme Format**: Each point must be numbered ("1. ...", "2. ..."). Alternatives must use "Accept: ..." format. Level descriptors required for ≥3 mark extended writing. Fix any paragraph-style mark schemes.
3. **Mark Allocation**: Count marking points — they must equal the marks awarded. A 3-mark question needs exactly 3 marking points. Fix mismatches.
4. **Scientific/Mathematical Accuracy**: Check all facts, equations, calculations, chemical formulae, state symbols, SI units. Fix any errors.
5. **Structured Question Format**: Multi-part questions (4+ marks) must have **(a)**, **(b)**, **(c)** sub-parts with individual mark allocations **[n]**. Fix any that don't.
6. **LaTeX**: All mathematical/chemical expressions must be in LaTeX delimiters. Fix plain-text math.
7. **syllabusObjective**: Must follow "REF – statement" format. Fix if missing or malformed.

Return the ENTIRE assessment with ALL questions (corrected or unchanged).`;

  const raw = await withRetry(async () => {
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  answer: { type: Type.STRING },
                  markScheme: { type: Type.STRING },
                  marks: { type: Type.NUMBER },
                  commandWord: { type: Type.STRING },
                  type: { type: Type.STRING },
                  hasDiagram: { type: Type.BOOLEAN },
                  syllabusObjective: { type: Type.STRING, nullable: true },
                  assessmentObjective: { type: Type.STRING, nullable: true },
                  difficultyStars: { type: Type.NUMBER, nullable: true },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                  // diagram field removed
                },
                required: [
                  "text",
                  "answer",
                  "markScheme",
                  "marks",
                  "commandWord",
                  "type",
                  "hasDiagram",
                  "options",
                ],
              },
            },
          },
          required: ["questions"],
        },
      },
    });
    const usage = getGeminiUsage(response);
    if (usage) onUsage?.(model, usage.inputTokens, usage.outputTokens);
    return safeJsonParse(response.text || "{}") as {
      questions: Omit<QuestionItem, "id">[];
    };
  });
  return (raw.questions ?? []).map((q, i) => {
    const sanitized = sanitizeQuestion(q);
    const existing = assessment.questions[i];
    return {
      ...sanitized,
      diagram: existing?.diagram,
      hasDiagram: existing?.hasDiagram ?? sanitized.hasDiagram,
      id: existing?.id ?? crypto.randomUUID(),
      code:
        existing?.code ??
        sharedGenerateQuestionCode(assessment.subject, {
          text: sanitized.text,
          syllabusObjective: sanitized.syllabusObjective,
        }),
    };
  });
}

export async function getStudentFeedback(
  subject: string,
  assessment: Assessment,
  studentAnswers: string[],
  modelName: string = "gemini-3-flash-preview",
  apiKey?: string,
): Promise<string> {
  const ai = getAI(apiKey);
  const questionsText = assessment.questions
    .map(
      (q, i) =>
        `**Q${i + 1}** [${q.marks} marks]\n${q.text}\n\nMark Scheme: ${q.markScheme}`,
    )
    .join("\n\n");
  const answersText = studentAnswers
    .map((a, i) => `Q${i + 1}: ${a || "(no answer)"}`)
    .join("\n");

  const prompt = `
    You are an expert Cambridge IGCSE Examiner for ${subject}.

    TASK:
    Evaluate the student's answers based on the provided questions and mark scheme.

    QUESTIONS AND MARK SCHEMES:
    ${questionsText}

    STUDENT ANSWERS:
    ${answersText}

    INSTRUCTIONS:
    1. Be strict but fair, following the Cambridge assessment objectives.
    2. For each question, indicate if it's correct, partially correct, or incorrect.
    3. Provide specific feedback on how to improve, referencing the "Command Words" if applicable.
    4. Give an estimated mark for each section.
    5. Summarize the student's performance and provide 3 key areas for improvement.
    6. Use Markdown for formatting.
  `;

  const response = await withRetry(() =>
    ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        systemInstruction:
          "You are a professional Cambridge IGCSE examiner. Provide constructive, precise feedback based on official mark schemes.",
      },
    }),
  );

  return response.text || "Could not generate feedback.";
}

// sanitizeQuestion is now imported from './sanitize'

function safeJsonParse(text: string) {
  return parseJsonWithRecovery(text || "{}", "Gemini");
}

function getGeminiUsage(
  response: any,
): { inputTokens: number; outputTokens: number } | null {
  const meta = response?.usageMetadata ?? response?.usage ?? null;
  if (!meta) return null;
  const inputTokens = Number(
    meta.promptTokenCount ?? meta.inputTokens ?? meta.prompt_tokens ?? 0,
  );
  const outputTokens = Number(
    meta.candidatesTokenCount ??
      meta.outputTokens ??
      meta.completion_tokens ??
      0,
  );
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens))
    return null;
  if (inputTokens <= 0 && outputTokens <= 0) return null;
  return { inputTokens, outputTokens };
}

export async function analyzeFile(
  base64Data: string,
  mimeType: string,
  subject: string,
  count: number = 3,
  model: string = "gemini-3-flash-preview",
  references?: Reference[],
  apiKey?: string,
): Promise<AnalyzeFileResult> {
  const ai = getAI(apiKey);
  const isPdf = mimeType === "application/pdf";
  const prompt = `Analyze this ${isPdf ? "past paper PDF" : "screenshot"} of a Cambridge IGCSE ${subject} question.
1. Explain the topic and learning objectives it covers.
2. Generate EXACTLY ${count} similar questions with the same concept but different context.
3. For Science subjects, indicate if a diagram is needed by setting hasDiagram=true. Do not generate SVG.
4. Each question must have: text, answer, markScheme, marks, commandWord, type (mcq/short_answer/structured), hasDiagram.
5. **FORMATTING**: Use clean markdown with clear spacing for options. Do NOT append a separate Syllabus Reference line.`;

  const parts: any[] =
    references && references.length > 0 ? buildReferenceParts(references) : [];

  parts.push({
    inlineData: {
      mimeType: mimeType,
      data: base64Data.split(",")[1] || base64Data,
    },
  });

  parts.push({ text: prompt });

  const raw = await withRetry(async () => {
    const response = await ai.models.generateContent({
      model: model,
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 8192,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            analysis: { type: Type.STRING },
            questions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  answer: { type: Type.STRING },
                  markScheme: { type: Type.STRING },
                  marks: { type: Type.NUMBER },
                  commandWord: { type: Type.STRING },
                  type: { type: Type.STRING },
                  hasDiagram: { type: Type.BOOLEAN },
                  options: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: [
                  "text",
                  "answer",
                  "markScheme",
                  "marks",
                  "commandWord",
                  "type",
                  "hasDiagram",
                  "options",
                ],
              },
            },
          },
          required: ["analysis", "questions"],
        },
        systemInstruction: `You are an expert Cambridge IGCSE ${subject} assessment designer.
Analyze past paper questions with high precision and generate similar questions.
Do NOT use SVG. Use hasDiagram=true for questions requiring diagrams.`,
      },
    });
    return safeJsonParse(response.text || "{}");
  });
  return {
    analysis: raw.analysis ?? "",
    questions: (raw.questions ?? []).map((q: any) => {
      const sanitized = sanitizeQuestion(q);
      return {
        ...sanitized,
        id: crypto.randomUUID(),
        code: sharedGenerateQuestionCode(subject, {
          text: sanitized.text,
          syllabusObjective: sanitized.syllabusObjective,
        }),
      };
    }),
  };
}
