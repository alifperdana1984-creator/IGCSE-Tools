import { useState, useCallback, useRef } from 'react'
import type { User } from 'firebase/auth'
import type { Resource, ResourceType } from '../lib/types'
import type { NotifyFn } from './useNotifications'
import {
  saveResource, getResources, deleteResource as fbDelete, storage,
  updateResourceType as fbUpdateResourceType,
  updateResourceGeminiUri as fbUpdateGeminiUri,
  saveSyllabusCache, getSyllabusCache,
  savePastPaperCache, getPastPaperCache,
  toggleResourceShared as fbToggleShared,
} from '../lib/firebase'
import { ref as storageRef, getBlob } from 'firebase/storage'

/** Non-blocking base64 conversion using FileReader (avoids blocking the main thread). */
function arrayBufferToBase64(buffer: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([buffer])
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      resolve(dataUrl.split(',')[1] ?? '')
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** Wraps a promise with a timeout. Rejects with a descriptive error on expiry. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ])
}

const PROCESSING_TIMEOUT_MS = 300_000 // 5 minutes — gemini-2.5-pro needs more time for large PDFs

export function useResources(user: User | null, notify: NotifyFn) {
  const [resources, setResources] = useState<Resource[]>([])
  const [knowledgeBase, setKnowledgeBase] = useState<Resource[]>([])
  const [uploading, setUploading] = useState(false)
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set())

  // Sequential processing queue — avoids Gemini rate limits
  const processingQueue = useRef<Array<() => Promise<void>>>([])
  const queueRunning = useRef(false)

  const enqueueProcessing = useCallback((task: () => Promise<void>) => {
    processingQueue.current.push(task)
    if (queueRunning.current) return
    queueRunning.current = true
    const runNext = async () => {
      const next = processingQueue.current.shift()
      if (!next) { queueRunning.current = false; return }
      await next()
      // 3s delay between tasks to stay within free tier rate limits
      await new Promise(r => setTimeout(r, 3000))
      runNext()
    }
    runNext()
  }, [])

  const loadResources = useCallback(async (subject?: string) => {
    if (!user) return
    try {
      const data = await getResources(subject)
      setResources(data)
      // Auto-populate KB with all resources for the current subject
      setKnowledgeBase(data)
    } catch (e) {
      notify('Failed to load resources', 'error')
    }
  }, [user, notify])

  const uploadResource = useCallback(async (
    file: File,
    subject: string,
    resourceType?: ResourceType
  ): Promise<Resource | null> => {
    if (!user) { notify('Login required to save resources', 'error'); return null }
    setUploading(true)
    try {
      const arrayBuffer = await file.arrayBuffer()
      const resource = await saveResource(
        { name: file.name, data: arrayBuffer, mimeType: file.type },
        subject,
        resourceType
      )
      setResources(r => [resource, ...r])
      setKnowledgeBase(kb => kb.find(x => x.id === resource.id) ? kb : [resource, ...kb])
      notify(`"${file.name}" saved to resources`, 'success')
      return resource
    } catch (e) {
      notify('Failed to upload resource', 'error')
      return null
    } finally {
      setUploading(false)
    }
  }, [user, notify])

  const updateResourceType = useCallback(async (resource: Resource, resourceType: ResourceType) => {
    try {
      await fbUpdateResourceType(resource.id, resourceType)
      setResources(r => r.map(x => x.id === resource.id ? { ...x, resourceType } : x))
      setKnowledgeBase(kb => kb.map(x => x.id === resource.id ? { ...x, resourceType } : x))
    } catch (e) {
      notify('Failed to update resource type', 'error')
    }
  }, [notify])

  const updateGeminiUri = useCallback(async (resource: Resource, uri: string) => {
    try {
      await fbUpdateGeminiUri(resource.id, uri)
      setResources(r => r.map(x => x.id === resource.id ? { ...x, geminiFileUri: uri } : x))
      setKnowledgeBase(kb => kb.map(x => x.id === resource.id ? { ...x, geminiFileUri: uri } : x))
    } catch {
      // Non-critical: URI caching failure doesn't block generation
    }
  }, [])

  const processSyllabus = useCallback(async (resource: Resource, apiKey: string): Promise<void> => {
    try {
      const existing = await getSyllabusCache(resource.id)
      if (existing) return
    } catch { /* cache read failed — proceed with processing */ }
    setProcessingIds(s => new Set(s).add(resource.id))

    try {
      const sRef = storageRef(storage, resource.storagePath)
      const blob = await getBlob(sRef)
      const arrayBuffer = await blob.arrayBuffer()
      const base64 = await arrayBufferToBase64(arrayBuffer)

      const { GoogleGenAI, Type } = await import('@google/genai')
      const ai = new GoogleGenAI({ apiKey })
      const response = await withTimeout(
        ai.models.generateContent({
          model: 'gemini-2.5-pro',
          contents: {
            parts: [
              { inlineData: { mimeType: resource.mimeType, data: base64 } },
              { text: `You are parsing an official Cambridge IGCSE syllabus document for ${resource.subject}.

Extract ALL learning objectives, preserving:
1. The exact CAIE reference codes (e.g. "B2.3", "C4.1", "P1.2") — do NOT omit or paraphrase these.
2. The exact objective wording as written in the syllabus.
3. Core vs Extended distinctions — prefix Extended-only objectives with "[Extended] ".
4. Group objectives by their topic/section heading exactly as in the document.

Return a JSON object where each key is the topic name and each value is a string containing all objectives for that topic, one per line, with their reference codes. Example:
{
  "Cell Structure": "1.1 – Describe the structure of a typical animal cell...\\n1.2 – Describe the structure of a typical plant cell...\\n[Extended] 1.3 – Compare the structure of...",
  "Enzymes": "2.1 – Define enzyme as a biological catalyst...\\n2.2 – Describe the effect of temperature on enzyme activity..."
}

Be thorough — include every numbered objective. Do not skip any.` },
            ]
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              additionalProperties: { type: Type.STRING },
            },
          },
        }),
        PROCESSING_TIMEOUT_MS,
        'Syllabus processing'
      )
      const topics = JSON.parse(response.text || '{}') as Record<string, string>
      if (Object.keys(topics).length > 0) {
        await saveSyllabusCache(resource.id, resource.subject, topics)
        notify(`Syllabus "${resource.name}" processed — objectives cached`, 'success')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      console.warn('Syllabus processing failed:', e)
      notify(`Syllabus processing failed: ${msg}`, 'error')
    } finally {
      setProcessingIds(s => { const n = new Set(s); n.delete(resource.id); return n })
    }
  }, [notify])

  const toggleShared = useCallback(async (resource: Resource, isShared: boolean) => {
    try {
      await fbToggleShared(resource.id, isShared)
      setResources(r => r.map(x => x.id === resource.id ? { ...x, isShared } : x))
      setKnowledgeBase(kb => kb.map(x => x.id === resource.id ? { ...x, isShared } : x))
    } catch (e) {
      notify('Failed to update sharing', 'error')
    }
  }, [notify])

  const processPastPaper = useCallback(async (resource: Resource, apiKey: string): Promise<void> => {
    try {
      const existing = await getPastPaperCache(resource.id)
      if (existing && ((existing.items && existing.items.length >= 10) || (existing.examples && existing.examples.length > 100))) return
    } catch { /* cache read failed — proceed with processing */ }
    setProcessingIds(s => new Set(s).add(resource.id))

    try {
      const sRef = storageRef(storage, resource.storagePath)
      const blob = await getBlob(sRef)
      const arrayBuffer = await blob.arrayBuffer()
      const base64 = await arrayBufferToBase64(arrayBuffer)

      const { GoogleGenAI, Type } = await import('@google/genai')
      const ai = new GoogleGenAI({ apiKey })
      const response = await withTimeout(
        ai.models.generateContent({
          model: 'gemini-2.5-pro',
          contents: {
            parts: [
              { inlineData: { mimeType: resource.mimeType, data: base64 } },
              { text: `You are extracting questions from an official Cambridge IGCSE ${resource.subject} past paper for use as style references.

EXTRACTION RULES:
1. Extract ALL questions and sub-questions from the paper. For multi-part questions (a)(b)(c), extract EACH sub-part as a separate item — label them clearly (e.g. questionText: "(b)(ii) Explain why...").
2. Preserve the EXACT original wording of every question — do not paraphrase or shorten.
3. Preserve the FULL mark scheme for each question/sub-part — include every marking point, "accept" alternatives, "reject" notes, and method marks (M marks). Do NOT truncate.
4. For each item, identify:
   - commandWord: the Cambridge command word used (Describe, Explain, Calculate, State, etc.)
   - marks: the mark allocation for this specific sub-part
   - questionType: "mcq", "short_answer", or "structured"
   - difficultyBand: "easy" (1–2 marks, recall), "medium" (2–4 marks, application), or "challenging" (4+ marks, analysis/evaluation)
   - topic: the syllabus topic this question covers
   - assessmentObjective: "AO1" (knowledge/recall), "AO2" (application/problem-solving), or "AO3" (experimental/practical)
5. summary: include the paper type (e.g. "Paper 1 MCQ", "Paper 2 Structured"), approximate number of questions, mark range distribution, and dominant question types.

Extract as many items as possible — aim for complete coverage of the paper, not a sample.` },
            ]
          },
          config: {
            responseMimeType: 'application/json',
            maxOutputTokens: 65536,
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                summary: { type: Type.STRING, nullable: true },
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      questionText: { type: Type.STRING },
                      commandWord: { type: Type.STRING, nullable: true },
                      marks: { type: Type.NUMBER, nullable: true },
                      markScheme: { type: Type.STRING },
                      questionType: { type: Type.STRING, nullable: true },
                      difficultyBand: { type: Type.STRING, nullable: true },
                      topic: { type: Type.STRING, nullable: true },
                      assessmentObjective: { type: Type.STRING, nullable: true },
                    },
                    required: ['questionText', 'markScheme'],
                  },
                },
              },
              required: ['items'],
            },
          },
        }),
        PROCESSING_TIMEOUT_MS,
        'Past paper processing'
      )
      const parsed = JSON.parse(response.text || '{}') as {
        summary?: string
        items?: Array<{
          questionText?: string
          commandWord?: string
          marks?: number
          markScheme?: string
          questionType?: string
          difficultyBand?: 'easy' | 'medium' | 'challenging'
          topic?: string
          assessmentObjective?: string
        }>
      }
      const items = (parsed.items ?? [])
        .filter(x => (x.questionText ?? '').trim().length > 10 && (x.markScheme ?? '').trim().length > 5)
        .map(x => ({
          questionText: (x.questionText ?? '').trim(),
          commandWord: (x.commandWord ?? '').trim() || 'Unknown',
          marks: Number.isFinite(x.marks as number) ? Math.max(1, Math.round(Number(x.marks))) : 1,
          markScheme: (x.markScheme ?? '').trim(),
          ...(x.questionType ? { questionType: String(x.questionType).trim() } : {}),
          ...(x.difficultyBand ? { difficultyBand: x.difficultyBand } : {}),
          ...(x.topic ? { topic: String(x.topic).trim() } : {}),
          ...(x.assessmentObjective ? { assessmentObjective: String(x.assessmentObjective).trim() } : {}),
        }))
      if (items.length >= 5) {
        await savePastPaperCache(resource.id, resource.subject, {
          items,
          summary: parsed.summary?.trim() || undefined,
          version: 2,
        })
        notify(`Past paper "${resource.name}" processed � ${items.length} structured examples cached`, 'success')
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      console.warn('Past paper processing failed:', e)
      notify(`Past paper processing failed: ${msg}`, 'error')
    } finally {
      setProcessingIds(s => { const n = new Set(s); n.delete(resource.id); return n })
    }
  }, [notify])

  const deleteResource = useCallback(async (resource: Resource) => {
    try {
      await fbDelete(resource)
      setResources(r => r.filter(x => x.id !== resource.id))
      setKnowledgeBase(kb => kb.filter(x => x.id !== resource.id))
      notify(`"${resource.name}" deleted`, 'info')
    } catch (e) {
      notify('Failed to delete resource', 'error')
    }
  }, [notify])

  const addToKnowledgeBase = useCallback((resource: Resource) => {
    setKnowledgeBase(kb => {
      if (kb.find(x => x.id === resource.id)) return kb
      return [...kb, resource]
    })
  }, [])

  const removeFromKnowledgeBase = useCallback((id: string) => {
    setKnowledgeBase(kb => kb.filter(x => x.id !== id))
  }, [])

  const getBase64 = useCallback(async (resource: Resource): Promise<string> => {
    const sRef = storageRef(storage, resource.storagePath)
    const blob = await getBlob(sRef)
    const arrayBuffer = await blob.arrayBuffer()
    return arrayBufferToBase64(arrayBuffer)
  }, [])

  const queueSyllabus = useCallback((resource: Resource, apiKey: string) => {
    enqueueProcessing(() => processSyllabus(resource, apiKey))
  }, [enqueueProcessing, processSyllabus])

  const queuePastPaper = useCallback((resource: Resource, apiKey: string) => {
    enqueueProcessing(() => processPastPaper(resource, apiKey))
  }, [enqueueProcessing, processPastPaper])

  return {
    resources, knowledgeBase, uploading, processingIds,
    loadResources, uploadResource, deleteResource,
    addToKnowledgeBase, removeFromKnowledgeBase, getBase64,
    updateResourceType, updateGeminiUri, toggleShared,
    processSyllabus: queueSyllabus,
    processPastPaper: queuePastPaper,
  }
}

