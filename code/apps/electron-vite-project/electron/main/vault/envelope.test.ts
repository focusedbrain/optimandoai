/**
 * Unit tests for per-record envelope encryption.
 *
 * Acceptance criteria:
 *   1. sealRecord + openRecord round-trips correctly.
 *   2. Wrong KEK → openRecord throws.
 *   3. Tampered ciphertext → openRecord throws.
 *   4. Tampered wrappedDEK → openRecord throws.
 *   5. Record DEK is zeroized after seal/open.
 *   6. DecryptCache honours TTL and flush.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'crypto'
import {
  generateRecordDEK,
  wrapRecordDEK,
  unwrapRecordDEK,
  encryptRecord,
  decryptRecord,
  sealRecord,
  openRecord,
  ENVELOPE_SCHEMA_VERSION,
  LEGACY_SCHEMA_VERSION,
} from './envelope'
import { DecryptCache } from './cache'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeKEK(): Buffer { return randomBytes(32) }

const SAMPLE_FIELDS = JSON.stringify([
  { key: 'service_name', value: 'OpenAI', encrypted: false, type: 'text' },
  { key: 'secret',       value: 'sk-abc123',  encrypted: true,  type: 'password' },
])

// ---------------------------------------------------------------------------
// 1. Record DEK wrap / unwrap
// ---------------------------------------------------------------------------
describe('Record DEK wrap / unwrap', () => {
  it('round-trips a 32-byte DEK', () => {
    const kek = makeKEK()
    const dek = generateRecordDEK()
    const wrapped = wrapRecordDEK(dek, kek)
    expect(wrapped.length).toBe(60)
    const recovered = unwrapRecordDEK(wrapped, kek)
    expect(recovered).toEqual(dek)
  })

  it('throws on wrong KEK', () => {
    const kek1 = makeKEK()
    const kek2 = makeKEK()
    const dek = generateRecordDEK()
    const wrapped = wrapRecordDEK(dek, kek1)
    expect(() => unwrapRecordDEK(wrapped, kek2)).toThrow()
  })

  it('throws on invalid length', () => {
    const kek = makeKEK()
    expect(() => unwrapRecordDEK(Buffer.alloc(30), kek)).toThrow(/length/)
  })
})

// ---------------------------------------------------------------------------
// 2. Record encrypt / decrypt
// ---------------------------------------------------------------------------
describe('Record encrypt / decrypt', () => {
  it('round-trips a JSON string', async () => {
    const dek = generateRecordDEK()
    const ct = await encryptRecord(SAMPLE_FIELDS, dek)
    expect(ct.length).toBeGreaterThan(24) // nonce + ciphertext
    const pt = await decryptRecord(ct, dek)
    expect(pt).toBe(SAMPLE_FIELDS)
  })

  it('throws on wrong DEK', async () => {
    const dek1 = generateRecordDEK()
    const dek2 = generateRecordDEK()
    const ct = await encryptRecord(SAMPLE_FIELDS, dek1)
    await expect(decryptRecord(ct, dek2)).rejects.toThrow()
  })

  it('throws on tampered ciphertext', async () => {
    const dek = generateRecordDEK()
    const ct = await encryptRecord(SAMPLE_FIELDS, dek)
    // Flip a byte in the ciphertext (after the 24-byte nonce)
    ct[30] ^= 0xff
    await expect(decryptRecord(ct, dek)).rejects.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 3. sealRecord + openRecord (high-level)
// ---------------------------------------------------------------------------
describe('sealRecord / openRecord', () => {
  it('round-trips fields through seal → open', async () => {
    const kek = makeKEK()
    const { wrappedDEK, ciphertext } = await sealRecord(SAMPLE_FIELDS, kek)

    expect(wrappedDEK.length).toBe(60)
    expect(ciphertext.length).toBeGreaterThan(24)

    const fields = await openRecord(wrappedDEK, ciphertext, kek)
    expect(fields).toEqual(JSON.parse(SAMPLE_FIELDS))
  })

  it('fails with wrong KEK', async () => {
    const kek1 = makeKEK()
    const kek2 = makeKEK()
    const { wrappedDEK, ciphertext } = await sealRecord(SAMPLE_FIELDS, kek1)
    await expect(openRecord(wrappedDEK, ciphertext, kek2)).rejects.toThrow()
  })

  it('each seal produces a different wrappedDEK (fresh DEK each time)', async () => {
    const kek = makeKEK()
    const r1 = await sealRecord(SAMPLE_FIELDS, kek)
    const r2 = await sealRecord(SAMPLE_FIELDS, kek)
    expect(r1.wrappedDEK).not.toEqual(r2.wrappedDEK) // different random DEKs
  })
})

// ---------------------------------------------------------------------------
// 4. Schema version constants
// ---------------------------------------------------------------------------
describe('Schema version constants', () => {
  it('ENVELOPE_SCHEMA_VERSION is 2', () => {
    expect(ENVELOPE_SCHEMA_VERSION).toBe(2)
  })
  it('LEGACY_SCHEMA_VERSION is 1', () => {
    expect(LEGACY_SCHEMA_VERSION).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// 5. DecryptCache
// ---------------------------------------------------------------------------
describe('DecryptCache', () => {
  let cache: DecryptCache

  beforeEach(() => {
    cache = new DecryptCache({ ttlMs: 100, maxEntries: 3 })
  })

  afterEach(() => {
    cache.flush()
  })

  it('stores and retrieves a value', () => {
    cache.set('a', '{"test":1}')
    expect(cache.get('a')).toBe('{"test":1}')
  })

  it('returns undefined for missing keys', () => {
    expect(cache.get('nonexistent')).toBeUndefined()
  })

  it('evicts on explicit call', () => {
    cache.set('a', 'data')
    cache.evict('a')
    expect(cache.get('a')).toBeUndefined()
  })

  it('flush clears everything', () => {
    cache.set('a', '1')
    cache.set('b', '2')
    cache.flush()
    expect(cache.size).toBe(0)
    expect(cache.get('a')).toBeUndefined()
  })

  it('respects maxEntries (evicts oldest)', () => {
    cache.set('a', '1')
    cache.set('b', '2')
    cache.set('c', '3')
    cache.set('d', '4') // should evict 'a'
    expect(cache.get('a')).toBeUndefined()
    expect(cache.get('d')).toBe('4')
    expect(cache.size).toBe(3)
  })

  it('expires entries after TTL', async () => {
    cache.set('a', '1')
    expect(cache.get('a')).toBe('1')
    // Wait for TTL to expire
    await new Promise(r => setTimeout(r, 150))
    expect(cache.get('a')).toBeUndefined()
  })
})
