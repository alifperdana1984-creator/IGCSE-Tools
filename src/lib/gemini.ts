import { GoogleGenAI, Type } from "@google/genai";
import type { QuestionItem, Assessment, AnalyzeFileResult, GenerationConfig, GeminiError, TikzSpec } from './types'
import type { Reference } from './ai'
import type { UsageCallback } from './ai'
import { sanitizeQuestion, generateQuestionCode as sharedGenerateQuestionCode } from './sanitize'
import { parseJsonWithRecovery } from './json'
import { renderDiagram } from './diagram/diagramEngine'

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

/** Fixes formatting, LaTeX, and wording issues in an existing question without changing its content.
 *  Used by the UI "Repair" button. */
export async function repairQuestionText(
  question: QuestionItem,
  subject: string,
  model: string = 'gemini-2.0-flash',
  apiKey?: string,
): Promise<Partial<QuestionItem> | null> {
  const ai = getAI(apiKey)

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
}`

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 2048,
      },
    })
    const raw = response.text?.trim()
    if (!raw) return null
    const parsed = JSON.parse(raw) as { text?: string; answer?: string; markScheme?: string }
    const updates: Partial<QuestionItem> = {}
    if (parsed.text && parsed.text !== question.text) updates.text = parsed.text
    if (parsed.answer && parsed.answer !== question.answer) updates.answer = parsed.answer
    if (parsed.markScheme && parsed.markScheme !== question.markScheme) updates.markScheme = parsed.markScheme
    return Object.keys(updates).length > 0 ? updates : null
  } catch {
    return null
  }
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
): Promise<Array<{ id: string; diagram: TikzSpec }>> {
  const ai = getAI(apiKey)
  const results = await Promise.all(
    questions.map(async q => {
      const tikzCode = await generateTikzCode(q, subject, model, ai, onLog, q.diagram?.code)
      if (tikzCode) {
        return { id: q.id, diagram: { diagramType: 'tikz' as const, code: tikzCode } }
      }
      return null
    })
  )
  return results.filter((v): v is { id: string; diagram: TikzSpec } => Boolean(v))
}

// ── Three-phase question generation ────────────────────────────────────────────
// Phase 1 (Planning): Decide question topics and types (lightweight).
// Phase 2 (Writing): Write the questions freely.
// Phase 3 (Visualization): Generate TikZ code for questions that require a diagram.
// ───────────────────────────────────────────────────────────────────────────────

/** Internal descriptor produced in Phase 1 for each question slot. */
interface QuestionSlot {
  index: number
  /** Short description of what the question will test, chosen by Phase 1 */
  topic: string
  questionType: 'mcq' | 'short_answer' | 'structured'
  /** Whether this question needs a diagram */
  hasDiagram: boolean
  diagramType?: string
  diagramData?: any
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
- hasDiagram: true only if a visual diagram is VITAL for this sub-topic.

DIAGRAM DATA (If hasDiagram=true):
You must provide structured JSON in 'diagramData' for the deterministic renderer.
NEVER write vague descriptions. Use EXACT coordinates.

Supported diagramType: "triangle"

Example (Triangle):
{
  "diagramType": "triangle",
  "diagramData": {
    "A": [0, 4],
    "B": [0, 0],
    "C": [3, 0],
    "rightAngleAt": "B"
  }
}

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
            diagramType:  { type: Type.STRING, nullable: true },
            diagramData:  {
              type: Type.OBJECT,
              nullable: true,
              properties: {
                A: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                B: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                C: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                rightAngleAt: { type: Type.STRING, nullable: true }
              }
            },
          },
          required: ['index', 'topic', 'questionType', 'hasDiagram']
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
    const parsed = safeJsonParse(response.text || '{}')
    if (!parsed.slots || parsed.slots.length < config.count) {
      throw { type: 'invalid_response', retryable: true, message: `Phase 1 returned ${parsed.slots?.length ?? 0} slots, expected ${config.count}. Retrying…` }
    }
    return parsed.slots
  }, 3, onRetry)

  // Normalise slots
  const validTypes = ['mcq', 'short_answer', 'structured']
  const slots: QuestionSlot[] = rawSlots.slice(0, config.count).map((s, i) => ({
    index: i,
    topic: s.topic ?? config.topic,
    questionType: (validTypes.includes(s.questionType) ? s.questionType : (cleanType === 'mixed' ? 'short_answer' : cleanType)) as QuestionSlot['questionType'],
    hasDiagram: Boolean(s.hasDiagram),
    diagramType: s.diagramType,
    diagramData: s.diagramData,
  }))

  // ── Phase 2: Write questions ─────────────────────────────────────────────

  onLog?.('Phase 2: writing questions…')

  // Build per-slot diagram context to inject into the Phase 2 prompt
  const slotDescriptions = slots.map(s => {
    let desc = `Q${s.index + 1}: topic="${s.topic}", type="${s.questionType}"${s.hasDiagram ? ' (needs diagram)' : ''}`;
    if (s.hasDiagram && s.diagramData) {
      desc += `\n   MANDATORY DIAGRAM DATA: ${JSON.stringify(s.diagramData)}\n   (Write the question using THESE EXACT VALUES. Do not change them.)`;
    }
    return desc;
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
   - Use the EXACT coordinates/values from the JSON in your question text.
   - Do NOT invent new numbers. The diagram is already fixed.

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

`

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
      diagramType:        { type: Type.STRING, nullable: true },
      diagramData:        { type: Type.OBJECT, nullable: true },
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
    const parsed = safeJsonParse(response.text || '{}')
    if (!parsed.questions || parsed.questions.length < config.count) {
      throw { type: 'invalid_response', retryable: true, message: `Phase 2 returned ${parsed.questions?.length ?? 0} questions, expected ${config.count}. Retrying…` }
    }
    return parsed
  }, 3, onRetry)

  // Stitch: sanitize questions
  let questions: QuestionItem[] = (rawQuestions.questions ?? []).map((q, i) => {
    const sanitized = sanitizeQuestion(q)
    const slot = slots[i]
    const hasDiagram = slot?.hasDiagram || sanitized.hasDiagram || !!slot?.diagramData
    return {
      ...sanitized,
      hasDiagram,
      diagramType: slot?.diagramType ?? sanitized.diagramType,
      diagramData: slot?.diagramData ?? sanitized.diagramData,
      id: crypto.randomUUID(),
      code: sharedGenerateQuestionCode(config.subject, {
        text: sanitized.text,
        syllabusObjective: sanitized.syllabusObjective,
      }),
    }
  })

  // ── Phase 3: Generate TikZ diagrams for questions that need them ─────────
  const diagramQuestions = questions.filter(q => q.hasDiagram)
  if (diagramQuestions.length > 0) {
    onLog?.(`Phase 3: rendering ${diagramQuestions.length} diagrams…`)
    await Promise.all(questions.map(async (q) => {
      if (q.hasDiagram) {
        // 1. Try Deterministic Render
        const deterministicTikz = renderDiagram(q)
        if (deterministicTikz) {
          q.diagram = { diagramType: 'tikz', code: deterministicTikz }
        } else {
          // 2. Fallback to AI-generated TikZ
          const tikzCode = await generateTikzCode(q, config.subject, model, ai, onLog)
          if (tikzCode) q.diagram = { diagramType: 'tikz', code: tikzCode }
        }
      }
    }))
  }

  if (config.difficulty === 'Challenging' && questions.length > 0) {
    questions = await critiqueForDifficulty(questions, config.subject, model, ai, onRetry, onUsage)
  }

  return questions
}

/** Generates complete LaTeX/TikZ code for a single question */
async function generateTikzCode(
  question: { text: string; answer: string },
  subject: string,
  model: string,
  ai: ReturnType<typeof getAI>,
  onLog?: (msg: string) => void,
  previousCode?: string,
): Promise<string | null> {
  const improvementBlock = previousCode ? `
PREVIOUS VERSION (improve accuracy — keep it concise, max 25 lines inside tikzpicture):
${previousCode}

IMPROVE BY:
- Fix any incorrect coordinates or proportions
- Add missing labels, angle marks, or tick marks
- Keep total line count inside tikzpicture ≤ 25 — do not add unnecessary commands
- Still end with \\end{tikzpicture} and \\end{document}
` : ''

  const prompt = `Generate a concise, exam-quality LaTeX/TikZ diagram for this ${subject} question.
${improvementBlock}
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
8. If no diagram is needed, output nothing (empty string).`

  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.2, maxOutputTokens: 8192 },
    })
    const text = response.text?.trim()
    const clean = text?.replace(/^```(latex|tex)?/i, '').replace(/```$/, '').trim()
    return clean || null
  } catch (err) {
    onLog?.(`TikZ generation error: ${err}`)
    return null
  }
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
   If the question has a diagram, you may reference it differently but output hasDiagram=true.
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
      diagram: existing?.diagram,
      hasDiagram: existing?.hasDiagram ?? sanitized.hasDiagram,
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
7. **syllabusObjective**: Must follow "REF – statement" format. Fix if missing or malformed.

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
                // diagram field removed
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
      diagram: existing?.diagram,
      hasDiagram: existing?.hasDiagram ?? sanitized.hasDiagram,
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
3. For Science subjects, indicate if a diagram is needed by setting hasDiagram=true. Do not generate SVG.
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
Do NOT use SVG. Use hasDiagram=true for questions requiring diagrams.`,
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
