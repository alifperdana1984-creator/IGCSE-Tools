/**
 * Safely parses and sanitizes an SVG string using DOMParser.
 * Blocks executable/dangerous tags and attributes, then normalizes dimensions.
 * Returns sanitized SVG outerHTML, or null if malformed.
 */
export function parseSVGSafe(svgString: string): string | null {
  if (!svgString.trim()) return null

  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString, 'image/svg+xml')
  if (doc.querySelector('parsererror')) return null
  const svg = doc.documentElement
  if (svg.tagName.toLowerCase() !== 'svg') return null

  const blockedTags = new Set([
    'script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas', 'link', 'style'
  ])
  doc.querySelectorAll('*').forEach(el => {
    if (blockedTags.has(el.tagName.toLowerCase())) {
      el.remove()
      return
    }
    // Remove executable attributes and risky link/style vectors.
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      const value = attr.value.trim()
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name)
        continue
      }
      if (name === 'style') {
        el.removeAttribute(attr.name)
        continue
      }
      if (name === 'href' || name === 'xlink:href') {
        if (!value.startsWith('#')) el.removeAttribute(attr.name)
        continue
      }
      if ((name === 'src' || name === 'data') && /^(javascript:|data:text\/html)/i.test(value)) {
        el.removeAttribute(attr.name)
      }
    }
  })

  // Strip LaTeX from SVG <text> elements — SVG cannot render KaTeX, so
  // raw delimiters like "$5.2 \text{ m}$" would show as ugly strings.
  // Convert to readable plain text: "$5.2 \text{ m}$" → "5.2 m", "$60^\circ$" → "60°"
  doc.querySelectorAll('text, tspan').forEach(el => {
    const raw = el.textContent ?? ''
    if (!raw.includes('$') && !raw.includes('\\')) return
    const plain = raw
      .replace(/\$([^$]+)\$/g, '$1')            // strip outer $...$
      .replace(/\\text\s*\{([^}]*)\}/g, '$1')   // \text{m} → m
      .replace(/\\mathrm\s*\{([^}]*)\}/g, '$1') // \mathrm{cm} → cm
      .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, '$1/$2') // \frac{a}{b} → a/b
      .replace(/\^\\circ|\^\\degree/g, '°')     // ^\circ → °
      .replace(/\\circ|\\degree/g, '°')         // lone \circ → °
      .replace(/\\cdot/g, '·')
      .replace(/\\times/g, '×')
      .replace(/\\pm/g, '±')
      .replace(/\\\s*/g, '')                     // remove remaining backslashes
      .replace(/\s+/g, ' ').trim()
    if (plain !== raw) el.textContent = plain
  })

  // Preserve intrinsic dimensions as viewBox so the SVG scales properly
  if (!svg.getAttribute('viewBox')) {
    const w = Number.parseFloat(svg.getAttribute('width') ?? '')
    const h = Number.parseFloat(svg.getAttribute('height') ?? '')
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
    }
  }

  // Make the SVG fill its container width and scale height proportionally
  svg.setAttribute('width', '100%')
  svg.removeAttribute('height')

  return svg.outerHTML
}

/** Normalizes AI markdown that may contain malformed raw SVG snippets.
 *  - Fixes accidental `svg<svg ...` prefix
 *  - Wraps raw `<svg>...</svg>` blocks in ```svg fenced blocks
 */
export function normalizeSvgMarkdown(text: string): string {
  if (!text) return text

  const fixedPrefix = text.replace(/(^|[\s>])svg<svg\b/gi, '$1<svg')

  const fencedRanges: Array<{ start: number; end: number }> = []
  const fencedRe = /```svg\s*[\s\S]*?```/gi
  let m: RegExpExecArray | null
  while ((m = fencedRe.exec(fixedPrefix)) !== null) {
    fencedRanges.push({ start: m.index, end: m.index + m[0].length })
  }

  const rawRe = /<svg[\s\S]*?<\/svg>/gi
  const wraps: Array<{ start: number; end: number; raw: string }> = []
  while ((m = rawRe.exec(fixedPrefix)) !== null) {
    const start = m.index
    const end = m.index + m[0].length
    const inFenced = fencedRanges.some(r => start >= r.start && end <= r.end)
    if (!inFenced) wraps.push({ start, end, raw: m[0] })
  }

  if (wraps.length === 0) {
    // Even if no raw SVGs need wrapping, ensure existing fenced blocks
    // are preceded by a newline so markdown treats them as block-level code
    return fixedPrefix.replace(/([^\n])(\s*```svg)/g, '$1\n$2')
  }

  let out = ''
  let cursor = 0
  for (const w of wraps) {
    out += fixedPrefix.slice(cursor, w.start)
    out += `\n\`\`\`svg\n${w.raw}\n\`\`\`\n`
    cursor = w.end
  }
  out += fixedPrefix.slice(cursor)
  // Also fix any pre-existing fenced blocks that lack a leading newline
  return out.replace(/([^\n])(\s*```svg)/g, '$1\n$2')
}
