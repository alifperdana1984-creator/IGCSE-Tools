export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Google Gemini
  'gemini-2.5-flash-preview-05-20': { input: 0.15, output: 0.60 },
  'gemini-2.5-pro-preview-05-06': { input: 1.25, output: 10.00 },
  'gemini-2.0-flash-lite': { input: 0.075, output: 0.30 },
  // OpenAI
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1': { input: 2.00, output: 8.00 },
  // Anthropic
  'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-opus-4-5': { input: 15.00, output: 75.00 },
}

const FALLBACK_PRICING = { input: 0.10, output: 0.40 }
const IDR_RATE = 15800

export function estimateCostIDR(
  modelId: string,
  inputTokens: number,
  outputTokens: number
): number {
  const p = MODEL_PRICING[modelId] ?? FALLBACK_PRICING
  const usd = (inputTokens / 1_000_000 * p.input) + (outputTokens / 1_000_000 * p.output)
  return Math.round(usd * IDR_RATE)
}
