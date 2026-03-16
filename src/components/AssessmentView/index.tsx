import React, { useState, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import { Download, Copy, Save, Edit3, BookmarkPlus, X, Plus, Check, Pencil, ChevronUp, ChevronDown, Calendar, Loader2 } from 'lucide-react'
import type { Assessment, Question, QuestionItem } from '../../lib/types'
import { parseSVGSafe } from '../../lib/svg'
import { exportToPDF } from '../../lib/pdf'
import { preprocessLatex } from '../../lib/latex'
import { RichEditor } from '../RichEditor'

interface Props {
  assessment: Assessment | null
  analysisText?: string | null
  isEditing: boolean
  studentMode: boolean
  onEdit: () => void
  onCancelEdit: () => void
  onSave: () => void
  onSaveToLibrary: () => void
  onStudentFeedback?: (answers: string[]) => Promise<string | null | undefined>
  onCopy: (text: string) => void
  activeTab: 'questions' | 'answerKey' | 'markScheme'
  onTabChange: (tab: 'questions' | 'answerKey' | 'markScheme') => void
  onRemoveQuestion?: (questionId: string) => void
  onMoveQuestion?: (questionId: string, direction: 'up' | 'down') => void
  bankQuestions?: Question[]
  onAddQuestions?: (questions: QuestionItem[]) => void
  onUpdateQuestion?: (questionId: string, updates: { text?: string; answer?: string; markScheme?: string }) => void
}

function QuestionMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath, remarkGfm]}
      rehypePlugins={[rehypeKatex, rehypeRaw]}
      components={{
        code({ className, children }) {
          if (className === 'language-svg') {
            const svgStr = String(children)
            const safe = parseSVGSafe(svgStr)
            if (safe) return (
              <div className="my-3 border-t-2 border-b-2 border-violet-100 py-3 bg-violet-50/30 rounded-sm">
                <p className="text-xs font-semibold text-violet-400 mb-2 flex items-center gap-1.5 px-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-violet-300 inline-block" />
                  Diagram
                </p>
                <div dangerouslySetInnerHTML={{ __html: safe }} style={{ fontSize: '0.85em', maxWidth: '480px' }} />
              </div>
            )
            return <span className="text-stone-400 text-xs italic">[Diagram unavailable]</span>
          }
          return <code className={className}>{children}</code>
        }
      }}
    >
      {preprocessLatex(content)}
    </ReactMarkdown>
  )
}

function BankPickerModal({
  questions,
  currentIds,
  onAdd,
  onClose,
}: {
  questions: Question[]
  currentIds: Set<string>
  onAdd: (qs: QuestionItem[]) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const available = questions.filter(q => !currentIds.has(q.id))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[70vh] flex flex-col mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200">
          <span className="text-sm font-semibold text-stone-800">Add from Question Bank</span>
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
          {available.length === 0 && (
            <p className="text-sm text-stone-400 text-center py-8">No questions available to add.</p>
          )}
          {available.map(q => {
            const sel = selected.has(q.id)
            return (
              <div
                key={q.id}
                onClick={() => toggle(q.id)}
                className={`flex gap-2 items-start p-2.5 rounded-lg border cursor-pointer transition-all
                  ${sel ? 'border-emerald-400 bg-emerald-50' : 'border-stone-200 hover:border-emerald-300 hover:bg-stone-50'}`}
              >
                <div className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                  ${sel ? 'border-emerald-500 bg-emerald-500' : 'border-stone-300'}`}>
                  {sel && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-stone-700 truncate">
                    {q.text.replace(/```svg[\s\S]*?```/g, '[diagram]').replace(/<svg[\s\S]*?<\/svg>/gi, '[diagram]').replace(/\*\*/g, '').substring(0, 100)}...
                  </p>
                  <p className="text-xs text-stone-400 mt-0.5">{q.subject} · {q.marks}m · {q.commandWord}</p>
                </div>
              </div>
            )
          })}
        </div>
        <div className="px-4 py-3 border-t border-stone-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs bg-stone-100 text-stone-600 rounded-lg font-medium hover:bg-stone-200">Cancel</button>
          <button
            disabled={selected.size === 0}
            onClick={() => { onAdd(available.filter(q => selected.has(q.id))); onClose() }}
            className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:bg-stone-300"
          >
            Add {selected.size > 0 ? `(${selected.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

function formatDateTime(ts: import('firebase/firestore').Timestamp): string {
  const d = ts.toDate()
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function AssessmentView({
  assessment, analysisText, isEditing, studentMode,
  onEdit, onCancelEdit, onSave, onSaveToLibrary, onStudentFeedback, onCopy,
  activeTab, onTabChange,
  onRemoveQuestion, onMoveQuestion, bankQuestions, onAddQuestions, onUpdateQuestion,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [studentAnswers, setStudentAnswers] = useState<string[]>([])
  const [feedback, setFeedback] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [editingQId, setEditingQId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ text: string; answer: string; markScheme: string }>({ text: '', answer: '', markScheme: '' })
  const [isSaving, setIsSaving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false)

  if (!assessment) {
    return (
      <div className="flex-1 flex items-center justify-center text-stone-400">
        <div className="text-center">
          <p className="text-lg font-medium">No assessment generated yet</p>
          <p className="text-sm">Configure and generate an assessment using the sidebar</p>
        </div>
      </div>
    )
  }

  const handleDownloadPDF = async () => {
    if (!contentRef.current) return
    setIsDownloading(true)
    try {
      const filename = `${assessment.subject}-${assessment.topic}-assessment.pdf`
        .replace(/\s+/g, '-').toLowerCase()
      await exportToPDF(contentRef.current, filename)
    } finally {
      setIsDownloading(false)
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try { await onSaveToLibrary() } finally { setIsSaving(false) }
  }

  const questionsText = assessment.questions
    .map((q, i) => `### Question ${i + 1} [${q.marks} marks]\n\n${q.text}`)
    .join('\n\n---\n\n')
  const answerKeyText = assessment.questions
    .map((q, i) => `### Q${i + 1}\n\n${q.answer}`)
    .join('\n\n')
  const markSchemeText = assessment.questions
    .map((q, i) => `### Q${i + 1} Mark Scheme [${q.marks} marks]\n\n${q.markScheme}`)
    .join('\n\n')

  const currentText = activeTab === 'questions' ? questionsText
    : activeTab === 'answerKey' ? answerKeyText
    : markSchemeText

  const currentIds = new Set(assessment.questions.map(q => q.id))

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="border-b border-stone-200 px-4 py-2 flex items-center justify-between gap-2">
        <div className="flex gap-1">
          {(['questions', 'answerKey', 'markScheme'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium ${activeTab === tab ? 'bg-emerald-600 text-white' : 'bg-stone-100 text-stone-600 hover:bg-stone-200'}`}
            >
              {tab === 'questions' ? `Questions (${assessment.questions.length})` : tab === 'answerKey' ? 'Answer Key' : 'Mark Scheme'}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 items-center">
          {onAddQuestions && bankQuestions && !studentMode && (
            <button
              onClick={() => setShowPicker(true)}
              className="px-2.5 py-1.5 text-xs bg-stone-100 text-stone-600 rounded-lg font-medium flex items-center gap-1 hover:bg-stone-200"
              title="Add questions from bank"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          )}
          <button onClick={handleSave} disabled={isSaving} className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-medium flex items-center gap-1 hover:bg-emerald-700 disabled:opacity-60">
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
            Save
          </button>
          <button onClick={() => onCopy(currentText)} className="p-1.5 text-stone-500 hover:bg-stone-100 rounded" title="Copy">
            <Copy className="w-4 h-4" />
          </button>
          <button onClick={handleDownloadPDF} disabled={isDownloading} className="p-1.5 text-stone-500 hover:bg-stone-100 rounded disabled:opacity-60" title="Download PDF">
            {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          </button>
          {isEditing ? (
            <>
              <button onClick={onSave} className="px-3 py-1.5 text-xs bg-stone-700 text-white rounded-lg font-medium flex items-center gap-1">
                <Save className="w-3.5 h-3.5" /> Apply
              </button>
              <button onClick={onCancelEdit} className="px-3 py-1.5 text-xs bg-stone-100 text-stone-600 rounded-lg font-medium">
                Cancel
              </button>
            </>
          ) : (
            <button onClick={onEdit} className="p-1.5 text-stone-500 hover:bg-stone-100 rounded" title="Edit markdown">
              <Edit3 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Assessment meta */}
      <div className="px-4 py-1.5 border-b border-stone-100 flex items-center gap-3 text-xs text-stone-400 bg-stone-50/60">
        <span className="font-medium text-stone-600">{assessment.subject} · {assessment.topic}</span>
        <span>{assessment.difficulty}</span>
        <span className="flex items-center gap-1 ml-auto">
          <Calendar className="w-3 h-3" />
          {formatDateTime(assessment.createdAt)}
        </span>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 markdown-body" ref={contentRef}>
        {analysisText && (
          <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
            <strong>Analysis:</strong> {analysisText}
          </div>
        )}

        {isEditing ? (
          <textarea
            value={editContent || currentText}
            onChange={e => setEditContent(e.target.value)}
            className="w-full h-full min-h-[400px] font-mono text-sm p-3 border border-stone-300 rounded-lg"
          />
        ) : (
          <div>
            {activeTab === 'questions' && assessment.questions.map((q, i) => (
              <div key={q.id}>
                {editingQId === q.id ? (
                  <div className="border border-emerald-300 rounded-lg p-3 bg-emerald-50/30 mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-emerald-800">Editing Q{i + 1}</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => { onUpdateQuestion?.(q.id, editDraft); setEditingQId(null) }}
                          className="px-2.5 py-1 text-xs bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700"
                        >
                          Apply
                        </button>
                        <button
                          onClick={() => setEditingQId(null)}
                          className="px-2.5 py-1 text-xs bg-stone-100 text-stone-600 rounded-lg font-medium hover:bg-stone-200"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3">
                      <div>
                        <label className="text-xs font-medium text-stone-600 mb-1 block">Question</label>
                        <RichEditor value={editDraft.text} onChange={v => setEditDraft(d => ({ ...d, text: v }))} minRows={8} />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-stone-600 mb-1 block">Answer</label>
                        <RichEditor value={editDraft.answer} onChange={v => setEditDraft(d => ({ ...d, answer: v }))} minRows={6} />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-stone-600 mb-1 block">Mark Scheme</label>
                        <RichEditor value={editDraft.markScheme} onChange={v => setEditDraft(d => ({ ...d, markScheme: v }))} minRows={6} />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mb-6 group">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-xs font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                        Q{i + 1} · {q.marks}m · {q.commandWord}
                      </span>
                      <span className="text-xs text-stone-400">{q.type}</span>
                      {q.code && (
                        <span className="text-xs font-mono text-stone-400 bg-stone-100 px-1.5 py-0.5 rounded">
                          {q.code}
                        </span>
                      )}
                      {q.difficultyStars && (
                        <span className={`text-sm font-medium tracking-tight ${
                          q.difficultyStars === 1 ? 'text-emerald-500' :
                          q.difficultyStars === 2 ? 'text-amber-500' :
                          'text-red-500'
                        }`} title={q.difficultyStars === 1 ? 'Easy' : q.difficultyStars === 2 ? 'Medium' : 'Challenging'}>
                          {'★'.repeat(q.difficultyStars)}{'☆'.repeat(3 - q.difficultyStars)}
                        </span>
                      )}
                      {q.syllabusObjective && (
                        <span className="text-xs text-violet-700 bg-violet-50 border border-violet-200 px-2 py-0.5 rounded-full" title="Syllabus objective">
                          📋 {q.syllabusObjective}
                        </span>
                      )}
                      {onUpdateQuestion && !studentMode && (
                        <button
                          onClick={() => { setEditingQId(q.id); setEditDraft({ text: q.text, answer: q.answer, markScheme: q.markScheme }) }}
                          className="ml-1 opacity-0 group-hover:opacity-100 p-0.5 text-stone-400 hover:text-emerald-600 transition-opacity"
                          title="Edit question"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      )}
                      {onMoveQuestion && !studentMode && (
                        <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => onMoveQuestion(q.id, 'up')}
                            disabled={i === 0}
                            className="p-0.5 text-stone-400 hover:text-stone-700 disabled:opacity-30"
                            title="Move up"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onMoveQuestion(q.id, 'down')}
                            disabled={i === assessment.questions.length - 1}
                            className="p-0.5 text-stone-400 hover:text-stone-700 disabled:opacity-30"
                            title="Move down"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      {onRemoveQuestion && !studentMode && (
                        <button
                          onClick={() => onRemoveQuestion(q.id)}
                          className="ml-auto opacity-0 group-hover:opacity-100 p-0.5 text-red-400 hover:text-red-600 transition-opacity"
                          title="Remove question"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <QuestionMarkdown content={q.text} />
                    {studentMode && (
                      <textarea
                        placeholder="Your answer..."
                        value={studentAnswers[i] ?? ''}
                        onChange={e => {
                          const next = [...studentAnswers]
                          next[i] = e.target.value
                          setStudentAnswers(next)
                        }}
                        className="w-full mt-2 p-2 border border-stone-300 rounded text-sm"
                        rows={3}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}

            {!studentMode && activeTab === 'answerKey' && (
              <QuestionMarkdown content={answerKeyText} />
            )}

            {!studentMode && activeTab === 'markScheme' && (
              <QuestionMarkdown content={markSchemeText} />
            )}

            {studentMode && activeTab !== 'questions' && (
              <div className="text-stone-400 text-sm italic">
                Answer key and mark scheme hidden in student mode.
              </div>
            )}
          </div>
        )}

        {studentMode && onStudentFeedback && (
          <div className="mt-4">
            <button
              disabled={isFeedbackLoading}
              onClick={async () => {
                setIsFeedbackLoading(true)
                try {
                  const fb = await onStudentFeedback(studentAnswers)
                  if (fb) setFeedback(fb)
                } finally {
                  setIsFeedbackLoading(false)
                }
              }}
              className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg font-medium flex items-center gap-2 disabled:opacity-60"
            >
              {isFeedbackLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isFeedbackLoading ? 'Generating feedback...' : 'Get Feedback'}
            </button>
            {feedback && (
              <div className="mt-4 p-3 bg-stone-50 border border-stone-200 rounded-lg">
                <QuestionMarkdown content={feedback} />
              </div>
            )}
          </div>
        )}
      </div>

      {showPicker && bankQuestions && onAddQuestions && (
        <BankPickerModal
          questions={bankQuestions}
          currentIds={currentIds}
          onAdd={onAddQuestions}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  )
}
