/**
 * QuickLaTeX client — renders TikZ code to a PNG image via the proxy.
 * In production: /api/quicklatex (Vercel Edge Function).
 * In dev: /api/quicklatex (Vite configureServer middleware in vite.config.ts).
 */

interface QuickLaTeXResult {
  url: string
  width: number
  height: number
}

// Simple in-memory cache keyed by TikZ code
const cache = new Map<string, QuickLaTeXResult>()

/**
 * Wraps bare TikZ body in \begin{tikzpicture}...\end{tikzpicture} if needed.
 */
function wrapTikz(code: string): string {
  const trimmed = code.trim()
  if (trimmed.startsWith('\\begin{tikzpicture}')) return trimmed
  return `\\begin{tikzpicture}\n${trimmed}\n\\end{tikzpicture}`
}

/**
 * Renders TikZ code and returns a PNG URL hosted on quicklatex.com.
 * Throws if rendering fails.
 */
export async function renderTikz(code: string): Promise<QuickLaTeXResult> {
  const formula = wrapTikz(code)
  const cached = cache.get(formula)
  if (cached) return cached

  const res = await fetch('/api/quicklatex', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ formula }),
  })

  if (!res.ok) throw new Error(`QuickLaTeX proxy error: HTTP ${res.status}`)

  const text = await res.text()
  const lines = text.trim().split('\n')

  // QuickLaTeX response format:
  //   line 0: "0" (success) or error code
  //   line 1: image URL
  //   line 2: "width height"
  if (lines[0] !== '0') {
    const msg = lines.slice(1).join(' ').trim() || 'Unknown QuickLaTeX error'
    throw new Error(`QuickLaTeX: ${msg}`)
  }

  const url = lines[1]?.trim()
  if (!url) throw new Error('QuickLaTeX returned no image URL')

  const [w, h] = (lines[2] ?? '400 300').split(' ').map(Number)
  const result: QuickLaTeXResult = { url, width: isNaN(w) ? 400 : w, height: isNaN(h) ? 300 : h }
  cache.set(formula, result)
  return result
}
