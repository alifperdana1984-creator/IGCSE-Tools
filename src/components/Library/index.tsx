import React, { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import { Folder as FolderIcon, Trash2, Plus, Library as LibraryIcon, Pencil, X, Check, Eye, FilePlus, FolderPlus } from 'lucide-react'
import type { Assessment, Question, Folder } from '../../lib/types'

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
  selectedFolderId: string | null | undefined
  onSelectFolder: (id: string | null | undefined) => void
  onCreateAssessmentFromQuestions: (questions: Question[]) => void
  onAddQuestionsToAssessment: (assessmentId: string, questions: Question[]) => void
}

function QuestionPreviewModal({ question, onClose }: { question: Question; onClose: () => void }) {
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
          </div>
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto p-4 markdown-body text-sm">
          <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
            {question.text}
          </ReactMarkdown>
          <div className="mt-4 pt-4 border-t border-stone-100">
            <p className="text-xs font-semibold text-stone-500 mb-1">Answer</p>
            <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
              {question.answer}
            </ReactMarkdown>
          </div>
          <div className="mt-4 pt-4 border-t border-stone-100">
            <p className="text-xs font-semibold text-stone-500 mb-1">Mark Scheme</p>
            <ReactMarkdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
              {question.markScheme}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Library({
  assessments, questions, folders, loading,
  onSelect, onDeleteAssessment, onMoveAssessment, onRenameAssessment,
  onDeleteQuestion, onMoveQuestion,
  onCreateFolder, onDeleteFolder,
  selectedFolderId, onSelectFolder,
  onCreateAssessmentFromQuestions, onAddQuestionsToAssessment,
}: Props) {
  const [bankView, setBankView] = useState<'assessments' | 'questions'>('assessments')
  const [newFolderName, setNewFolderName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [previewQuestion, setPreviewQuestion] = useState<Question | null>(null)
  const [addToAssessmentId, setAddToAssessmentId] = useState('')

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
    <div className="flex h-full">
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
            <button
              onClick={() => onSelectFolder(f.id)}
              className={`flex-1 text-left text-xs px-2 py-1.5 rounded flex items-center gap-1 ${selectedFolderId === f.id ? 'bg-emerald-100 text-emerald-800 font-medium' : 'hover:bg-stone-100 text-stone-600'}`}
            >
              <FolderIcon className="w-3.5 h-3.5" /> {f.name}
            </button>
            <button
              onClick={() => onDeleteFolder(f.id)}
              className="opacity-0 group-hover:opacity-100 p-0.5 text-red-400 hover:text-red-600"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Tab switcher */}
        <div className="flex items-center gap-2 px-4 pt-4 pb-2">
          <button
            onClick={() => { setBankView('assessments'); setSelectedIds(new Set()) }}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium ${bankView === 'assessments' ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
          >
            Assessments ({assessments.length})
          </button>
          <button
            onClick={() => { setBankView('questions'); setSelectedIds(new Set()) }}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium ${bankView === 'questions' ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
          >
            Questions ({questions.length})
          </button>
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
              {assessments.map(a => (
                <div key={a.id} className="border border-stone-200 rounded-lg p-3 hover:border-emerald-300 hover:shadow-sm transition-all bg-white">
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
                          <div className="text-sm font-medium text-stone-800">{a.topic}</div>
                          <div className="text-xs text-stone-500">{a.subject} · {a.difficulty} · {a.questions.length}q</div>
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => { setRenamingId(a.id); setRenameValue(a.topic) }} className="p-1 text-stone-400 hover:text-stone-600"><Pencil className="w-3.5 h-3.5" /></button>
                      <select
                        value={a.folderId ?? ''}
                        onChange={e => onMoveAssessment(a.id, e.target.value || null)}
                        className="text-xs border border-stone-200 rounded px-1 py-0.5 text-stone-600"
                      >
                        <option value="">No folder</option>
                        {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                      <button onClick={() => onDeleteAssessment(a.id)} className="p-1 text-red-400 hover:text-red-600"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                </div>
              ))}
              {assessments.length === 0 && !loading && (
                <div className="text-stone-400 text-sm text-center py-8">No assessments saved yet.</div>
              )}
            </div>
          )}

          {bankView === 'questions' && (
            <div className="grid grid-cols-1 gap-2">
              {questions.map(q => {
                const isSelected = selectedIds.has(q.id)
                return (
                  <div
                    key={q.id}
                    className={`border rounded-lg p-2.5 bg-white flex gap-2 items-start cursor-pointer transition-all group
                      ${isSelected
                        ? 'border-emerald-400 bg-emerald-50 shadow-sm'
                        : 'border-stone-200 hover:border-emerald-300 hover:shadow-sm hover:bg-stone-50'
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
                        {q.text.replace(/```svg[\s\S]*?```/g, '[diagram]').replace(/\*\*/g, '').substring(0, 120)}...
                      </div>
                      <div className="text-xs text-stone-400 mt-0.5">{q.subject} · {q.marks}m · {q.commandWord}</div>
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
                      <select
                        value={q.folderId ?? ''}
                        onChange={e => onMoveQuestion(q.id, e.target.value || null)}
                        className="text-xs border border-stone-200 rounded px-1 py-0.5 text-stone-600"
                      >
                        <option value="">No folder</option>
                        {folders.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                      <button onClick={() => onDeleteQuestion(q.id)} className="p-1 text-red-400 hover:text-red-600">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )
              })}
              {questions.length === 0 && !loading && (
                <div className="text-stone-400 text-sm text-center py-8">No questions saved yet.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Preview Modal */}
      {previewQuestion && (
        <QuestionPreviewModal question={previewQuestion} onClose={() => setPreviewQuestion(null)} />
      )}
    </div>
  )
}
