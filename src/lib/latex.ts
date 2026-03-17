const BARE_LATEX_RE = /(\\(?:frac|sqrt|sum|int|prod|lim|infty|partial|Delta|alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega|Gamma|Lambda|Sigma|Phi|Omega|times|div|pm|mp|leq|geq|neq|approx|equiv|sim|cong|cdot|ldots|dots|circ|degree|angle|triangle|perp|parallel|propto|nabla|therefore|because|vec|hat|bar|tilde|overline|underline|left|right|mathbf|mathrm|mathit|text|sqrt)\b(?:\{[^}]*\})*(?:\{[^}]*\})*)/g

/**
 * Fixes AI LaTeX output before passing to KaTeX:
 * 1. Merges adjacent $a$$b$ blocks the AI accidentally split (→ $ab$)
 * 2. Wraps bare \commands in $...$ — only in segments NOT already inside $...$
 *    (handles MCQ options where question stem has $ but options don't)
 */
export function preprocessLatex(text: string): string {
  // Step 0: escape currency dollar signs so they don't get parsed as LaTeX math delimiters.
  // Uses HTML entity &#36; (renders as $) instead of \$ (shows backslash in some renderers).
  //
  // Pattern: $DIGITS (optionally followed by a unit suffix like m, cm, kg)
  // Escaped when followed by:
  //   • space + 3+ letters  ("$1500 for", "$5.2m rests")
  //   • punctuation/newline ("$60,", "$180\n")
  //   • end of line/string  ("$1680" at end of option)
  //
  // NOT escaped (preserved as math):
  //   • $3x^2$  — next non-unit char is ^ or _ → math operator context
  //   • $\frac  — backslash after $ → clearly LaTeX
  let result = text.replace(/\$(\d[\d,.]*(?:[a-zA-Z]{1,4})?)(?=\s+[a-zA-Z]{3,}|[,.)!?\n]|\s*$)/gm, (_, digits) => `&#36;${digits}`)

  // Step 0.5: repair malformed inline sequences like \alpha$$\beta
  // produced by some model outputs; this avoids KaTeX parse errors.
  result = result.replace(/(\\[A-Za-z]+)\s*\$\$\s*(\\[A-Za-z]+)/g, '$1 $2')

  // Step 0.6: fix common model LaTeX typos before POWER_RE runs
  // ^{circ} without backslash → ^{\circ}  (model drops the backslash)
  result = result.replace(/\^\{circ\}/g, '^{\\circ}')
  // ^ ext{...} → ^{\text{...}}  (model writes "ext" instead of "\text")
  result = result.replace(/\^ ?ext\{([^}]*)\}/g, '^{\\text{$1}}')

  // Step 1: merge accidentally split adjacent math blocks
  result = result.replace(/\$([^$\n]+?)\$\$([^$\n]+?)\$/g, (_m, a, b) => `$${a}${b}$`)

  // Step 2: split by existing $...$ blocks; in each plain segment:
  //   2a) wrap power-expressions (e.g. x^2, 2x^2+7x, 108^{\circ}) FIRST
  //   2b) then wrap remaining bare \commands with BARE_LATEX_RE
  // Running 2a before 2b avoids BARE_LATEX_RE grabbing \circ out of 108^{\circ}
  const POWER_RE = /\b([a-zA-Z0-9]+(?:\^(?:\{[^}]*\}|[a-zA-Z0-9]+))(?:\s*[+\-]\s*[0-9]*[a-zA-Z]*(?:\^(?:\{[^}]*\}|[a-zA-Z0-9]+))?[a-zA-Z0-9]*)*)/g

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
