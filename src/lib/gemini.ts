import { GoogleGenAI, Type } from "@google/genai";
import type { QuestionItem, DiagramSpec, Assessment, AnalyzeFileResult, GenerationConfig, GeminiError } from './types'
import type { Reference } from './ai'
import type { UsageCallback } from './ai'
import { sanitizeQuestion, normalizeDiagram, generateDiagramFromText, generateQuestionCode as sharedGenerateQuestionCode } from './sanitize'
import { parseJsonWithRecovery } from './json'

function getAI(apiKey?: string) {
  if (!apiKey) {
    throw {
      type: 'unknown',
      retryable: false,
      message: 'No Gemini API key provided. Please add your key in API Settings.',
    }
  }
  return new GoogleGenAI({ apiKey });
}

const SUBJECT_CODES: Record<string, string> = {
  'Mathematics': 'MAT', 'Biology': 'BIO', 'Physics': 'PHY', 'Chemistry': 'CHM',
}

// Re-export shared helper so callers can still import generateQuestionCode from gemini
export { sharedGenerateQuestionCode as generateQuestionCode }

const DIFFICULTY_CODES: Record<string, string> = {
  'Easy': 'EAS', 'Medium': 'MED', 'Challenging': 'CHL', 'Balanced': 'BAL',
}

export function generateAssessmentCode(subject: string, difficulty: string): string {
  const subj = SUBJECT_CODES[subject] ?? subject.substring(0, 3).toUpperCase()
  const diff = DIFFICULTY_CODES[difficulty] ?? difficulty.substring(0, 3).toUpperCase()
  const shortId = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `${subj}-${diff}-${shortId}`
}

export const IGCSE_SUBJECTS = ["Mathematics", "Biology", "Physics", "Chemistry"];

export const IGCSE_TOPICS: Record<string, string[]> = {
  "Mathematics": [
    "Number", "Algebra", "Functions", "Geometry", "Trigonometry",
    "Vectors & Transformations", "Mensuration", "Coordinate Geometry",
    "Statistics", "Probability", "Mixed Topics"
  ],
  "Biology": [
    "Characteristics of Living Organisms", "Cell Structure", "Biological Molecules",
    "Enzymes", "Plant Nutrition", "Human Nutrition", "Transport in Plants",
    "Transport in Animals", "Diseases & Immunity", "Gas Exchange", "Respiration",
    "Excretion", "Coordination & Response", "Drugs", "Reproduction", "Inheritance",
    "Variation & Selection", "Organisms & Environment", "Biotechnology", "Mixed Topics"
  ],
  "Physics": [
    "Motion, Forces & Energy", "Thermal Physics", "Waves",
    "Electricity & Magnetism", "Nuclear Physics", "Space Physics", "Mixed Topics"
  ],
  "Chemistry": [
    "States of Matter", "Atoms, Elements & Compounds", "Stoichiometry",
    "Electrochemistry", "Chemical Energetics", "Chemical Reactions",
    "Acids, Bases & Salts", "The Periodic Table", "Metals",
    "Chemistry of the Environment", "Organic Chemistry", "Experimental Techniques", "Mixed Topics"
  ]
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
}

export const CAMBRIDGE_COMMAND_WORDS: Record<string, string> = {
  "State": "Express in clear terms.",
  "Name": "Identify using a recognised technical term.",
  "List": "Give a number of points with no explanation.",
  "Define": "Give the meaning of a term precisely.",
  "Label": "Add names or identifiers to a diagram.",
  "Identify": "Name or otherwise characterise.",
  "Describe": "State the points of a topic / give characteristics and main features.",
  "Explain": "Set out purposes or reasons / make the relationships between things evident / provide why and/or how and support with relevant evidence.",
  "Suggest": "Apply knowledge and understanding to situations where there are a range of valid responses in order to make proposals / put forward considerations.",
  "Evaluate": "Judge or calculate the quality, importance, amount, or value of something.",
  "Discuss": "Write about issue(s) or topic(s) in depth in a structured way.",
  "Compare": "Identify/comment on similarities and/or differences.",
  "Calculate": "Work out from given facts, figures or information.",
  "Show": "Provide structured evidence that leads to a given result.",
  "Deduce": "Reach a conclusion from the information given.",
  "Predict": "Give an expected result.",
  "Draw": "Produce a diagram.",
  "Sketch": "Make a simple freehand drawing showing key features.",
  "Determine": "Establish with certainty from information given.",
  "Outline": "Set out the main points.",
  "Justify": "Support a case with evidence/reasoning.",
  "Plot": "Mark on a graph using data provided.",
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
  onRetry?: (attempt: number) => void
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn()
    } catch (err: any) {
      const status = err?.status ?? err?.code
      if (status === 429) {
        if (i < maxRetries - 1) {
          onRetry?.(i + 1)
          await new Promise(r => setTimeout(r, Math.pow(2, i) * 5000))
          continue
        }
        throw {
          type: 'rate_limit',
          retryable: false,
          message: 'Rate limit exceeded. Please wait a few minutes and try again.',
        } satisfies GeminiError
      }
      if (status === 503) {
        throw {
          type: 'model_overloaded',
          retryable: false,
          message: 'Model is currently overloaded. Try switching to a Flash model.',
        } satisfies GeminiError
      }
      if (status === 404) {
        throw {
          type: 'unknown',
          retryable: false,
          message: 'Model not found (404). Check your model selection — the selected model may not exist or your API key may not have access to it.',
        } satisfies GeminiError
      }
      if (status === 401 || status === 403) {
        throw {
          type: 'unknown',
          retryable: false,
          message: 'Invalid or unauthorized API key. Please check your key in API Settings.',
        } satisfies GeminiError
      }
      if (status === 422 || err?.type === 'invalid_response') {
        if (i < maxRetries - 1) {
          onRetry?.(i + 1)
          await new Promise(r => setTimeout(r, 1500))
          continue
        }
        throw {
          type: 'invalid_response',
          retryable: true,
          message: 'Model returned invalid JSON. Retried automatically but still failed. Please retry.',
        } satisfies GeminiError
      }
      // Preserve original error message if available
      const originalMsg = err?.message && !err.message.startsWith('{') ? err.message : null
      throw {
        type: 'unknown',
        retryable: false,
        message: originalMsg ?? 'Generation failed. Please try again.',
      } satisfies GeminiError
    }
  }
  throw {
    type: 'rate_limit',
    retryable: false,
    message: 'Rate limit exceeded. Please wait a few minutes and try again.',
  } satisfies GeminiError
}
// -------------------------

// 48h minus 2h buffer
const GEMINI_URI_VALID_MS = 46 * 60 * 60 * 1000

const FILE_UPLOAD_TIMEOUT_MS = 120_000 // 2 minutes max for a file upload

export async function uploadToGeminiFileApi(
  base64: string,
  mimeType: string,
  displayName: string,
  apiKey: string
): Promise<string> {
  const ai = getAI(apiKey)
  const binaryStr = atob(base64)
  const bytes = new Uint8Array(binaryStr.length)
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
  const blob = new Blob([bytes], { type: mimeType })

  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`File upload timed out after ${FILE_UPLOAD_TIMEOUT_MS / 1000}s. Check your connection or try a smaller file.`)),
      FILE_UPLOAD_TIMEOUT_MS
    )
  )

  const uploaded = await Promise.race([
    ai.files.upload({ file: blob, config: { displayName, mimeType } }),
    timeoutPromise,
  ])
  return (uploaded as any).uri as string
}

export const PAST_PAPER_FOCUS: Record<string, string> = {
  Easy: `Focus EXCLUSIVELY on the easiest questions in these papers: opening questions, part (a) sub-parts, 1–2 mark items, and any question using "State", "Name", or "Define". Ignore all other questions.`,
  Medium: `Focus on the mid-section questions in these papers: 2–4 mark items, "Describe" and "Explain" questions, and calculation questions with 2–3 steps. Ignore both the very easy opening questions and the hardest final questions.`,
  Challenging: `Focus EXCLUSIVELY on the HARDEST questions in these papers: the final questions of each section, all questions worth 4+ marks, any "Evaluate", "Discuss", or extended writing question, and multi-part structured questions. These are the questions that differentiate A* from A students. Replicate ONLY this level of difficulty — completely ignore the easier questions in the papers.`,
  Balanced: `Use the full range of questions across the papers to represent all difficulty levels proportionally.`,
}

function buildReferenceParts(references: Reference[], difficulty?: string): any[] {
  const parts: any[] = []
  const pastPapers = references.filter(r => r.resourceType === 'past_paper')
  const syllabuses = references.filter(r => r.resourceType === 'syllabus')
  const others = references.filter(r => !r.resourceType || r.resourceType === 'other')

  if (pastPapers.length > 0) {
    const focusInstruction = difficulty ? (PAST_PAPER_FOCUS[difficulty] ?? '') : ''
    parts.push({ text: `REFERENCE PAST PAPERS (${pastPapers.length} document${pastPapers.length > 1 ? 's' : ''}): The following are authentic Cambridge IGCSE past papers. Study them carefully and replicate their exact question style, phrasing, command word usage, diagram style, and mark allocation patterns. Your generated questions MUST feel indistinguishable from these official papers.\n\n${focusInstruction}` })
    pastPapers.forEach(ref => {
      if (ref.pastPaperText) {
        // Use cached text extraction — much cheaper than sending the full PDF
        parts.push({ text: `PAST PAPER STYLE EXAMPLES (extracted):\n${ref.pastPaperText}` })
      } else if (ref.geminiFileUri && ref.geminiFileUploadedAt && Date.now() - ref.geminiFileUploadedAt < GEMINI_URI_VALID_MS) {
        parts.push({ fileData: { fileUri: ref.geminiFileUri, mimeType: ref.mimeType } })
      } else {
        parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data.split(',')[1] || ref.data } })
      }
    })
  }

  if (syllabuses.length > 0) {
    syllabuses.forEach(ref => {
      if (ref.syllabusText) {
        parts.push({ text: `OFFICIAL CAMBRIDGE IGCSE SYLLABUS OBJECTIVES:\nOnly generate questions that directly assess the following learning objectives. Every question must be explicitly aligned to a stated objective.\n\n${ref.syllabusText}` })
      } else {
        parts.push({ text: `OFFICIAL CAMBRIDGE IGCSE SYLLABUS: The following document is the official syllabus. Only generate questions that cover the stated learning objectives. Every question must be aligned to a specific objective listed in this syllabus.` })
        if (ref.geminiFileUri && ref.geminiFileUploadedAt && Date.now() - ref.geminiFileUploadedAt < GEMINI_URI_VALID_MS) {
          parts.push({ fileData: { fileUri: ref.geminiFileUri, mimeType: ref.mimeType } })
        } else {
          parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data.split(',')[1] || ref.data } })
        }
      }
    })
  }

  if (others.length > 0) {
    others.forEach(ref => {
      if (ref.geminiFileUri && ref.geminiFileUploadedAt && Date.now() - ref.geminiFileUploadedAt < GEMINI_URI_VALID_MS) {
        parts.push({ fileData: { fileUri: ref.geminiFileUri, mimeType: ref.mimeType } })
      } else {
        parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data.split(',')[1] || ref.data } })
      }
    })
  }

  return parts
}

/** Gemini responseSchema fragment for the structured diagram field.
 *  Flat bag of nullable fields — all 14 diagram types share one schema object.
 *  Array items stay as generic objects; sanitize.ts validates at runtime. */
const DIAGRAM_SCHEMA = {
  type: Type.OBJECT,
  nullable: true,
  properties: {
    diagramType: { type: Type.STRING },
    // cartesian_grid
    xMin: { type: Type.NUMBER, nullable: true },
    xMax: { type: Type.NUMBER, nullable: true },
    yMin: { type: Type.NUMBER, nullable: true },
    yMax: { type: Type.NUMBER, nullable: true },
    gridStep: { type: Type.NUMBER, nullable: true },
    // geometric_shape
    viewWidth: { type: Type.NUMBER, nullable: true },
    viewHeight: { type: Type.NUMBER, nullable: true },
    // number_line
    min: { type: Type.NUMBER, nullable: true },
    max: { type: Type.NUMBER, nullable: true },
    step: { type: Type.NUMBER, nullable: true },
    // shared string fields
    title:       { type: Type.STRING, nullable: true },
    xLabel:      { type: Type.STRING, nullable: true },
    yLabel:      { type: Type.STRING, nullable: true },
    subtype:     { type: Type.STRING, nullable: true },
    reactionType:{ type: Type.STRING, nullable: true },
    chartType:   { type: Type.STRING, nullable: true },
    // energy_level_diagram scalar
    showCatalystPath: { type: Type.BOOLEAN, nullable: true },
    catalystPeak:     { type: Type.NUMBER, nullable: true },
    showRatio:        { type: Type.BOOLEAN, nullable: true },
    // Stricter schema for geometry elements to prevent "rejected by normalizeDiagram"
    points: { 
      type: Type.ARRAY, nullable: true, 
      items: { 
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, nullable: true },
          x: { type: Type.NUMBER },
          y: { type: Type.NUMBER },
          label: { type: Type.STRING, nullable: true }
        },
        required: ['x', 'y']
      } 
    },
    segments: { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT, properties: { from: {type:Type.STRING}, to: {type:Type.STRING}, label: {type:Type.STRING, nullable:true} }, required: ['from', 'to'] } },
    polygons: { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    shapes:   { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    nlPoints: { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    ranges:              { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    bars:                { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    // circle_theorem
    pointsOnCircumference: { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    chords:              { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    radii:               { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    tangentPoints:       { type: Type.ARRAY, nullable: true, items: { type: Type.STRING } },
    angles:              { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    centre:              { type: Type.OBJECT, nullable: true },
    // science_graph
    xRange:              { type: Type.ARRAY, nullable: true, items: { type: Type.NUMBER } },
    yRange:              { type: Type.ARRAY, nullable: true, items: { type: Type.NUMBER } },
    datasets:            { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    annotations:         { type: Type.OBJECT, nullable: true },
    // genetic_diagram
    parent1:             { type: Type.OBJECT, nullable: true },
    parent2:             { type: Type.OBJECT, nullable: true },
    gametes1:            { type: Type.ARRAY, nullable: true, items: { type: Type.STRING } },
    gametes2:            { type: Type.ARRAY, nullable: true, items: { type: Type.STRING } },
    punnettGridRows:     { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    hiddenCells:         { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    individuals:         { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    relationships:       { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    // energy_level_diagram
    reactants:           { type: Type.OBJECT, nullable: true },
    products:            { type: Type.OBJECT, nullable: true },
    activationEnergy:    { type: Type.OBJECT, nullable: true },
    energyChange:        { type: Type.OBJECT, nullable: true },
    // food_web
    organisms:           { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    arrows:              { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    // energy_pyramid
    levels:              { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    hiddenOrganisms:     { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    // flowchart
    nodes:               { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    connections:         { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    hiddenNodes:         { type: Type.ARRAY, nullable: true, items: { type: Type.STRING } },
    // svg_template (Layer 2)
    templateId:   { type: Type.STRING, nullable: true },
    svgLabels:    { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    // tikz (Layer 3)
    tikzCode:     { type: Type.STRING, nullable: true },
    parallel:     { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    perpendicular:{ type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    labels:       { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
  },
}

/** Non-nullable top-level schema for diagram spec generation calls.
 *  DIAGRAM_SCHEMA has nullable:true (needed when embedded in question schema),
 *  but Gemini rejects nullable top-level schemas — so we use this for spec calls. */
const DIAGRAM_SPEC_SCHEMA = {
  ...DIAGRAM_SCHEMA,
  nullable: false,
}

/** Phase 1: generate diagram specs for questions that need one.
 *  Each spec is a complete DiagramSpec JSON — the ground truth that Phase 2 writes questions around.
 *  One API call per question, all run in parallel. Temperature 0.3 for determinism. */
async function generateDiagramSpecs(
  specs: Array<{ index: number; topic: string; questionType: string; diagramHint: string }>,
  subject: string,
  model: string,
  ai: ReturnType<typeof getAI>,
  onUsage?: UsageCallback,
  onLog?: (msg: string) => void,
): Promise<Array<{ index: number; diagram: DiagramSpec } | null>> {
  const DIAGRAM_TYPE_DOCS = buildDiagramTypeDocs(subject)

  return Promise.all(specs.map(async (spec) => {
    const prompt = `You are generating a Cambridge IGCSE ${subject} exam diagram.

TASK: Produce a complete, precise diagram JSON for a ${spec.questionType} question on the topic "${spec.topic}".
DIAGRAM HINT: ${spec.diagramHint}

RULES:
- Pick EXACTLY ONE diagramType and fill in ALL required fields for that type.
- ALL numeric values must be plain integers or decimals — never null, never strings.
- Invent specific, realistic numbers (e.g. side lengths, temperatures, coordinates) — these become the ground truth that the question text will be written around.
- Coordinate Space: Use a logical 0-10 or 0-100 grid. Ensure shapes fit within view.
- Angle labels: ONLY the value or variable — "72°" or "x", NEVER "angle EAF = 72°".

${DIAGRAM_TYPE_DOCS}`

    try {
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          responseMimeType: 'application/json',
          maxOutputTokens: 8192,
          temperature: 0.3,
          responseSchema: DIAGRAM_SPEC_SCHEMA,
        },
      })
      const usage = getGeminiUsage(response)
      if (usage) onUsage?.(model, usage.inputTokens, usage.outputTokens)
      const raw = response.text
      if (!raw) { onLog?.(`[spec ${spec.index}] empty response`); return null }
      let parsed: unknown
      try { parsed = JSON.parse(raw) } catch { onLog?.(`[spec ${spec.index}] JSON parse failed: ${raw?.slice(0, 120)}`); return null }
      const diagram = normalizeDiagram(parsed)
      if (diagram) {
        onLog?.(`[spec ${spec.index}] type=${diagram.diagramType} → OK`)
        return { index: spec.index, diagram }
      }
      onLog?.(`[spec ${spec.index}] type=${(parsed as any)?.diagramType ?? '?'} → rejected by normalizeDiagram`)
      return null
    } catch (err) {
      onLog?.(`[spec ${spec.index}] error: ${String(err).slice(0, 100)}`)
      return null
    }
  }))
}

/** Builds concise diagram type documentation for the given subject. */
function buildDiagramTypeDocs(subject: string): string {
  const math = `MATHEMATICS diagram types:
• "geometry" — triangles, polygons, parallel lines, bearings, angles. points:[{name,x,y}] in 0-10 space. segments:[{from,to,label?}]. angles:[{at,between:[p1,p2],label}]. parallel:[{seg1,seg2}]. perpendicular:[{seg1,seg2}].
  Min 3 points. Angle labels: "72°" or "x" only — no point names.
  Right triangle example: {"diagramType":"geometry","points":[{"name":"A","x":1,"y":1},{"name":"B","x":1,"y":7},{"name":"C","x":9,"y":1}],"segments":[{"from":"A","to":"B","label":"6 cm"},{"from":"B","to":"C","label":"10 cm"},{"from":"A","to":"C"}],"perpendicular":[{"seg1":"AB","seg2":"BC"}]}
  Parallel lines example: {"diagramType":"geometry","points":[{"name":"A","x":1,"y":7},{"name":"B","x":9,"y":7},{"name":"E","x":6,"y":7},{"name":"C","x":1,"y":3},{"name":"D","x":9,"y":3},{"name":"F","x":4,"y":3}],"segments":[{"from":"A","to":"B"},{"from":"C","to":"D"},{"from":"E","to":"F"}],"parallel":[{"seg1":"AB","seg2":"CD"}],"angles":[{"at":"E","between":["A","F"],"label":"65°"}]}
• "circle_theorem" — circle with named points, chords, radii, angles. centre:{id:"O"}. pointsOnCircumference:[{id,angleDegrees}] (0°=right, 90°=top). chords:[{s1,s2}]. radii:[{s1,s2}]. angles:[{vertex,rays:[p1,p2],label}].
  Example: {"diagramType":"circle_theorem","centre":{"id":"O"},"pointsOnCircumference":[{"id":"A","angleDegrees":20},{"id":"B","angleDegrees":144},{"id":"C","angleDegrees":260}],"radii":[{"s1":"O","s2":"A"},{"s1":"O","s2":"B"}],"chords":[{"s1":"A","s2":"C"},{"s1":"B","s2":"C"}],"angles":[{"vertex":"O","rays":["A","B"],"label":"124°"},{"vertex":"C","rays":["A","B"],"label":"x"}]}
• "cartesian_grid" — coordinate grid. xMin,xMax,yMin,yMax,gridStep. points:[{label,x,y}]. segments:[{x1,y1,x2,y2}]. polygons:[{vertices:[{x,y}]}].
• "number_line" — min,max,step. nlPoints:[{value,open,label}]. ranges:[{from,to}].
• "bar_chart" — bars:[{label,value}]. title,xLabel,yLabel optional.`

  const bio = `BIOLOGY diagram types:
• "science_graph" — line graphs (enzyme, photosynthesis, population). chartType:"line_graph". xRange:[min,max], yRange:[min,max]. xLabel,yLabel,title. datasets:[{id,label,dataPoints:[{x,y}],curve:"smooth"|"linear_segments",style:"solid"|"dashed"}]. annotations:{optimumPoint:{x,y,label}}.
  Data MUST be biologically realistic — enzyme activity rises then falls after denaturation, photosynthesis plateaus at limiting factor.
  Example: {"diagramType":"science_graph","chartType":"line_graph","title":"Effect of temperature on enzyme activity","xLabel":"Temperature (°C)","yLabel":"Rate of reaction (au)","xRange":[0,70],"yRange":[0,100],"datasets":[{"id":"e","label":"Enzyme","dataPoints":[{"x":0,"y":5},{"x":10,"y":15},{"x":20,"y":35},{"x":30,"y":65},{"x":37,"y":95},{"x":45,"y":50},{"x":55,"y":10},{"x":65,"y":0}],"curve":"smooth","style":"solid"}],"annotations":{"optimumPoint":{"x":37,"y":95,"label":"Optimum 37°C"}}}
• "genetic_diagram" — Punnett squares. subtype:"punnett_square". parent1/parent2:{label,genotype}. gametes1/gametes2:[alleles]. punnettGridRows:[{"row":["RR","Rr"]},{"row":["Rr","rr"]}]. hiddenCells:[].
• "food_web" — organisms:[{id,label,trophicLevel,x,y}] y=0 producers, y=8+ apex. arrows:[{from,to}] prey→predator direction.
• "energy_pyramid" — subtype:"numbers"|"biomass"|"energy". levels:[{trophicLevel,organism,value,unit}] levels[0]=producer (bottom). hiddenOrganisms:[].
• "flowchart" — nodes:[{id,text,shape:"diamond"|"rectangle"|"rounded_rectangle"}]. connections:[{from,to,label?}]. hiddenNodes:[].
• "svg_template" — templateId + svgLabels:[{anchorId,text}]. Templates: "bio/animal_cell" (anchorIds: cell_membrane,nucleus,nuclear_membrane,nucleolus,mitochondrion,golgi_apparatus,rough_er,ribosome,lysosome,vacuole,cytoplasm), "bio/plant_cell" (cell_wall,cell_membrane,nucleus,nucleolus,chloroplast,central_vacuole,tonoplast,mitochondrion,golgi_apparatus,cytoplasm), "bio/leaf_cross_section" (upper_epidermis,cuticle,palisade_mesophyll,chloroplast,spongy_mesophyll,air_space,lower_epidermis,guard_cell,stoma,xylem,phloem,vascular_bundle).`

  const chem = `CHEMISTRY diagram types:
• "science_graph" — rate of reaction, heating curves, pH titration. Same format as Biology. For heating curves use curve:"linear_segments".
  Rate example: {"diagramType":"science_graph","chartType":"line_graph","title":"Volume of gas collected vs time","xLabel":"Time (s)","yLabel":"Volume of gas (cm³)","xRange":[0,120],"yRange":[0,60],"datasets":[{"id":"fast","label":"Higher temperature","dataPoints":[{"x":0,"y":0},{"x":10,"y":22},{"x":20,"y":40},{"x":35,"y":52},{"x":60,"y":55}],"curve":"smooth","style":"solid"},{"id":"slow","label":"Lower temperature","dataPoints":[{"x":0,"y":0},{"x":20,"y":12},{"x":40,"y":30},{"x":70,"y":50},{"x":100,"y":55}],"curve":"smooth","style":"dashed"}]}
• "energy_level_diagram" — reactionType:"exothermic"|"endothermic". reactants:{label,energyLevel}. products:{label,energyLevel}. activationEnergy:{peak,label} — peak MUST be > both levels. energyChange:{label:"ΔH = –890 kJ/mol"}. showCatalystPath:false.
• "svg_template" — templateId + svgLabels. Templates: "chem/electrolysis" (beaker,electrolyte,cathode,anode,negative_electrode,positive_electrode,power_supply,gas_at_cathode,gas_at_anode), "chem/simple_distillation" (flask,liquid,thermometer,condenser,water_in,water_out,collecting_flask,distillate,heat).
• "tikz" — ONLY for apparatus with no matching svg_template (chromatography, filtration, titration setup). tikzCode: full \\begin{tikzpicture}...\\end{tikzpicture}. Double all backslashes in JSON strings.`

  const phys = `PHYSICS diagram types:
• "science_graph" — motion graphs (v-t, s-t), force-extension, cooling curves. Same format as Biology science_graph.
• "geometry" — force diagrams, ray diagrams (use named points for object/image/lens), wave diagrams.
• "cartesian_grid" — coordinate-based physics problems.`

  const parts: string[] = []
  if (subject === 'Mathematics') parts.push(math)
  else if (subject === 'Biology') parts.push(bio)
  else if (subject === 'Chemistry') parts.push(chem)
  else if (subject === 'Physics') parts.push(phys)
  else parts.push(math, bio, chem, phys)
  return parts.join('\n\n')
}

/** Used by the UI "Regenerate Diagram" button — regenerates diagrams for already-written questions.
 *  This is the repair path, not the main generation path. */
export async function regenerateDiagramsForQuestions(
  questions: QuestionItem[],
  subject: string,
  model: string = 'gemini-2.0-flash',
  apiKey?: string,
  onUsage?: UsageCallback,
  onLog?: (msg: string) => void,
): Promise<Array<{ id: string; diagram: DiagramSpec }>> {
  const ai = getAI(apiKey)
  const DIAGRAM_TYPE_DOCS = buildDiagramTypeDocs(subject)
  const results = await Promise.all(
    questions.map(async q => {
      const optText = q.options?.length ? `\nMCQ options: ${q.options.join(' | ')}` : ''
      const msText = q.markScheme ? `\nMark scheme: ${q.markScheme}` : ''
      const prompt = `Generate a replacement diagram JSON for this Cambridge IGCSE ${subject} question.

QUESTION: ${q.text}${optText}
Answer: ${q.answer}${msText}

Use the EXACT numbers and values from the question above. Do not invent different values.

${DIAGRAM_TYPE_DOCS}`
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          config: { responseMimeType: 'application/json', maxOutputTokens: 8192, temperature: 0.2, responseSchema: DIAGRAM_SCHEMA },
        })
        const usage = getGeminiUsage(response)
        if (usage) onUsage?.(model, usage.inputTokens, usage.outputTokens)
        const raw = response.text
        if (!raw) return null
        let parsed: unknown
        try { parsed = JSON.parse(raw) } catch { return null }
        const diagram = normalizeDiagram(parsed)
        if (diagram) { onLog?.(`[repair ${q.id.slice(0,6)}] OK`); return { id: q.id, diagram } }
        const fallback = generateDiagramFromText(q.text, q.answer, q.options ?? [])
        if (fallback) return { id: q.id, diagram: fallback }
        return null
      } catch { return null }
    })
  )
  return results.filter((v): v is { id: string; diagram: DiagramSpec } => Boolean(v))
}

// ── Two-phase question generation ────────────────────────────────────────────
//
// Phase 1 (temperature 0.3): decide WHAT each diagram-bearing question will show.
//   Output: { index, topic, questionType, diagramHint, diagram }[]
//   The diagram spec is the ground truth — concrete numbers, coordinates, data.
//
// Phase 2 (temperature 0.75): write the full question TEXT that references the
//   diagram data exactly. The diagram JSON is embedded verbatim into the prompt
//   so Gemini can read the actual coordinates/values it must mention.
//
// Questions without diagrams skip Phase 1 and go straight to Phase 2.
// ─────────────────────────────────────────────────────────────────────────────

/** Internal descriptor produced in Phase 1 for each question slot. */
interface QuestionSlot {
  index: number
  /** Short description of what the question will test, chosen by Phase 1 */
  topic: string
  questionType: 'mcq' | 'short_answer' | 'structured'
  /** Whether this question needs a diagram */
  hasDiagram: boolean
  /** Natural-language description of the diagram to generate (Phase 1 output) */
  diagramHint: string
  /** Resolved diagram spec (filled by generateDiagramSpecs, null if no diagram or failed) */
  diagram: DiagramSpec | null
}

export async function generateTest(
  config: GenerationConfig & { references?: Reference[]; apiKey?: string },
  onRetry?: (attempt: number) => void,
  onUsage?: UsageCallback,
  onLog?: (msg: string) => void,
): Promise<QuestionItem[]> {
  const ai = getAI(config.apiKey)
  const model = config.model || 'gemini-2.5-flash'
  const subjectRules = SUBJECT_SPECIFIC_RULES[config.subject] ?? ''

  // Normalise question type from UI display string to clean internal value
  const rawType = config.type.toLowerCase()
  const cleanType: 'mcq' | 'short_answer' | 'structured' | 'mixed' =
    rawType.includes('mcq') || rawType.includes('multiple') ? 'mcq' :
    rawType.includes('short') ? 'short_answer' :
    rawType.includes('structured') ? 'structured' : 'mixed'

  // ── Phase 1: Plan question slots (lightweight — no diagram data yet) ──────

  onLog?.('Phase 1: planning question slots…')

  const phase1Prompt = `You are a Cambridge IGCSE ${config.subject} Chief Examiner planning an assessment.

CONFIGURATION:
- Topic: ${config.topic}
- ${DIFFICULTY_GUIDANCE[config.difficulty] ?? `Difficulty: ${config.difficulty}`}
- Number of Questions: ${config.count}
- Question Type: ${cleanType === 'mixed' ? 'Mixed (any of: mcq, short_answer, structured)' : cleanType}
- Calculator: ${config.calculator ? 'Allowed' : 'Not Allowed'}
${config.syllabusContext ? `- Syllabus Context/Focus: ${config.syllabusContext}` : ''}

TASK: For each of the ${config.count} question slots, output:
- index: 0-based slot number
- topic: specific sub-topic to assess (must be DIFFERENT for every slot)
- questionType: one of "mcq", "short_answer", "structured" — match the configured type
- hasDiagram: true only if a visual diagram genuinely helps answer this question
- diagramHint: if hasDiagram=true, describe EXACTLY what the diagram shows with specific numbers
  e.g. "right triangle, legs 5 cm and 12 cm, right angle at B, hypotenuse unlabelled"
  If hasDiagram=false, set diagramHint to empty string "".

SUB-TOPIC DIVERSITY (strictly enforce):
- Each slot MUST test a DIFFERENT sub-topic or skill within ${config.topic}.
- Spread across the widest possible range.

Return EXACTLY ${config.count} slots.`

  const phase1Schema = {
    type: Type.OBJECT,
    properties: {
      slots: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            index:        { type: Type.NUMBER },
            topic:        { type: Type.STRING },
            questionType: { type: Type.STRING },
            hasDiagram:   { type: Type.BOOLEAN },
            diagramHint:  { type: Type.STRING },
          },
          required: ['index', 'topic', 'questionType', 'hasDiagram', 'diagramHint'],
        },
      },
    },
    required: ['slots'],
  }

  const refParts: any[] = config.references && config.references.length > 0
    ? buildReferenceParts(config.references, config.difficulty)
    : []

  const rawSlots = await withRetry(async () => {
    const response = await ai.models.generateContent({
      model,
      contents: { parts: [...refParts, { text: phase1Prompt }] },
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
        temperature: 0.4,
        responseSchema: phase1Schema,
      },
    })
    const usage = getGeminiUsage(response)
    if (usage) onUsage?.(model, usage.inputTokens, usage.outputTokens)
    const finishReason = (response as any)?.candidates?.[0]?.finishReason
    const thoughtTokens = (response as any)?.usageMetadata?.thoughtsTokenCount ?? 0
    onLog?.(`[Phase 1] length=${response.text?.length ?? 0} finishReason=${finishReason} thoughtTokens=${thoughtTokens}`)
    if (finishReason === 'MAX_TOKENS') {
      throw { type: 'invalid_response', retryable: false, message: `Generation failed: model hit token limit during planning (thinking used ${thoughtTokens} tokens). Try a shorter topic or fewer questions.` }
    }
    const parsed = safeJsonParse(response.text || '{}') as { slots: any[] }
    if (!parsed.slots || parsed.slots.length < config.count) {
      throw { type: 'invalid_response', retryable: true, message: `Phase 1 returned ${parsed.slots?.length ?? 0} slots, expected ${config.count}. Retrying…` }
    }
    return parsed.slots as Array<{ index: number; topic: string; questionType: string; hasDiagram: boolean; diagramHint: string }>
  }, 3, onRetry)

  // Normalise slots
  const validTypes = ['mcq', 'short_answer', 'structured']
  const slots: QuestionSlot[] = rawSlots.slice(0, config.count).map((s, i) => ({
    index: i,
    topic: s.topic ?? config.topic,
    questionType: (validTypes.includes(s.questionType) ? s.questionType : (cleanType === 'mixed' ? 'short_answer' : cleanType)) as QuestionSlot['questionType'],
    hasDiagram: Boolean(s.hasDiagram),
    diagramHint: s.diagramHint ?? '',
    diagram: null,
  }))

  // ── Generate diagram specs in parallel for slots that need one ────────────

  const diagramSlots = slots.filter(s => s.hasDiagram && s.diagramHint)
  if (diagramSlots.length > 0) {
    onLog?.(`Phase 1: generating ${diagramSlots.length} diagram spec${diagramSlots.length !== 1 ? 's' : ''}…`)
    const specResults = await generateDiagramSpecs(
      diagramSlots.map(s => ({ index: s.index, topic: s.topic, questionType: s.questionType, diagramHint: s.diagramHint })),
      config.subject, model, ai, onUsage, onLog
    )
    for (const result of specResults) {
      if (result) slots[result.index].diagram = result.diagram
    }
  }

  // ── Phase 2: Write questions around the locked diagram specs ─────────────

  onLog?.('Phase 2: writing questions…')

  // Build per-slot diagram context to inject into the Phase 2 prompt
  const slotDescriptions = slots.map(s => {
    const diagramSection = s.hasDiagram && s.diagram
      ? `  hasDiagram: true\n  diagram (GROUND TRUTH — your question text MUST reference these exact values):\n  ${JSON.stringify(s.diagram)}`
      : s.hasDiagram
        ? `  hasDiagram: false (diagram failed to generate — do NOT write a question that relies on a visual)`
        : `  hasDiagram: false`
    return `Q${s.index + 1}: topic="${s.topic}", type="${s.questionType}"\n${diagramSection}`
  }).join('\n\n')

  const phase2Prompt = `Generate a Cambridge IGCSE ${config.subject} assessment.

CONFIGURATION:
- Topic: ${config.topic}
- ${DIFFICULTY_GUIDANCE[config.difficulty] ?? `Difficulty: ${config.difficulty}`}
- Calculator: ${config.calculator ? 'Allowed' : 'Not Allowed'}
${config.syllabusContext ? `- Syllabus Context/Focus: ${config.syllabusContext}` : ''}

${subjectRules ? `${subjectRules}\n` : ''}${MARK_SCHEME_FORMAT}

QUESTION SLOTS (write EXACTLY these ${config.count} questions in order):
${slotDescriptions}

WRITING RULES:
1. Write EXACTLY ${config.count} questions, one per slot, in slot order.

2. DIAGRAMS: If a slot has hasDiagram=true and provides a diagram JSON above:
   - Set hasDiagram=true in your output.
   - Your question text MUST reference the exact numbers/labels shown in that diagram.
     E.g. If the diagram shows a triangle points A(0,0), B(4,0), write about a base of length 4.
     E.g. If the diagram shows a speed-time graph going to (10, 20), ask about speed at t=10.
   - Do NOT invent different values — the diagram JSON is the ground truth; it will be automatically attached.
   - Do NOT include a "diagram" field in your output (it is injected automatically).
   If hasDiagram=false, set hasDiagram=false.

3. STRUCTURED QUESTIONS (type="structured", 4+ marks):
   - 2–4 sentence scenario/stem paragraph, then **(a)**, **(b)**, **(c)** sub-parts each with mark allocation **[n]**.
   - Total marks = sum of sub-part marks. Each sub-part uses a different command word.

4. MCQ QUESTIONS: 4 options in "options" array (no letter prefix). "answer" = only "A"/"B"/"C"/"D".
   All distractors must be plausible misconceptions. Math in options: wrap in $...$.

5. SHORT ANSWER: 1–3 marks. No sub-parts.

6. LaTeX: ALL math expressions MUST be in $...$. Never write math as plain text.
   Never use bare $ as currency — write "USD 1500" or just "1500".

7. syllabusObjective: "REF – objective statement" format. ONE sentence.

8. assessmentObjective: "AO1" | "AO2" | "AO3"

9. difficultyStars: 1 | 2 | 3

10. marks: integer. MCQ always 1. Short answer 1–3. Structured = sum of sub-parts.`

  const phase2SystemInstruction = `You are a Senior Cambridge IGCSE Chief Examiner for ${config.subject} with 20+ years of experience.

CAMBRIDGE COMMAND WORDS:
${Object.entries(CAMBRIDGE_COMMAND_WORDS).map(([w, d]) => `- **${w}**: ${d}`).join('\n')}

ASSESSMENT OBJECTIVES:
- AO1: recall, state, name, define — 1–2 mark questions
- AO2: apply, calculate, interpret, deduce — 2–4 mark questions
- AO3: plan experiments, identify variables, evaluate — 2–4 mark questions

DIAGRAM RULE:
When a question slot lists hasDiagram=true with a diagram JSON, your question text MUST
reference the exact values shown in that diagram (coordinates, side lengths, labels, etc.).
It is critical that the question text matches the diagram visual.
Do NOT output a "diagram" field in your JSON.
Do NOT invent different numbers than what the diagram shows.`

  // Phase 2 schema deliberately excludes the diagram field.
  // Diagrams are injected from Phase 1 specs — asking Gemini to reproduce the full
  // diagram schema alongside long question text causes structured-output failures.
  const questionSchema = {
    type: Type.OBJECT,
    properties: {
      text:               { type: Type.STRING },
      answer:             { type: Type.STRING },
      markScheme:         { type: Type.STRING },
      marks:              { type: Type.NUMBER },
      commandWord:        { type: Type.STRING },
      type:               { type: Type.STRING },
      hasDiagram:         { type: Type.BOOLEAN },
      syllabusObjective:  { type: Type.STRING, nullable: true },
      assessmentObjective:{ type: Type.STRING, nullable: true },
      difficultyStars:    { type: Type.NUMBER, nullable: true },
      options:            { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ['text', 'answer', 'markScheme', 'marks', 'commandWord', 'type', 'hasDiagram', 'options'],
  }

  const rawQuestions = await withRetry(async () => {
    const response = await ai.models.generateContent({
      model,
      contents: { parts: [...refParts, { text: phase2Prompt }] },
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
        temperature: 0.75,
        responseSchema: { type: Type.OBJECT, properties: { questions: { type: Type.ARRAY, items: questionSchema } }, required: ['questions'] },
        systemInstruction: phase2SystemInstruction,
      },
    })
    const usage = getGeminiUsage(response)
    if (usage) onUsage?.(model, usage.inputTokens, usage.outputTokens)
    const finishReason2 = (response as any)?.candidates?.[0]?.finishReason
    const thoughtTokens2 = (response as any)?.usageMetadata?.thoughtsTokenCount ?? 0
    onLog?.(`[Phase 2] length=${response.text?.length ?? 0} finishReason=${finishReason2} thoughtTokens=${thoughtTokens2}`)
    if (finishReason2 === 'MAX_TOKENS') {
      throw { type: 'invalid_response', retryable: false, message: `Generation failed: model hit token limit while writing questions (thinking used ${thoughtTokens2} tokens). Try fewer questions or a less complex topic.` }
    }
    const parsed = safeJsonParse(response.text || '{}') as { questions: Omit<QuestionItem, 'id'>[] }
    if (!parsed.questions || parsed.questions.length < config.count) {
      throw { type: 'invalid_response', retryable: true, message: `Phase 2 returned ${parsed.questions?.length ?? 0} questions, expected ${config.count}. Retrying…` }
    }
    return parsed
  }, 3, onRetry)

  // Stitch: sanitize questions and inject Phase 1 diagram specs where Phase 2 didn't preserve them
  let questions: QuestionItem[] = (rawQuestions.questions ?? []).map((q, i) => {
    const sanitized = sanitizeQuestion(q)
    const slot = slots[i]
    // Prefer Phase 2's diagram if valid; fall back to Phase 1 spec
    const phase2Diagram = sanitized.diagram ? normalizeDiagram(sanitized.diagram) : undefined
    const resolvedDiagram = phase2Diagram ?? slot?.diagram ?? undefined
    return {
      ...sanitized,
      diagram: resolvedDiagram,
      hasDiagram: Boolean(resolvedDiagram) || sanitized.hasDiagram,
      diagramMissing: sanitized.hasDiagram && !resolvedDiagram ? true : undefined,
      id: crypto.randomUUID(),
      code: sharedGenerateQuestionCode(config.subject, {
        text: sanitized.text,
        syllabusObjective: sanitized.syllabusObjective,
      }),
    }
  })

  if (config.difficulty === 'Challenging' && questions.length > 0) {
    questions = await critiqueForDifficulty(questions, config.subject, model, ai, onRetry, onUsage)
  }

  return questions
}

async function critiqueForDifficulty(
  questions: QuestionItem[],
  subject: string,
  model: string,
  ai: ReturnType<typeof getAI>,
  onRetry?: (attempt: number) => void,
  onUsage?: UsageCallback,
): Promise<QuestionItem[]> {
  // Include diagram summary in prompt so Gemini knows the diagram exists and can reference it.
  // But we always restore the original diagram after critique — diagram rewrites are forbidden here.
  const questionsText = questions
    .map((q, i) => {
      const diagramNote = q.diagram
        ? `\n[This question has a diagram: ${q.diagram.diagramType}. Do NOT change the diagram — only rewrite the text/markScheme/commandWord if needed.]`
        : ''
      return `Q${i + 1} [${q.marks} marks] (${q.commandWord})\n${q.text}\n\nAnswer: ${q.answer}\n\nMark Scheme: ${q.markScheme}${diagramNote}`
    })
    .join('\n\n---\n\n')

  const prompt = `You are a Cambridge IGCSE Chief Examiner conducting a strict difficulty audit for ${subject}.

REQUIRED DIFFICULTY STANDARD: Challenging (A* discriminator level)
- Target: Only 10–20% of students answer fully correctly
- Command words: Evaluate, Deduce, Predict, Suggest, Discuss, Justify — NEVER State/Name/Define
- Must require 3+ distinct cognitive steps or multi-stage synthesis
- Content must be in UNFAMILIAR context — novel scenario, never a textbook example
- Mark schemes must have 4+ distinct marking points for 4+ mark questions
- A question a student can answer from memory alone FAILS this standard

QUESTIONS TO AUDIT:
${questionsText}

TASK:
1. Score each question 1–10 for difficulty (1 = trivial recall, 10 = A* discriminator question).
   Scoring guide: 1–3 = recall only; 4–6 = standard application; 7–8 = A grade synthesis; 9–10 = A* discrimination.
2. Any question scoring 6 or below MUST be rewritten to reach 8+.
3. When rewriting: place in unfamiliar context, increase synthesis steps, upgrade command word, strengthen mark scheme.
   If the question has a diagram, you may reference it differently but do NOT change the diagram data — output hasDiagram=true and omit the diagram field (it will be restored automatically).
4. Keep the same syllabus topic and mark allocation.
5. If a question is already 8+ — preserve it exactly; do NOT simplify.
6. Return ALL ${questions.length} questions (revised or unchanged).`

  const raw = await withRetry(async () => {
    const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 8192,
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          questions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text:               { type: Type.STRING },
                answer:             { type: Type.STRING },
                markScheme:         { type: Type.STRING },
                marks:              { type: Type.NUMBER },
                commandWord:        { type: Type.STRING },
                type:               { type: Type.STRING },
                hasDiagram:         { type: Type.BOOLEAN },
                syllabusObjective:  { type: Type.STRING, nullable: true },
                assessmentObjective:{ type: Type.STRING, nullable: true },
                difficultyStars:    { type: Type.NUMBER, nullable: true },
                options:            { type: Type.ARRAY, items: { type: Type.STRING } },
              },
              required: ['text', 'answer', 'markScheme', 'marks', 'commandWord', 'type', 'hasDiagram', 'options'],
            },
          },
        },
        required: ['questions'],
      },
      systemInstruction: `You are a Senior Cambridge IGCSE Chief Examiner. Your only job is to ensure questions discriminate between A and A* candidates. Be ruthless: any question a student could answer from memory or with a single step of reasoning must be rewritten. Unfamiliar contexts, multi-stage synthesis, and higher-order command words are non-negotiable. Never alter diagram data — diagrams are fixed ground truth.`,
    },
    })
    const usage = getGeminiUsage(response)
    if (usage) onUsage?.(model, usage.inputTokens, usage.outputTokens)
    return safeJsonParse(response.text || '{}') as { questions: any[] }
  }, 3, onRetry)
  return (raw.questions ?? []).map((q, i) => {
    const sanitized = sanitizeQuestion(q)
    const existing = questions[i]
    return {
      ...sanitized,
      // Always restore original diagram — critique must never change diagram data
      diagram: existing?.diagram,
      hasDiagram: existing?.hasDiagram ?? sanitized.hasDiagram,
      diagramMissing: existing?.diagramMissing,
      id: existing?.id ?? crypto.randomUUID(),
      code: existing?.code ?? sharedGenerateQuestionCode(subject, {
        text: sanitized.text,
        syllabusObjective: sanitized.syllabusObjective,
      }),
    }
  })
}

export async function auditTest(
  subject: string,
  assessment: Assessment,
  model: string = 'gemini-3.1-pro-preview',
  apiKey?: string,
  onUsage?: UsageCallback
): Promise<QuestionItem[]> {
  const ai = getAI(apiKey)
  const questionsText = assessment.questions
    .map((q, i) => `**Q${i + 1}** [${q.marks} marks] (${q.commandWord})\n${q.text}\n\nAnswer: ${q.answer}\n\nMark Scheme: ${q.markScheme}`)
    .join('\n\n---\n\n')

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
7. **SVG Attributes**: All SVG attributes must be camelCase. Fix kebab-case or snake_case.
8. **syllabusObjective**: Must follow "REF – statement" format. Fix if missing or malformed.

Return the ENTIRE assessment with ALL questions (corrected or unchanged).`

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
                diagram: DIAGRAM_SCHEMA,
              },
              required: ['text', 'answer', 'markScheme', 'marks', 'commandWord', 'type', 'hasDiagram', 'options'],
            },
          },
        },
        required: ['questions'],
      },
    },
    })
    const usage = getGeminiUsage(response)
    if (usage) onUsage?.(model, usage.inputTokens, usage.outputTokens)
    return safeJsonParse(response.text || '{}') as { questions: Omit<QuestionItem, 'id'>[] }
  })
  return (raw.questions ?? []).map((q, i) => {
    const sanitized = sanitizeQuestion(q)
    const existing = assessment.questions[i]
    return {
      ...sanitized,
      id: existing?.id ?? crypto.randomUUID(),
      code: existing?.code ?? sharedGenerateQuestionCode(assessment.subject, {
        text: sanitized.text,
        syllabusObjective: sanitized.syllabusObjective,
      }),
    }
  })
}

export async function getStudentFeedback(
  subject: string,
  assessment: Assessment,
  studentAnswers: string[],
  modelName: string = 'gemini-3-flash-preview',
  apiKey?: string
): Promise<string> {
  const ai = getAI(apiKey)
  const questionsText = assessment.questions
    .map((q, i) => `**Q${i + 1}** [${q.marks} marks]\n${q.text}\n\nMark Scheme: ${q.markScheme}`)
    .join('\n\n')
  const answersText = studentAnswers
    .map((a, i) => `Q${i + 1}: ${a || '(no answer)'}`)
    .join('\n')

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
  `

  const response = await withRetry(() => ai.models.generateContent({
    model: modelName,
    contents: prompt,
    config: {
      systemInstruction: "You are a professional Cambridge IGCSE examiner. Provide constructive, precise feedback based on official mark schemes.",
    },
  }))

  return response.text || "Could not generate feedback."
}

// sanitizeQuestion is now imported from './sanitize'

function safeJsonParse(text: string) {
  return parseJsonWithRecovery(text || '{}', 'Gemini')
}

function getGeminiUsage(response: any): { inputTokens: number; outputTokens: number } | null {
  const meta = response?.usageMetadata ?? response?.usage ?? null
  if (!meta) return null
  const inputTokens = Number(
    meta.promptTokenCount
    ?? meta.inputTokens
    ?? meta.prompt_tokens
    ?? 0
  )
  const outputTokens = Number(
    meta.candidatesTokenCount
    ?? meta.outputTokens
    ?? meta.completion_tokens
    ?? 0
  )
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null
  if (inputTokens <= 0 && outputTokens <= 0) return null
  return { inputTokens, outputTokens }
}

export async function analyzeFile(
  base64Data: string,
  mimeType: string,
  subject: string,
  count: number = 3,
  model: string = 'gemini-3-flash-preview',
  references?: Reference[],
  apiKey?: string
): Promise<AnalyzeFileResult> {
  const ai = getAI(apiKey)
  const isPdf = mimeType === "application/pdf"
  const prompt = `Analyze this ${isPdf ? "past paper PDF" : "screenshot"} of a Cambridge IGCSE ${subject} question.
1. Explain the topic and learning objectives it covers.
2. Generate EXACTLY ${count} similar questions with the same concept but different context.
3. For Science subjects, include SVG diagrams if appropriate. Use \`\`\`svg ... \`\`\` code blocks and **camelCase** attributes.
4. Each question must have: text, answer, markScheme, marks, commandWord, type (mcq/short_answer/structured), hasDiagram.
5. **FORMATTING**: Use clean markdown with clear spacing for options. Do NOT append a separate Syllabus Reference line.`

  const parts: any[] = references && references.length > 0
    ? buildReferenceParts(references)
    : []

  parts.push({
    inlineData: {
      mimeType: mimeType,
      data: base64Data.split(",")[1] || base64Data,
    },
  })

  parts.push({ text: prompt })

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
                required: ['text', 'answer', 'markScheme', 'marks', 'commandWord', 'type', 'hasDiagram', 'options'],
              },
            },
          },
          required: ['analysis', 'questions'],
        },
        systemInstruction: `You are an expert Cambridge IGCSE ${subject} assessment designer.
Analyze past paper questions with high precision and generate similar questions.
Use SVG for any diagrams using **camelCase** attributes.`,
      },
    })
    return safeJsonParse(response.text || '{}')
  })
  return {
    analysis: raw.analysis ?? '',
    questions: (raw.questions ?? []).map((q: any) => {
      const sanitized = sanitizeQuestion(q)
      return {
        ...sanitized,
        id: crypto.randomUUID(),
        code: sharedGenerateQuestionCode(subject, {
          text: sanitized.text,
          syllabusObjective: sanitized.syllabusObjective,
        }),
      }
    }),
  }
}
