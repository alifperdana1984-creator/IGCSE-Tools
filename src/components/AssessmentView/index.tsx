import React, { useState, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import { Download, Copy, Save, Edit3, BookmarkPlus } from 'lucide-react'
import type { Assessment } from '../../lib/types'
import { copyToClipboard } from '../../lib/clipboard'
import { parseSVGSafe } from '../../lib/svg'
import { exportToPDF } from '../../lib/pdf'

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
            if (safe) return <div dangerouslySetInnerHTML={{ __html: safe }} className="my-2" />
            return <span className="text-stone-400 text-xs italic">[Diagram unavailable]</span>
          }
          return <code className={className}>{children}</code>
        }
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

export function AssessmentView({
  assessment, analysisText, isEditing, studentMode,
  onEdit, onCancelEdit, onSave, onSaveToLibrary, onStudentFeedback, onCopy,
  activeTab, onTabChange,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [studentAnswers, setStudentAnswers] = useState<string[]>([])
  const [feedback, setFeedback] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')

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
    const filename = `${assessment.subject}-${assessment.topic}-assessment.pdf`
      .replace(/\s+/g, '-').toLowerCase()
    await exportToPDF(contentRef.current, filename)
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
              {tab === 'questions' ? 'Questions' : tab === 'answerKey' ? 'Answer Key' : 'Mark Scheme'}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button onClick={onSaveToLibrary} className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-medium flex items-center gap-1 hover:bg-emerald-700" title="Save to Library">
            <BookmarkPlus className="w-3.5 h-3.5" /> Save
          </button>
          <button onClick={() => onCopy(currentText)} className="p-1.5 text-stone-500 hover:bg-stone-100 rounded" title="Copy">
            <Copy className="w-4 h-4" />
          </button>
          <button onClick={handleDownloadPDF} className="p-1.5 text-stone-500 hover:bg-stone-100 rounded" title="Download PDF">
            <Download className="w-4 h-4" />
          </button>
          {isEditing ? (
            <>
              <button onClick={onSave} className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-medium flex items-center gap-1">
                <Save className="w-3.5 h-3.5" /> Save
              </button>
              <button onClick={onCancelEdit} className="px-3 py-1.5 text-xs bg-stone-100 text-stone-600 rounded-lg font-medium">
                Cancel
              </button>
            </>
          ) : (
            <button onClick={onEdit} className="p-1.5 text-stone-500 hover:bg-stone-100 rounded" title="Edit">
              <Edit3 className="w-4 h-4" />
            </button>
          )}
        </div>
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
              <div key={q.id} className="mb-6">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                    Q{i + 1} · {q.marks}m · {q.commandWord}
                  </span>
                  <span className="text-xs text-stone-400">{q.type}</span>
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
              onClick={async () => {
                const fb = await onStudentFeedback(studentAnswers)
                if (fb) setFeedback(fb)
              }}
              className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg font-medium"
            >
              Get Feedback
            </button>
            {feedback && (
              <div className="mt-4 p-3 bg-stone-50 border border-stone-200 rounded-lg">
                <QuestionMarkdown content={feedback} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
