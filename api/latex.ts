/**
 * Vercel Edge Function — QuickLaTeX proxy.
 * Accepts POST { code: string } — tikzpicture block or full standalone document.
 * Extracts the tikzpicture block and sends it as formula+preamble to QuickLaTeX.
 */
export const config = { runtime: 'edge' }

const BASE_PREAMBLE = [
  '\\usepackage{tikz}',
  '\\usepackage{amsmath}',
  '\\usetikzlibrary{arrows.meta,calc,patterns,positioning}',
].join('\n')

function extractTikzBlock(code: string): { formula: string; extraLibs: string } {
  // Extract tikzpicture block
  const blockMatch = code.match(/\\begin\{tikzpicture\}[\s\S]*?\\end\{tikzpicture\}/)
  const formula = blockMatch ? blockMatch[0] : code

  // Collect all \usetikzlibrary calls from anywhere in the document
  const libMatches = [...code.matchAll(/\\usetikzlibrary\{([^}]+)\}/g)]
  const libs = [...new Set(
    libMatches.flatMap(m => m[1].split(',').map((s: string) => s.trim()).filter(Boolean))
  )]
  return { formula, extraLibs: libs.join(',') }
}

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
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  let code: string
  try {
    const body = await req.json() as { code?: string }
    code = body.code ?? ''
  } catch {
    return new Response('Invalid JSON body', { status: 400 })
  }
  if (!code) return new Response('Missing code', { status: 400 })

  const { formula, extraLibs } = extractTikzBlock(code)
  const preamble = extraLibs
    ? `${BASE_PREAMBLE}\n\\usetikzlibrary{${extraLibs}}`
    : BASE_PREAMBLE

  const params = [
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
    body: params,
  })

  const text = await qlRes.text()
  const lines = text.split('\n').map((l: string) => l.trim()).filter(Boolean)

  // QuickLaTeX response format:
  //   Success: "0\n<url> <w> <h>\n"
  //   Error:   "1\n<error message>\n"
  const statusLine = lines[0]
  if (statusLine === '1') {
    const errMsg = lines.slice(1).join(' ').trim()
    return new Response(`QuickLaTeX error: ${errMsg || 'unknown error'}`, { status: 502 })
  }

  const urlLine = lines.find((l: string) => l.startsWith('http'))
  if (!urlLine) {
    return new Response(`QuickLaTeX unexpected response: ${text.slice(0, 300)}`, { status: 502 })
  }

  const imageUrl = urlLine.split(/\s+/)[0]
  if (imageUrl.includes('/error.png')) {
    const errMsg = lines.filter((l: string) => !l.startsWith('http') && !/^\d/.test(l)).join(' ')
    return new Response(`QuickLaTeX render error: ${errMsg || 'unknown'}`, { status: 502 })
  }

  const imgRes = await fetch(imageUrl)
  if (!imgRes.ok) return new Response(`Image fetch failed: HTTP ${imgRes.status}`, { status: 502 })

  const buf = await imgRes.arrayBuffer()
  return new Response(buf, {
    headers: {
      'Content-Type': 'image/png',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
