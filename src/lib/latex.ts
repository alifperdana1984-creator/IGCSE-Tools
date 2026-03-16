const BARE_LATEX_RE = /(\\(?:frac|sqrt|sum|int|prod|lim|infty|partial|Delta|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|phi|omega|times|div|pm|leq|geq|neq|approx|cdot|ldots|vec|hat|bar|overline|underline|left|right|mathbf|mathrm|text)\b(?:\{[^}]*\})*(?:\{[^}]*\})*)/g

/**
 * Fixes AI LaTeX output before passing to KaTeX:
 * 1. Merges adjacent $a$$b$ blocks the AI accidentally split (→ $ab$)
 * 2. If text has no $ at all, wraps bare \commands in $...$
 */
export function preprocessLatex(text: string): string {
  let result = text.replace(/\$([^$\n]+?)\$\$([^$\n]+?)\$/g, (_m, a, b) => `$${a}${b}$`)
  if (!result.includes('$')) {
    result = result.replace(BARE_LATEX_RE, (match) => `$${match}$`)
  }
  return result
}
