import React, { useRef, useState } from 'react'
import { Bold, Italic, List, ListOrdered, Minus, X } from 'lucide-react'
import { parseSVGSafe } from '../../lib/svg'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  minRows?: number
}

function extractSvgBlocks(text: string) {
  const blocks: { svgContent: string; start: number; end: number }[] = []
  const regex = /```svg\s*([\s\S]*?)```/g
  let m
  while ((m = regex.exec(text)) !== null) {
    blocks.push({ svgContent: m[1].trim(), start: m.index, end: m.index + m[0].length })
  }
  return blocks
}

function SvgEditorModal({
  svgContent,
  onSave,
  onClose,
}: {
  svgContent: string
  onSave: (newSvg: string) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(svgContent)
  const safe = parseSVGSafe(draft)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-4xl mx-4 flex flex-col overflow-hidden"
        style={{ maxHeight: '88vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-200 bg-stone-50">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-violet-400" />
            <span className="text-sm font-semibold text-stone-800">Edit SVG Diagram</span>
          </div>
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-600 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden" style={{ minHeight: 0 }}>
          {/* SVG Code */}
          <div className="flex-1 flex flex-col border-r border-stone-200">
            <div className="px-3 py-1.5 bg-stone-50 border-b border-stone-200 text-xs text-stone-500 font-medium">
              SVG Code
            </div>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="flex-1 p-3 font-mono text-xs text-stone-800 outline-none resize-none bg-white"
              style={{ minHeight: 320 }}
              spellCheck={false}
              autoFocus
            />
          </div>

          {/* Preview */}
          <div className="flex-1 flex flex-col bg-stone-50/50">
            <div className="px-3 py-1.5 bg-stone-50 border-b border-stone-200 text-xs text-stone-500 font-medium">
              Live Preview
            </div>
            <div className="flex-1 p-4 overflow-auto flex items-center justify-center">
              {safe
                ? <div dangerouslySetInnerHTML={{ __html: safe }} className="max-w-full" />
                : <span className="text-stone-400 text-xs italic text-center px-4">
                    Enter valid SVG code on the left to see a live preview here
                  </span>
              }
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between px-4 py-3 border-t border-stone-200 bg-stone-50">
          <span className={`text-xs font-medium ${safe ? 'text-emerald-600' : 'text-red-400'}`}>
            {safe ? '✓ Valid SVG' : '✗ Invalid SVG — fix errors before applying'}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs bg-stone-100 text-stone-600 rounded-lg font-medium hover:bg-stone-200"
            >
              Cancel
            </button>
            <button
              onClick={() => { onSave(draft); onClose() }}
              disabled={!safe}
              className="px-3 py-1.5 text-xs bg-violet-600 text-white rounded-lg font-medium hover:bg-violet-700 disabled:bg-stone-300 disabled:cursor-not-allowed"
            >
              Apply Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function RichEditor({ value, onChange, placeholder, minRows = 4 }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const [editingSvgIndex, setEditingSvgIndex] = useState<number | null>(null)

  const wrap = (before: string, after: string) => {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = value.slice(start, end) || 'text'
    const next = value.slice(0, start) + before + selected + after + value.slice(end)
    onChange(next)
    setTimeout(() => {
      el.focus()
      el.setSelectionRange(start + before.length, start + before.length + selected.length)
    }, 0)
  }

  const prefixLines = (prefix: string) => {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const lines = value.split('\n')
    let charCount = 0
    const result = lines.map(line => {
      const lineStart = charCount
      charCount += line.length + 1
      if (lineStart <= end && charCount > start) return prefix + line
      return line
    })
    onChange(result.join('\n'))
    setTimeout(() => el.focus(), 0)
  }

  const insertAtCursor = (text: string) => {
    const el = ref.current
    if (!el) return
    const start = el.selectionStart
    const next = value.slice(0, start) + text + value.slice(start)
    onChange(next)
    setTimeout(() => { el.focus(); el.setSelectionRange(start + text.length, start + text.length) }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'b') { e.preventDefault(); wrap('**', '**') }
      if (e.key === 'i') { e.preventDefault(); wrap('*', '*') }
    }
  }

  const handleSaveSvg = (index: number, newSvg: string) => {
    const blocks = extractSvgBlocks(value)
    const block = blocks[index]
    if (!block) return
    const newBlock = `\`\`\`svg\n${newSvg}\n\`\`\``
    onChange(value.slice(0, block.start) + newBlock + value.slice(block.end))
  }

  const svgBlocks = extractSvgBlocks(value)

  const tools = [
    { icon: <Bold className="w-3.5 h-3.5" />, title: 'Bold (Ctrl+B)', action: () => wrap('**', '**') },
    { icon: <Italic className="w-3.5 h-3.5" />, title: 'Italic (Ctrl+I)', action: () => wrap('*', '*') },
    { icon: <List className="w-3.5 h-3.5" />, title: 'Bullet list', action: () => prefixLines('- ') },
    { icon: <ListOrdered className="w-3.5 h-3.5" />, title: 'Numbered list', action: () => prefixLines('1. ') },
    { icon: <Minus className="w-3.5 h-3.5" />, title: 'Horizontal rule', action: () => insertAtCursor('\n\n---\n\n') },
  ]

  return (
    <>
      <div className="border border-stone-300 rounded-lg overflow-hidden focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-400">
        {/* Toolbar */}
        <div className="flex items-center gap-0.5 px-2 py-1 bg-stone-50 border-b border-stone-200">
          {tools.map((t, i) => (
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
          {svgBlocks.length > 0 && (
            <span className="ml-auto text-xs text-violet-500 font-medium px-1.5 py-0.5 bg-violet-50 rounded">
              {svgBlocks.length} diagram{svgBlocks.length > 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* Textarea */}
        <textarea
          ref={ref}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          rows={minRows}
          className="w-full px-3 py-2 text-sm font-mono resize-y bg-white outline-none"
        />

        {/* SVG Block Panels */}
        {svgBlocks.map((block, i) => {
          const safe = parseSVGSafe(block.svgContent)
          return (
            <div key={i} className="border-t-2 border-violet-100">
              <div className="flex items-center justify-between px-3 py-1.5 bg-violet-50">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                  <span className="text-xs font-semibold text-violet-700">
                    Diagram{svgBlocks.length > 1 ? ` ${i + 1}` : ''}
                  </span>
                  {!safe && (
                    <span className="text-xs text-red-400 italic">⚠ Invalid SVG</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setEditingSvgIndex(i)}
                  className="text-xs px-2.5 py-0.5 bg-violet-100 text-violet-700 rounded-full hover:bg-violet-200 font-medium transition-colors"
                >
                  Edit Diagram
                </button>
              </div>
              {safe && (
                <div
                  className="px-4 py-2 bg-violet-50/30 overflow-auto"
                  dangerouslySetInnerHTML={{ __html: safe }}
                  style={{ fontSize: '0.82em' }}
                />
              )}
            </div>
          )
        })}
      </div>

      {editingSvgIndex !== null && (
        <SvgEditorModal
          svgContent={svgBlocks[editingSvgIndex]?.svgContent ?? ''}
          onSave={newSvg => handleSaveSvg(editingSvgIndex, newSvg)}
          onClose={() => setEditingSvgIndex(null)}
        />
      )}
    </>
  )
}
