/**
 * UTF-16 / WSL output decoding
 */

import { describe, expect, test } from 'vitest'

import {
  decodeProcessBuffer,
  decodeProcessOutput,
  looksLikeUtf16Le,
  sanitizeForUserDisplay,
} from '../processOutputDecode.js'

describe('decodeProcessBuffer', () => {
  test('decodes UTF-16LE wsl-style output without mojibake', () => {
    const buf = Buffer.from('Default Version: 2\r\n', 'utf16le')
    expect(looksLikeUtf16Le(buf)).toBe(true)
    expect(decodeProcessBuffer(buf, true)).toBe('Default Version: 2')
  })

  test('decodes UTF-8 normally', () => {
    const buf = Buffer.from('hello world', 'utf8')
    expect(decodeProcessBuffer(buf)).toBe('hello world')
  })

  test('decodeProcessOutput joins chunks', () => {
    const a = Buffer.from('line1\n', 'utf16le')
    const b = Buffer.from('line2', 'utf16le')
    expect(decodeProcessOutput([a, b], true)).toBe('line1\nline2')
  })
})

describe('sanitizeForUserDisplay', () => {
  test('drops mojibake-like strings', () => {
    expect(sanitizeForUserDisplay('DΦeΦrΦ')).toBeUndefined()
  })

  test('keeps plain english', () => {
    expect(sanitizeForUserDisplay('Restart required')).toBe('Restart required')
  })
})
