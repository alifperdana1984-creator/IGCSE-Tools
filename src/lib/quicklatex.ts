/**
 * LaTeX render client — sends TikZ code to /api/latex proxy
 * (Vercel Serverless → Railway pdflatex renderer).
 */

interface RenderResult {
  url: string;
  width: number;
  height: number;
}

const cache = new Map<string, RenderResult>();

function sanitize(code: string): string {
  // Strip markdown code fences
  const fenced = code.match(/```(?:latex|tex)?\s*([\s\S]*?)```/i)
  if (fenced) code = fenced[1]
  // Fix literal \n sequences from JSON serialization — only when not part of a LaTeX command
  // Match \n only when followed by whitespace, digit, or end-of-string (not a letter like \node, \normalsize)
  code = code.replace(/\\n(?=[^a-zA-Z]|$)/g, '\n')
  return code.trim()
}

export async function renderTikz(code: string): Promise<RenderResult> {
  const clean = sanitize(code)
  const cached = cache.get(clean)
  if (cached) return cached

  const res = await fetch('/api/latex', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: clean }),
  })

  if (!res.ok) {
    const msg = await res.text().catch(() => '')
    throw new Error(`LaTeX render error: HTTP ${res.status}${msg ? ` — ${msg}` : ''}`)
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const result: RenderResult = { url, width: 400, height: 300 }
  cache.set(clean, result)
  return result
}
