/**
 * Credential zeroing helpers — unit tests (P4.5.12)
 */

import { describe, test, expect } from 'vitest'

import { withCredential, zeroizeBuffer } from '../zeroize.js'

describe('zeroizeBuffer', () => {
  test('fills buffer with zeros', () => {
    const buf = Buffer.from('secret')
    zeroizeBuffer(buf)
    expect(buf.every((b) => b === 0)).toBe(true)
  })
})

describe('withCredential', () => {
  test('zeroes buffer after fn resolves', async () => {
    const cred = Buffer.from('secret-key')
    const result = await withCredential(cred, async (buf) => {
      expect(buf.toString('utf8')).toBe('secret-key')
      return 42
    })
    expect(result).toBe(42)
    expect(cred.every((b) => b === 0)).toBe(true)
  })

  test('zeroes buffer after fn throws', async () => {
    const cred = Buffer.from('secret-key')
    await expect(
      withCredential(cred, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(cred.every((b) => b === 0)).toBe(true)
  })
})
