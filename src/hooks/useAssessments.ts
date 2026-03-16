import { useState, useCallback } from 'react'
import type { User } from 'firebase/auth'
import type { Assessment, Question, Folder } from '../lib/types'
import type { NotifyFn } from './useNotifications'
import { generateAssessmentCode } from '../lib/gemini'
import {
  saveAssessmentWithQuestions,
  getSavedAssessments,
  deleteAssessment as fbDelete,
  updateAssessment as fbUpdate,
  moveAssessment as fbMove,
  saveQuestion as fbSaveQ,
  getQuestions,
  deleteQuestion as fbDeleteQ,
  moveQuestion as fbMoveQ,
  updateQuestion as fbUpdateQ,
  createFolder as fbCreateFolder,
  getFolders,
  deleteFolder as fbDeleteFolder,
  updateFolder as fbUpdateFolder,
  togglePublicAssessment as fbTogglePublicAssessment,
  togglePublicQuestion as fbTogglePublicQuestion,
} from '../lib/firebase'

export function useAssessments(user: User | null, notify: NotifyFn) {
  const [assessments, setAssessments] = useState<Assessment[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(false)

  const loadAll = useCallback(async (folderId?: string) => {
    if (!user) return
    setLoading(true)
    setAssessments([])
    setQuestions([])
    try {
      const [a, q, f] = await Promise.all([
        getSavedAssessments(folderId),
        getQuestions(folderId),
        getFolders(),
      ])
      setAssessments(a)
      setQuestions(q)
      setFolders(f)
    } catch (e) {
      notify('Failed to load library', 'error')
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [user, notify])

  const saveAssessment = useCallback(async (assessment: Assessment): Promise<string | null> => {
    try {
      const { id, createdAt, userId, ...data } = assessment
      if (!data.code) data.code = generateAssessmentCode(assessment.subject, assessment.difficulty)

      // Filter out questions already in the bank to avoid duplicates
      const existingIds = new Set(questions.map(q => q.id))
      const newQuestions = assessment.questions
        .filter(q => !existingIds.has(q.id))
        .map(q => {
          const { id: _id, ...qData } = q
          return {
            ...qData,
            subject: assessment.subject,
            topic: assessment.topic,
            difficulty: assessment.difficulty,
          }
        })

      // Atomic: assessment + questions saved in a single batch commit
      const newId = await saveAssessmentWithQuestions(data, newQuestions)
      notify('Assessment saved to library', 'success')
      return newId
    } catch (e) {
      notify('Failed to save assessment', 'error')
      console.error(e)
      return null
    }
  }, [notify, questions])

  const saveQuestions = useCallback(async (
    qs: Question[]
  ): Promise<void> => {
    try {
      await Promise.all(qs.map(q => {
        const { id, createdAt, userId, ...data } = q
        return fbSaveQ(data)
      }))
    } catch (e) {
      console.error('Failed to save questions:', e)
    }
  }, [])

  const deleteAssessment = useCallback(async (id: string) => {
    try {
      await fbDelete(id)
      setAssessments(a => a.filter(x => x.id !== id))
      notify('Assessment deleted', 'info')
    } catch (e) {
      notify('Failed to delete assessment', 'error')
    }
  }, [notify])

  const updateAssessment = useCallback(async (
    id: string,
    data: Partial<Omit<Assessment, 'id' | 'userId' | 'createdAt'>>
  ) => {
    // Optimistic update with rollback on failure
    const original = assessments.find(x => x.id === id)
    setAssessments(a => a.map(x => x.id === id ? { ...x, ...data } : x))
    try {
      await fbUpdate(id, data)
    } catch (e) {
      setAssessments(a => a.map(x => x.id === id ? (original ?? x) : x))
      notify('Failed to update assessment', 'error')
    }
  }, [notify, assessments])

  const moveAssessment = useCallback(async (id: string, folderId: string | null) => {
    const original = assessments.find(x => x.id === id)
    setAssessments(a => a.map(x => x.id === id ? { ...x, folderId: folderId ?? undefined } : x))
    try {
      await fbMove(id, folderId)
    } catch (e) {
      setAssessments(a => a.map(x => x.id === id ? (original ?? x) : x))
      notify('Failed to move assessment', 'error')
    }
  }, [notify, assessments])

  const updateQuestion = useCallback(async (
    id: string,
    updates: Partial<Omit<Question, 'id' | 'userId' | 'createdAt'>>
  ) => {
    const original = questions.find(x => x.id === id)
    setQuestions(q => q.map(x => x.id === id ? { ...x, ...updates } : x))
    try {
      await fbUpdateQ(id, updates)
    } catch (e) {
      setQuestions(q => q.map(x => x.id === id ? (original ?? x) : x))
      notify('Failed to update question', 'error')
    }
  }, [notify, questions])

  const deleteQuestion = useCallback(async (id: string) => {
    try {
      await fbDeleteQ(id)
      setQuestions(q => q.filter(x => x.id !== id))
      notify('Question deleted', 'info')
    } catch (e) {
      notify('Failed to delete question', 'error')
    }
  }, [notify])

  const moveQuestion = useCallback(async (id: string, folderId: string | null) => {
    const original = questions.find(x => x.id === id)
    setQuestions(q => q.map(x => x.id === id ? { ...x, folderId: folderId ?? undefined } : x))
    try {
      await fbMoveQ(id, folderId)
    } catch (e) {
      setQuestions(q => q.map(x => x.id === id ? (original ?? x) : x))
      notify('Failed to move question', 'error')
    }
  }, [notify, questions])

  const createFolder = useCallback(async (name: string) => {
    try {
      await fbCreateFolder(name)
      await loadAll()
      notify(`Folder "${name}" created`, 'success')
    } catch (e) {
      notify('Failed to create folder', 'error')
    }
  }, [loadAll, notify])

  const deleteFolder = useCallback(async (id: string) => {
    try {
      await fbDeleteFolder(id)
      setFolders(f => f.filter(x => x.id !== id))
      notify('Folder deleted', 'info')
    } catch (e) {
      notify('Failed to delete folder', 'error')
    }
  }, [notify])

  const renameFolder = useCallback(async (id: string, name: string) => {
    const original = folders.find(x => x.id === id)
    setFolders(f => f.map(x => x.id === id ? { ...x, name } : x))
    try {
      await fbUpdateFolder(id, name)
    } catch (e) {
      setFolders(f => f.map(x => x.id === id ? (original ?? x) : x))
      notify('Failed to rename folder', 'error')
    }
  }, [notify, folders])

  const togglePublicAssessment = useCallback(async (id: string, isPublic: boolean, preparedBy: string) => {
    const original = assessments.find(x => x.id === id)
    setAssessments(a => a.map(x => x.id === id ? { ...x, isPublic, preparedBy: isPublic ? preparedBy : undefined } : x))
    try {
      await fbTogglePublicAssessment(id, isPublic, preparedBy)
    } catch (e) {
      setAssessments(a => a.map(x => x.id === id ? (original ?? x) : x))
      notify('Failed to update visibility', 'error')
    }
  }, [notify, assessments])

  const togglePublicQuestion = useCallback(async (id: string, isPublic: boolean, preparedBy: string) => {
    const original = questions.find(x => x.id === id)
    setQuestions(q => q.map(x => x.id === id ? { ...x, isPublic, preparedBy: isPublic ? preparedBy : undefined } : x))
    try {
      await fbTogglePublicQuestion(id, isPublic, preparedBy)
    } catch (e) {
      setQuestions(q => q.map(x => x.id === id ? (original ?? x) : x))
      notify('Failed to update visibility', 'error')
    }
  }, [notify, questions])

  return {
    assessments, questions, folders, loading,
    loadAll, saveAssessment, saveQuestions,
    deleteAssessment, updateAssessment, moveAssessment,
    deleteQuestion, updateQuestion, moveQuestion,
    createFolder, deleteFolder, renameFolder,
    togglePublicAssessment, togglePublicQuestion,
  }
}
