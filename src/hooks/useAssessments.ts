import { useState, useCallback } from 'react'
import type { User } from 'firebase/auth'
import type { Assessment, Question, Folder } from '../lib/types'
import type { NotifyFn } from './useNotifications'
import { generateAssessmentCode } from '../lib/gemini'
import {
  saveAssessment as fbSave,
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
      const newId = await fbSave(data)
      const existingIds = new Set(questions.map(q => q.id))
      await Promise.all(
        assessment.questions
          .filter(q => !existingIds.has(q.id))
          .map(q => {
            const { id: _id, ...qData } = q
            return fbSaveQ({
              ...qData,
              assessmentId: newId,
              subject: assessment.subject,
              topic: assessment.topic,
              difficulty: assessment.difficulty,
            })
          })
      )
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
    try {
      await fbUpdate(id, data)
      setAssessments(a => a.map(x => x.id === id ? { ...x, ...data } : x))
    } catch (e) {
      notify('Failed to update assessment', 'error')
    }
  }, [notify])

  const moveAssessment = useCallback(async (id: string, folderId: string | null) => {
    try {
      await fbMove(id, folderId)
      setAssessments(a => a.map(x => x.id === id ? { ...x, folderId: folderId ?? undefined } : x))
    } catch (e) {
      notify('Failed to move assessment', 'error')
    }
  }, [notify])

  const updateQuestion = useCallback(async (
    id: string,
    updates: Partial<Omit<Question, 'id' | 'userId' | 'createdAt'>>
  ) => {
    try {
      await fbUpdateQ(id, updates)
      setQuestions(q => q.map(x => x.id === id ? { ...x, ...updates } : x))
    } catch (e) {
      notify('Failed to update question', 'error')
    }
  }, [notify])

  const deleteQuestion = useCallback(async (id: string) => {
    try {
      await fbDeleteQ(id)
      setQuestions(q => q.filter(x => x.id !== id))
    } catch (e) {
      notify('Failed to delete question', 'error')
    }
  }, [notify])

  const moveQuestion = useCallback(async (id: string, folderId: string | null) => {
    try {
      await fbMoveQ(id, folderId)
      setQuestions(q => q.map(x => x.id === id ? { ...x, folderId: folderId ?? undefined } : x))
    } catch (e) {
      notify('Failed to move question', 'error')
    }
  }, [notify])

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
    try {
      await fbUpdateFolder(id, name)
      setFolders(f => f.map(x => x.id === id ? { ...x, name } : x))
    } catch (e) {
      notify('Failed to rename folder', 'error')
    }
  }, [notify])

  const togglePublicAssessment = useCallback(async (id: string, isPublic: boolean, preparedBy: string) => {
    try {
      await fbTogglePublicAssessment(id, isPublic, preparedBy)
      setAssessments(a => a.map(x => x.id === id ? { ...x, isPublic, preparedBy: isPublic ? preparedBy : undefined } : x))
    } catch (e) {
      notify('Failed to update visibility', 'error')
    }
  }, [notify])

  const togglePublicQuestion = useCallback(async (id: string, isPublic: boolean, preparedBy: string) => {
    try {
      await fbTogglePublicQuestion(id, isPublic, preparedBy)
      setQuestions(q => q.map(x => x.id === id ? { ...x, isPublic, preparedBy: isPublic ? preparedBy : undefined } : x))
    } catch (e) {
      notify('Failed to update visibility', 'error')
    }
  }, [notify])

  return {
    assessments, questions, folders, loading,
    loadAll, saveAssessment, saveQuestions,
    deleteAssessment, updateAssessment, moveAssessment,
    deleteQuestion, updateQuestion, moveQuestion,
    createFolder, deleteFolder, renameFolder,
    togglePublicAssessment, togglePublicQuestion,
  }
}
