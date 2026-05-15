/**
 * Phase B, PR B-8.1 — beapInbox.list cursor-based pagination tests
 *
 * Verifies the cursor-pagination extension of the handshake.beapInbox.list
 * VAULT_RPC case:
 *   §1  First batch (cursor = null) returns rows and nextCursor
 *   §2  Second batch (with cursor) returns non-overlapping next rows
 *   §3  Last batch (cursor returns fewer than limit rows) returns nextCursor = null
 *   §4  limit parameter is respected (capped at 1000)
 *   §5  Malformed cursor falls back gracefully (no crash, returns first batch)
 *   §6  sealedQuery is used (not raw db.prepare) — gate-verified reads
 *
 * Sealed-storage setup uses the shared harness (B-8.4d-iii-5b, Decision A).
 * See: docs/testing/sealed-storage-test-harness.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { handleHandshakeRPC } from '../ipc'
import {
  createSealedStorageTestContext,
  type SealedStorageTestContext,
} from '../../../../../../test/harness/sealed-storage'

// ---------------------------------------------------------------------------
// Stubs
//
// sealedQuery is mocked so that pagination logic can be controlled precisely
// via sealedQueryMock.mockReturnValue(rows).  The harness binds the key
// provider so rows built with ctx.buildValidSealForRowId would pass the gate
// if this mock were removed.
// ---------------------------------------------------------------------------

const sealedQueryMock = vi.fn()

vi.mock('../../sealed-storage', () => ({
  sealedQuery: (...args: any[]) => sealedQueryMock(...args),
  prepareSealedOperationalUpdate: (_db: any, _sql: string) => ({
    run: (..._args: unknown[]) => {},
  }),
  // Lifecycle hooks required by the sealed-storage test harness.
  // These are no-ops here because sealedQuery is fully mocked above.
  bindKeyProvider: vi.fn(),
  unbindKeyProvider: vi.fn(),
  isKeyProviderBound: vi.fn(() => false),
  clearTamperingEvents: vi.fn(),
  getTamperingEvents: vi.fn(() => []),
}))

vi.mock('../../email/sealedContentUpdate', () => ({
  resealWithAiAnalysis: vi.fn().mockResolvedValue({ ok: true }),
}))

function makeInboxRow(id: string, received_at: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    handshake_id: null,
    subject: `Subject for ${id}`,
    body_text: null,
    depackaged_json: '{}',
    received_at,
    read_status: 0,
    archived: 0,
    has_attachments: 0,
    attachment_count: 0,
    ai_analysis_json: null,
    urgency_score: null,
    from_address: null,
    from_name: null,
    source_type: 'beap_message',
    // Seals are intentionally left as stubs here because sealedQuery is mocked.
    // Tests that need real seals should use ctx.buildValidSealForRowId.
    seal: 'stub-seal',
    seal_input_json: '{"content_sha256":"stub","row_id":"stub"}',
    ...extra,
  }
}

/** Build a minimal DB stub that only handles inbox_attachments (no data). */
function makeDb() {
  return {
    prepare(_sql: string) {
      return {
        all: () => [],
        run: () => {},
        get: () => undefined,
      }
    },
  }
}

/** Decode a cursor produced by the handler. Returns null if invalid. */
function decodeCursor(cursor: string | null): { t: number; i: string } | null {
  if (!cursor) return null
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
  } catch { return null }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase B PR B-8.1 — handshake.beapInbox.list cursor pagination', () => {
  let db: ReturnType<typeof makeDb>
  let ctx: SealedStorageTestContext

  beforeEach(() => {
    ctx = createSealedStorageTestContext()
    db = makeDb()
    vi.clearAllMocks()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  // ── §1  First batch (no cursor) ─────────────────────────────────────────────

  describe('§1 first batch (cursor = null)', () => {
    it('§1.1 returns items and non-null nextCursor when rows === limit', async () => {
      const rows = Array.from({ length: 200 }, (_, i) =>
        makeInboxRow(`msg${i}`, 1_000_000 - i),
      )
      sealedQueryMock.mockReturnValue(rows)

      const result = await handleHandshakeRPC('handshake.beapInbox.list', { cursor: null }, db)

      expect(result.success).toBe(true)
      expect(result.items).toHaveLength(200)
      expect(result.nextCursor).not.toBeNull()
    })

    it('§1.2 encodes last row\'s received_at and id in nextCursor', async () => {
      const rows = Array.from({ length: 200 }, (_, i) =>
        makeInboxRow(`id-${String(i).padStart(4, '0')}`, 1_000_000 - i),
      )
      sealedQueryMock.mockReturnValue(rows)

      const result = await handleHandshakeRPC('handshake.beapInbox.list', { cursor: null, limit: 200 }, db)

      const decoded = decodeCursor(result.nextCursor)
      expect(decoded?.t).toBe(rows[199].received_at)
      expect(decoded?.i).toBe(rows[199].id)
    })

    it('§1.3 returns nextCursor = null when rows < limit', async () => {
      // Only 3 rows — fewer than the default limit of 200
      sealedQueryMock.mockReturnValue([
        makeInboxRow('a', 3000),
        makeInboxRow('b', 2000),
        makeInboxRow('c', 1000),
      ])

      const result = await handleHandshakeRPC('handshake.beapInbox.list', { cursor: null }, db)

      expect(result.success).toBe(true)
      expect(result.items).toHaveLength(3)
      expect(result.nextCursor).toBeNull()
    })

    it('§1.4 returns empty items and nextCursor = null when no rows', async () => {
      sealedQueryMock.mockReturnValue([])

      const result = await handleHandshakeRPC('handshake.beapInbox.list', {}, db)

      expect(result.success).toBe(true)
      expect(result.items).toHaveLength(0)
      expect(result.nextCursor).toBeNull()
    })
  })

  // ── §2  Second batch (with cursor) ─────────────────────────────────────────

  describe('§2 second batch (cursor provided)', () => {
    it('§2.1 passes cursor position to sealedQuery (no overlap with first batch)', async () => {
      // First batch: 200 rows with received_at 1_000_000 down to 1_000_000 - 199
      const firstRows = Array.from({ length: 200 }, (_, i) =>
        makeInboxRow(`msg${i}`, 1_000_000 - i),
      )
      // Second batch starts after last row of first
      const secondRows = Array.from({ length: 50 }, (_, i) =>
        makeInboxRow(`msg${200 + i}`, 1_000_000 - 200 - i),
      )

      // First call returns first batch
      sealedQueryMock.mockReturnValueOnce(firstRows)
      const firstResult = await handleHandshakeRPC('handshake.beapInbox.list', { cursor: null }, db)
      expect(firstResult.nextCursor).not.toBeNull()

      // Second call with cursor returns next batch
      sealedQueryMock.mockReturnValueOnce(secondRows)
      const secondResult = await handleHandshakeRPC(
        'handshake.beapInbox.list',
        { cursor: firstResult.nextCursor },
        db,
      )

      expect(secondResult.success).toBe(true)
      expect(secondResult.items).toHaveLength(50)
      // Last batch: fewer than 200 → nextCursor null
      expect(secondResult.nextCursor).toBeNull()

      // Verify sealedQuery was called with cursor parameters
      const secondCall = sealedQueryMock.mock.calls[1]
      // args = [db, sql, params, sealField]
      expect(secondCall[2]).toContain(firstRows[199].received_at)
      expect(secondCall[2]).toContain(firstRows[199].id)
    })

    it('§2.2 cursor query SQL uses the cursor-predicate form', async () => {
      // Produce a cursor
      sealedQueryMock.mockReturnValueOnce(
        Array.from({ length: 200 }, (_, i) => makeInboxRow(`m${i}`, 9000 - i)),
      )
      const firstResult = await handleHandshakeRPC('handshake.beapInbox.list', { cursor: null }, db)

      sealedQueryMock.mockReturnValueOnce([])
      await handleHandshakeRPC('handshake.beapInbox.list', { cursor: firstResult.nextCursor }, db)

      const secondSql: string = sealedQueryMock.mock.calls[1][1]
      // Cursor-form query must contain the WHERE clause for cursor pagination
      expect(secondSql).toMatch(/received_at < \?/)
      expect(secondSql).toMatch(/received_at = \? AND id < \?/)
    })
  })

  // ── §3  Last batch ──────────────────────────────────────────────────────────

  describe('§3 last batch', () => {
    it('§3.1 nextCursor is null when returned rows < effective limit', async () => {
      sealedQueryMock.mockReturnValue(
        Array.from({ length: 199 }, (_, i) => makeInboxRow(`m${i}`, 5000 - i)),
      )
      const result = await handleHandshakeRPC(
        'handshake.beapInbox.list',
        { cursor: null, limit: 200 },
        db,
      )
      expect(result.nextCursor).toBeNull()
    })
  })

  // ── §4  limit parameter ─────────────────────────────────────────────────────

  describe('§4 limit parameter', () => {
    it('§4.1 respects explicit limit', async () => {
      sealedQueryMock.mockReturnValue(
        Array.from({ length: 10 }, (_, i) => makeInboxRow(`m${i}`, 1000 - i)),
      )
      await handleHandshakeRPC('handshake.beapInbox.list', { cursor: null, limit: 10 }, db)

      const callArgs = sealedQueryMock.mock.calls[0][2] as unknown[]
      // Last arg in params is the effective limit
      expect(callArgs[callArgs.length - 1]).toBe(10)
    })

    it('§4.2 clamps limit at 1000', async () => {
      sealedQueryMock.mockReturnValue([])
      await handleHandshakeRPC('handshake.beapInbox.list', { cursor: null, limit: 99999 }, db)

      const callArgs = sealedQueryMock.mock.calls[0][2] as unknown[]
      expect(callArgs[callArgs.length - 1]).toBe(1000)
    })

    it('§4.3 defaults to 200 when limit omitted', async () => {
      sealedQueryMock.mockReturnValue([])
      await handleHandshakeRPC('handshake.beapInbox.list', {}, db)

      const callArgs = sealedQueryMock.mock.calls[0][2] as unknown[]
      expect(callArgs[callArgs.length - 1]).toBe(200)
    })
  })

  // ── §5  Malformed cursor ────────────────────────────────────────────────────

  describe('§5 malformed cursor', () => {
    it('§5.1 ignores invalid cursor and returns first-batch query (no crash)', async () => {
      sealedQueryMock.mockReturnValue([makeInboxRow('m1', 1000)])

      const result = await handleHandshakeRPC(
        'handshake.beapInbox.list',
        { cursor: 'not-valid-base64url!!' },
        db,
      )

      expect(result.success).toBe(true)
      // Falls back to first-batch form (no cursor predicate in SQL)
      const sql: string = sealedQueryMock.mock.calls[0][1]
      expect(sql).not.toMatch(/received_at < \?/)
    })
  })

  // ── §6  Gate-verified reads ─────────────────────────────────────────────────

  describe('§6 gate-verified reads (sealedQuery, not raw db.prepare)', () => {
    it('§6.1 list handler calls sealedQuery stub, not db.prepare', async () => {
      const prepareSpy = vi.spyOn(db, 'prepare')
      sealedQueryMock.mockReturnValue([])

      await handleHandshakeRPC('handshake.beapInbox.list', { cursor: null }, db)

      // sealedQuery was called once for inbox_messages rows
      expect(sealedQueryMock).toHaveBeenCalledTimes(1)
      // db.prepare may be called for inbox_attachments (separate, non-sealed query),
      // but NOT for inbox_messages content — that must go through sealedQuery
      const mainQuery = sealedQueryMock.mock.calls[0][1] as string
      expect(mainQuery).toMatch(/FROM inbox_messages/)
    })
  })
})
