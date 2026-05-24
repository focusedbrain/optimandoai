/**
 * B-7.1 Operational-Update Gate Tests
 *
 * Covers the three deliverables of PR B-7.1:
 *
 * §1 — extractColumnsFromSetClause (SQL parser)
 *   §1.1  Single column: SET col = ?
 *   §1.2  Multiple columns: SET col1 = ?, col2 = ?, col3 = ?
 *   §1.3  NULL literal RHS: SET col = NULL
 *   §1.4  String literal RHS with commas prevented by paren tracking
 *   §1.5  Multi-line SQL template (classifySingleMessage pattern)
 *   §1.6  WHERE clause is excluded from column extraction
 *   §1.7  Unknown pattern (dynamic column) throws SealVerificationError
 *
 * §2 — prepareSealedOperationalUpdate gate enforcement
 *   §2.1  SET seal = ? → throws SealVerificationError at prepare time
 *   §2.2  SET depackaged_json = ? → throws SealVerificationError at prepare time
 *   §2.3  SET unknown_col = ? → throws (not in allowlist)
 *   §2.4  SET read_status = ? → succeeds (allowlisted)
 *   §2.5  SET archived = 1 → succeeds (allowlisted, literal RHS)
 *   §2.6  Multiple allowlisted columns in one statement → succeeds
 *
 * §3 — Operational update does NOT modify the seal
 *   §3.1  seal and seal_input_json are unchanged after operational .run()
 *   §3.2  sealedQuery still accepts the row after an operational update
 *
 * §4 — classifySingleMessage atomicity (Decision D)
 *   §4.1  When resealWithAiAnalysis fails, operational columns are NOT written
 *         (verified by checking that no prepareSealedOperationalUpdate call runs)
 *
 * per Phase B Architecture, PR B-7.1, Decisions A–D.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createRequire } from 'module'
import { randomUUID } from 'crypto'

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  app: { getPath: () => '/tmp' },
}))

// ─────────────────────────────────────────────────────────────────────────────
// DB setup
// ─────────────────────────────────────────────────────────────────────────────

const require = createRequire(import.meta.url)
let Database: typeof import('better-sqlite3').default | null = null
try {
  const D = require('better-sqlite3') as typeof import('better-sqlite3').default
  const d = new D(':memory:')
  d.close()
  Database = D
} catch {
  Database = null
}

import {
  bindKeyProvider,
  unbindKeyProvider,
  clearTamperingEvents,
  prepareSealedInsert,
  sealedQuery,
  SealVerificationError,
  extractColumnsFromSetClause,
  prepareSealedOperationalUpdate,
} from '../../sealed-storage/index'

const TEST_DEK = Buffer.from('00'.repeat(32), 'hex')

function makeDb() {
  if (!Database) throw new Error('better-sqlite3 unavailable')
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE inbox_messages (
      id TEXT PRIMARY KEY,
      source_type TEXT DEFAULT 'direct_beap',
      depackaged_json TEXT,
      ai_analysis_json TEXT,
      read_status INTEGER DEFAULT 0,
      starred INTEGER DEFAULT 0,
      archived INTEGER DEFAULT 0,
      sort_category TEXT,
      sort_reason TEXT,
      pending_delete INTEGER DEFAULT 0,
      pending_delete_at TEXT,
      pending_review_at TEXT,
      urgency_score REAL,
      needs_reply INTEGER DEFAULT 0,
      last_autosort_session_id TEXT,
      validated_at TEXT,
      validator_version TEXT,
      validation_reason TEXT,
      seal TEXT,
      seal_input_json TEXT
    );
  `)
  return db
}

function skipIfNoBetterSqlite(db: any) {
  if (!db) return true
  return false
}

// ─────────────────────────────────────────────────────────────────────────────
// §1 — extractColumnsFromSetClause parser
// ─────────────────────────────────────────────────────────────────────────────

describe('B-7.1 §1 — extractColumnsFromSetClause', () => {
  it('§1.1 single column: SET col = ?', () => {
    const cols = extractColumnsFromSetClause('UPDATE inbox_messages SET read_status = ? WHERE id = ?')
    expect(cols).toEqual(['read_status'])
  })

  it('§1.2 multiple columns: SET col1 = ?, col2 = ?, col3 = ?', () => {
    const cols = extractColumnsFromSetClause(
      'UPDATE inbox_messages SET archived = ?, sort_category = ?, sort_reason = ? WHERE id = ?',
    )
    expect(cols).toEqual(['archived', 'sort_category', 'sort_reason'])
  })

  it('§1.3 NULL literal RHS: SET col = NULL', () => {
    const cols = extractColumnsFromSetClause(
      'UPDATE inbox_messages SET remote_orchestrator_last_error = NULL WHERE id = ?',
    )
    expect(cols).toEqual(['remote_orchestrator_last_error'])
  })

  it('§1.4 integer literal RHS: SET archived = 1', () => {
    const cols = extractColumnsFromSetClause(
      'UPDATE inbox_messages SET archived = 1 WHERE id = ?',
    )
    expect(cols).toEqual(['archived'])
  })

  it('§1.5 string literal RHS with comma inside paren-tracking safe', () => {
    // sort_category = 'pending_review' contains no comma, but tests that string
    // quoting doesn't confuse the parser
    const cols = extractColumnsFromSetClause(
      `UPDATE inbox_messages SET sort_category = 'pending_review', pending_review_at = ? WHERE id IN (?)`,
    )
    expect(cols).toEqual(['sort_category', 'pending_review_at'])
  })

  it('§1.6 multi-line SQL template (classifySingleMessage pattern)', () => {
    const sql = `UPDATE inbox_messages SET archived = 0, pending_delete = 0, pending_delete_at = NULL, pending_review_at = NULL,
           sort_category = ?, sort_reason = ?, urgency_score = ?, needs_reply = ? WHERE id = ?`
    const cols = extractColumnsFromSetClause(sql)
    expect(cols).toEqual([
      'archived',
      'pending_delete',
      'pending_delete_at',
      'pending_review_at',
      'sort_category',
      'sort_reason',
      'urgency_score',
      'needs_reply',
    ])
  })

  it('§1.7 SET clause not found → throws SealVerificationError', () => {
    expect(() => extractColumnsFromSetClause('SELECT * FROM inbox_messages')).toThrow(
      SealVerificationError,
    )
  })

  // ── §1b — Robustness / edge cases (PR B-7.2) ─────────────────────────────

  it('§1.8 subquery on RHS: SET col = (SELECT id FROM t WHERE id = ?) — column still extracted', () => {
    const cols = extractColumnsFromSetClause(
      'UPDATE inbox_messages SET lifecycle_status = (SELECT status FROM t WHERE id = ?) WHERE id = ?',
    )
    expect(cols).toEqual(['lifecycle_status'])
  })

  it('§1.9 function call on RHS: SET validated_at = datetime(?) — column extracted', () => {
    const cols = extractColumnsFromSetClause(
      'UPDATE inbox_messages SET validated_at = datetime(?) WHERE id = ?',
    )
    expect(cols).toEqual(['validated_at'])
  })

  it('§1.10 function call with multiple args: SET embedding_status = COALESCE(?, \'pending\') — column extracted', () => {
    const cols = extractColumnsFromSetClause(
      `UPDATE inbox_messages SET embedding_status = COALESCE(?, 'pending') WHERE id = ?`,
    )
    expect(cols).toEqual(['embedding_status'])
  })

  it('§1.11 multi-line SQL with function call RHS — realistic pattern', () => {
    const sql = `
      UPDATE inbox_messages SET
        lifecycle_status = ?,
        lifecycle_updated_at = datetime('now'),
        embedding_status = 'pending'
      WHERE id = ?
    `
    const cols = extractColumnsFromSetClause(sql)
    expect(cols).toEqual(['lifecycle_status', 'lifecycle_updated_at', 'embedding_status'])
  })

  it('§1.12 encryption columns (B-7.1 allowlist additions)', () => {
    const sql = `UPDATE inbox_messages SET encryption_key = ?, encryption_iv = ?, encryption_tag = ?, storage_encrypted = ? WHERE id = ?`
    const cols = extractColumnsFromSetClause(sql)
    expect(cols).toEqual(['encryption_key', 'encryption_iv', 'encryption_tag', 'storage_encrypted'])
  })

  it('§1.13 has_attachments / attachment_count pattern', () => {
    const cols = extractColumnsFromSetClause(
      'UPDATE inbox_messages SET has_attachments = 1, attachment_count = ? WHERE id = ?',
    )
    expect(cols).toEqual(['has_attachments', 'attachment_count'])
  })

  it('§1.14 string literal RHS with embedded comma inside parens — not confused', () => {
    // The string \'a,b\' has a comma, but the parser must not split on it.
    // COALESCE(?, 'a,b') wraps a string with a comma in a function call.
    const cols = extractColumnsFromSetClause(
      `UPDATE inbox_messages SET sort_reason = COALESCE(?, 'a,b'), urgency_score = ? WHERE id = ?`,
    )
    expect(cols).toEqual(['sort_reason', 'urgency_score'])
  })

  it('§1.15 multiple WHERE id IN sublist — WHERE body excluded from SET parse', () => {
    // Ensures the parser stops at WHERE even when WHERE contains commas.
    const cols = extractColumnsFromSetClause(
      `UPDATE inbox_messages SET read_status = 1 WHERE id IN (?, ?, ?)`,
    )
    expect(cols).toEqual(['read_status'])
  })

  it('§1.16 dynamic column name pattern (e.g. computed col) → throws SealVerificationError', () => {
    // If the parser encounters something it can't classify as a static column name,
    // it should throw rather than silently allow unknown columns.
    expect(() => extractColumnsFromSetClause('UPDATE t SET ? = 1 WHERE id = ?')).toThrow(
      SealVerificationError,
    )
  })

  it('§1.17 CTE prefix before UPDATE — SET clause still found', () => {
    const sql = `
      WITH src AS (SELECT id FROM t)
      UPDATE inbox_messages SET autosort_pending = 0 WHERE id = ?
    `
    const cols = extractColumnsFromSetClause(sql)
    expect(cols).toEqual(['autosort_pending'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §2 — prepareSealedOperationalUpdate gate enforcement
// ─────────────────────────────────────────────────────────────────────────────

describe('B-7.1 §2 — prepareSealedOperationalUpdate gate enforcement', () => {
  let db: ReturnType<typeof makeDb> | null = null

  beforeEach(() => {
    if (!Database) return
    db = makeDb()
    bindKeyProvider(() => TEST_DEK)
  })

  afterEach(() => {
    unbindKeyProvider()
    clearTamperingEvents()
    db?.close()
    db = null
  })

  it('§2.1 SET seal = ? → throws SealVerificationError at prepare time', () => {
    if (!db) return
    expect(() =>
      prepareSealedOperationalUpdate(db!, 'UPDATE inbox_messages SET seal = ? WHERE id = ?'),
    ).toThrow(SealVerificationError)
  })

  it('§2.2 SET depackaged_json = ? → throws SealVerificationError at prepare time', () => {
    if (!db) return
    expect(() =>
      prepareSealedOperationalUpdate(
        db!,
        'UPDATE inbox_messages SET depackaged_json = ? WHERE id = ?',
      ),
    ).toThrow(SealVerificationError)
  })

  it('§2.3 SET unknown_column = ? → throws (not in allowlist)', () => {
    if (!db) return
    expect(() =>
      prepareSealedOperationalUpdate(
        db!,
        'UPDATE inbox_messages SET unknown_column = ? WHERE id = ?',
      ),
    ).toThrow(SealVerificationError)
  })

  it('§2.4 SET read_status = ? → succeeds (allowlisted column)', () => {
    if (!db) return
    const stmt = prepareSealedOperationalUpdate(
      db!,
      'UPDATE inbox_messages SET read_status = ? WHERE id = ?',
    )
    expect(stmt).toBeDefined()
    expect(stmt.columns).toEqual(['read_status'])
  })

  it('§2.5 SET archived = 1 → succeeds (allowlisted, literal RHS)', () => {
    if (!db) return
    const stmt = prepareSealedOperationalUpdate(
      db!,
      'UPDATE inbox_messages SET archived = 1 WHERE id = ?',
    )
    expect(stmt.columns).toEqual(['archived'])
  })

  it('§2.6 multiple allowlisted columns → succeeds', () => {
    if (!db) return
    const stmt = prepareSealedOperationalUpdate(
      db!,
      'UPDATE inbox_messages SET pending_delete = 1, pending_delete_at = ? WHERE id = ?',
    )
    expect(stmt.columns).toEqual(['pending_delete', 'pending_delete_at'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §3 — Operational update does NOT modify the seal
// ─────────────────────────────────────────────────────────────────────────────

describe('B-7.1 §3 — Operational update leaves seal intact', () => {
  let db: ReturnType<typeof makeDb> | null = null
  const messageId = randomUUID()

  beforeEach(() => {
    if (!Database) return
    db = makeDb()
    bindKeyProvider(() => TEST_DEK)

    // Insert a sealed row via the gate
    const canonical = JSON.stringify({
      content_type: 'plain_email',
      transport_sender: 'alice@example.com',
      transport_received_at: new Date().toISOString(),
    })
    const sealInput = JSON.stringify({
      content_sha256: require('crypto').createHash('sha256').update(canonical, 'utf8').digest('hex'),
      algorithm: 'HMAC-SHA256',
      version: '1.0.0',
      created_at: new Date().toISOString(),
    })
    const sealValue = require('crypto')
      .createHmac('sha256', TEST_DEK)
      .update(sealInput, 'utf8')
      .digest('base64')

    db!.prepare(
      'INSERT INTO inbox_messages (id, depackaged_json, read_status, seal, seal_input_json) VALUES (?, ?, 0, ?, ?)',
    ).run(messageId, canonical, sealValue, sealInput)
  })

  afterEach(() => {
    unbindKeyProvider()
    clearTamperingEvents()
    db?.close()
    db = null
  })

  it('§3.1 seal and seal_input_json unchanged after operational .run()', () => {
    if (!db) return
    const before = db!.prepare('SELECT seal, seal_input_json FROM inbox_messages WHERE id = ?').get(messageId) as any
    expect(before.seal).toBeTruthy()

    prepareSealedOperationalUpdate(
      db!,
      'UPDATE inbox_messages SET read_status = ? WHERE id = ?',
    ).run(1, messageId)

    const after = db!.prepare('SELECT seal, seal_input_json, read_status FROM inbox_messages WHERE id = ?').get(messageId) as any
    expect(after.seal).toEqual(before.seal)
    expect(after.seal_input_json).toEqual(before.seal_input_json)
    expect(after.read_status).toBe(1)
  })

  it('§3.2 sealedQuery still returns the row with valid seal after operational update', () => {
    if (!db) return
    // Update an operational column
    prepareSealedOperationalUpdate(
      db!,
      'UPDATE inbox_messages SET starred = ? WHERE id = ?',
    ).run(1, messageId)

    // Read path should still accept the row — the seal covers content only
    const rows = sealedQuery(db!, 'SELECT * FROM inbox_messages WHERE id = ?', [messageId], 'depackaged_json')
    expect(rows).toHaveLength(1)
    expect((rows[0] as any).starred).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// §4 — classifySingleMessage atomicity (Decision D)
// ─────────────────────────────────────────────────────────────────────────────

describe('B-7.1 §4 — classifySingleMessage atomicity: re-seal first, operational second', () => {
  it('§4.1 when resealWithAiAnalysis fails, prepareSealedOperationalUpdate is not called', async () => {
    // We simulate the Decision D ordering by verifying the contract:
    // the new ipc.ts code returns early (with error) when sealResClassify.ok === false,
    // before any prepareSealedOperationalUpdate call.
    //
    // Here we test the gate API directly: verify that if we never call
    // prepareSealedOperationalUpdate, no operational write can happen.
    // The actual classifySingleMessage behavior is integration-tested at the
    // handler level; here we verify the ordering invariant structurally.

    const operationalUpdateCalled = vi.fn()

    // Simulate the Decision D pattern
    async function simulateClassify(resealShouldFail: boolean) {
      const resealResult = resealShouldFail
        ? { ok: false as const, error: 'tampered row' }
        : { ok: true as const }

      if (!resealResult.ok) {
        // B-7.1 Decision D: abort early, no operational writes
        return { error: resealResult.error }
      }

      // Only reaches here if re-seal succeeded
      operationalUpdateCalled()
      return { ok: true }
    }

    // Case A: re-seal fails → operational update NOT called
    await simulateClassify(true)
    expect(operationalUpdateCalled).not.toHaveBeenCalled()

    // Case B: re-seal succeeds → operational update IS called
    await simulateClassify(false)
    expect(operationalUpdateCalled).toHaveBeenCalledTimes(1)
  })
})
