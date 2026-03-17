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

export type DiagramSpec = CartesianGridSpec | GeometricShapeSpec | NumberLineSpec | BarChartSpec

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
