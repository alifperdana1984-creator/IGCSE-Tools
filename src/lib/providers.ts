export type AIProvider = 'gemini' | 'openai' | 'anthropic'

export const PROVIDER_LABELS: Record<AIProvider, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI (ChatGPT)',
  anthropic: 'Anthropic (Claude)',
}

export interface ProviderModel {
  id: string
  label: string
}

export const PROVIDER_MODELS: Record<AIProvider, ProviderModel[]> = {
  gemini: [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (Recommended)' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (Best Quality)' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite (Budget)' },
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash (Preview)' },
  ],
  openai: [
    { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
    { id: 'gpt-4.1', label: 'GPT-4.1' },
  ],
  anthropic: [
    { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
    { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  ],
}

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o-mini',
  anthropic: 'claude-haiku-4-5-20251001',
}

export const DEFAULT_AUDIT_MODELS: Record<AIProvider, string> = {
  gemini: 'gemini-2.5-pro',
  openai: 'gpt-4.1',
  anthropic: 'claude-sonnet-4-6',
}

export const API_KEY_PLACEHOLDERS: Record<AIProvider, string> = {
  gemini: 'AIza...',
  openai: 'sk-...',
  anthropic: 'sk-ant-...',
}

export const API_KEY_URLS: Record<AIProvider, string> = {
  gemini: 'https://aistudio.google.com/apikey',
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
}

export const API_USAGE_URLS: Record<AIProvider, string> = {
  gemini: 'https://aistudio.google.com/usage',
  openai: 'https://platform.openai.com/usage',
  anthropic: 'https://console.anthropic.com/settings/usage',
}
