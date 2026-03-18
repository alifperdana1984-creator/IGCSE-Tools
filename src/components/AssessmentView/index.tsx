import React, { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import { Download, Copy, Save, Edit3, BookmarkPlus, X, Plus, Check, Pencil, ChevronUp, ChevronDown, Calendar, Loader2, RefreshCw, Eye, Code2 } from 'lucide-react'
import type { Assessment, Question, QuestionItem } from '../../lib/types'
import { parseSVGSafe, normalizeSvgMarkdown } from '../../lib/svg'
import { DiagramRenderer } from '../DiagramRenderer'
import { exportToPDF } from '../../lib/pdf'
import { preprocessLatex } from '../../lib/latex'
import { RichEditor } from '../RichEditor'
import { repairQuestionItem } from '../../lib/sanitize'

interface Props {
  assessment: Assessment | null
  analysisText?: string | null
  isEditing: boolean
  studentMode: boolean
  isGenerating?: boolean
  generationLog?: string[]
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
  onUpdateQuestion?: (questionId: string, updates: Partial<QuestionItem>) => void
  onRegenerateDiagrams?: (questions: QuestionItem[]) => Promise<void>
}

function QuestionMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkMath, remarkGfm]}
      rehypePlugins={[rehypeKatex]}
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
      {preprocessLatex(normalizeSvgMarkdown(content))}
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

// ── TikZ code editor with Preview tab and snippet toolbar ──────────────────
const TIKZ_SNIPPETS = [
  { label: '\\draw', insert: '\\draw[thick] (0,0) -- (1,0);' },
  { label: '\\node', insert: '\\node at (0,0) {$A$};' },
  { label: '\\coordinate', insert: '\\coordinate (A) at (0,0);' },
  { label: 'right angle', insert: '\\draw (0.2,0) |- (0,0.2);' },
  { label: 'arc', insert: '\\draw (1,0) arc[start angle=0,end angle=90,radius=1];' },
  { label: 'dashed', insert: '\\draw[dashed] (0,0) -- (2,2);' },
  { label: '\\usetikzlibrary', insert: '\\usetikzlibrary{angles,quotes,calc}' },
]

function TikzEditor({
  value, onChange,
  maxWidth, onMaxWidthChange,
  minHeight, onMinHeightChange,
}: {
  value: string
  onChange: (v: string) => void
  maxWidth: number
  onMaxWidthChange: (v: number) => void
  minHeight: number
  onMinHeightChange: (v: number) => void
}) {
  const [tab, setTab] = useState<'code' | 'preview'>('code')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const insertSnippet = useCallback((snippet: string) => {
    const el = textareaRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const next = value.slice(0, start) + snippet + value.slice(end)
    onChange(next)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + snippet.length, start + snippet.length)
    })
  }, [value, onChange])

  return (
    <div className="border border-stone-300 rounded-lg overflow-hidden bg-white">
      {/* Tab bar + snippet toolbar */}
      <div className="flex items-center border-b border-stone-200 bg-stone-50 px-2 py-1 flex-wrap gap-y-1 gap-x-1">
        <button
          onClick={() => setTab('code')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium ${tab === 'code' ? 'bg-white shadow-sm text-stone-800 border border-stone-200' : 'text-stone-500 hover:text-stone-700'}`}
        >
          <Code2 className="w-3 h-3" /> Code
        </button>
        <button
          onClick={() => setTab('preview')}
          className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium mr-2 ${tab === 'preview' ? 'bg-white shadow-sm text-stone-800 border border-stone-200' : 'text-stone-500 hover:text-stone-700'}`}
        >
          <Eye className="w-3 h-3" /> Preview
        </button>
        <div className="h-3.5 w-px bg-stone-300 mr-2 hidden sm:block" />
        {tab === 'code' && TIKZ_SNIPPETS.map(s => (
          <button
            key={s.label}
            onClick={() => insertSnippet(s.insert)}
            className="px-2 py-0.5 rounded text-xs bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200 font-mono"
            title={s.insert}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Size controls */}
      <div className="flex items-center gap-4 px-3 py-1.5 border-b border-stone-100 bg-stone-50/60 text-xs text-stone-500">
        <label className="flex items-center gap-1.5 shrink-0">
          Max width
          <input
            type="number" min={100} max={900} step={10}
            value={maxWidth}
            onChange={e => onMaxWidthChange(Number(e.target.value))}
            className="w-16 px-1.5 py-0.5 border border-stone-300 rounded text-xs text-stone-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
          <span>px</span>
        </label>
        <label className="flex items-center gap-1.5 shrink-0">
          Min height
          <input
            type="number" min={0} max={600} step={10}
            value={minHeight}
            onChange={e => onMinHeightChange(Number(e.target.value))}
            className="w-16 px-1.5 py-0.5 border border-stone-300 rounded text-xs text-stone-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
          />
          <span>px</span>
        </label>
      </div>

      {tab === 'code' ? (
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full font-mono text-xs p-2.5 bg-stone-50 focus:outline-none focus:ring-1 focus:ring-violet-400 resize-y"
          rows={18}
          placeholder={'\\documentclass[tikz,border=2mm]{standalone}\n\\usepackage{tikz}\n\\begin{document}\n\\begin{tikzpicture}\n  % your diagram here\n\\end{tikzpicture}\n\\end{document}'}
          spellCheck={false}
        />
      ) : (
        <div className="p-3 min-h-[200px] flex items-center justify-center bg-stone-50">
          {value.trim() ? (
            <DiagramRenderer spec={{ diagramType: 'tikz', code: value, maxWidth, minHeight: minHeight || undefined }} />
          ) : (
            <span className="text-xs text-stone-400 italic">No code to preview</span>
          )}
        </div>
      )}
    </div>
  )
}

export function AssessmentView({
  assessment, analysisText, isEditing, studentMode,
  isGenerating, generationLog,
  onEdit, onCancelEdit, onSave, onSaveToLibrary, onStudentFeedback, onCopy,
  activeTab, onTabChange,
  onRemoveQuestion, onMoveQuestion, bankQuestions, onAddQuestions, onUpdateQuestion, onRegenerateDiagrams,
}: Props) {
  const QUESTIONS_PER_PAGE = 8
  const contentRef = useRef<HTMLDivElement>(null)
  const [studentAnswers, setStudentAnswers] = useState<string[]>([])
  const [feedback, setFeedback] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [editingQId, setEditingQId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<{ text: string; answer: string; markScheme: string; tikzCode: string; maxWidth: number; minHeight: number }>({ text: '', answer: '', markScheme: '', tikzCode: '', maxWidth: 480, minHeight: 0 })
  const [isSaving, setIsSaving] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false)
  const [repairingIds, setRepairingIds] = useState<Set<string>>(new Set())
  const [questionPage, setQuestionPage] = useState(1)

  const renderedQuestions = assessment ? assessment.questions.map(repairQuestionItem) : []
  const totalQuestionPages = Math.max(1, Math.ceil(renderedQuestions.length / QUESTIONS_PER_PAGE))
  const safeQuestionPage = Math.min(questionPage, totalQuestionPages)
  const questionStart = (safeQuestionPage - 1) * QUESTIONS_PER_PAGE
  const pagedQuestions = renderedQuestions.slice(questionStart, questionStart + QUESTIONS_PER_PAGE)
  const missingDiagramQuestions = renderedQuestions.filter(q => q.diagramMissing)

  useEffect(() => {
    setQuestionPage(1)
  }, [assessment?.id, activeTab])

  useEffect(() => {
    if (questionPage > totalQuestionPages) setQuestionPage(totalQuestionPages)
  }, [questionPage, totalQuestionPages])

  if (!assessment) {
    if (isGenerating && generationLog) {
      return (
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-md">
            <div className="flex items-center gap-3 mb-8">
              <Loader2 className="w-5 h-5 text-emerald-500 animate-spin shrink-0" />
              <span className="text-sm font-semibold text-stone-700">Generating assessment…</span>
            </div>
            <div className="flex flex-col gap-3">
              {generationLog.map((step, i) => {
                const isCurrent = i === generationLog.length - 1
                return (
                  <div
                    key={i}
                    className="generation-step flex items-start gap-3"
                  >
                    <div className="mt-0.5 shrink-0">
                      {isCurrent
                        ? <Loader2 className="w-4 h-4 text-emerald-500 animate-spin" />
                        : <Check className="w-4 h-4 text-emerald-500" />
                      }
                    </div>
                    <span className={`text-sm leading-snug ${isCurrent ? 'text-stone-800 font-medium' : 'text-stone-400'}`}>
                      {step}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )
    }
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
    .map(repairQuestionItem)
    .map((q, i) => `### Question ${i + 1} [${q.marks} marks]\n\n${q.text}`)
    .join('\n\n---\n\n')
  const answerKeyText = assessment.questions
    .map(repairQuestionItem)
    .map((q, i) => `### Q${i + 1}\n\n${q.answer}`)
    .join('\n\n')
  const markSchemeText = assessment.questions
    .map(repairQuestionItem)
    .map((q, i) => `### Q${i + 1} Mark Scheme [${q.marks} marks]\n\n${q.markScheme}`)
    .join('\n\n')

  const handleRegenerateDiagram = async (q: QuestionItem) => {
    if (onRegenerateDiagrams) {
      setRepairingIds(prev => new Set(prev).add(q.id))
      try {
        await onRegenerateDiagrams([q])
      } finally {
        setRepairingIds(prev => {
          const next = new Set(prev)
          next.delete(q.id)
          return next
        })
      }
      return
    }
    if (!onUpdateQuestion) return
    const repaired = repairQuestionItem(q)
    onUpdateQuestion(q.id, {
      hasDiagram: repaired.hasDiagram,
      diagramMissing: repaired.diagramMissing,
      diagram: repaired.diagram,
    })
  }

  const handleRegenerateAllMissing = async () => {
    if (!missingDiagramQuestions.length) return
    if (onRegenerateDiagrams) {
      const allIds = missingDiagramQuestions.map(q => q.id)
      setRepairingIds(prev => {
        const next = new Set(prev)
        allIds.forEach(id => next.add(id))
        return next
      })
      try {
        await onRegenerateDiagrams(missingDiagramQuestions)
      } finally {
        setRepairingIds(prev => {
          const next = new Set(prev)
          allIds.forEach(id => next.delete(id))
          return next
        })
      }
      return
    }
    if (!onUpdateQuestion) return
    missingDiagramQuestions.forEach(q => {
      const repaired = repairQuestionItem(q)
      onUpdateQuestion(q.id, {
        hasDiagram: repaired.hasDiagram,
        diagramMissing: repaired.diagramMissing,
        diagram: repaired.diagram,
      })
    })
  }

  const currentText = activeTab === 'questions' ? questionsText
    : activeTab === 'answerKey' ? answerKeyText
    : markSchemeText

  const currentIds = new Set(renderedQuestions.map(q => q.id))

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
              {tab === 'questions' ? `Questions (${renderedQuestions.length})` : tab === 'answerKey' ? 'Answer Key' : 'Mark Scheme'}
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
          {onUpdateQuestion && !studentMode && activeTab === 'questions' && missingDiagramQuestions.length > 0 && (
            <button
              onClick={() => { void handleRegenerateAllMissing() }}
              className="px-2.5 py-1.5 text-xs bg-amber-100 text-amber-800 rounded-lg font-medium flex items-center gap-1 hover:bg-amber-200"
              title="Regenerate missing diagrams without changing question text"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Regenerate All Missing ({missingDiagramQuestions.length})
            </button>
          )}
          <button onClick={handleSave} disabled={isSaving} className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-medium flex items-center gap-1 hover:bg-emerald-700 disabled:opacity-60">
            {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookmarkPlus className="w-3.5 h-3.5" />}
            Save
          </button>
          <button onClick={() => onCopy(currentText)} className="p-1.5 text-stone-500 hover:bg-stone-100 rounded" title="Copy" aria-label="Copy to clipboard">
            <Copy className="w-4 h-4" />
          </button>
          <button onClick={handleDownloadPDF} disabled={isDownloading} className="p-1.5 text-stone-500 hover:bg-stone-100 rounded disabled:opacity-60" title="Download PDF" aria-label="Download as PDF">
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
            <button onClick={onEdit} className="p-1.5 text-stone-500 hover:bg-stone-100 rounded" title="Edit markdown" aria-label="Edit assessment markdown">
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

      <div className="flex-1 overflow-y-auto" ref={contentRef}>
      <div className="p-4 markdown-body">
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
            {activeTab === 'questions' && pagedQuestions.map((q, localIdx) => {
              const i = questionStart + localIdx
              return (
              <div key={q.id}>
                {editingQId === q.id ? (
                  <div className="border border-emerald-300 rounded-lg p-3 bg-emerald-50/30 mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs font-semibold text-emerald-800">Editing Q{i + 1}</span>
                      <div className="flex gap-1">
                        <button
                          onClick={() => {
                          const updates: Partial<QuestionItem> = { text: editDraft.text, answer: editDraft.answer, markScheme: editDraft.markScheme }
                          if (editDraft.tikzCode.trim()) {
                            updates.diagram = {
                              diagramType: 'tikz',
                              code: editDraft.tikzCode,
                              maxWidth: editDraft.maxWidth || undefined,
                              minHeight: editDraft.minHeight || undefined,
                            }
                          } else if (q.hasDiagram) {
                            updates.diagram = undefined
                          }
                          onUpdateQuestion?.(q.id, updates)
                          setEditingQId(null)
                        }}
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
                      {q.hasDiagram && (
                        <div>
                          <label className="text-xs font-medium text-stone-600 mb-1.5 block flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" />
                            TikZ Diagram
                            <span className="text-stone-400 font-normal">(leave empty to remove diagram)</span>
                          </label>
                          <TikzEditor
                            value={editDraft.tikzCode}
                            onChange={v => setEditDraft(d => ({ ...d, tikzCode: v }))}
                            maxWidth={editDraft.maxWidth}
                            onMaxWidthChange={v => setEditDraft(d => ({ ...d, maxWidth: v }))}
                            minHeight={editDraft.minHeight}
                            onMinHeightChange={v => setEditDraft(d => ({ ...d, minHeight: v }))}
                          />
                        </div>
                      )}
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
                          📋 {q.syllabusObjective.replace(/\$[^$]*\$/g, '').replace(/\\[a-zA-Z]+\{([^}]*)\}/g, '$1').replace(/\\[a-zA-Z]+/g, '').trim()}
                        </span>
                      )}
                      {onUpdateQuestion && !studentMode && (
                        <button
                          onClick={() => { setEditingQId(q.id); setEditDraft({ text: q.text, answer: q.answer, markScheme: q.markScheme, tikzCode: q.diagram?.code ?? '', maxWidth: q.diagram?.maxWidth ?? 480, minHeight: q.diagram?.minHeight ?? 0 }) }}
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
                            disabled={i === renderedQuestions.length - 1}
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
                    {q.diagramMissing && onUpdateQuestion && !studentMode && (
                      <div className="mb-2 flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                        <span className="shrink-0 mt-0.5">!</span>
                        <div className="flex-1 min-w-0">
                          <span>Diagram was not generated for this question - it may be unanswerable.</span>
                          <button
                            onClick={() => { void handleRegenerateDiagram(q) }}
                            disabled={repairingIds.has(q.id)}
                            className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-200 text-amber-900 hover:bg-amber-300 disabled:opacity-60"
                            title="Generate diagram for this question"
                          >
                            <RefreshCw className={`w-3 h-3 ${repairingIds.has(q.id) ? 'animate-spin' : ''}`} />
                            Generate Diagram
                          </button>
                        </div>
                      </div>
                    )}
                    {q.hasDiagram && !q.diagramMissing && onUpdateQuestion && !studentMode && (
                      <div className="mb-2 flex justify-end">
                        <button
                          onClick={() => { void handleRegenerateDiagram(q) }}
                          disabled={repairingIds.has(q.id)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-violet-100 text-violet-700 hover:bg-violet-200 disabled:opacity-60"
                          title="Improve this diagram — each click adds more detail"
                        >
                          <RefreshCw className={`w-3 h-3 ${repairingIds.has(q.id) ? 'animate-spin' : ''}`} />
                          Improve Diagram
                        </button>
                      </div>
                    )}
                    <DiagramRenderer spec={q.diagram} />
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
            )})}

            {activeTab === 'questions' && totalQuestionPages > 1 && (
              <div className="flex items-center justify-between mt-2 mb-4 px-1">
                <span className="text-xs text-stone-500">
                  Page {safeQuestionPage} / {totalQuestionPages}
                </span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => setQuestionPage(p => Math.max(1, p - 1))}
                    disabled={safeQuestionPage === 1}
                    className="px-2.5 py-1 text-xs bg-stone-100 text-stone-600 rounded disabled:opacity-40"
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setQuestionPage(p => Math.min(totalQuestionPages, p + 1))}
                    disabled={safeQuestionPage === totalQuestionPages}
                    className="px-2.5 py-1 text-xs bg-stone-100 text-stone-600 rounded disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

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
      </div>{/* end inner grow div */}
      </div>{/* end outer scroll div */}

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

