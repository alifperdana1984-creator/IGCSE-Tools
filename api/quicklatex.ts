/**
 * Vercel Edge Function — QuickLaTeX proxy.
 * Accepts POST { formula: string } and forwards to QuickLaTeX API.
 * Required because QuickLaTeX does not set CORS headers.
 */
export const config = { runtime: 'edge' }

// Minimal preamble — no \usetikzlibrary to avoid pgf version compatibility issues
const PREAMBLE = '\\usepackage{tikz}'

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    })
  }
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  let formula: string
  try {
    const body = await req.json() as { formula?: string }
    formula = body.formula ?? ''
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  if (!formula) return new Response('Missing formula', { status: 400 })

  const params = new URLSearchParams({
    formula,
    fsize: '17px',
    fcolor: '000000',
    bcolor: 'ffffff',
    mode: '0',
    out: '1',
    errors: '1',
    preamble: PREAMBLE,
  })

  const qlRes = await fetch('https://quicklatex.com/latex3.f', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })

  const text = await qlRes.text()
  return new Response(text, {
    headers: {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
