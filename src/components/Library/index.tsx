import React, { useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import { Folder as FolderIcon, Trash2, Plus, Library as LibraryIcon, Pencil, X, Check, Eye, FilePlus, FolderPlus, Loader2, Calendar, Globe } from 'lucide-react'
import type { Assessment, Question, Folder } from '../../lib/types'
import { parseSVGSafe } from '../../lib/svg'
import { preprocessLatex } from '../../lib/latex'
import { RichEditor } from '../RichEditor'

interface Props {
  assessments: Assessment[]
  questions: Question[]
  folders: Folder[]
  loading: boolean
  onSelect: (assessment: Assessment) => void
  onDeleteAssessment: (id: string) => void
  onMoveAssessment: (id: string, folderId: string | null) => void
  onRenameAssessment: (id: string, topic: string) => void
  onDeleteQuestion: (id: string) => void
  onMoveQuestion: (id: string, folderId: string | null) => void
  onCreateFolder: (name: string) => void
  onDeleteFolder: (id: string) => void
  onRenameFolder: (id: string, name: string) => void
  selectedFolderId: string | null | undefined
  onSelectFolder: (id: string | null | undefined) => void
  onCreateAssessmentFromQuestions: (questions: Question[]) => void
  onAddQuestionsToAssessment: (assessmentId: string, questions: Question[]) => void
  onUpdateQuestion: (id: string, updates: Partial<Question>) => void
  currentUserId: string
  currentUserName: string
  onTogglePublicAssessment: (id: string, isPublic: boolean) => void
  onTogglePublicQuestion: (id: string, isPublic: boolean) => void
}

const svgComponents = {
  code({ className, children }: any) {
    if (className === 'language-svg') {
      const safe = parseSVGSafe(String(children))
      if (safe) return (
        <div className="my-3 border-t-2 border-b-2 border-violet-100 py-3 bg-violet-50/30 rounded-sm">
          <p className="text-xs font-semibold text-violet-400 mb-2 flex items-center gap-1.5 px-1">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-300 inline-block" />
            Diagram
          </p>
          <div dangerouslySetInnerHTML={{ __html: safe }} style={{ fontSize: '0.85em' }} />
        </div>
      )
      return <span className="text-stone-400 text-xs italic">[Diagram unavailable]</span>
    }
    return <code className={className}>{children}</code>
  }
}


function QMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath, remarkGfm]}
      rehypePlugins={[rehypeKatex, rehypeRaw]}
      components={svgComponents}
    >
      {preprocessLatex(content)}
    </ReactMarkdown>
  )
}

function QuestionPreviewModal({
  question,
  onClose,
  onUpdate,
}: {
  question: Question
  onClose: () => void
  onUpdate?: (updates: { text: string; answer: string; markScheme: string }) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ text: question.text, answer: question.answer, markScheme: question.markScheme })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col mx-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
              {question.marks}m · {question.commandWord}
            </span>
            <span className="text-xs text-stone-400">{question.type} · {question.subject}</span>
            {question.code && (
              <span className="text-xs font-mono bg-stone-100 text-stone-600 px-1.5 py-0.5 rounded">{question.code}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {onUpdate && (
              editing ? (
                <>
                  <button
                    onClick={() => { onUpdate(draft); setEditing(false) }}
                    className="px-2.5 py-1 text-xs bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700"
                  >
                    Apply
                  </button>
                  <button
                    onClick={() => { setDraft({ text: question.text, answer: question.answer, markScheme: question.markScheme }); setEditing(false) }}
                    className="px-2.5 py-1 text-xs bg-stone-100 text-stone-600 rounded-lg font-medium hover:bg-stone-200"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  onClick={() => setEditing(true)}
                  className="p-1 text-stone-400 hover:text-emerald-600"
                  title="Edit question"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              )
            )}
            <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-4 markdown-body text-sm">
          {editing ? (
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs font-medium text-stone-600 mb-1 block">Question</label>
                <RichEditor value={draft.text} onChange={v => setDraft(d => ({ ...d, text: v }))} minRows={8} />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-600 mb-1 block">Answer</label>
                <RichEditor value={draft.answer} onChange={v => setDraft(d => ({ ...d, answer: v }))} minRows={6} />
              </div>
              <div>
                <label className="text-xs font-medium text-stone-600 mb-1 block">Mark Scheme</label>
                <RichEditor value={draft.markScheme} onChange={v => setDraft(d => ({ ...d, markScheme: v }))} minRows={6} />
              </div>
            </div>
          ) : (
            <>
              <QMarkdown content={question.text} />
              <div className="mt-4 pt-4 border-t border-stone-100">
                <p className="text-xs font-semibold text-stone-500 mb-1">Answer</p>
                <QMarkdown content={question.answer} />
              </div>
              <div className="mt-4 pt-4 border-t border-stone-100">
                <p className="text-xs font-semibold text-stone-500 mb-1">Mark Scheme</p>
                <QMarkdown content={question.markScheme} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

type DeleteTarget = { type: 'assessment' | 'question' | 'folder'; id: string; label: string }

function ConfirmDeleteModal({ target, onConfirm, onCancel, isDeleting }: {
  target: DeleteTarget
  onConfirm: () => void
  onCancel: () => void
  isDeleting?: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-5 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-semibold text-stone-800">Delete {target.type}?</h2>
        <p className="text-xs text-stone-500">
          <span className="font-medium text-stone-700">"{target.label}"</span> will be permanently deleted. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-1.5 text-xs bg-stone-100 text-stone-600 rounded-lg font-medium hover:bg-stone-200">Cancel</button>
          <button onClick={onConfirm} disabled={isDeleting} className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg font-medium hover:bg-red-700 disabled:opacity-60 flex items-center gap-1.5">
            {isDeleting && <Loader2 className="w-3 h-3 animate-spin" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

export function Library({
  assessments, questions, folders, loading,
  onSelect, onDeleteAssessment, onMoveAssessment, onRenameAssessment,
  onDeleteQuestion, onMoveQuestion,
  onCreateFolder, onDeleteFolder, onRenameFolder,
  selectedFolderId, onSelectFolder,
  onCreateAssessmentFromQuestions, onAddQuestionsToAssessment,
  onUpdateQuestion,
  currentUserId, currentUserName,
  onTogglePublicAssessment, onTogglePublicQuestion,
}: Props) {
  const [bankView, setBankView] = useState<'assessments' | 'questions'>('assessments')
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameFolderValue, setRenameFolderValue] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [previewQuestion, setPreviewQuestion] = useState<Question | null>(null)
  const [addToAssessmentId, setAddToAssessmentId] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<DeleteTarget | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [subjectFilter, setSubjectFilter] = useState<string>('')

  const subjectOptions = useMemo(() => {
    const set = new Set<string>()
    assessments.forEach(a => { if (a.subject) set.add(a.subject) })
    questions.forEach(q => { if (q.subject) set.add(q.subject) })
    return Array.from(set).sort()
  }, [assessments, questions])

  const filteredAssessments = subjectFilter
    ? assessments.filter(a => a.subject === subjectFilter)
    : assessments

  const filteredQuestions = subjectFilter
    ? questions.filter(q => q.subject === subjectFilter)
    : questions

  const handleConfirmDelete = async () => {
    if (!confirmDelete) return
    setIsDeleting(true)
    try {
      if (confirmDelete.type === 'assessment') await onDeleteAssessment(confirmDelete.id)
      else if (confirmDelete.type === 'question') await onDeleteQuestion(confirmDelete.id)
      else if (confirmDelete.type === 'folder') await onDeleteFolder(confirmDelete.id)
    } finally {
      setIsDeleting(false)
      setConfirmDelete(null)
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectedQuestions = questions.filter(q => selectedIds.has(q.id))

  const handleCreateFromSelected = () => {
    onCreateAssessmentFromQuestions(selectedQuestions)
    setSelectedIds(new Set())
  }

  const handleAddToAssessment = () => {
    if (!addToAssessmentId) return
    onAddQuestionsToAssessment(addToAssessmentId, selectedQuestions)
    setSelectedIds(new Set())
    setAddToAssessmentId('')
  }

  return (
    <div className="flex h-full overflow-hidden">
      {/* Folder Sidebar */}
      <div className="w-56 border-r border-stone-200 p-3 flex flex-col gap-2">
        <div className="flex gap-1">
          <input
            value={newFolderName}
            onChange={e => setNewFolderName(e.target.value)}
            placeholder="New folder..."
            className="flex-1 text-xs px-2 py-1 border border-stone-300 rounded"
            onKeyDown={e => {
              if (e.key === 'Enter' && newFolderName.trim()) {
                onCreateFolder(newFolderName.trim())
                setNewFolderName('')
              }
            }}
          />
          <button
            onClick={() => { if (newFolderName.trim()) { onCreateFolder(newFolderName.trim()); setNewFolderName('') } }}
            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
        <button
          onClick={() => onSelectFolder(undefined)}
          className={`text-left text-xs px-2 py-1.5 rounded flex items-center gap-1 ${selectedFolderId === undefined ? 'bg-emerald-100 text-emerald-800 font-medium' : 'hover:bg-stone-100 text-stone-600'}`}
        >
          <LibraryIcon className="w-3.5 h-3.5" /> All
        </button>
        {folders.map(f => (
          <div key={f.id} className="flex items-center gap-1 group">
            {renamingFolderId === f.id ? (
              <>
                <input
                  value={renameFolderValue}
                  onChange={e => setRenameFolderValue(e.target.value)}
                  className="flex-1 text-xs px-1.5 py-1 border border-emerald-400 rounded min-w-0"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter' && renameFolderValue.trim()) {
                      onRenameFolder(f.id, renameFolderValue.trim())
                      setRenamingFolderId(null)
                    }
                    if (e.key === 'Escape') setRenamingFolderId(null)
                  }}
                />
                <button onClick={() => { if (renameFolderValue.trim()) { onRenameFolder(f.id, renameFolderValue.trim()); setRenamingFolderId(null) } }} className="text-emerald-600 shrink-0"><Check className="w-3.5 h-3.5" /></button>
                <button onClick={() => setRenamingFolderId(null)} className="text-stone-400 shrink-0"><X className="w-3.5 h-3.5" /></button>
              </>
            ) : (
              <>
                <button
                  onClick={() => onSelectFolder(f.id)}
                  className={`flex-1 text-left text-xs px-2 py-1.5 rounded flex items-center gap-1 min-w-0 ${selectedFolderId === f.id ? 'bg-emerald-100 text-emerald-800 font-medium' : 'hover:bg-stone-100 text-stone-600'}`}
                >
                  <FolderIcon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{f.name}</span>
                </button>
                <button
                  onClick={() => { setRenamingFolderId(f.id); setRenameFolderValue(f.name) }}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-stone-400 hover:text-stone-600 shrink-0"
                >
                  <Pencil className="w-3 h-3" />
                </button>
                <button
                  onClick={() => setConfirmDelete({ type: 'folder', id: f.id, label: f.name })}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-red-400 hover:text-red-600 shrink-0"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab switcher + subject filter */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-2 flex-wrap">
          <button
            onClick={() => { setBankView('assessments'); setSelectedIds(new Set()) }}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium ${bankView === 'assessments' ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
          >
            Assessments ({filteredAssessments.length})
          </button>
          <button
            onClick={() => { setBankView('questions'); setSelectedIds(new Set()) }}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium ${bankView === 'questions' ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
          >
            Questions ({filteredQuestions.length})
          </button>
          <select
            value={subjectFilter}
            onChange={e => setSubjectFilter(e.target.value)}
            className="ml-auto text-xs border border-stone-300 rounded-lg px-2 py-1.5 bg-white text-stone-600"
          >
            <option value="">All subjects</option>
            {subjectOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Selection action bar */}
        {bankView === 'questions' && selectedIds.size > 0 && (
          <div className="mx-4 mb-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-emerald-800">{selectedIds.size} selected</span>
            <button
              onClick={handleCreateFromSelected}
              className="flex items-center gap-1 text-xs px-2.5 py-1 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700"
            >
              <FilePlus className="w-3.5 h-3.5" /> New Assessment
            </button>
            <div className="flex items-center gap-1">
              <select
                value={addToAssessmentId}
                onChange={e => setAddToAssessmentId(e.target.value)}
                className="text-xs border border-emerald-300 rounded px-2 py-1 bg-white text-stone-700"
              >
                <option value="">Add to assessment...</option>
                {assessments.map(a => (
                  <option key={a.id} value={a.id}>{a.subject} — {a.topic}</option>
                ))}
              </select>
              {addToAssessmentId && (
                <button
                  onClick={handleAddToAssessment}
                  className="flex items-center gap-1 text-xs px-2.5 py-1 bg-stone-700 text-white rounded-lg font-medium hover:bg-stone-800"
                >
                  <FolderPlus className="w-3.5 h-3.5" /> Add
                </button>
              )}
            </div>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="ml-auto text-xs text-stone-400 hover:text-stone-600"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {loading && <div className="text-stone-400 text-sm">Loading...</div>}

          {bankView === 'assessments' && (
            <div className="grid grid-cols-1 gap-3">
              {filteredAssessments.map(a => {
                const isGlobal = a.userId !== currentUserId && a.isPublic
                return (
                <div key={a.id} className={`border rounded-lg p-3 hover:shadow-sm transition-all ${isGlobal ? 'bg-sky-50 border-sky-200 hover:border-sky-400' : 'bg-white border-stone-200 hover:border-emerald-300'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      {renamingId === a.id ? (
                        <div className="flex gap-1">
                          <input
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            className="flex-1 text-sm px-1 border border-emerald-400 rounded"
                            autoFocus
                          />
                          <button onClick={() => { onRenameAssessment(a.id, renameValue); setRenamingId(null) }} className="text-emerald-600"><Check className="w-4 h-4" /></button>
                          <button onClick={() => setRenamingId(null)} className="text-stone-400"><X className="w-4 h-4" /></button>
                        </div>
                      ) : (
                        <button onClick={() => onSelect(a)} className="text-left">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-stone-800">{a.topic}</span>
                            {a.code && <span className="text-xs font-mono bg-stone-100 text-stone-500 px-1.5 py-0.5 rounded">{a.code}</span>}
                            {a.userId === currentUserId && (
                              <button
                                onClick={e => { e.stopPropagation(); onTogglePublicAssessment(a.id, !a.isPublic) }}
                                className={`p-1 rounded ${a.isPublic ? 'text-emerald-600 hover:text-emerald-700' : 'text-stone-300 hover:text-stone-500'}`}
                                title={a.isPublic ? 'Public — click to make private' : 'Make public'}
                              >
                                <Globe className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                          <div className="text-xs text-stone-500 flex items-center gap-1.5 flex-wrap">
                            <span>{a.subject} · {a.difficulty} · {a.questions.length}q</span>
                            {a.userId !== currentUserId && a.isPublic && a.preparedBy && (
                              <span className="text-xs text-emerald-600">by {a.preparedBy}</span>
                            )}
                            <span className="flex items-center gap-1 text-stone-400">
                              <Calendar className="w-3 h-3" />
                              {a.createdAt.toDate().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
                              {' · '}
                              {a.createdAt.toDate().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {a.userId === currentUserId && (
                        <>
                          <button onClick={() => { setRenamingId(a.id); setRenameValue(a.topic) }} className="p-1 text-stone-400 hover:text-stone-600"><Pencil className="w-3.5 h-3.5" /></button>
                          <select
                            value={a.folderId ?? ''}
                            onChange={e => onMoveAssessment(a.id, e.target.value || null)}
                            className="text-xs border border-stone-200 rounded px-1 py-0.5 text-stone-600"
                          >
                            <option value="">No folder</option>
                            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                          <button onClick={() => setConfirmDelete({ type: 'assessment', id: a.id, label: a.topic + (a.code ? ` (${a.code})` : '') })} className="p-1 text-red-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )})}
              {filteredAssessments.length === 0 && !loading && (
                <div className="text-stone-400 text-sm text-center py-8">
                  {subjectFilter ? `No ${subjectFilter} assessments found.` : 'No assessments saved yet.'}
                </div>
              )}
            </div>
          )}

          {bankView === 'questions' && (
            <div className="grid grid-cols-1 gap-2">
              {filteredQuestions.map(q => {
                const isSelected = selectedIds.has(q.id)
                const isGlobal = q.userId !== currentUserId && q.isPublic
                return (
                  <div
                    key={q.id}
                    className={`border rounded-lg p-2.5 flex gap-2 items-start cursor-pointer transition-all group
                      ${isSelected
                        ? 'border-emerald-400 bg-emerald-50 shadow-sm'
                        : isGlobal
                          ? 'border-sky-200 bg-sky-50 hover:border-sky-400 hover:shadow-sm'
                          : 'border-stone-200 bg-white hover:border-emerald-300 hover:shadow-sm hover:bg-stone-50'
                      }`}
                    onClick={() => toggleSelect(q.id)}
                  >
                    {/* Checkbox */}
                    <div className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                      ${isSelected ? 'border-emerald-500 bg-emerald-500' : 'border-stone-300 group-hover:border-emerald-400'}`}
                    >
                      {isSelected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-stone-700 truncate">
                        {q.text
                        .replace(/```svg[\s\S]*?```/g, '[diagram]')
                        .replace(/<svg[\s\S]*?<\/svg>/gi, '[diagram]')
                        .replace(/\*\*/g, '')
                        .substring(0, 120)}...
                      </div>
                      <div className="text-xs text-stone-400 mt-0.5 flex items-center gap-1 flex-wrap">
                        <span>{q.subject} · {q.marks}m · {q.commandWord}</span>
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          q.type === 'mcq' ? 'bg-blue-100 text-blue-700' :
                          q.type === 'structured' ? 'bg-violet-100 text-violet-700' :
                          'bg-stone-100 text-stone-500'
                        }`}>{q.type === 'mcq' ? 'MCQ' : q.type === 'structured' ? 'Structured' : 'Short Answer'}</span>
                        {q.difficultyStars && (
                          <span className={`font-medium tracking-tight ${
                            q.difficultyStars === 1 ? 'text-emerald-500' :
                            q.difficultyStars === 2 ? 'text-amber-500' :
                            'text-red-500'
                          }`} title={q.difficultyStars === 1 ? 'Easy' : q.difficultyStars === 2 ? 'Medium' : 'Challenging'}>
                            {'★'.repeat(q.difficultyStars)}{'☆'.repeat(3 - q.difficultyStars)}
                          </span>
                        )}
                        {q.code && <span className="font-mono bg-stone-100 px-1 rounded text-stone-500">{q.code}</span>}
                        {q.userId !== currentUserId && q.isPublic && q.preparedBy && (
                          <span className="ml-1 text-emerald-600">by {q.preparedBy}</span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => setPreviewQuestion(q)}
                        className="p-1 text-stone-400 hover:text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Preview"
                      >
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      {q.userId === currentUserId && (
                        <button
                          onClick={e => { e.stopPropagation(); onTogglePublicQuestion(q.id, !q.isPublic) }}
                          className={`p-1 rounded ${q.isPublic ? 'text-emerald-600 hover:text-emerald-700' : 'text-stone-300 hover:text-stone-500'}`}
                          title={q.isPublic ? 'Public' : 'Make public'}
                        >
                          <Globe className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {q.userId === currentUserId && (
                        <>
                          <select
                            value={q.folderId ?? ''}
                            onChange={e => onMoveQuestion(q.id, e.target.value || null)}
                            className="text-xs border border-stone-200 rounded px-1 py-0.5 text-stone-600"
                          >
                            <option value="">No folder</option>
                            {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                          </select>
                          <button onClick={() => setConfirmDelete({ type: 'question', id: q.id, label: q.code ?? q.text.substring(0, 40) })} className="p-1 text-red-400 hover:text-red-600">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
              {filteredQuestions.length === 0 && !loading && (
                <div className="text-stone-400 text-sm text-center py-8">
                  {subjectFilter ? `No ${subjectFilter} questions found.` : 'No questions saved yet.'}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Confirm Delete Modal */}
      {confirmDelete && (
        <ConfirmDeleteModal
          target={confirmDelete}
          onConfirm={handleConfirmDelete}
          onCancel={() => setConfirmDelete(null)}
          isDeleting={isDeleting}
        />
      )}

      {/* Preview Modal */}
      {previewQuestion && (
        <QuestionPreviewModal
          question={previewQuestion}
          onClose={() => setPreviewQuestion(null)}
          onUpdate={async (updates) => {
            await onUpdateQuestion(previewQuestion.id, updates)
            setPreviewQuestion({ ...previewQuestion, ...updates })
          }}
        />
      )}
    </div>
  )
}
