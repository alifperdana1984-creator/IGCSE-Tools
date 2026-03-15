import { Timestamp } from 'firebase/firestore'

export interface QuestionItem {
  id: string
  code?: string          // e.g. BIO-6.1-A3F9
  text: string           // markdown — soru metni
  answer: string         // markdown — cevap
  markScheme: string     // markdown — puan şeması
  marks: number
  commandWord: string    // "Calculate", "Explain", vs.
  type: 'mcq' | 'short_answer' | 'structured'
  hasDiagram: boolean
}

export interface Assessment {
  id: string
  subject: string
  topic: string
  difficulty: string
  questions: QuestionItem[]
  userId: string
  folderId?: string
  createdAt: Timestamp
}

export interface Question extends QuestionItem {
  assessmentId?: string
  subject: string
  topic: string
  difficulty: string
  userId: string
  folderId?: string
  createdAt: Timestamp
}

export interface Folder {
  id: string
  name: string
  userId: string
  createdAt: Timestamp
}

export interface Resource {
  id: string
  name: string
  subject: string
  storagePath: string
  downloadURL: string
  mimeType: string
  userId: string
  createdAt: Timestamp
}

export interface GenerationConfig {
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

export interface GeminiError {
  type: 'rate_limit' | 'model_overloaded' | 'invalid_response' | 'network' | 'unknown'
  retryable: boolean
  message: string
}

export interface Notification {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
  dismissAt: number
}
