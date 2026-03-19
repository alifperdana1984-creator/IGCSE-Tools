import React, { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import { Bold, Italic, List, ListOrdered, Minus, Eye, EyeOff } from 'lucide-react'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  minRows?: number
}

export function RichEditor({ value, onChange, placeholder, minRows = 4 }: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [preview, setPreview] = useState(false)

  const wrapText = (before: string, after: string) => {
    const el = textareaRef.current
    if (!el) return
    const s = value
    const st = el.selectionStart, en = el.selectionEnd
    const selected = s.slice(st, en) || 'text'
    const newVal = s.slice(0, st) + before + selected + after + s.slice(en)
    onChange(newVal)
    setTimeout(() => { el.focus(); el.setSelectionRange(st + before.length, st + before.length + selected.length) }, 0)
  }

  const prefixLines = (prefix: string) => {
    const el = textareaRef.current
    if (!el) return
    const s = value
    const st = el.selectionStart, en = el.selectionEnd
    const lines = s.split('\n')
    let c = 0
    const result = lines.map(line => {
      const ls = c; c += line.length + 1
      return (ls <= en && c > st) ? prefix + line : line
    })
    onChange(result.join('\n'))
    setTimeout(() => el.focus(), 0)
  }

  const insertText = (text: string) => {
    const el = textareaRef.current
    if (!el) return
    const s = value
    const st = el.selectionStart
    const newVal = s.slice(0, st) + text + s.slice(st)
    onChange(newVal)
    setTimeout(() => { el.focus(); el.setSelectionRange(st + text.length, st + text.length) }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'b') { e.preventDefault(); wrapText('**', '**') }
      if (e.key === 'i') { e.preventDefault(); wrapText('*', '*') }
    }
  }

  const tools = [
    { icon: <Bold className="w-3.5 h-3.5" />, title: 'Bold (Ctrl+B)', action: () => wrapText('**', '**') },
    { icon: <Italic className="w-3.5 h-3.5" />, title: 'Italic (Ctrl+I)', action: () => wrapText('*', '*') },
    { icon: <List className="w-3.5 h-3.5" />, title: 'Bullet list', action: () => prefixLines('- ') },
    { icon: <ListOrdered className="w-3.5 h-3.5" />, title: 'Numbered list', action: () => prefixLines('1. ') },
    { icon: <Minus className="w-3.5 h-3.5" />, title: 'Horizontal rule', action: () => insertText('\n\n---\n\n') },
  ]

  const textareaClass = 'w-full px-3 py-2 text-sm font-mono resize-y bg-white outline-none block'

  return (
    <>
      <div className="border border-stone-300 rounded-lg overflow-hidden focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-400">
        {/* Toolbar */}
        <div className="flex items-center gap-0.5 px-2 py-1 bg-stone-50 border-b border-stone-200">
          {!preview && tools.map((t, i) => (
            <button
              key={i}
              type="button"
              title={t.title}
              onMouseDown={e => { e.preventDefault(); t.action() }}
              className="p-1 rounded text-stone-500 hover:bg-stone-200 hover:text-stone-700"
            >
              {t.icon}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPreview(p => !p)}
            title={preview ? 'Back to edit' : 'Preview rendered output'}
            className={`ml-auto flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${preview ? 'bg-emerald-100 text-emerald-700' : 'text-stone-500 hover:bg-stone-200'}`}
          >
            {preview
              ? <><EyeOff className="w-3.5 h-3.5" /> Edit</>
              : <><Eye className="w-3.5 h-3.5" /> Preview</>
            }
          </button>
        </div>

        {/* Preview mode */}
        {preview ? (
          <div className="px-3 py-2 text-sm markdown-body" style={{ minHeight: `${minRows * 1.6}rem` }}>
            <ReactMarkdown
              remarkPlugins={[remarkMath, remarkGfm]}
              rehypePlugins={[rehypeKatex]}
            >
              {value}
            </ReactMarkdown>
          </div>

        ) : (
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={minRows}
            className={textareaClass}
          />
        )}
      </div>
    </>
  )
}
