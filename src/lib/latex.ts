const BARE_LATEX_RE = /(\\(?:frac|sqrt|sum|int|prod|lim|infty|partial|Delta|alpha|beta|gamma|delta|epsilon|theta|lambda|mu|pi|sigma|phi|omega|times|div|pm|leq|geq|neq|approx|cdot|ldots|vec|hat|bar|overline|underline|left|right|mathbf|mathrm|text)\b(?:\{[^}]*\})*(?:\{[^}]*\})*)/g

/**
 * Fixes AI LaTeX output before passing to KaTeX:
 * 1. Merges adjacent $a$$b$ blocks the AI accidentally split (→ $ab$)
 * 2. Wraps bare \commands in $...$ — only in segments NOT already inside $...$
 *    (handles MCQ options where question stem has $ but options don't)
 */
export function preprocessLatex(text: string): string {
  // Step 0: escape currency dollar signs ($5000, $3.50) but NOT math blocks like $1000 \times 4$
  // Currency pattern: $digits followed by space+letter (plain English word, not LaTeX command/operator)
  // "$5000 at a rate" → \$5000   |   "$1000 \times" → unchanged   |   "$4$" → unchanged
  let result = text.replace(/\$(\d[\d,.]*)(?=\s[a-zA-Z])/g, '\\$$1')

  // Step 1: merge accidentally split adjacent math blocks
  result = result.replace(/\$([^$\n]+?)\$\$([^$\n]+?)\$/g, (_m, a, b) => `$${a}${b}$`)

  // Step 2: split by existing $...$ blocks, wrap bare \commands only in plain segments
  const segments = result.split(/(\$[^$\n]+?\$)/g)
  result = segments.map((seg, i) => {
    // Odd indices are already-wrapped math blocks — leave untouched
    if (i % 2 === 1) return seg
    return seg.replace(BARE_LATEX_RE, (match) => `$${match}$`)
  }).join('')

  return result
}
