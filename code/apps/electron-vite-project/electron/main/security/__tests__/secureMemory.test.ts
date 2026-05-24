/**
 * Secure credential memory — P4.5.15 tests.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

import {
  _resetSecureMemoryForTest,
  duplicateCredentialForScope,
  getSecureMemoryStatus,
  initSecureMemory,
  memzeroBufferIfAvailable,
  probeSecureAllocation,
  releaseScopedCredential,
} from '../secureMemory.js'
import { withCredential, zeroizeBuffer } from '../zeroize.js'

describe('initSecureMemory', () => {
  beforeEach(() => {
    _resetSecureMemoryForTest()
  })

  test('surveys libsodium and reports plain_buffer when malloc/mlock are absent', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const status = await initSecureMemory()

    expect(status.mode).toBe('plain_buffer')
    expect(status.memzeroAvailable).toBe(true)
    expect(status.sodiumMallocAvailable).toBe(false)
    expect(status.sodiumMlockAvailable).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('memory locking not available on this platform'),
    )

    warn.mockRestore()
  })

  test('duplicateCredentialForScope reuses input buffer when locking unavailable', async () => {
    await initSecureMemory()
    const cred = Buffer.from('secret-key')
    const scoped = duplicateCredentialForScope(cred)

    expect(scoped.buffer).toBe(cred)
    expect(scoped.secure).toBe(false)
    expect(scoped.ownsBuffer).toBe(false)
  })
})

describe('memzeroBufferIfAvailable', () => {
  beforeEach(() => {
    _resetSecureMemoryForTest()
  })

  test('zeroes via libsodium memzero after init', async () => {
    await initSecureMemory()
    const buf = Buffer.from('secret')
    expect(memzeroBufferIfAvailable(buf)).toBe(true)
    expect(buf.every((b) => b === 0)).toBe(true)
  })
})

describe('probeSecureAllocation', () => {
  beforeEach(() => {
    _resetSecureMemoryForTest()
  })

  test('does not throw when malloc/mlock APIs are unavailable', async () => {
    const result = await probeSecureAllocation()
    expect(result.attempted).toBe(false)
    expect(result.succeeded).toBe(false)
  })
})

describe('withCredential + secure memory survey', () => {
  beforeEach(() => {
    _resetSecureMemoryForTest()
  })

  test('initializes secure memory survey and zeroes buffer on exit', async () => {
    const cred = Buffer.from('secret-key')
    await withCredential(cred, async (buf) => {
      expect(buf.toString('utf8')).toBe('secret-key')
      expect(getSecureMemoryStatus()?.mode).toBe('plain_buffer')
      return 7
    })
    expect(cred.every((b) => b === 0)).toBe(true)
  })

  test('releaseScopedCredential zeroes owned and borrowed buffers', async () => {
    await initSecureMemory()
    const cred = Buffer.from('abc')
    const scoped = duplicateCredentialForScope(cred)
    releaseScopedCredential(scoped)
    expect(cred.every((b) => b === 0)).toBe(true)
  })
})

describe('zeroizeBuffer', () => {
  beforeEach(() => {
    _resetSecureMemoryForTest()
  })

  test('falls back to fill(0) before secure memory init', () => {
    const buf = Buffer.from('secret')
    zeroizeBuffer(buf)
    expect(buf.every((b) => b === 0)).toBe(true)
  })
})
