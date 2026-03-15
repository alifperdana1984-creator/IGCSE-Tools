import { useState, useCallback } from 'react'
import type { Assessment, QuestionItem, AnalyzeFileResult, GenerationConfig, GeminiError, Resource } from '../lib/types'
import type { NotifyFn } from './useNotifications'
import { generateTest, auditTest, getStudentFeedback as fbFeedback, analyzeFile as fbAnalyze } from '../lib/gemini'
import { Timestamp } from 'firebase/firestore'
import { auth } from '../lib/firebase'

export function useGeneration(notify: NotifyFn) {
  const [generatedAssessment, setGeneratedAssessment] = useState<Assessment | null>(null)
  const [analysisText, setAnalysisText] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isAuditing, setIsAuditing] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [error, setError] = useState<GeminiError | null>(null)

  const generate = useCallback(async (
    config: GenerationConfig,
    knowledgeBaseResources: Resource[],
    getBase64: (r: Resource) => Promise<string>
  ) => {
    setIsGenerating(true)
    setRetryCount(0)
    setError(null)
    try {
      const references = await Promise.all(
        knowledgeBaseResources.map(async r => ({
          data: await getBase64(r),
          mimeType: r.mimeType,
        }))
      )
      const questions = await generateTest({ ...config, references }, (attempt) => {
        setRetryCount(attempt)
        notify(`Rate limit, retrying (${attempt}/3)...`, 'info')
      })
      setIsAuditing(true)
      notify('Auditing assessment quality...', 'info')
      const draft: Assessment = {
        id: crypto.randomUUID(),
        subject: config.subject,
        topic: config.topic,
        difficulty: config.difficulty,
        questions,
        userId: auth.currentUser?.uid ?? '',
        createdAt: Timestamp.now(),
      }
      const auditedQuestions = await auditTest(config.subject, draft, config.model)
      setGeneratedAssessment({ ...draft, questions: auditedQuestions })
      notify('Assessment generated successfully!', 'success')
    } catch (e: any) {
      const ge = e as GeminiError
      const msg = ge.message ?? 'Failed to generate assessment'
      setError(ge)
      notify(msg, 'error')
    } finally {
      setIsGenerating(false)
      setIsAuditing(false)
    }
  }, [notify])

  const analyzeFile = useCallback(async (
    file: { base64: string; mimeType: string },
    subject: string,
    model: string,
    knowledgeBaseResources: Resource[],
    getBase64: (r: Resource) => Promise<string>
  ) => {
    setIsGenerating(true)
    setError(null)
    try {
      const references = await Promise.all(
        knowledgeBaseResources.map(async r => ({
          data: await getBase64(r),
          mimeType: r.mimeType,
        }))
      )
      const result: AnalyzeFileResult = await fbAnalyze(
        file.base64,
        file.mimeType,
        subject,
        3,
        model,
        references
      )
      setAnalysisText(result.analysis)
      setGeneratedAssessment({
        id: crypto.randomUUID(),
        subject,
        topic: 'Analyzed Content',
        difficulty: 'N/A',
        questions: result.questions,
        userId: auth.currentUser?.uid ?? '',
        createdAt: Timestamp.now(),
      })
      notify('File analyzed successfully!', 'success')
    } catch (e: any) {
      notify((e as GeminiError).message ?? 'Failed to analyze file', 'error')
    } finally {
      setIsGenerating(false)
    }
  }, [notify])

  const getStudentFeedback = useCallback(async (
    studentAnswers: string[],
    model: string
  ) => {
    if (!generatedAssessment) return
    try {
      const fb = await fbFeedback(
        generatedAssessment.subject,
        generatedAssessment,
        studentAnswers,
        model
      )
      notify('Feedback ready', 'success')
      return fb
    } catch (e) {
      notify('Failed to get feedback', 'error')
      return null
    }
  }, [generatedAssessment, notify])

  return {
    generatedAssessment,
    setGeneratedAssessment,
    analysisText,
    isGenerating,
    isAuditing,
    retryCount,
    error,
    generate,
    analyzeFile,
    getStudentFeedback,
  }
}
