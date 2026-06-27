import { describe, expect, it } from 'vitest'
import { isGgufMagicBuffer, GGUF_MAGIC } from '../ggufFileUtils'
import { assertHttpsHuggingFaceDownloadUrl } from '../huggingFaceModelDownloadAllowlist'

describe('ggufFileUtils', () => {
  it('accepts GGUF magic header', () => {
    expect(isGgufMagicBuffer(GGUF_MAGIC)).toBe(true)
    expect(isGgufMagicBuffer(Buffer.from('NOTG'))).toBe(false)
  })
})

describe('huggingFaceModelDownloadAllowlist', () => {
  it('allows HTTPS huggingface.co .gguf URLs', () => {
    const u = assertHttpsHuggingFaceDownloadUrl(
      'https://huggingface.co/org/repo/resolve/main/model-q4.gguf',
    )
    expect(u.hostname).toBe('huggingface.co')
  })

  it('rejects HTTP and non-allowlisted hosts', () => {
    expect(() =>
      assertHttpsHuggingFaceDownloadUrl('http://huggingface.co/x/model.gguf'),
    ).toThrow(/HTTPS/)
    expect(() => assertHttpsHuggingFaceDownloadUrl('https://evil.example/model.gguf')).toThrow(
      /allowlisted/,
    )
    expect(() => assertHttpsHuggingFaceDownloadUrl('https://huggingface.co/x/model.bin')).toThrow(
      /\.gguf/,
    )
  })
})
