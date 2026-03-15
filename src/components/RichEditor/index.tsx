import React, { useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import { Bold, Italic, List, ListOrdered, Minus, Eye, EyeOff, X, Trash2 } from 'lucide-react'
import { parseSVGSafe } from '../../lib/svg'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  minRows?: number
}

function extractSvgBlocks(text: string) {
  const blocks: { svgContent: string; start: number; end: number; fenced: boolean }[] = []

  const fencedRe = /```svg\s*([\s\S]*?)```/g
  let m: RegExpExecArray | null
  while ((m = fencedRe.exec(text)) !== null) {
    blocks.push({ svgContent: m[1].trim(), start: m.index, end: m.index + m[0].length, fenced: true })
  }

  const rawRe = /<svg[\s\S]*?<\/svg>/gi
  while ((m = rawRe.exec(text)) !== null) {
    const inFenced = blocks.some(b => m!.index >= b.start && m!.index < b.end)
    if (!inFenced) {
      blocks.push({ svgContent: m[0].trim(), start: m.index, end: m.index + m[0].length, fenced: false })
    }
  }

  return blocks.sort((a, b) => a.start - b.start)
}

function SvgEditorModal({ svgContent, onSave, onClose }: {
  svgContent: string
  onSave: (v: string) => void
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
          <div className="flex-1 flex flex-col border-r border-stone-200">
            <div className="px-3 py-1.5 bg-stone-50 border-b border-stone-200 text-xs text-stone-500 font-medium">SVG Code</div>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="flex-1 p-3 font-mono text-xs text-stone-800 outline-none resize-none bg-white"
              style={{ minHeight: 320 }}
              spellCheck={false}
              autoFocus
            />
          </div>
          <div className="flex-1 flex flex-col bg-stone-50/50">
            <div className="px-3 py-1.5 bg-stone-50 border-b border-stone-200 text-xs text-stone-500 font-medium">Live Preview</div>
            <div className="flex-1 p-4 overflow-auto flex items-center justify-center">
              {safe
                ? <div dangerouslySetInnerHTML={{ __html: safe }} className="max-w-full" />
                : <span className="text-stone-400 text-xs italic text-center px-4">Enter valid SVG code on the left to see a live preview here</span>
              }
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between px-4 py-3 border-t border-stone-200 bg-stone-50">
          <span className={`text-xs font-medium ${safe ? 'text-emerald-600' : 'text-red-400'}`}>
            {safe ? '✓ Valid SVG' : '✗ Invalid SVG — fix errors before applying'}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs bg-stone-100 text-stone-600 rounded-lg font-medium hover:bg-stone-200">Cancel</button>
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

const previewComponents = {
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

export function RichEditor({ value, onChange, placeholder, minRows = 4 }: Props) {
  const segRefs = useRef<(HTMLTextAreaElement | null)[]>([])
  const [editingSvgIndex, setEditingSvgIndex] = useState<number | null>(null)
  const [preview, setPreview] = useState(false)
  const [focusedSeg, setFocusedSeg] = useState(0)

  const svgBlocks = extractSvgBlocks(value)
  const svgFullTexts = svgBlocks.map(b => value.slice(b.start, b.end))

  // Split value into text segments between/around SVG blocks
  const textSegments: string[] = []
  let cursor = 0
  for (const block of svgBlocks) {
    textSegments.push(value.slice(cursor, block.start))
    cursor = block.end
  }
  textSegments.push(value.slice(cursor))

  const reconstruct = (segs: string[], fullTexts: string[]) => {
    let result = segs[0]
    for (let i = 0; i < fullTexts.length; i++) result += fullTexts[i] + segs[i + 1]
    return result
  }

  const handleTextChange = (segIndex: number, newText: string) => {
    const segs = textSegments.map((s, i) => i === segIndex ? newText : s)
    onChange(reconstruct(segs, svgFullTexts))
  }

  const handleSaveSvg = (index: number, newSvg: string) => {
    const newFullTexts = svgFullTexts.map((t, i) => {
      if (i !== index) return t
      return svgBlocks[i].fenced ? `\`\`\`svg\n${newSvg}\n\`\`\`` : newSvg
    })
    onChange(reconstruct(textSegments, newFullTexts))
  }

  const handleDeleteSvg = (index: number) => {
    const newFullTexts = svgFullTexts.filter((_, i) => i !== index)
    const newSegs = textSegments.map((s, i) => {
      if (i === index) return s + (textSegments[index + 1] ?? '')
      if (i > index + 1) return s
      return s
    }).filter((_, i) => i !== index + 1)
    onChange(reconstruct(newSegs, newFullTexts))
  }

  const wrapSeg = (seg: number, before: string, after: string) => {
    const el = segRefs.current[seg]
    if (!el) return
    const s = textSegments[seg]
    const st = el.selectionStart, en = el.selectionEnd
    const selected = s.slice(st, en) || 'text'
    const newSeg = s.slice(0, st) + before + selected + after + s.slice(en)
    const segs = textSegments.map((x, i) => i === seg ? newSeg : x)
    onChange(reconstruct(segs, svgFullTexts))
    setTimeout(() => { el.focus(); el.setSelectionRange(st + before.length, st + before.length + selected.length) }, 0)
  }

  const prefixSeg = (seg: number, prefix: string) => {
    const el = segRefs.current[seg]
    if (!el) return
    const s = textSegments[seg]
    const st = el.selectionStart, en = el.selectionEnd
    const lines = s.split('\n')
    let c = 0
    const result = lines.map(line => {
      const ls = c; c += line.length + 1
      return (ls <= en && c > st) ? prefix + line : line
    })
    const segs = textSegments.map((x, i) => i === seg ? result.join('\n') : x)
    onChange(reconstruct(segs, svgFullTexts))
    setTimeout(() => el.focus(), 0)
  }

  const insertSeg = (seg: number, text: string) => {
    const el = segRefs.current[seg]
    if (!el) return
    const s = textSegments[seg]
    const st = el.selectionStart
    const newSeg = s.slice(0, st) + text + s.slice(st)
    const segs = textSegments.map((x, i) => i === seg ? newSeg : x)
    onChange(reconstruct(segs, svgFullTexts))
    setTimeout(() => { el.focus(); el.setSelectionRange(st + text.length, st + text.length) }, 0)
  }

  const handleKeyDown = (seg: number, e: React.KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'b') { e.preventDefault(); wrapSeg(seg, '**', '**') }
      if (e.key === 'i') { e.preventDefault(); wrapSeg(seg, '*', '*') }
    }
  }

  const tools = [
    { icon: <Bold className="w-3.5 h-3.5" />, title: 'Bold (Ctrl+B)', action: () => wrapSeg(focusedSeg, '**', '**') },
    { icon: <Italic className="w-3.5 h-3.5" />, title: 'Italic (Ctrl+I)', action: () => wrapSeg(focusedSeg, '*', '*') },
    { icon: <List className="w-3.5 h-3.5" />, title: 'Bullet list', action: () => prefixSeg(focusedSeg, '- ') },
    { icon: <ListOrdered className="w-3.5 h-3.5" />, title: 'Numbered list', action: () => prefixSeg(focusedSeg, '1. ') },
    { icon: <Minus className="w-3.5 h-3.5" />, title: 'Horizontal rule', action: () => insertSeg(focusedSeg, '\n\n---\n\n') },
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
              rehypePlugins={[rehypeKatex, rehypeRaw]}
              components={previewComponents}
            >
              {value}
            </ReactMarkdown>
          </div>

        ) : svgBlocks.length === 0 ? (
          /* No SVGs — single textarea */
          <textarea
            ref={el => { segRefs.current[0] = el }}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={e => handleKeyDown(0, e)}
            onFocus={() => setFocusedSeg(0)}
            placeholder={placeholder}
            rows={minRows}
            className={textareaClass}
          />

        ) : (
          /* Segmented edit mode — text areas separated by SVG panels */
          <>
            {svgBlocks.map((block, i) => {
              const safe = parseSVGSafe(block.svgContent)
              return (
                <React.Fragment key={`seg-${i}`}>
                  {/* Text segment before this SVG */}
                  <textarea
                    ref={el => { segRefs.current[i] = el }}
                    value={textSegments[i]}
                    onChange={e => handleTextChange(i, e.target.value)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    onFocus={() => setFocusedSeg(i)}
                    placeholder={i === 0 ? placeholder : undefined}
                    rows={Math.max(2, textSegments[i].split('\n').length)}
                    className={textareaClass}
                  />

                  {/* SVG block panel */}
                  <div className="border-t-2 border-b-2 border-violet-100">
                    <div className="flex items-center justify-between px-3 py-1.5 bg-violet-50">
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-violet-400" />
                        <span className="text-xs font-semibold text-violet-700">
                          Diagram{svgBlocks.length > 1 ? ` ${i + 1}` : ''}
                        </span>
                        {!safe && <span className="text-xs text-red-400 italic">⚠ Invalid SVG</span>}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingSvgIndex(i)}
                          className="text-xs px-2.5 py-0.5 bg-violet-100 text-violet-700 rounded-full hover:bg-violet-200 font-medium transition-colors"
                        >
                          Edit Diagram
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteSvg(i)}
                          className="p-1 text-red-300 hover:text-red-500 rounded transition-colors"
                          title="Remove diagram"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                    {safe && (
                      <div
                        className="px-4 py-2 bg-violet-50/30 overflow-auto"
                        dangerouslySetInnerHTML={{ __html: safe }}
                        style={{ fontSize: '0.82em' }}
                      />
                    )}
                  </div>
                </React.Fragment>
              )
            })}

            {/* Last text segment (after final SVG) */}
            <textarea
              ref={el => { segRefs.current[svgBlocks.length] = el }}
              value={textSegments[svgBlocks.length]}
              onChange={e => handleTextChange(svgBlocks.length, e.target.value)}
              onKeyDown={e => handleKeyDown(svgBlocks.length, e)}
              onFocus={() => setFocusedSeg(svgBlocks.length)}
              rows={Math.max(2, textSegments[svgBlocks.length].split('\n').length)}
              className={textareaClass}
            />
          </>
        )}
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
