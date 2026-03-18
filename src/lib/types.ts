import { Timestamp } from 'firebase/firestore'
import type { AIProvider } from './providers'

export type { AIProvider }

// ── Structured diagram types ────────────────────────────────────────────────

export interface CartesianGridSpec {
  diagramType: 'cartesian_grid'
  xMin: number; xMax: number
  yMin: number; yMax: number
  gridStep?: number
  points?: Array<{ label: string; x: number; y: number; color?: string }>
  segments?: Array<{ x1: number; y1: number; x2: number; y2: number; label?: string; dashed?: boolean }>
  polygons?: Array<{ vertices: Array<{ x: number; y: number; label?: string }>; fill?: string }>
}

export interface GeomShapeDef {
  kind: 'triangle' | 'rectangle' | 'circle' | 'polygon' | 'line'
  vertices?: Array<{ x: number; y: number; label?: string }>
  sides?: Array<{ label: string; fromVertex: number; toVertex: number }>
  rightAngleAt?: number
  x?: number; y?: number; width?: number; height?: number
  cx?: number; cy?: number; radius?: number
  fill?: string; stroke?: string
  labels?: Array<{ text: string; x: number; y: number }>
}

export interface GeometricShapeSpec {
  diagramType: 'geometric_shape'
  viewWidth?: number; viewHeight?: number
  shapes: GeomShapeDef[]
}

export interface NumberLineSpec {
  diagramType: 'number_line'
  min: number; max: number
  step?: number
  nlPoints?: Array<{ value: number; label?: string; open?: boolean }>
  ranges?: Array<{ from: number; to: number; fromOpen?: boolean; toOpen?: boolean }>
}

export interface BarChartSpec {
  diagramType: 'bar_chart'
  title?: string; xLabel?: string; yLabel?: string
  bars: Array<{ label: string; value: number }>
  yMax?: number
}

/** Semantic geometry diagram — named points in 0-10 coordinate space.
 *  Renderer scales to SVG and auto-draws angle arcs, right-angle markers, parallel ticks. */
export interface GeometryDiagramSpec {
  diagramType: 'geometry'
  points: Record<string, [number, number]>
  segments?: Array<{ from: string; to: string; label?: string; dashed?: boolean }>
  angles?: Array<{ at: string; between: [string, string]; label: string }>
  parallel?: Array<[string, string]>       // e.g. ["AB","CD"] — draw tick marks
  perpendicular?: Array<[string, string]>  // e.g. ["AB","BC"] — draw square marker
  labels?: Array<{ text: string; at: string; offset?: [number, number] }>
}

/** Circle theorem diagram — circle with named points, chords, radii, tangents, angle arcs. */
export interface CircleTheoremSpec {
  diagramType: 'circle_theorem'
  centre?: { id: string }
  pointsOnCircumference: Array<{ id: string; angleDegrees: number }>
  chords?: Array<[string, string]>
  radii?: Array<[string, string]>
  tangentPoints?: string[]
  angles?: Array<{ vertex: string; rays: [string, string]; label: string }>
}

/** Multi-dataset line/scatter graph for Biology and Chemistry data questions. */
export interface ScienceGraphSpec {
  diagramType: 'science_graph'
  chartType: 'line_graph' | 'bar_chart_multi' | 'scatter_plot'
  title?: string
  xLabel?: string
  yLabel?: string
  xRange: [number, number]
  yRange: [number, number]
  datasets: Array<{
    id: string
    label?: string
    dataPoints: Array<{ x: number; y: number }>
    curve?: 'smooth' | 'linear_segments'
    style?: 'solid' | 'dashed'
  }>
  annotations?: {
    optimumPoint?: { x: number; y: number; label: string }
    plateaus?: Array<{ y: number; label: string; xStart: number; xEnd: number }>
  }
}

/** Genetics diagram — Punnett square or pedigree chart. */
export interface GeneticDiagramSpec {
  diagramType: 'genetic_diagram'
  subtype: 'punnett_square' | 'pedigree'
  // Punnett square fields
  parent1?: { label: string; genotype: string }
  parent2?: { label: string; genotype: string }
  gametes1?: string[]   // row headers
  gametes2?: string[]   // column headers
  punnettGrid?: string[][]  // [row][col] genotype strings
  hiddenCells?: Array<{ row: number; col: number; pointer: string }>
  showRatio?: boolean
  // Pedigree fields
  individuals?: Array<{ id: string; generation: number; sex: 'male' | 'female'; phenotype: 'affected' | 'unaffected'; genotype?: string; showGenotype?: boolean }>
  relationships?: Array<{ type: 'mating' | 'offspring'; between?: [string, string]; parents?: string[]; children?: string[] }>
}

/** Chemistry energy level diagram — exothermic/endothermic reaction profile. */
export interface EnergyLevelDiagramSpec {
  diagramType: 'energy_level_diagram'
  reactionType: 'exothermic' | 'endothermic'
  reactants: { label: string; energyLevel: number }
  products: { label: string; energyLevel: number }
  activationEnergy?: { peak: number; label?: string }
  energyChange?: { label?: string }
  showCatalystPath?: boolean
  catalystPeak?: number
}

/** Biology/Chemistry food web diagram — organisms at trophic levels connected by arrows. */
export interface FoodWebSpec {
  diagramType: 'food_web'
  organisms: Array<{ id: string; label: string; trophicLevel: 'producer' | 'primary_consumer' | 'secondary_consumer' | 'tertiary_consumer'; x?: number; y?: number }>
  arrows: Array<{ from: string; to: string }>
}

/** Biology pyramid of numbers/biomass/energy. levels[0] = producer (bottom/widest). */
export interface EnergyPyramidSpec {
  diagramType: 'energy_pyramid'
  subtype: 'numbers' | 'biomass' | 'energy'
  title?: string
  levels: Array<{ trophicLevel: string; organism: string; value?: number; unit?: string }>
  hiddenOrganisms?: Array<{ levelIndex: number; pointer: string }>
}

/** Flowchart for dichotomous keys, separation techniques, decision trees. */
export interface FlowchartSpec {
  diagramType: 'flowchart'
  title?: string
  nodes: Array<{ id: string; text: string; shape: 'diamond' | 'rectangle' | 'rounded_rectangle'; x?: number; y?: number }>
  connections: Array<{ from: string; to: string; label?: string }>
  hiddenNodes?: string[]
}

/** Layer 2 — pre-drawn SVG template with AI-specified labels at predefined anchor points. */
export interface SvgTemplateSpec {
  diagramType: 'svg_template'
  /** Template ID matching a key in SVG_TEMPLATES */
  templateId: string
  /** Labels to show — each references a named anchor on the template */
  labels?: Array<{ anchorId: string; text: string }>
}

/** Layer 3a — TikZ code rendered server-side via QuickLaTeX to PNG. */
export interface TikzSpec {
  diagramType: 'tikz'
  /** Full \begin{tikzpicture}...\end{tikzpicture} block or just the body. */
  code: string
}

/** Layer 3b — GeoGebra geometry applet driven by AI-generated commands. */
export interface GeoGebraSpec {
  diagramType: 'geogebra'
  /** GeoGebra commands, e.g. ["A=(0,0)", "B=(4,0)", "c=Segment(A,B)"] */
  commands: string[]
  width?: number
  height?: number
}

export type DiagramSpec = CartesianGridSpec | GeometricShapeSpec | NumberLineSpec | BarChartSpec | GeometryDiagramSpec | CircleTheoremSpec | ScienceGraphSpec | GeneticDiagramSpec | EnergyLevelDiagramSpec | FoodWebSpec | EnergyPyramidSpec | FlowchartSpec | SvgTemplateSpec | TikzSpec | GeoGebraSpec

// ────────────────────────────────────────────────────────────────────────────

export interface QuestionItem {
  id: string
  code?: string
  text: string
  answer: string
  markScheme: string
  marks: number
  commandWord: string
  type: 'mcq' | 'short_answer' | 'structured'
  hasDiagram: boolean
  /** True when the question text references a diagram but no SVG was generated — question may be unanswerable */
  diagramMissing?: boolean
  /** Structured diagram data — rendered by DiagramRenderer; preferred over raw SVG in text */
  diagram?: DiagramSpec
  syllabusObjective?: string
  difficultyStars?: 1 | 2 | 3
  /** Cambridge Assessment Objective: AO1 Knowledge, AO2 Application, AO3 Experimental */
  assessmentObjective?: 'AO1' | 'AO2' | 'AO3'
  /** MCQ options — also embedded in text by sanitizeQuestion */
  options?: string[]
}

export interface Assessment {
  id: string
  code?: string
  subject: string
  topic: string
  difficulty: string
  questions: QuestionItem[]
  userId: string
  folderId?: string
  createdAt: Timestamp
  isPublic?: boolean
  preparedBy?: string
}

export interface Question extends QuestionItem {
  assessmentId?: string
  subject: string
  topic: string
  difficulty: string
  userId: string
  folderId?: string
  createdAt: Timestamp
  isPublic?: boolean
  preparedBy?: string
}

export interface Folder {
  id: string
  name: string
  userId: string
  createdAt: Timestamp
}

export type ResourceType = 'past_paper' | 'syllabus' | 'other'

export interface Resource {
  id: string
  name: string
  subject: string
  storagePath: string
  downloadURL: string
  mimeType: string
  userId: string
  createdAt: Timestamp
  resourceType?: ResourceType
  geminiFileUri?: string
  geminiFileUploadedAt?: Timestamp
  isShared?: boolean
}

export interface SyllabusCache {
  resourceId: string
  subject: string
  topics: Record<string, string>
  processedAt: Timestamp
}

export interface PastPaperExample {
  questionText: string
  commandWord: string
  marks: number
  markScheme: string
  questionType?: string
  difficultyBand?: 'easy' | 'medium' | 'challenging'
  topic?: string
}

export interface PastPaperCache {
  resourceId: string
  subject: string
  examples?: string   // legacy plain text cache
  items?: PastPaperExample[] // structured examples for better style transfer
  summary?: string
  version?: number
  processedAt: Timestamp
}

export interface GenerationConfig {
  provider: AIProvider
  subject: string
  topic: string
  difficulty: string
  count: number
  type: string
  calculator: boolean
  model: string
  syllabusContext?: string
}

export interface AnalyzeFileResult {
  analysis: string
  questions: QuestionItem[]
}

export interface AIError {
  type: 'rate_limit' | 'model_overloaded' | 'invalid_response' | 'network' | 'unknown'
  retryable: boolean
  message: string
}

/** @deprecated use AIError */
export type GeminiError = AIError

export interface Notification {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
  dismissAt: number
}
