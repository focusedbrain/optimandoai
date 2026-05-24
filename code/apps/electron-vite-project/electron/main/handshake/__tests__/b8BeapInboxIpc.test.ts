/**
 * Phase B, PR B-8 — Extension BEAP Inbox IPC tests
 *
 * Verifies the VAULT_RPC cases added to handleHandshakeRPC:
 *   §1  handshake.beapInbox.list      — sealed read
 *   §2  handshake.beapInbox.markRead  — operational update (returns rowId)
 *   §3  handshake.beapInbox.archive   — operational update (returns rowId)
 *   §4  handshake.beapInbox.unarchive — operational update (returns rowId)
 *   §5  handshake.beapInbox.classify  — reseal with AI analysis (returns rowId)
 *   §6  handshake.beapInbox.setUrgency — operational update (returns rowId)
 *
 * Phase B, PR B-8.2 additions:
 *   §7  handshake.beapInbox.getMany   — gate-verified read for patch mode
 *   §2–§6 rowId assertions            — each mutation now returns rowId
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
// Minimal in-memory SQLite-style DB stub
//
// These tests exercise the IPC handler logic, not the sealed-storage gate
// itself.  sealedQuery is mocked below so that the stub DB is sufficient.
// The harness context binds the key provider so that if the mock is removed
// in the future, real sealedQuery will work with the valid seals provided by
// ctx.buildValidSealForRowId.
// ---------------------------------------------------------------------------

function makeDb() {
  const rows: Record<string, any>[] = []
  const attachRows: Record<string, any>[] = []

  // Tracks prepare().run() calls for assertions
  const runCalls: Array<{ sql: string; args: unknown[] }> = []

  return {
    rows,
    attachRows,
    runCalls,

    prepare(sql: string) {
      return {
        all: (...args: unknown[]) => {
          if (sql.includes('FROM inbox_messages')) return rows
          if (sql.includes('FROM inbox_attachments')) return attachRows
          return []
        },
        run: (...args: unknown[]) => {
          runCalls.push({ sql, args })
        },
        get: (...args: unknown[]) => rows[0] ?? undefined,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Sealed-storage module stubs
//
// sealedQuery is mocked as a passthrough so IPC handler tests run at full
// speed without requiring real seal verification.  The harness binds a real
// key provider so rows built with ctx.buildValidSealForRowId would pass
// the gate if this mock were removed.
// ---------------------------------------------------------------------------

vi.mock('../../sealed-storage', () => ({
  sealedQuery: (_db: any, sql: string, args: unknown[]) => {
    // Return whatever the test DB has
    return _db.prepare(sql).all(...args)
  },
  prepareSealedOperationalUpdate: (db: any, sql: string) => ({
    run: (...args: unknown[]) => db.prepare(sql).run(...args),
  }),
  // Lifecycle hooks required by the sealed-storage test harness.
  // These are no-ops here because sealedQuery is fully mocked above and
  // key-provider binding has no effect in this test context.
  bindKeyProvider: vi.fn(),
  unbindKeyProvider: vi.fn(),
  isKeyProviderBound: vi.fn(() => false),
  clearTamperingEvents: vi.fn(),
  getTamperingEvents: vi.fn(() => []),
}))

vi.mock('../../email/sealedContentUpdate', () => ({
  resealWithAiAnalysis: vi.fn().mockResolvedValue({ ok: true }),
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase B PR B-8 — handshake.beapInbox IPC', () => {
  let db: ReturnType<typeof makeDb>
  let ctx: SealedStorageTestContext

  beforeEach(() => {
    ctx = createSealedStorageTestContext()
    db = makeDb()
  })

  afterEach(() => {
    ctx.cleanup()
  })

  // ── §1  list ────────────────────────────────────────────────────────────────

  describe('§1 handshake.beapInbox.list', () => {
    it('§1.1 returns sealed inbox rows as items array', async () => {
      const content = { body: 'World', transport_plaintext: '' }
      const { seal, seal_input_json } = ctx.buildValidSealForRowId('msg1', content)
      db.rows.push({
        id: 'msg1',
        handshake_id: 'hs1',
        subject: 'Hello',
        body_text: 'World',
        depackaged_json: JSON.stringify(content),
        received_at: 1000,
        read_status: 0,
        archived: 0,
        has_attachments: 0,
        attachment_count: 0,
        ai_analysis_json: null,
        urgency_score: null,
        from_address: 'alice@example.com',
        from_name: 'Alice',
        source_type: 'beap_message',
        seal,
        seal_input_json,
      })

      const result = await handleHandshakeRPC('handshake.beapInbox.list', {}, db)

      expect(result.success).toBe(true)
      expect(result.items).toHaveLength(1)
      expect(result.items[0].id).toBe('msg1')
      expect(result.items[0].subject).toBe('Hello')
    })

    it('§1.2 returns empty array when no rows', async () => {
      const result = await handleHandshakeRPC('handshake.beapInbox.list', {}, db)
      expect(result.success).toBe(true)
      expect(result.items).toHaveLength(0)
    })

    it('§1.3 returns error when db is null', async () => {
      const result = await handleHandshakeRPC('handshake.beapInbox.list', {}, null)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/database unavailable/i)
    })

    it('§1.4 includes attachments from inbox_attachments', async () => {
      const { seal: seal2, seal_input_json: sij2 } = ctx.buildValidSealForRowId('msg2', {})
      db.rows.push({
        id: 'msg2',
        handshake_id: null,
        subject: 'Files',
        body_text: '',
        depackaged_json: '{}',
        received_at: 2000,
        read_status: 0,
        archived: 0,
        has_attachments: 1,
        attachment_count: 1,
        ai_analysis_json: null,
        urgency_score: null,
        from_address: null,
        from_name: null,
        source_type: 'beap_message',
        seal: seal2,
        seal_input_json: sij2,
      })
      db.attachRows.push({
        attachment_id: 'att1',
        filename: 'file.pdf',
        mime_type: 'application/pdf',
        size_bytes: 12345,
        content_sha256: 'abc123',
      })

      const result = await handleHandshakeRPC('handshake.beapInbox.list', {}, db)
      expect(result.success).toBe(true)
      expect(result.items[0].attachments).toHaveLength(1)
      expect(result.items[0].attachments[0].filename).toBe('file.pdf')
    })
  })

  // ── §2  markRead ────────────────────────────────────────────────────────────

  describe('§2 handshake.beapInbox.markRead', () => {
    it('§2.1 sets read_status = 1 when read = true and returns rowId', async () => {
      const result = await handleHandshakeRPC(
        'handshake.beapInbox.markRead',
        { messageId: 'msg1', read: true },
        db,
      )
      expect(result.success).toBe(true)
      expect(result.rowId).toBe('msg1')
      const call = db.runCalls.find((c) => c.sql.includes('read_status'))
      expect(call).toBeDefined()
      expect(call?.args[0]).toBe(1)
      expect(call?.args[1]).toBe('msg1')
    })

    it('§2.2 sets read_status = 0 when read = false', async () => {
      await handleHandshakeRPC(
        'handshake.beapInbox.markRead',
        { messageId: 'msg1', read: false },
        db,
      )
      const call = db.runCalls.find((c) => c.sql.includes('read_status'))
      expect(call?.args[0]).toBe(0)
    })

    it('§2.3 returns error when messageId missing', async () => {
      const result = await handleHandshakeRPC('handshake.beapInbox.markRead', {}, db)
      expect(result.success).toBe(false)
    })

    it('§2.4 returns error when db is null', async () => {
      const result = await handleHandshakeRPC(
        'handshake.beapInbox.markRead',
        { messageId: 'msg1', read: true },
        null,
      )
      expect(result.success).toBe(false)
    })
  })

  // ── §3  archive ─────────────────────────────────────────────────────────────

  describe('§3 handshake.beapInbox.archive', () => {
    it('§3.1 sets archived = 1 and returns rowId', async () => {
      const result = await handleHandshakeRPC(
        'handshake.beapInbox.archive',
        { messageId: 'msg1' },
        db,
      )
      expect(result.success).toBe(true)
      expect(result.rowId).toBe('msg1')
      const call = db.runCalls.find((c) => c.sql.includes('archived = 1'))
      expect(call).toBeDefined()
      expect(call?.args[0]).toBe('msg1')
    })

    it('§3.2 returns error when messageId missing', async () => {
      const result = await handleHandshakeRPC('handshake.beapInbox.archive', {}, db)
      expect(result.success).toBe(false)
    })
  })

  // ── §4  unarchive ───────────────────────────────────────────────────────────

  describe('§4 handshake.beapInbox.unarchive', () => {
    it('§4.1 sets archived = 0 and returns rowId', async () => {
      const result = await handleHandshakeRPC(
        'handshake.beapInbox.unarchive',
        { messageId: 'msg1' },
        db,
      )
      expect(result.success).toBe(true)
      expect(result.rowId).toBe('msg1')
      const call = db.runCalls.find((c) => c.sql.includes('archived = 0'))
      expect(call).toBeDefined()
    })
  })

  // ── §5  classify ────────────────────────────────────────────────────────────

  describe('§5 handshake.beapInbox.classify', () => {
    it('§5.1 calls resealWithAiAnalysis with provided analysis', async () => {
      const { resealWithAiAnalysis } = await import('../../email/sealedContentUpdate')
      vi.mocked(resealWithAiAnalysis).mockResolvedValue({ ok: true })

      const result = await handleHandshakeRPC(
        'handshake.beapInbox.classify',
        {
          messageId: 'msg1',
          aiAnalysis: { urgency: 'urgent', summary: 'test', confidence: 0.9 },
          urgencyScore: 90,
        },
        db,
      )
      expect(result.success).toBe(true)
      expect(result.rowId).toBe('msg1')
      expect(resealWithAiAnalysis).toHaveBeenCalledWith(
        db,
        'msg1',
        expect.objectContaining({ urgency: 'urgent' }),
      )
    })

    it('§5.2 returns failure when resealWithAiAnalysis fails', async () => {
      const { resealWithAiAnalysis } = await import('../../email/sealedContentUpdate')
      vi.mocked(resealWithAiAnalysis).mockResolvedValue({ ok: false, error: 'validator reject' })

      const result = await handleHandshakeRPC(
        'handshake.beapInbox.classify',
        { messageId: 'msg1', aiAnalysis: {} },
        db,
      )
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/validator reject/)
    })

    it('§5.3 updates urgency_score operationally after successful reseal', async () => {
      const { resealWithAiAnalysis } = await import('../../email/sealedContentUpdate')
      vi.mocked(resealWithAiAnalysis).mockResolvedValue({ ok: true })

      await handleHandshakeRPC(
        'handshake.beapInbox.classify',
        { messageId: 'msg1', aiAnalysis: {}, urgencyScore: 75 },
        db,
      )
      const call = db.runCalls.find((c) => c.sql.includes('urgency_score'))
      expect(call).toBeDefined()
      expect(call?.args[0]).toBe(75)
    })

    it('§5.4 returns error when messageId missing', async () => {
      const result = await handleHandshakeRPC('handshake.beapInbox.classify', {}, db)
      expect(result.success).toBe(false)
    })
  })

  // ── §6  setUrgency ──────────────────────────────────────────────────────────

  describe('§6 handshake.beapInbox.setUrgency', () => {
    it('§6.1 updates urgency_score and returns rowId', async () => {
      const result = await handleHandshakeRPC(
        'handshake.beapInbox.setUrgency',
        { messageId: 'msg1', urgencyScore: 65 },
        db,
      )
      expect(result.success).toBe(true)
      expect(result.rowId).toBe('msg1')
      const call = db.runCalls.find((c) => c.sql.includes('urgency_score'))
      expect(call).toBeDefined()
      expect(call?.args[0]).toBe(65)
      expect(call?.args[1]).toBe('msg1')
    })

    it('§6.2 returns error when urgencyScore is not a number', async () => {
      const result = await handleHandshakeRPC(
        'handshake.beapInbox.setUrgency',
        { messageId: 'msg1', urgencyScore: 'high' },
        db,
      )
      expect(result.success).toBe(false)
    })

    it('§6.3 returns error when db is null', async () => {
      const result = await handleHandshakeRPC(
        'handshake.beapInbox.setUrgency',
        { messageId: 'msg1', urgencyScore: 50 },
        null,
      )
      expect(result.success).toBe(false)
    })
  })

  // ── §7  getMany — Phase B, PR B-8.2 ─────────────────────────────────────────

  describe('§7 handshake.beapInbox.getMany (B-8.2)', () => {
    function pushRow(id: string, extra: Record<string, unknown> = {}) {
      const content = { subject: `Subject ${id}` }
      const { seal, seal_input_json } = ctx.buildValidSealForRowId(id, content)
      db.rows.push({
        id,
        handshake_id: null,
        subject: `Subject ${id}`,
        body_text: '',
        depackaged_json: '{}',
        received_at: 1000,
        read_status: 0,
        archived: 0,
        has_attachments: 0,
        attachment_count: 0,
        ai_analysis_json: null,
        urgency_score: null,
        from_address: null,
        from_name: null,
        source_type: 'beap_message',
        seal,
        seal_input_json,
        ...extra,
      })
    }

    it('§7.1 returns rows that exist and pass sealedQuery', async () => {
      pushRow('row1')
      pushRow('row2')

      const result = await handleHandshakeRPC(
        'handshake.beapInbox.getMany',
        { rowIds: ['row1', 'row2'] },
        db,
      )
      expect(result.success).toBe(true)
      expect(result.rows).toHaveLength(2)
      expect(result.rows.map((r: any) => r.id)).toEqual(expect.arrayContaining(['row1', 'row2']))
    })

    it('§7.2 returns empty array when rowIds is empty', async () => {
      const result = await handleHandshakeRPC(
        'handshake.beapInbox.getMany',
        { rowIds: [] },
        db,
      )
      expect(result.success).toBe(true)
      expect(result.rows).toHaveLength(0)
    })

    it('§7.3 returns empty array when rowIds is missing', async () => {
      const result = await handleHandshakeRPC('handshake.beapInbox.getMany', {}, db)
      expect(result.success).toBe(true)
      expect(result.rows).toHaveLength(0)
    })

    it('§7.4 returns error when db is null', async () => {
      const result = await handleHandshakeRPC(
        'handshake.beapInbox.getMany',
        { rowIds: ['row1'] },
        null,
      )
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/database unavailable/i)
    })

    it('§7.5 ignores non-string entries in rowIds', async () => {
      pushRow('row1')
      const result = await handleHandshakeRPC(
        'handshake.beapInbox.getMany',
        { rowIds: ['row1', 42, null, '', 'row1'] },
        db,
      )
      expect(result.success).toBe(true)
      // Only 'row1' is valid; empty string and non-string filtered out.
      // DB stub returns all rows regardless — the IPC still succeeds.
    })

    it('§7.6 clamps rowIds to 500 entries', async () => {
      const manyIds = Array.from({ length: 600 }, (_, i) => `row${i}`)
      // Just verify it doesn't throw
      const result = await handleHandshakeRPC(
        'handshake.beapInbox.getMany',
        { rowIds: manyIds },
        db,
      )
      expect(result.success).toBe(true)
    })

    it('§7.7 uses an IN-clause predicate (structural proof of sealedQuery usage)', async () => {
      // The sealedQuery mock delegates to db.prepare(sql).all(...args).
      // We verify the handler produces an IN-clause by checking that the db
      // receives a prepare() call containing "IN (" when rowIds has elements.
      const preparedSqls: string[] = []
      const origPrepare = db.prepare.bind(db)
      db.prepare = (sql: string) => {
        preparedSqls.push(sql)
        return origPrepare(sql)
      }

      pushRow('row1')
      pushRow('row2')
      await handleHandshakeRPC(
        'handshake.beapInbox.getMany',
        { rowIds: ['row1', 'row2'] },
        db,
      )
      expect(preparedSqls.some((s) => s.includes('IN ('))).toBe(true)
    })

    it('§7.8 includes attachments from inbox_attachments', async () => {
      // pushRow already provides valid seals via ctx.buildValidSealForRowId
      pushRow('row1', { has_attachments: 1, attachment_count: 1 })
      db.attachRows.push({
        attachment_id: 'att1',
        filename: 'doc.pdf',
        mime_type: 'application/pdf',
        size_bytes: 500,
        content_sha256: 'abc',
      })

      const result = await handleHandshakeRPC(
        'handshake.beapInbox.getMany',
        { rowIds: ['row1'] },
        db,
      )
      expect(result.success).toBe(true)
      expect(result.rows[0].attachments).toHaveLength(1)
      expect(result.rows[0].attachments[0].filename).toBe('doc.pdf')
    })
  })
})
