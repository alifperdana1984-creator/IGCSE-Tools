import { describe, it, expect, vi, beforeEach } from 'vitest'

describe('copyToClipboard', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()  // clear module cache — isSecureContext mock won't leak
  })

  it('returns true when clipboard API is available and succeeds', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: true, writable: true, configurable: true })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    })

    const { copyToClipboard } = await import('../clipboard')
    const result = await copyToClipboard('hello')
    expect(writeText).toHaveBeenCalledWith('hello')
    expect(result).toBe(true)
  })

  it('falls back when isSecureContext is false', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, writable: true, configurable: true })
    document.execCommand = vi.fn().mockReturnValue(true)

    const { copyToClipboard } = await import('../clipboard')
    const result = await copyToClipboard('fallback text')
    expect(result).toBe(true)
  })
})
