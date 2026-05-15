/**
 * Phase B PR B-2 — Structural Property Tests
 *
 * Architecture reference: Phase B Section 3, Amendment to PR B-2.
 *
 * Tests in this file verify:
 *
 * A) Gate-API unit tests (no better-sqlite3 needed for most):
 *    run() rejects when seal / seal_input_json / canonical_json / row_id missing
 *    run() rejects on row_id mismatch, content_sha256 mismatch, HMAC mismatch
 *    sealedQuery() rejects when no key provider bound
 *    sealedQuery() filters tampered rows
 *
 * B) Key-provider unit tests:
 *    bindKeyProvider / unbindKeyProvider
 *    provider called on each verification (not cached)
 *    key buffer zeroized after use
 *    provider returning null → clean error
 *
 * C) Architecture structural property tests (require better-sqlite3):
 *    Test 1 — Direct-write attack: raw INSERT bypasses gate; read path filters it
 *    Test 2 — Forged-seal attack: HMAC under wrong key rejected at write time
 *    Test 3 — Replay attack: seal for row A rejected when written to row B
 *    Test 4 — Tamper attack: post-write content modification detected at read time
 *    Test 5 — SKIPPED (quarantine isolation; pending PR B-10)
 *    Test 6 — Logout invalidation: unbinding key provider makes gate refuse operations
 *    Test 7 — Subprocess crash recovery: liveness gate refuses validate(); storage gate
 *              still refuses reads (key provider is unbound after crash cleanup)
 *
 * Tests that require better-sqlite3 are guarded with test.skipIf(!BetterSqlite3).
 * The native module is compiled against Electron's Node ABI; under the system Node
 * used by Vitest the module may be unavailable.  The structural property tests
 * DO pass in environments where the ABIs match (e.g. CI with the correct Node build).
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createRequire } from 'module'

// ── better-sqlite3 availability guard ────────────────────────────────────────

const _req = createRequire(import.meta.url)
let BetterSqlite3: typeof import('better-sqlite3').default | null = null
try {
  const D = _req('better-sqlite3') as typeof import('better-sqlite3').default
  const probe = new D(':memory:')
  probe.close()
  BetterSqlite3 = D
} catch {
  BetterSqlite3 = null
}
type Database = import('better-sqlite3').Database
type Statement = import('better-sqlite3').Statement

// ── Gate imports ─────────────────────────────────────────────────────────────

import {
  SEALED_STORAGE_MODE,
  SealVerificationError,
  SealedStatement,
  prepareSealedInsert,
  prepareSealedUpdate,
  sealedQuery,
  verifySealAndContent,
  bindKeyProvider,
  unbindKeyProvider,
  isKeyProviderBound,
  clearTamperingEvents,
  getTamperingEvents,
  type SealBindParams,
  type SealKeyProvider,
} from '../index'

// ── Subprocess imports (for Tests 6–7) ───────────────────────────────────────

import {
  computeSealForTest,
  verifySeal,
} from '../../validator-process/index'
import {
  startTestValidator,
  deriveTestSealKey,
  makeTestValidateRequest,
} from '../../validator-process/test-session'
import type { ValidatorOrchestrator } from '../../validator-process/orchestrator'

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const TEST_KEY = Buffer.from('structural-test-key-32-bytes!!!!')
const TEST_KEY_2 = Buffer.from('wrong-structural-key-32-bytes!!!')

function makeTestSealParams(
  canonicalJson: string,
  rowId: string,
  key = TEST_KEY,
): SealBindParams {
  const { seal, sealInputJson } = computeSealForTest(
    canonicalJson,
    rowId,
    'validated',
    '1.0.0',
    new Date().toISOString(),
    key,
  )
  return { seal, seal_input_json: sealInputJson, canonical_json: canonicalJson, row_id: rowId }
}

/**
 * Create a mock Statement that records calls and returns a predictable result.
 * Used for testing SealedStatement.run() without a real database.
 */
function mockStatement(
  handler?: (args: unknown[]) => { changes: number; lastInsertRowid: number },
): Statement {
  const h = handler ?? (() => ({ changes: 1, lastInsertRowid: 1 }))
  return {
    run: (...args: unknown[]) => h(args),
  } as unknown as Statement
}

/**
 * Create a mock Database whose prepare() returns a Statement that yields the
 * given rows.  Used for testing sealedQuery() without a real database.
 */
function mockDb(rows: Record<string, unknown>[] = []): Database {
  return {
    prepare: (_sql: string) => ({
      all: (..._args: unknown[]) => rows,
    }),
  } as unknown as Database
}

function makeInMemoryDb(): Database {
  if (!BetterSqlite3) throw new Error('better-sqlite3 unavailable in this Node environment')
  const db = new BetterSqlite3(':memory:')
  db.exec(`
    CREATE TABLE inbox_messages (
      id TEXT PRIMARY KEY,
      depackaged_json TEXT,
      seal TEXT,
      seal_input_json TEXT
    );
    CREATE TABLE inbox_attachments (
      id TEXT PRIMARY KEY,
      message_id TEXT,
      seal TEXT,
      seal_input_json TEXT
    );
  `)
  return db
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  // Ensure every test starts with a clean key provider state.
  unbindKeyProvider()
  clearTamperingEvents()
})

afterEach(() => {
  unbindKeyProvider()
  clearTamperingEvents()
})

// ─────────────────────────────────────────────────────────────────────────────
// A) Gate-API unit tests — run()
// ─────────────────────────────────────────────────────────────────────────────

describe('A — Gate API: run() write-path verification', () => {
  const CANON = '{"capsule_type":"internal_draft","schema_version":1}'

  beforeEach(() => {
    bindKeyProvider(() => Buffer.from(TEST_KEY))
  })

  test('run() rejects when seal is missing', () => {
    const stmt = new SealedStatement(mockStatement(), 'INSERT INTO t', 'INSERT')
    const params = makeTestSealParams(CANON, 'row-1')
    expect(() =>
      stmt.run([], { ...params, seal: '' }),
    ).toThrow(SealVerificationError)
  })

  test('run() rejects when seal_input_json is missing', () => {
    const stmt = new SealedStatement(mockStatement(), 'INSERT INTO t', 'INSERT')
    const params = makeTestSealParams(CANON, 'row-1')
    expect(() =>
      stmt.run([], { ...params, seal_input_json: '' }),
    ).toThrow(SealVerificationError)
  })

  test('run() rejects when canonical_json is missing', () => {
    const stmt = new SealedStatement(mockStatement(), 'INSERT INTO t', 'INSERT')
    const params = makeTestSealParams(CANON, 'row-1')
    // @ts-expect-error — intentional: testing missing required field
    expect(() => stmt.run([], { ...params, canonical_json: undefined })).toThrow(SealVerificationError)
  })

  test('run() rejects when row_id is missing', () => {
    const stmt = new SealedStatement(mockStatement(), 'INSERT INTO t', 'INSERT')
    const params = makeTestSealParams(CANON, 'row-1')
    expect(() =>
      stmt.run([], { ...params, row_id: '' }),
    ).toThrow(SealVerificationError)
  })

  test("run() rejects when seal_input_json's row_id doesn't match the supplied row_id", () => {
    const stmt = new SealedStatement(mockStatement(), 'INSERT INTO t', 'INSERT')
    // Seal was produced for row-A but we're writing to row-B.
    const params = makeTestSealParams(CANON, 'row-A')
    expect(() =>
      stmt.run([], { ...params, row_id: 'row-B' }),
    ).toThrow(SealVerificationError)
  })

  test("run() rejects when seal_input_json's content_sha256 doesn't match sha256(canonical_json)", () => {
    const stmt = new SealedStatement(mockStatement(), 'INSERT INTO t', 'INSERT')
    // Seal was produced for CANON but we supply different canonical_json.
    const params = makeTestSealParams(CANON, 'row-1')
    const differentContent = '{"capsule_type":"internal_draft","schema_version":99}'
    expect(() =>
      stmt.run([], { ...params, canonical_json: differentContent }),
    ).toThrow(SealVerificationError)
  })

  test("run() rejects when HMAC of seal_input_json doesn't match seal", () => {
    const stmt = new SealedStatement(mockStatement(), 'INSERT INTO t', 'INSERT')
    // Produce a seal under TEST_KEY_2 but the gate's provider returns TEST_KEY.
    const params = makeTestSealParams(CANON, 'row-1', TEST_KEY_2)
    expect(() => stmt.run([], params)).toThrow(SealVerificationError)
  })

  test('run() succeeds with all four checks passing', () => {
    const stmt = new SealedStatement(mockStatement(), 'INSERT INTO t', 'INSERT')
    const params = makeTestSealParams(CANON, 'row-ok')
    expect(() => stmt.run([], params)).not.toThrow()
  })

  test('run() rejects when no key provider is bound', () => {
    unbindKeyProvider()
    const stmt = new SealedStatement(mockStatement(), 'INSERT INTO t', 'INSERT')
    const params = makeTestSealParams(CANON, 'row-1', TEST_KEY)
    // Even if the seal was valid, without a provider there's no way to verify.
    expect(() => stmt.run([], params)).toThrow(SealVerificationError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// A) Gate-API unit tests — sealedQuery()
// ─────────────────────────────────────────────────────────────────────────────

describe('A — Gate API: sealedQuery() read-path verification', () => {
  const CANON = '{"capsule_type":"internal_draft","schema_version":1}'

  test('sealedQuery() throws when no key provider is bound', () => {
    const db = mockDb([{ id: 'r1', depackaged_json: CANON, seal: 'x', seal_input_json: '{}' }])
    expect(() =>
      sealedQuery(db, 'SELECT * FROM inbox_messages', [], 'depackaged_json'),
    ).toThrow(SealVerificationError)
  })

  test('sealedQuery() filters rows with missing seal (returns empty, records TamperingEvent)', () => {
    bindKeyProvider(() => Buffer.from(TEST_KEY))
    const db = mockDb([
      { id: 'r1', depackaged_json: CANON, seal: null, seal_input_json: null },
    ])
    const rows = sealedQuery(db, 'SELECT * FROM inbox_messages', [], 'depackaged_json')
    expect(rows.length).toBe(0)
    const events = getTamperingEvents()
    expect(events.length).toBeGreaterThan(0)
    expect(events[0]!.reason).toBe('missing_seal')
  })

  test('sealedQuery() filters rows whose HMAC does not verify', () => {
    bindKeyProvider(() => Buffer.from(TEST_KEY))
    // Produce a seal under TEST_KEY_2; the provider will use TEST_KEY → mismatch.
    const { seal, sealInputJson } = computeSealForTest(
      CANON, 'r1', 'validated', '1.0.0', new Date().toISOString(), TEST_KEY_2,
    )
    const db = mockDb([{ id: 'r1', depackaged_json: CANON, seal, seal_input_json: sealInputJson }])
    const rows = sealedQuery(db, 'SELECT * FROM inbox_messages', [], 'depackaged_json')
    expect(rows.length).toBe(0)
    const events = getTamperingEvents()
    expect(events.some((e) => e.reason === 'hmac_mismatch')).toBe(true)
  })

  test("sealedQuery() filters rows whose content_sha256 doesn't match actual content", () => {
    bindKeyProvider(() => Buffer.from(TEST_KEY))
    // Produce a seal for CANON, then store different content in the DB row.
    const { seal, sealInputJson } = computeSealForTest(
      CANON, 'r1', 'validated', '1.0.0', new Date().toISOString(), TEST_KEY,
    )
    const tamperedContent = CANON + ',"TAMPERED":true}'
    const db = mockDb([
      { id: 'r1', depackaged_json: tamperedContent, seal, seal_input_json: sealInputJson },
    ])
    const rows = sealedQuery(db, 'SELECT * FROM inbox_messages', [], 'depackaged_json')
    expect(rows.length).toBe(0)
    const events = getTamperingEvents()
    expect(events.some((e) => e.reason === 'content_hash_mismatch')).toBe(true)
  })

  test('sealedQuery() returns a valid sealed row', () => {
    bindKeyProvider(() => Buffer.from(TEST_KEY))
    const { seal, sealInputJson } = computeSealForTest(
      CANON, 'r1', 'validated', '1.0.0', new Date().toISOString(), TEST_KEY,
    )
    const db = mockDb([{ id: 'r1', depackaged_json: CANON, seal, seal_input_json: sealInputJson }])
    const rows = sealedQuery(db, 'SELECT * FROM inbox_messages', [], 'depackaged_json')
    expect(rows.length).toBe(1)
    expect(getTamperingEvents().length).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// B) Key-provider unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('B — Key provider binding', () => {
  test('bindKeyProvider registers the function (isKeyProviderBound reflects state)', () => {
    expect(isKeyProviderBound()).toBe(false)
    bindKeyProvider(() => Buffer.from(TEST_KEY))
    expect(isKeyProviderBound()).toBe(true)
  })

  test('unbindKeyProvider clears it; subsequent operations fail', () => {
    bindKeyProvider(() => Buffer.from(TEST_KEY))
    unbindKeyProvider()
    expect(isKeyProviderBound()).toBe(false)

    const CANON = '{"x":1}'
    const params = makeTestSealParams(CANON, 'row-1', TEST_KEY)
    const stmt = new SealedStatement(mockStatement(), 'INSERT INTO t', 'INSERT')
    expect(() => stmt.run([], params)).toThrow(SealVerificationError)
  })

  test('provider is called on each verification (not cached between calls)', () => {
    let callCount = 0
    bindKeyProvider(() => {
      callCount++
      return Buffer.from(TEST_KEY)
    })

    const CANON = '{"x":1}'
    const params1 = makeTestSealParams(CANON, 'row-a')
    const params2 = makeTestSealParams(CANON, 'row-b')
    const stmt1 = new SealedStatement(mockStatement(), 'INSERT', 'INSERT')
    const stmt2 = new SealedStatement(mockStatement(), 'INSERT', 'INSERT')

    stmt1.run([], params1)
    stmt2.run([], params2)

    // Each run() calls the provider once for the HMAC check.
    expect(callCount).toBeGreaterThanOrEqual(2)
  })

  test('key buffers returned by provider are zeroized after use', () => {
    const returnedBuffers: Buffer[] = []
    bindKeyProvider(() => {
      const buf = Buffer.from(TEST_KEY)
      returnedBuffers.push(buf)
      return buf
    })

    const CANON = '{"x":1}'
    const params = makeTestSealParams(CANON, 'row-z')
    const stmt = new SealedStatement(mockStatement(), 'INSERT', 'INSERT')
    stmt.run([], params)

    // The gate must have zeroized every buffer it received.
    expect(returnedBuffers.length).toBeGreaterThan(0)
    for (const buf of returnedBuffers) {
      // After zeroization every byte should be 0.
      expect(buf.every((b) => b === 0)).toBe(true)
    }
  })

  test('provider returning null causes verification to fail with a clear SealVerificationError', () => {
    bindKeyProvider(() => null)
    const CANON = '{"x":1}'
    const params = makeTestSealParams(CANON, 'row-null', TEST_KEY)
    const stmt = new SealedStatement(mockStatement(), 'INSERT', 'INSERT')
    expect(() => stmt.run([], params)).toThrow(SealVerificationError)
    expect(() => stmt.run([], params)).toThrow(/null|locked/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// C) Architecture structural property tests
// ─────────────────────────────────────────────────────────────────────────────

// ── C1: Direct-write attack ───────────────────────────────────────────────────

describe('Test 1 — Direct-write attack: raw INSERT bypassed; read path filters it', () => {
  test.skipIf(!BetterSqlite3)(
    'raw INSERT into inbox_messages without seal: read path returns 0 rows',
    () => {
      const db = makeInMemoryDb()
      bindKeyProvider(() => Buffer.from(TEST_KEY))

      // Bypass the gate entirely with raw db.prepare().
      db.prepare(
        'INSERT INTO inbox_messages (id, depackaged_json) VALUES (?, ?)',
      ).run('attack-1', '{"malicious":"payload"}')

      // The row exists in the DB but the read path must filter it out.
      const rows = sealedQuery(
        db,
        'SELECT * FROM inbox_messages WHERE id = ?',
        ['attack-1'],
        'depackaged_json',
      )
      expect(rows.length).toBe(0)

      // Tampering event recorded.
      const events = getTamperingEvents()
      expect(events.some((e) => e.reason === 'missing_seal')).toBe(true)

      db.close()
    },
  )

  test.skipIf(!BetterSqlite3)(
    'row written through gate with valid seal IS returned by read path',
    () => {
      const db = makeInMemoryDb()
      bindKeyProvider(() => Buffer.from(TEST_KEY))

      const CANON = '{"capsule_type":"internal_draft","schema_version":1}'
      const params = makeTestSealParams(CANON, 'legitimate-1')

      const stmt = prepareSealedInsert(
        db,
        'INSERT INTO inbox_messages (id, depackaged_json, seal, seal_input_json) VALUES (?, ?, ?, ?)',
      )
      stmt.run(
        ['legitimate-1', CANON, params.seal, params.seal_input_json],
        params,
      )

      const rows = sealedQuery(
        db,
        'SELECT * FROM inbox_messages WHERE id = ?',
        ['legitimate-1'],
        'depackaged_json',
      )
      expect(rows.length).toBe(1)
      expect(getTamperingEvents().length).toBe(0)

      db.close()
    },
  )
})

// ── C2: Forged-seal attack ────────────────────────────────────────────────────

describe('Test 2 — Forged-seal attack: HMAC under wrong key rejected at write time', () => {
  test.skipIf(!BetterSqlite3)(
    'write with seal produced under wrong key throws SealVerificationError',
    () => {
      const db = makeInMemoryDb()
      // Gate's provider uses TEST_KEY; attacker uses TEST_KEY_2.
      bindKeyProvider(() => Buffer.from(TEST_KEY))

      const CANON = '{"capsule_type":"internal_draft","schema_version":1}'
      // Produce seal under the WRONG key.
      const forgedParams = makeTestSealParams(CANON, 'forged-1', TEST_KEY_2)

      const stmt = prepareSealedInsert(
        db,
        'INSERT INTO inbox_messages (id, depackaged_json, seal, seal_input_json) VALUES (?, ?, ?, ?)',
      )
      expect(() =>
        stmt.run(
          ['forged-1', CANON, forgedParams.seal, forgedParams.seal_input_json],
          forgedParams,
        ),
      ).toThrow(SealVerificationError)

      // Nothing was written.
      const count = (
        db.prepare('SELECT COUNT(*) as n FROM inbox_messages').get() as { n: number }
      ).n
      expect(count).toBe(0)

      db.close()
    },
  )
})

// ── C3: Replay attack ─────────────────────────────────────────────────────────

describe('Test 3 — Replay attack: seal for row A rejected when written to row B', () => {
  test.skipIf(!BetterSqlite3)(
    'replayed seal (row_id mismatch) throws SealVerificationError',
    () => {
      const db = makeInMemoryDb()
      bindKeyProvider(() => Buffer.from(TEST_KEY))

      const CANON = '{"capsule_type":"internal_draft","schema_version":1}'
      // Seal was legitimately produced for 'row-A'.
      const paramsForRowA = makeTestSealParams(CANON, 'row-A')

      const stmt = prepareSealedInsert(
        db,
        'INSERT INTO inbox_messages (id, depackaged_json, seal, seal_input_json) VALUES (?, ?, ?, ?)',
      )
      // Attempt to use the row-A seal to write to 'row-B' (replay).
      expect(() =>
        stmt.run(
          ['row-B', CANON, paramsForRowA.seal, paramsForRowA.seal_input_json],
          { ...paramsForRowA, row_id: 'row-B' },
        ),
      ).toThrow(SealVerificationError)

      db.close()
    },
  )
})

// ── C4: Tamper attack ─────────────────────────────────────────────────────────

describe('Test 4 — Tamper attack: post-write content modification detected at read time', () => {
  test.skipIf(!BetterSqlite3)(
    'content modified after sealed write: row filtered at read time; TamperingEvent recorded',
    () => {
      const db = makeInMemoryDb()
      bindKeyProvider(() => Buffer.from(TEST_KEY))

      const CANON = '{"capsule_type":"internal_draft","schema_version":1}'
      const params = makeTestSealParams(CANON, 'tamper-target')

      // Legitimate write through the gate.
      const stmt = prepareSealedInsert(
        db,
        'INSERT INTO inbox_messages (id, depackaged_json, seal, seal_input_json) VALUES (?, ?, ?, ?)',
      )
      stmt.run(
        ['tamper-target', CANON, params.seal, params.seal_input_json],
        params,
      )

      // Verify the row reads back cleanly before tampering.
      const beforeTamper = sealedQuery(
        db,
        'SELECT * FROM inbox_messages WHERE id = ?',
        ['tamper-target'],
        'depackaged_json',
      )
      expect(beforeTamper.length).toBe(1)
      clearTamperingEvents()

      // Attacker modifies content directly (bypasses the gate; the seal is not updated).
      db.prepare('UPDATE inbox_messages SET depackaged_json = ? WHERE id = ?').run(
        '{"capsule_type":"internal_draft","schema_version":1,"INJECTED":"malware"}',
        'tamper-target',
      )

      // Read through the gate: must filter the tampered row.
      const afterTamper = sealedQuery(
        db,
        'SELECT * FROM inbox_messages WHERE id = ?',
        ['tamper-target'],
        'depackaged_json',
      )
      expect(afterTamper.length).toBe(0)

      // TamperingEvent must have been recorded.
      const events = getTamperingEvents()
      expect(events.length).toBeGreaterThan(0)
      expect(events[0]!.reason).toBe('content_hash_mismatch')

      db.close()
    },
  )
})

// ── C5: Quarantine isolation — SKIPPED pending PR B-10 ───────────────────────

describe('Test 5 — Quarantine isolation (pending PR B-10)', () => {
  test.skip('rejected messages are isolated in quarantine table (B-10)', () => {
    // Pending: quarantine table is introduced in PR B-10.
  })
})

// ── C6: Logout invalidation ───────────────────────────────────────────────────

describe('Test 6 — Logout invalidation: unbound key provider blocks all operations', () => {
  test('unbinding key provider causes sealedQuery to throw SealVerificationError', () => {
    bindKeyProvider(() => Buffer.from(TEST_KEY))
    expect(isKeyProviderBound()).toBe(true)

    unbindKeyProvider()
    expect(isKeyProviderBound()).toBe(false)

    const db = mockDb([{ id: 'r1', depackaged_json: '{}', seal: 'x', seal_input_json: '{}' }])
    expect(() =>
      sealedQuery(db, 'SELECT * FROM inbox_messages', [], 'depackaged_json'),
    ).toThrow(SealVerificationError)
  })

  test('unbinding key provider causes run() to throw SealVerificationError', () => {
    bindKeyProvider(() => Buffer.from(TEST_KEY))
    unbindKeyProvider()

    const CANON = '{"x":1}'
    const params = makeTestSealParams(CANON, 'row-logout', TEST_KEY)
    const stmt = new SealedStatement(mockStatement(), 'INSERT', 'INSERT')
    expect(() => stmt.run([], params)).toThrow(SealVerificationError)
  })

  test.skipIf(!BetterSqlite3)(
    're-binding provider after logout restores gate operations',
    () => {
      const db = makeInMemoryDb()

      // First session: write a row.
      bindKeyProvider(() => Buffer.from(TEST_KEY))
      const CANON = '{"capsule_type":"internal_draft","schema_version":1}'
      const params = makeTestSealParams(CANON, 'logout-relogin')
      prepareSealedInsert(
        db,
        'INSERT INTO inbox_messages (id, depackaged_json, seal, seal_input_json) VALUES (?, ?, ?, ?)',
      ).run(['logout-relogin', CANON, params.seal, params.seal_input_json], params)

      // Logout.
      unbindKeyProvider()

      // Login again with same key.
      bindKeyProvider(() => Buffer.from(TEST_KEY))

      // Read should succeed.
      const rows = sealedQuery(
        db,
        'SELECT * FROM inbox_messages WHERE id = ?',
        ['logout-relogin'],
        'depackaged_json',
      )
      expect(rows.length).toBe(1)

      db.close()
    },
  )
})

// ── C7: Subprocess crash recovery ─────────────────────────────────────────────

describe('Test 7 — Subprocess crash recovery', () => {
  test('after crash, validate() rejects; gate key provider is unbound by stop()', async () => {
    const handle = await startTestValidator()
    expect(handle.orchestrator.getLiveness()).toBe('running')
    expect(isKeyProviderBound()).toBe(true)

    // Simulate crash by killing the subprocess directly.
    const proc = (
      handle.orchestrator as unknown as {
        subprocess: { kill: (sig?: string) => void } | null
      }
    ).subprocess
    expect(proc).not.toBeNull()
    proc!.kill('SIGKILL')

    // Wait for the orchestrator to detect the crash.
    await new Promise<void>((resolve) => {
      const poll = setInterval(() => {
        if (handle.orchestrator.getLiveness() === 'dead') {
          clearInterval(poll)
          resolve()
        }
      }, 200)
      setTimeout(() => { clearInterval(poll); resolve() }, 12_000)
    })

    expect(handle.orchestrator.getLiveness()).toBe('dead')

    // validate() must throw.
    await expect(
      handle.orchestrator.validate(makeTestValidateRequest()),
    ).rejects.toThrow(/unavailable/i)

    // Call stop() to trigger unbindKeyProvider.
    await handle.stop()

    // Key provider must be unbound after stop().
    expect(isKeyProviderBound()).toBe(false)
  }, 25_000)
})
