/**
 * Vercel Edge Function — QuickLaTeX proxy.
 * Accepts POST { formula: string } and forwards to QuickLaTeX API.
 * Required because QuickLaTeX does not set CORS headers.
 */
export const config = { runtime: 'edge' }

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
  let libraries: string
  try {
    const body = await req.json() as { formula?: string; libraries?: string }
    formula = body.formula ?? ''
    libraries = body.libraries ?? ''
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }

  if (!formula) return new Response('Missing formula', { status: 400 })

  // QuickLaTeX free API only supports mode=0 (snippet). Full \documentclass documents
  // are stripped to their tikzpicture block by the client before reaching here.
  const preamble = libraries
    ? `\\usepackage{tikz}\n\\usetikzlibrary{${libraries}}`
    : '\\usepackage{tikz}'

  // URLSearchParams encodes spaces as '+', but QuickLaTeX does not decode '+' as space.
  // Use encodeURIComponent (spaces → '%20') so QuickLaTeX receives correct whitespace.
  const body = [
    `formula=${encodeURIComponent(formula)}`,
    `fsize=17px`,
    `fcolor=000000`,
    `bcolor=ffffff`,
    `mode=0`,
    `out=1`,
    `errors=1`,
    `preamble=${encodeURIComponent(preamble)}`,
  ].join('&')

  const qlRes = await fetch('https://quicklatex.com/latex3.f', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  const text = await qlRes.text()
  return new Response(text, {
    headers: {
      'Content-Type': 'text/plain',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
