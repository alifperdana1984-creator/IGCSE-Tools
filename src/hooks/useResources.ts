import { useState, useCallback } from 'react'
import type { User } from 'firebase/auth'
import type { Resource, ResourceType } from '../lib/types'
import type { NotifyFn } from './useNotifications'
import {
  saveResource, getResources, deleteResource as fbDelete, storage,
  updateResourceType as fbUpdateResourceType,
  updateResourceGeminiUri as fbUpdateGeminiUri,
  saveSyllabusCache, getSyllabusCache,
} from '../lib/firebase'
import { ref as storageRef, getBlob } from 'firebase/storage'

export function useResources(user: User | null, notify: NotifyFn) {
  const [resources, setResources] = useState<Resource[]>([])
  const [knowledgeBase, setKnowledgeBase] = useState<Resource[]>([])
  const [uploading, setUploading] = useState(false)

  const loadResources = useCallback(async (subject?: string) => {
    if (!user) return
    try {
      const data = await getResources(subject)
      setResources(data)
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
    } catch { /* non-critical, fail silently */ }
  }, [])

  const processSyllabus = useCallback(async (resource: Resource, apiKey: string): Promise<void> => {
    // Check if already cached
    try {
      const existing = await getSyllabusCache(resource.id)
      if (existing) return
    } catch { return }

    try {
      const sRef = storageRef(storage, resource.storagePath)
      const blob = await getBlob(sRef)
      const arrayBuffer = await blob.arrayBuffer()
      const bytes = new Uint8Array(arrayBuffer)
      let binary = ''
      bytes.forEach(b => binary += String.fromCharCode(b))
      const base64 = btoa(binary)

      // Dynamically import to avoid circular deps
      const { GoogleGenAI, Type } = await import('@google/genai')
      const ai = new GoogleGenAI({ apiKey })
      const response = await ai.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: {
          parts: [
            { inlineData: { mimeType: resource.mimeType, data: base64 } },
            { text: `Parse this Cambridge IGCSE syllabus for ${resource.subject}. Extract all learning objectives organized by topic. Return ONLY a JSON object where each key is a topic name and each value is a string with all learning objectives for that topic. Example: { "Cell Structure": "1.1 describe the structure...", "Enzymes": "2.1 describe enzyme action..." }` },
          ]
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            additionalProperties: { type: Type.STRING },
          },
        },
      })
      const topics = JSON.parse(response.text || '{}') as Record<string, string>
      if (Object.keys(topics).length > 0) {
        await saveSyllabusCache(resource.id, resource.subject, topics)
        notify(`Syllabus "${resource.name}" processed — objectives cached`, 'success')
      }
    } catch (e) {
      // Silent fail — syllabus processing is best-effort
      console.warn('Syllabus processing failed:', e)
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
    const bytes = new Uint8Array(arrayBuffer)
    let binary = ''
    bytes.forEach(b => binary += String.fromCharCode(b))
    return btoa(binary)
  }, [])

  return {
    resources, knowledgeBase, uploading,
    loadResources, uploadResource, deleteResource,
    addToKnowledgeBase, removeFromKnowledgeBase, getBase64,
    updateResourceType, updateGeminiUri, processSyllabus,
  }
}
