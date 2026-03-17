function stripMarkdownFences(text: string): string {
  const cleaned = text.trim()
  if (!cleaned.startsWith('```')) return cleaned
  return cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}

function removeTrailingCommas(candidate: string): string {
  return candidate.replace(/,\s*([}\]])/g, '$1')
}

export function parseJsonWithRecovery<T = any>(text: string, source = 'model'): T {
  const cleaned = stripMarkdownFences(text)
  const candidates: string[] = [cleaned]

  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start !== -1 && end > start) candidates.push(cleaned.substring(start, end + 1))

  for (const c of candidates) {
    const normalized = removeTrailingCommas(c)
    try {
      return JSON.parse(normalized) as T
    } catch {
      // try next candidate
    }
  }

  const e: any = new Error(`Invalid JSON response from ${source}`)
  e.status = 422
  e.type = 'invalid_response'
  e.context = cleaned.substring(Math.max(0, cleaned.length - 500))
  throw e
}

