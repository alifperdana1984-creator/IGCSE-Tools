import { Timestamp } from 'firebase/firestore'
import type { AIProvider } from './providers'

export type { AIProvider }

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
  syllabusObjective?: string
  difficultyStars?: 1 | 2 | 3
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
