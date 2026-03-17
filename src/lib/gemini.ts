import { GoogleGenAI, Type } from "@google/genai";
import type { QuestionItem, DiagramSpec, Assessment, AnalyzeFileResult, GenerationConfig, GeminiError } from './types'
import type { Reference } from './ai'
import type { UsageCallback } from './ai'
import { sanitizeQuestion, normalizeDiagram, generateQuestionCode as sharedGenerateQuestionCode } from './sanitize'
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
 *  Kept intentionally flat/simple — deeply nested item schemas cause Gemini
 *  structured-output failures. Array items are declared as generic objects
 *  so the model can fill them freely; sanitize.ts validates/normalises at runtime. */
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
    // bar_chart (title/xLabel/yLabel also used for other types)
    title: { type: Type.STRING, nullable: true },
    xLabel: { type: Type.STRING, nullable: true },
    yLabel: { type: Type.STRING, nullable: true },
    // geometry type — named points dict (object, not array)
    // Note: using Type.OBJECT here covers both the cartesian points array and geometry points dict
    // All array fields: untyped items to avoid schema complexity
    points:   { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    segments: { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    polygons: { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    shapes:   { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    nlPoints: { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    ranges:   { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
    bars:     { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
  },
}

/** Focused single-call diagram generation for one question.
 *  Uses a minimal schema so Gemini structured output doesn't fail. */
async function generateDiagramForQuestion(
  question: QuestionItem,
  subject: string,
  model: string,
  ai: ReturnType<typeof getAI>,
  onUsage?: UsageCallback,
): Promise<DiagramSpec | undefined> {
  const optText = question.options?.length ? `\nMCQ options: ${question.options.join(' | ')}` : ''
  const ansText = question.answer ? `\nCorrect answer: ${question.answer}` : ''
  const prompt = `Generate a diagram JSON for this Cambridge IGCSE ${subject} question.

QUESTION: ${question.text}${optText}${ansText}

Pick the correct diagramType and fill in all required fields. ALL coordinate values MUST be plain integers or decimals — never null, never strings.

• "geometry" — PREFERRED for geometry/triangle/angle/shape questions. Named points in a 0-10 coordinate space. Renderer auto-scales to SVG.
    points: {"A":[x,y],"B":[x,y],...} — 2-10 named points, coordinates in range 0-10
    segments: [{from:"A",to:"B",label:"8 cm",dashed:false}]
    angles: [{at:"B",between:["A","C"],label:"60°"}]
    parallel: [{"seg1":"AB","seg2":"CD"}] — segment pairs that are parallel (draws tick marks)
    perpendicular: [{"seg1":"AB","seg2":"BC"}] — segment pairs at 90° (draws square marker)
    labels: [{"text":"label","at":"A","dx":5,"dy":0}]
    Example right triangle with AB=8cm BC=6cm right angle B:
    {"diagramType":"geometry","points":[{"name":"A","x":1,"y":1},{"name":"B","x":1,"y":7},{"name":"C","x":9,"y":1}],"segments":[{"from":"A","to":"B","label":"8 cm"},{"from":"B","to":"C","label":"6 cm"},{"from":"A","to":"C"}],"perpendicular":[{"seg1":"AB","seg2":"BC"}]}
• "cartesian_grid" — for coordinate geometry, graphs, plotting points. xMin,xMax,yMin,yMax (integers),gridStep(1 or 2); points:[{label,x,y}]; segments:[{x1,y1,x2,y2}]
• "geometric_shape" — AVOID; use "geometry" instead for most shapes. For complex multi-shape diagrams only. Canvas 400×300 px.
• "number_line" — min,max,step; nlPoints:[{value,open,label}]; ranges:[{from,to}]
• "bar_chart" — bars:[{label,value}]; title,xLabel,yLabel optional
All label strings: plain text only, no LaTeX or dollar signs.`

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        maxOutputTokens: 768,
        temperature: 0.2,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            diagramType: { type: Type.STRING },
            xMin: { type: Type.NUMBER, nullable: true }, xMax: { type: Type.NUMBER, nullable: true },
            yMin: { type: Type.NUMBER, nullable: true }, yMax: { type: Type.NUMBER, nullable: true },
            gridStep: { type: Type.NUMBER, nullable: true },
            viewWidth: { type: Type.NUMBER, nullable: true }, viewHeight: { type: Type.NUMBER, nullable: true },
            min: { type: Type.NUMBER, nullable: true }, max: { type: Type.NUMBER, nullable: true },
            step: { type: Type.NUMBER, nullable: true },
            title: { type: Type.STRING, nullable: true },
            xLabel: { type: Type.STRING, nullable: true }, yLabel: { type: Type.STRING, nullable: true },
            points:   { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
            segments: { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
            polygons: { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
            shapes:   { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
            nlPoints: { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
            ranges:   { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
            bars:     { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
            angles:   { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
            parallel: { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
            perpendicular: { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
            labels:   { type: Type.ARRAY, nullable: true, items: { type: Type.OBJECT } },
          },
          required: ['diagramType'],
        },
      },
    })
    const usage = getGeminiUsage(response)
    if (usage) onUsage?.(model, usage.inputTokens, usage.outputTokens)
    const raw = response.text
    if (!raw) return undefined
    return normalizeDiagram(JSON.parse(raw))
  } catch {
    return undefined
  }
}

export async function generateTest(
  config: GenerationConfig & { references?: Reference[]; apiKey?: string },
  onRetry?: (attempt: number) => void,
  onUsage?: UsageCallback,
  onLog?: (msg: string) => void,
): Promise<QuestionItem[]> {
  const ai = getAI(config.apiKey)
  const subjectRules = SUBJECT_SPECIFIC_RULES[config.subject] ?? ''
  const prompt = `Generate a Cambridge IGCSE ${config.subject} assessment.

CONFIGURATION:
- Topic: ${config.topic}
- ${DIFFICULTY_GUIDANCE[config.difficulty] ?? `Difficulty: ${config.difficulty}`}
- Number of Questions: ${config.count}
- Question Type: ${config.type}
- Calculator: ${config.calculator ? "Allowed" : "Not Allowed"}
${config.syllabusContext ? `- Syllabus Context/Focus: ${config.syllabusContext}` : ""}

${subjectRules ? `${subjectRules}\n` : ""}${MARK_SCHEME_FORMAT}

GENERATION RULES:
1. Generate EXACTLY ${config.count} questions. No more, no less.

2. STRUCTURED QUESTIONS (type="structured", 4+ marks): Must use multi-part format with a shared context paragraph:
   - Write a 2–4 sentence scenario/stem paragraph first.
   - Then list sub-questions as **(a)**, **(b)**, **(c)** each with its own mark allocation in brackets, e.g. **[2]**.
   - Total marks = sum of all sub-part marks.
   - Each sub-part uses a different command word targeting different cognitive levels.

3. MCQ QUESTIONS (type="mcq"): Provide exactly 4 answer choices in the "options" array (no letter prefix). The "answer" field must be ONLY the letter "A", "B", "C", or "D". All four distractors must be plausible — each representing a common misconception. If 4 truly distinct distractor options cannot be written, use short_answer instead. For non-MCQ questions, "options" must be an empty array []. IMPORTANT: any mathematical expression in an option (variables, exponents, fractions, units, symbols) MUST be wrapped in $...$, e.g. "$2x^2 + 7x$" not "2x^2 + 7x", "$120^{\circ}$" not "120°".

4. SHORT ANSWER (type="short_answer"): 1–3 marks. Direct recall or simple application. No sub-parts needed.

5. LaTeX: ALL mathematical expressions, variables, equations, and formulas MUST be wrapped in LaTeX delimiters: $x^2$, $\\frac{a}{b}$, $H_2O$. NEVER write math as plain text. For currency amounts (e.g. dollars), write the number only ("1500") or use a word prefix ("USD 1500") — NEVER use bare $ as a currency symbol, as it conflicts with LaTeX delimiters.

6. Diagrams: If a question requires a visual element, populate the "diagram" JSON field — do NOT embed SVG in the question text. Set hasDiagram=true.
   The "diagram" field must have a "diagramType" plus its required data:

   • "cartesian_grid" — Cartesian coordinate grid.
     Required: xMin, xMax, yMin, yMax, gridStep (usually 1 or 2).
     Optional: points [{label,x,y,color}], segments [{x1,y1,x2,y2,dashed}], polygons [{vertices:[{x,y,label}],fill}].
     Example: {"diagramType":"cartesian_grid","xMin":-2,"xMax":6,"yMin":-3,"yMax":5,"gridStep":1,"points":[{"label":"P","x":3,"y":2}]}

   • "geometric_shape" — Labelled triangle, rectangle, or circle with dimension annotations.
     Canvas: 400×300 (default). Place vertices with ~40px margin.
     Example triangle (right-angled at A): A(60,260), B(340,260), C(60,80)
     Required in each shape: "kind" ("triangle"/"rectangle"/"circle"/"polygon")
     - For triangle/polygon: "vertices":[{x,y,label}], "sides":[{label:"8 cm",fromVertex:0,toVertex:1}], "rightAngleAt":0 (vertex index)
     - For rectangle: x, y, width, height; "sides" for dimension labels; corners are indexed 0=TL,1=TR,2=BR,3=BL
     - For circle: cx, cy, radius
     Optional: viewWidth, viewHeight, labels:[{text,x,y}]

   • "number_line" — Number line with marked points or inequality ranges.
     Required: min, max, step.
     Optional: nlPoints:[{value,label,open}] (open=true → hollow circle = excluded endpoint), ranges:[{from,to,fromOpen,toOpen}]

   • "bar_chart" — Bar chart for statistics questions.
     Required: bars:[{label,value}].
     Optional: title, xLabel, yLabel, yMax.

   CRITICAL DIAGRAM RULE — this is mandatory, not optional:
   • If hasDiagram=true, the "diagram" field MUST be a complete non-null object with valid data. NEVER output hasDiagram=true with diagram=null.
   • If you cannot provide valid diagram data, set hasDiagram=false and rewrite the question so it does NOT mention any visual element ("the diagram", "the grid", "shown below", etc.).
   • NEVER write "State the coordinates of point P shown on the grid" or any similar question that asks a student to read from a visual without providing that visual in the diagram field.
   • For Cartesian coordinate questions (C3.x): choose actual coordinates for point(s), plot them in the diagram, and use nearby wrong coordinates as MCQ distractors. The diagram must always accompany such questions.

7. syllabusObjective: the SPECIFIC Cambridge IGCSE learning objective assessed. Format: "REF – objective statement" (e.g. "C4.1 – Define the term acid in terms of proton donation"). ONE sentence max. Do NOT add this as a line in the question text.

8. assessmentObjective: tag each question as exactly one of:
   - "AO1" — Knowledge & understanding (recall, state, name, define, describe)
   - "AO2" — Handling information & problem solving (apply, calculate, interpret, deduce, analyse)
   - "AO3" — Experimental skills (plan experiment, identify variables, evaluate method, suggest improvements)

9. difficultyStars: 1 = recall/knowledge (1–2 marks), 2 = application/analysis (2–4 marks), 3 = evaluation/synthesis (4+ marks, multi-step, unfamiliar context).

10. marks: integer. Structured questions: sum of all sub-part marks. MCQ: always 1. Short answer: 1–3.

11. SUB-TOPIC DIVERSITY (strictly enforce): Each question in the set MUST test a DIFFERENT sub-topic or skill.
    - BEFORE writing each question, list the sub-topics already used. NEVER repeat one.
    - "Different numbers, same method" is NOT diversity — it is a violation.
    - Spread coverage across the widest possible range of distinct skills within the topic.
    - If topic is "Mixed Topics", draw from at least 3 different major topic areas.
    - Wrong: Q1=calculate gradient, Q2=calculate gradient with different points (FORBIDDEN)
    - Wrong: Q1=find midpoint, Q2=find midpoint of different segment (FORBIDDEN)
    - Right: Q1=plot coordinates, Q2=calculate gradient, Q3=find midpoint, Q4=find line equation`

  const parts: any[] = config.references && config.references.length > 0
    ? buildReferenceParts(config.references, config.difficulty)
    : []

  parts.push({ text: prompt })

  const raw = await withRetry(async () => {
    const response = await ai.models.generateContent({
    model: config.model || "gemini-3-flash-preview",
    contents: { parts },
    config: {
      responseMimeType: "application/json",
      maxOutputTokens: 8192,
      temperature: 0.75,
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
      systemInstruction: `You are a Senior Cambridge IGCSE Chief Examiner and Assessment Designer for ${config.subject} with 20+ years of experience setting papers for Cambridge Assessment International Education (CAIE).

Your questions are indistinguishable from official Cambridge IGCSE papers in terms of:
- Phrasing, command word usage, and cognitive demand
- Mark scheme precision (numbered points, accept/reject alternatives, method marks)
- Syllabus alignment (every question maps to a specific learning objective)
- Difficulty calibration (mark allocations match cognitive load exactly)

CAMBRIDGE COMMAND WORDS (use precisely as defined by CAIE):
${Object.entries(CAMBRIDGE_COMMAND_WORDS).map(([w, d]) => `- **${w}**: ${d}`).join('\n')}

ASSESSMENT OBJECTIVES:
- AO1 (Knowledge): recall, state, name, define — typically 1–2 mark questions
- AO2 (Application): apply, calculate, interpret data, deduce — typically 2–4 mark questions
- AO3 (Experimental): plan, evaluate methods, identify variables — typically 2–4 mark questions

DIAGRAMS (MANDATORY RULES):
- Use the structured "diagram" JSON field — never embed raw SVG in question text.
- If hasDiagram=true, diagram MUST be a valid non-null object. hasDiagram=true with diagram=null is FORBIDDEN.
- Choose the correct diagramType: "cartesian_grid", "geometric_shape", "number_line", or "bar_chart".
- All text labels in diagram data must be plain text — no LaTeX. Write "5.2 m" not "$5.2 \\text{ m}$", "60°" not "$60^\\circ$".
- Provide only the data needed to answer the question — no decorative or irrelevant elements.
- Cartesian coordinate questions: ALWAYS provide the cartesian_grid with points/segments plotted. This is non-negotiable.`,
    },
    })
    const usage = getGeminiUsage(response)
    if (usage) onUsage?.(config.model || "gemini-3-flash-preview", usage.inputTokens, usage.outputTokens)
    const parsed = safeJsonParse(response.text || '{}') as { questions: Omit<QuestionItem, 'id'>[] }
    if (!parsed.questions || parsed.questions.length < config.count) {
      throw {
        type: 'invalid_response',
        retryable: true,
        message: `Model returned ${parsed.questions?.length ?? 0} questions, expected ${config.count}. Retrying…`,
      }
    }
    return parsed
  }, 3, onRetry)
  let questions: QuestionItem[] = (raw.questions ?? []).map(q => {
    const sanitized = sanitizeQuestion(q)
    return {
      ...sanitized,
      id: crypto.randomUUID(),
      code: sharedGenerateQuestionCode(config.subject, {
        text: sanitized.text,
        syllabusObjective: sanitized.syllabusObjective,
      }),
    }
  })

  if (config.difficulty === 'Challenging' && questions.length > 0) {
    questions = await critiqueForDifficulty(questions, config.subject, config.model || 'gemini-3-flash-preview', ai, onRetry, onUsage)
  }

  // Phase 2: generate diagrams for questions that need one but didn't get one.
  // Use diagramMissing (not hasDiagram) because sanitizeQuestion sets hasDiagram=false
  // when diagramMissing=true, so filtering on hasDiagram would skip all amber-warning questions.
  const needsDiagram = questions.filter(q => q.diagramMissing && !q.diagram)
  if (needsDiagram.length > 0) {
    onLog?.(`Generating diagrams for ${needsDiagram.length} question${needsDiagram.length !== 1 ? 's' : ''}…`)
    const diagrams = await Promise.all(
      needsDiagram.map(q => generateDiagramForQuestion(q, config.subject, config.model || 'gemini-2.0-flash', ai, onUsage))
    )
    questions = questions.map(q => {
      const idx = needsDiagram.findIndex(nd => nd.id === q.id)
      if (idx === -1 || !diagrams[idx]) return q
      return { ...q, diagram: diagrams[idx], diagramMissing: undefined } as QuestionItem
    })
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
  const questionsText = questions
    .map((q, i) => `Q${i + 1} [${q.marks} marks] (${q.commandWord})\n${q.text}\n\nAnswer: ${q.answer}\n\nMark Scheme: ${q.markScheme}`)
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
      systemInstruction: `You are a Senior Cambridge IGCSE Chief Examiner. Your only job is to ensure questions discriminate between A and A* candidates. Be ruthless: any question a student could answer from memory or with a single step of reasoning must be rewritten. Unfamiliar contexts, multi-stage synthesis, and higher-order command words are non-negotiable.`,
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
      // Preserve original diagram if the critique pass didn't supply one
      diagram: sanitized.diagram ?? existing?.diagram,
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
