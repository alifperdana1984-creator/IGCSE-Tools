import { Timestamp } from "firebase/firestore";
import type { DiagramDSL } from "./mathEngine";

export type { DiagramDSL };

export interface TikzSpec {
  diagramType: 'tikz'
  code: string
  maxWidth?: number   // px, default 480
  minHeight?: number  // px, default 0
}

export interface QuestionItem {
  id: string;
  text: string;
  answer: string;
  markScheme: string;
  marks: number;
  commandWord: string;
  type: "mcq" | "short_answer" | "structured";
  hasDiagram: boolean;
  diagram?: TikzSpec;
  /** Structured diagram DSL — single source of truth for all geometry */
  diagramDSL?: DiagramDSL;
  /** @deprecated Use diagramDSL instead */
  diagramType?: string;
  /** @deprecated Use diagramDSL instead */
  diagramData?: any;
  diagramMissing?: boolean;
  isValid?: boolean;
  code?: string;
  syllabusObjective?: string;
  assessmentObjective?: "AO1" | "AO2" | "AO3";
  difficultyStars?: 1 | 2 | 3;
  options?: string[];
}

export interface Assessment {
  id: string;
  subject: string;
  topic: string;
  difficulty: string;
  questions: QuestionItem[];
  userId: string;
  folderId?: string;
  createdAt: Timestamp;
  code?: string;
  isPublic?: boolean;
  preparedBy?: string;
}

export interface Question extends QuestionItem {
  assessmentId?: string;
  subject: string;
  topic: string;
  difficulty: string;
  userId: string;
  folderId?: string;
  createdAt: Timestamp;
  isPublic?: boolean;
  preparedBy?: string;
}

export interface Folder {
  id: string;
  name: string;
  userId: string;
  createdAt: Timestamp;
}

export type ResourceType = 'past_paper' | 'syllabus' | 'other';

export interface Resource {
  id: string;
  name: string;
  subject: string;
  storagePath: string;
  downloadURL: string;
  mimeType: string;
  userId: string;
  createdAt: Timestamp;
  resourceType?: ResourceType;
  isShared?: boolean;
  geminiFileUri?: string;
  geminiFileUploadedAt?: Timestamp;
}

export type AIProvider = 'gemini' | 'openai' | 'anthropic';

export interface GenerationConfig {
  subject: string;
  topic: string;
  difficulty: string;
  count: number;
  type: string;
  calculator: boolean;
  model: string;
  syllabusContext?: string;
  provider?: AIProvider;
}

export interface AnalyzeFileResult {
  analysis: string;
  questions: QuestionItem[];
}

export interface AIError {
  type:
    | "rate_limit"
    | "quota_exceeded"
    | "invalid_key"
    | "model_overloaded"
    | "invalid_response"
    | "network"
    | "unknown";
  retryable: boolean;
  message: string;
}

export interface GeminiError {
  type:
    | "rate_limit"
    | "model_overloaded"
    | "invalid_response"
    | "network"
    | "unknown";
  retryable: boolean;
  message: string;
}

export interface Notification {
  id: string;
  message: string;
  type: "success" | "error" | "info";
  dismissAt: number;
}

export interface SyllabusCache {
  resourceId: string;
  subject: string;
  topics: Record<string, string>;
  processedAt: Timestamp;
  userId: string | null;
}

export interface PastPaperCache {
  resourceId: string;
  subject: string;
  examples?: string;
  summary?: string;
  version?: number;
  processedAt: Timestamp;
  userId: string | null;
  items?: Array<{
    questionText: string;
    commandWord: string;
    marks: number;
    markScheme: string;
    questionType?: string;
    difficultyBand?: string;
    topic?: string;
    assessmentObjective?: string;
  }>;
}
