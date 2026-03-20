import React, { useEffect, useState } from 'react'
import type { TikzSpec } from '../../lib/types'
import { renderTikz } from '../../lib/quicklatex'

export function DiagramRenderer({ spec }: { spec: TikzSpec | undefined | null }) {
  const [state, setState] = useState<{ url?: string; error?: string; loading: boolean }>({ loading: false })

  useEffect(() => {
    if (!spec?.code) { setState({ loading: false }); return }
    let cancelled = false
    setState({ loading: true })
    renderTikz(spec.code)
      .then(result => { if (!cancelled) setState({ url: result.url, loading: false }) })
      .catch(err => { if (!cancelled) setState({ error: String(err), loading: false }) })
    return () => { cancelled = true }
  }, [spec?.code])

  if (!spec) return null

  return (
    <div className="my-3 border-t-2 border-b-2 border-violet-100 py-3 bg-violet-50/30 rounded-sm">
      <p className="text-xs font-semibold text-violet-400 mb-2 flex items-center gap-1.5 px-1">
        <span className="w-1.5 h-1.5 rounded-full bg-violet-300 inline-block" />
        Diagram
      </p>
      <div className="px-1">
        {state.loading && (
          <div className="flex items-center gap-2 py-4 px-2 text-sm text-violet-400">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            Rendering diagram…
          </div>
        )}
        {state.error && (
          <details className="text-xs text-red-400 py-2 px-1">
            <summary className="cursor-pointer font-semibold">Render error — click to see details</summary>
            <p className="font-mono whitespace-pre-wrap mt-1">{state.error}</p>
            <p className="mt-2 font-semibold text-stone-500">TikZ source:</p>
            <pre className="font-mono text-stone-400 whitespace-pre-wrap text-[10px] mt-1 max-h-40 overflow-y-auto">{spec.code}</pre>
          </details>
        )}
        {state.url && (
          <img
            src={state.url}
            alt="diagram"
            style={{
              maxWidth: spec.maxWidth ? `${spec.maxWidth}px` : '640px',
              display: 'block',
              margin: '0 auto',
            }}
          />
        )}
      </div>
    </div>
  )
}
