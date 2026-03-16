/**
 * Safely parses an SVG string using DOMParser.
 * Makes the SVG responsive by normalising width/height/viewBox.
 * Returns the validated outerHTML, or null if the SVG is malformed.
 */
export function parseSVGSafe(svgString: string): string | null {
  if (!svgString.trim()) return null
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgString, 'image/svg+xml')
  if (doc.querySelector('parsererror')) return null
  const svg = doc.documentElement as Element

  // Preserve intrinsic dimensions as viewBox so the SVG scales properly
  if (!svg.getAttribute('viewBox')) {
    const w = svg.getAttribute('width')
    const h = svg.getAttribute('height')
    if (w && h) svg.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`)
  }

  // Make the SVG fill its container width and scale height proportionally
  svg.setAttribute('width', '100%')
  svg.removeAttribute('height')

  return svg.outerHTML
}
