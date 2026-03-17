const BARE_LATEX_RE = /(\\(?:frac|sqrt|sum|int|prod|lim|infty|partial|Delta|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Lambda|Sigma|Phi|Omega|times|div|pm|mp|leq|geq|neq|approx|equiv|sim|cong|cdot|ldots|dots|circ|degree|angle|triangle|perp|parallel|propto|nabla|therefore|because|vec|hat|bar|tilde|overline|underline|left|right|mathbf|mathrm|mathit|text|sqrt)\b(?:\{[^}]*\})*(?:\{[^}]*\})*)/g

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
  let result = text.replace(/\$(\d[\d,.]*)(?=\s[a-zA-Z])/g, (_, digits) => `\\$${digits}`)

  // Step 0.5: repair malformed inline sequences like \alpha$$\beta
  // produced by some model outputs; this avoids KaTeX parse errors.
  result = result.replace(/(\\[A-Za-z]+)\s*\$\$\s*(\\[A-Za-z]+)/g, '$1 $2')

  // Step 1: merge accidentally split adjacent math blocks
  result = result.replace(/\$([^$\n]+?)\$\$([^$\n]+?)\$/g, (_m, a, b) => `$${a}${b}$`)

  // Step 2: split by existing $...$ blocks; in each plain segment:
  //   2a) wrap power-expressions (e.g. x^2, 2x^2+7x, 108^{\circ}) FIRST
  //   2b) then wrap remaining bare \commands with BARE_LATEX_RE
  // Running 2a before 2b avoids BARE_LATEX_RE grabbing \circ out of 108^{\circ}
  const POWER_RE = /\b([a-zA-Z0-9]+(?:\^(?:\{[^}]*\}|[a-zA-Z0-9]+))(?:[a-zA-Z0-9]*)?(?:\s*[+\-]\s*[0-9]*[a-zA-Z]*(?:\^(?:\{[^}]*\}|[a-zA-Z0-9]+))?[a-zA-Z0-9]*)*)/g

  const segments = result.split(/(\$[^$\n]+?\$)/g)
  result = segments.map((seg, i) => {
    if (i % 2 === 1) return seg  // already inside $...$

    // 2a: wrap power expressions
    const afterPowers = seg.replace(POWER_RE, (match) => `$${match}$`)

    // 2b: re-split so newly created $...$ blocks are protected, then apply BARE_LATEX_RE
    const subSegs = afterPowers.split(/(\$[^$\n]+?\$)/g)
    return subSegs.map((ss, j) => {
      if (j % 2 === 1) return ss
      return ss.replace(BARE_LATEX_RE, (match) => `$${match}$`)
    }).join('')
  }).join('')

  return result
}
