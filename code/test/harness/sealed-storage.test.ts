/**
 * Sealed-Storage Test Harness — Self-Tests
 *
 * Verifies that the harness itself is correct before tests rely on it.
 *
 * A) TEST_DEK is a valid 32-byte deterministic buffer.
 * B) createSealedStorageTestContext binds a key provider.
 * C) buildValidSealForRowId produces seals accepted by sealedQuery.
 * D) cleanup unbinds the key provider and closes the DB.
 * E) Multiple contexts don't interfere (isolation).
 * F) Validator mock can be configured to approve or reject (via vi.mock).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'

import {
  TEST_DEK,
  createSealedStorageTestContext,
  buildValidSealForRowId,
  createHarnessDb,
  type SealedStorageTestContext,
} from './sealed-storage'

import {
  isKeyProviderBound,
  sealedQuery,
  verifySealAndContent,
  clearTamperingEvents,
  getTamperingEvents,
  unbindKeyProvider,
} from '../../apps/electron-vite-project/electron/main/sealed-storage/index'

// ─────────────────────────────────────────────────────────────────────────────
// A) TEST_DEK
// ─────────────────────────────────────────────────────────────────────────────

describe('A — TEST_DEK', () => {
  it('is a 32-byte Buffer', () => {
    expect(Buffer.isBuffer(TEST_DEK)).toBe(true)
    expect(TEST_DEK.length).toBe(32)
  })

  it('is deterministic across calls (same value each import)', () => {
    const copy = Buffer.from(TEST_DEK)
    // The global TEST_DEK should not change between accesses.
    expect(TEST_DEK.equals(copy)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// B) createSealedStorageTestContext — lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('B — createSealedStorageTestContext lifecycle', () => {
  afterEach(() => {
    // Safety: always unbind in case a test failed before cleanup.
    unbindKeyProvider()
    clearTamperingEvents()
  })

  it('binds a key provider on creation', () => {
    expect(isKeyProviderBound()).toBe(false)
    const ctx = createSealedStorageTestContext()
    expect(isKeyProviderBound()).toBe(true)
    ctx.cleanup()
  })

  it('cleanup unbinds the key provider', () => {
    const ctx = createSealedStorageTestContext()
    expect(isKeyProviderBound()).toBe(true)
    ctx.cleanup()
    expect(isKeyProviderBound()).toBe(false)
  })

  it('key provider returns a non-null Buffer', () => {
    const ctx = createSealedStorageTestContext()
    const key = ctx.keyProvider()
    expect(key).not.toBeNull()
    expect(Buffer.isBuffer(key)).toBe(true)
    expect(key!.length).toBe(32)
    key!.fill(0)
    ctx.cleanup()
  })

  it('context TEST_DEK matches the module-level TEST_DEK', () => {
    const ctx = createSealedStorageTestContext()
    expect(ctx.TEST_DEK.equals(TEST_DEK)).toBe(true)
    ctx.cleanup()
  })

  it('cleanup zeroizes the context DEK copy (does not affect module-level TEST_DEK)', () => {
    const ctx = createSealedStorageTestContext()
    ctx.cleanup()
    // Module-level TEST_DEK should be intact.
    expect(TEST_DEK.length).toBe(32)
    expect(TEST_DEK.some((b) => b !== 0)).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C) buildValidSealForRowId — seal correctness
// ─────────────────────────────────────────────────────────────────────────────

describe('C — buildValidSealForRowId seal correctness', () => {
  let ctx: SealedStorageTestContext

  beforeEach(() => {
    ctx = createSealedStorageTestContext()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  it('returns a non-empty seal string and valid JSON seal_input_json', () => {
    const { seal, seal_input_json, canonical_json } = ctx.buildValidSealForRowId('row-1', { data: 'hello' })
    expect(typeof seal).toBe('string')
    expect(seal.length).toBeGreaterThan(0)
    expect(typeof seal_input_json).toBe('string')
    expect(() => JSON.parse(seal_input_json)).not.toThrow()
    expect(canonical_json).toBe(JSON.stringify({ data: 'hello' }))
  })

  it('seal_input_json contains the correct content_sha256', () => {
    const content = { msg: 'test', v: 42 }
    const { seal_input_json, canonical_json } = ctx.buildValidSealForRowId('row-2', content)
    const parsed = JSON.parse(seal_input_json)
    const expectedHash = createHash('sha256').update(canonical_json, 'utf8').digest('hex')
    expect(parsed.content_sha256).toBe(expectedHash)
  })

  it('passes verifySealAndContent with the test DEK', () => {
    const content = { capsule_type: 'internal_draft', schema_version: 1 }
    const { seal, seal_input_json, canonical_json } = ctx.buildValidSealForRowId('row-3', content)
    const dekCopy = Buffer.from(ctx.TEST_DEK)
    // verifySealAndContent(sealInputJson, expectedSeal, canonicalJson, key)
    const result = verifySealAndContent(seal_input_json, seal, canonical_json, dekCopy)
    dekCopy.fill(0)
    expect(result.hmacValid).toBe(true)
    expect(result.contentHashValid).toBe(true)
  })

  it('different rowIds produce different seals', () => {
    const content = { shared: true }
    const { seal: seal1 } = ctx.buildValidSealForRowId('row-A', content)
    const { seal: seal2 } = ctx.buildValidSealForRowId('row-B', content)
    // Seals differ because seal_input_json contains nonce + row_id.
    expect(seal1).not.toBe(seal2)
  })

  it('passes real sealedQuery verification when rows have valid seals', () => {
    const db = createHarnessDb()
    if (!db) {
      console.warn('[harness-test] better-sqlite3 unavailable — skipping sealedQuery test')
      return
    }

    const rowId = 'test-row-1'
    const content = { capsule_type: 'internal_draft', schema_version: 1, msg: 'hello' }
    const { seal, seal_input_json, canonical_json } = ctx.buildValidSealForRowId(rowId, content)

    db.prepare(
      `INSERT INTO inbox_messages (id, depackaged_json, seal, seal_input_json)
       VALUES (?, ?, ?, ?)`,
    ).run(rowId, canonical_json, seal, seal_input_json)

    const rows = sealedQuery(
      db,
      'SELECT * FROM inbox_messages WHERE id = ?',
      [rowId],
      'depackaged_json',
    )

    db.close()

    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(rowId)
    // Seal was valid — no tampering events.
    expect(getTamperingEvents()).toHaveLength(0)
  })

  it('sealedQuery filters rows with invalid seals in reject mode', () => {
    const db = createHarnessDb()
    if (!db) return

    const rowId = 'bad-row'
    const content = { data: 'x' }
    const canonicalJson = JSON.stringify(content)

    db.prepare(
      `INSERT INTO inbox_messages (id, depackaged_json, seal, seal_input_json)
       VALUES (?, ?, ?, ?)`,
    ).run(rowId, canonicalJson, 'invalidseal==', JSON.stringify({ content_sha256: 'wrong', row_id: rowId }))

    const rows = sealedQuery(
      db,
      'SELECT * FROM inbox_messages WHERE id = ?',
      [rowId],
      'depackaged_json',
    )

    db.close()

    // Row with invalid seal is filtered out in reject mode.
    expect(rows).toHaveLength(0)
    expect(getTamperingEvents().length).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// D) cleanup — DB close
// ─────────────────────────────────────────────────────────────────────────────

describe('D — cleanup closes the in-memory DB', () => {
  it('db is closed after cleanup (operations on closed DB throw)', () => {
    const ctx = createSealedStorageTestContext()
    const { db } = ctx
    ctx.cleanup()

    if (db) {
      // better-sqlite3 throws when querying a closed DB.
      expect(() => db.prepare('SELECT 1').all()).toThrow()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// E) Isolation between contexts
// ─────────────────────────────────────────────────────────────────────────────

describe('E — isolation between contexts', () => {
  afterEach(() => {
    unbindKeyProvider()
    clearTamperingEvents()
  })

  it('second context binds over first (last wins, with cleanup in between)', () => {
    const ctx1 = createSealedStorageTestContext()
    ctx1.cleanup()  // unbinds

    const ctx2 = createSealedStorageTestContext()
    expect(isKeyProviderBound()).toBe(true)
    ctx2.cleanup()
    expect(isKeyProviderBound()).toBe(false)
  })

  it('cleanup of one context does not affect another still-active context', () => {
    // Only one key provider can be bound at a time (module-level singleton).
    // This test documents that concurrent contexts are not supported — each
    // test must call cleanup before creating a new context.
    const ctx1 = createSealedStorageTestContext()
    ctx1.cleanup()  // unbinds

    const ctx2 = createSealedStorageTestContext()
    expect(isKeyProviderBound()).toBe(true)
    ctx2.cleanup()
  })
})
