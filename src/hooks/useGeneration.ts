import { useState, useCallback } from 'react'
import type { Assessment, QuestionItem, AnalyzeFileResult, GenerationConfig, AIError, Resource } from '../lib/types'
import type { AIProvider } from '../lib/providers'
import type { NotifyFn } from './useNotifications'
import { generateTest, auditTest, getStudentFeedback as aiFeedback, analyzeFile as aiAnalyze } from '../lib/ai'
import { uploadToGeminiFileApi } from '../lib/gemini'
import { getSyllabusCache, getPastPaperCache } from '../lib/firebase'
import { Timestamp } from 'firebase/firestore'
import { auth } from '../lib/firebase'

const GEMINI_URI_VALID_MS = 46 * 60 * 60 * 1000

async function buildReferences(
  knowledgeBaseResources: Resource[],
  getBase64: (r: Resource) => Promise<string>,
  provider: AIProvider,
  apiKey?: string,
  updateGeminiUri?: (r: Resource, uri: string) => Promise<void>
) {
  return Promise.all(
    knowledgeBaseResources.map(async r => {
      // For Gemini: try to use File API URI instead of re-uploading base64 each time
      if (provider === 'gemini' && apiKey) {
        const uriAge = r.geminiFileUploadedAt
          ? Date.now() - r.geminiFileUploadedAt.toMillis()
          : Infinity
        if (r.geminiFileUri && uriAge < GEMINI_URI_VALID_MS) {
          // Valid URI — skip base64 download entirely
          return {
            data: '',
            mimeType: r.mimeType,
            resourceType: r.resourceType,
            name: r.name,
            geminiFileUri: r.geminiFileUri,
            geminiFileUploadedAt: r.geminiFileUploadedAt?.toMillis(),
          }
        }
        // For syllabus: check text cache before downloading the file
        if (r.resourceType === 'syllabus') {
          try {
            const cache = await getSyllabusCache(r.id)
            if (cache && Object.keys(cache.topics).length > 0) {
              const syllabusText = Object.entries(cache.topics)
                .map(([topic, objectives]) => `### ${topic}\n${objectives}`)
                .join('\n\n')
              return { data: '', mimeType: r.mimeType, resourceType: 'syllabus', name: r.name, syllabusText }
            }
          } catch { /* fall through to file upload */ }
        }
        // For past paper: check text cache before downloading the file
        if (r.resourceType === 'past_paper') {
          try {
            const cache = await getPastPaperCache(r.id)
            if (cache && cache.examples.length > 100) {
              return { data: '', mimeType: r.mimeType, resourceType: 'past_paper', name: r.name, pastPaperText: cache.examples }
            }
          } catch { /* fall through to file upload */ }
        }
        // URI missing or expired — download, upload to File API, save URI
        try {
          const base64 = await getBase64(r)
          const uri = await uploadToGeminiFileApi(base64, r.mimeType, r.name, apiKey)
          await updateGeminiUri?.(r, uri)
          return {
            data: base64,
            mimeType: r.mimeType,
            resourceType: r.resourceType,
            name: r.name,
            geminiFileUri: uri,
            geminiFileUploadedAt: Date.now(),
          }
        } catch {
          // File API failed — fall back to inline base64
          const base64 = await getBase64(r)
          return { data: base64, mimeType: r.mimeType, resourceType: r.resourceType, name: r.name }
        }
      }
      // Non-Gemini provider: check text caches first
      if (r.resourceType === 'syllabus') {
        try {
          const cache = await getSyllabusCache(r.id)
          if (cache && Object.keys(cache.topics).length > 0) {
            const syllabusText = Object.entries(cache.topics)
              .map(([topic, objectives]) => `### ${topic}\n${objectives}`)
              .join('\n\n')
            return { data: '', mimeType: r.mimeType, resourceType: 'syllabus', name: r.name, syllabusText }
          }
        } catch { /* fall through */ }
      }
      if (r.resourceType === 'past_paper') {
        try {
          const cache = await getPastPaperCache(r.id)
          if (cache && cache.examples.length > 100) {
            return { data: '', mimeType: r.mimeType, resourceType: 'past_paper', name: r.name, pastPaperText: cache.examples }
          }
        } catch { /* fall through */ }
      }
      const base64 = await getBase64(r)
      return { data: base64, mimeType: r.mimeType, resourceType: r.resourceType, name: r.name }
    })
  )
}

export function useGeneration(
  notify: NotifyFn,
  provider: AIProvider = 'gemini',
  apiKey?: string,
  updateGeminiUri?: (r: Resource, uri: string) => Promise<void>
) {
  const [generatedAssessment, setGeneratedAssessment] = useState<Assessment | null>(null)
  const [analysisText, setAnalysisText] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isAuditing, setIsAuditing] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [error, setError] = useState<AIError | null>(null)

  const generate = useCallback(async (
    config: GenerationConfig,
    knowledgeBaseResources: Resource[],
    getBase64: (r: Resource) => Promise<string>
  ) => {
    setIsGenerating(true)
    setRetryCount(0)
    setError(null)
    try {
      const references = await buildReferences(
        knowledgeBaseResources, getBase64, provider, apiKey, updateGeminiUri
      )
      const questions = await generateTest({ ...config, references, apiKey }, (attempt) => {
        setRetryCount(attempt)
        notify(`Rate limit hit, retrying (${attempt}/3)...`, 'info')
      })
      setIsAuditing(true)
      notify('Auditing assessment quality...', 'info')
      await new Promise(r => setTimeout(r, 3000))
      const draft: Assessment = {
        id: crypto.randomUUID(),
        subject: config.subject,
        topic: config.topic,
        difficulty: config.difficulty,
        questions,
        userId: auth.currentUser?.uid ?? '',
        createdAt: Timestamp.now(),
      }
      const auditedQuestions = await auditTest(config.subject, draft, config.model, config.provider, apiKey)
      setGeneratedAssessment({ ...draft, questions: auditedQuestions })
      notify('Assessment generated successfully!', 'success')
    } catch (e: any) {
      const ae = e as AIError
      setError(ae)
      notify(ae.message ?? 'Failed to generate assessment', 'error')
    } finally {
      setIsGenerating(false)
      setIsAuditing(false)
    }
  }, [notify, provider, apiKey])

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
      const references = await buildReferences(
        knowledgeBaseResources, getBase64, provider, apiKey, updateGeminiUri
      )
      const result: AnalyzeFileResult = await aiAnalyze(
        file.base64,
        file.mimeType,
        subject,
        3,
        model,
        provider,
        references,
        apiKey
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
      const ae = e as AIError
      setError(ae)
      notify(ae.message ?? 'Failed to analyze file', 'error')
    } finally {
      setIsGenerating(false)
    }
  }, [notify, provider, apiKey])

  const getStudentFeedback = useCallback(async (
    studentAnswers: string[],
    model: string
  ) => {
    if (!generatedAssessment) return
    try {
      const fb = await aiFeedback(
        generatedAssessment.subject,
        generatedAssessment,
        studentAnswers,
        model,
        provider,
        apiKey
      )
      notify('Feedback ready', 'success')
      return fb
    } catch {
      notify('Failed to get feedback', 'error')
      return null
    }
  }, [generatedAssessment, notify, provider, apiKey])

  return {
    generatedAssessment,
    setGeneratedAssessment,
    analysisText,
    isGenerating,
    isAuditing,
    retryCount,
    error,
    setError,
    generate,
    analyzeFile,
    getStudentFeedback,
  }
}
