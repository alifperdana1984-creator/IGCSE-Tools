/**
 * Unified AI router — delegates to the correct provider based on config.provider.
 */
import type { QuestionItem, Assessment, AnalyzeFileResult, GenerationConfig } from './types'

import {
  generateTest as geminiGenerateTest,
  auditTest as geminiAuditTest,
  getStudentFeedback as geminiGetStudentFeedback,
  analyzeFile as geminiAnalyzeFile,
} from './gemini'

import {
  generateTest as openaiGenerateTest,
  auditTest as openaiAuditTest,
  getStudentFeedback as openaiGetStudentFeedback,
  analyzeFile as openaiAnalyzeFile,
} from './openai-provider'

import {
  generateTest as anthropicGenerateTest,
  auditTest as anthropicAuditTest,
  getStudentFeedback as anthropicGetStudentFeedback,
  analyzeFile as anthropicAnalyzeFile,
} from './anthropic-provider'

export type PastPaperItem = {
  questionText: string
  commandWord: string
  marks: number
  markScheme: string
  questionType?: string
  difficultyBand?: string
  topic?: string
  tags?: string[]
  assessmentObjective?: string
  tikzCode?: string
}

export type Reference = {
  data: string
  mimeType: string
  resourceType?: string
  name?: string
  geminiFileUri?: string
  geminiFileUploadedAt?: number
  syllabusText?: string
  pastPaperText?: string
  pastPaperItems?: PastPaperItem[]
}

type WithExtra = GenerationConfig & {
  references?: Reference[]
  apiKey?: string
}

export type UsageCallback = (model: string, inputTokens: number, outputTokens: number) => void

export async function generateTest(
  config: WithExtra,
  onRetry?: (attempt: number) => void,
  onUsage?: UsageCallback,
  onLog?: (msg: string) => void,
): Promise<QuestionItem[]> {
  switch (config.provider) {
    case 'openai': return openaiGenerateTest(config, onRetry, onUsage)
    case 'anthropic': return anthropicGenerateTest(config, onRetry, onUsage)
    default: return geminiGenerateTest(config, onRetry, onUsage, onLog)
  }
}

export async function auditTest(
  subject: string,
  assessment: Assessment,
  model: string,
  provider: GenerationConfig['provider'],
  apiKey?: string,
  onUsage?: UsageCallback
): Promise<QuestionItem[]> {
  switch (provider) {
    case 'openai': return openaiAuditTest(subject, assessment, model, apiKey, onUsage)
    case 'anthropic': return anthropicAuditTest(subject, assessment, model, apiKey, onUsage)
    default: return geminiAuditTest(subject, assessment, model, apiKey, onUsage)
  }
}

export async function getStudentFeedback(
  subject: string,
  assessment: Assessment,
  studentAnswers: string[],
  model: string,
  provider: GenerationConfig['provider'],
  apiKey?: string
): Promise<string> {
  switch (provider) {
    case 'openai': return openaiGetStudentFeedback(subject, assessment, studentAnswers, model, apiKey)
    case 'anthropic': return anthropicGetStudentFeedback(subject, assessment, studentAnswers, model, apiKey)
    default: return geminiGetStudentFeedback(subject, assessment, studentAnswers, model, apiKey)
  }
}

export async function analyzeFile(
  base64Data: string,
  mimeType: string,
  subject: string,
  count: number,
  model: string,
  provider: GenerationConfig['provider'],
  references?: Reference[],
  apiKey?: string
): Promise<AnalyzeFileResult> {
  switch (provider) {
    case 'openai': return openaiAnalyzeFile(base64Data, mimeType, subject, count, model, references, apiKey)
    case 'anthropic': return anthropicAnalyzeFile(base64Data, mimeType, subject, count, model, references, apiKey)
    default: return geminiAnalyzeFile(base64Data, mimeType, subject, count, model, references, apiKey)
  }
}
