/**
 * Phase B, PR B-8.2 — Patch Mode tests
 *
 * Verifies the new `patch` RefreshMode and the stable-position behavior it
 * enables:
 *
 *   §1  patch mode: in-place row updates
 *   §2  patch mode: rows missing from response are removed (deleted / seal fail)
 *   §3  patch mode: Decision D — rows NOT already in store are never added
 *   §4  patch mode: multi-row patch with mixed outcomes
 *   §5  patch mode: empty rowIds is a no-op
 *   §6  patch mode: local-only UI state (draftReply, selection) is preserved
 *   §7  patch mode: failed getBeapInboxMany does not corrupt store
 *   §8  patch mode: other rows are untouched (page position preserved)
 *   §9  batchClassify: single patch call for all rows (Decision E)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BeapInboxRow, BeapInboxListResponse } from '../../handshake/handshakeRpc'

// ---------------------------------------------------------------------------
// Mock handshakeRpc
// ---------------------------------------------------------------------------

const mockGetBeapInboxMessages = vi.fn<[opts?: { cursor?: string | null }], Promise<BeapInboxListResponse>>()
const mockGetBeapInboxMany = vi.fn<[{ rowIds: readonly string[] }], Promise<{ rows: BeapInboxRow[] }>>()
const mockBeapInboxMarkRead = vi.fn<[string, boolean], Promise<{ rowId: string }>>()
const mockBeapInboxArchive = vi.fn<[string], Promise<{ rowId: string }>>()
const mockBeapInboxUnarchive = vi.fn<[string], Promise<{ rowId: string }>>()
const mockBeapInboxClassify = vi.fn<[string, Record<string, unknown> | null, number | undefined], Promise<{ rowId: string }>>()
const mockBeapInboxSetUrgency = vi.fn<[string, number], Promise<{ rowId: string }>>()

vi.mock('../../handshake/handshakeRpc', () => ({
  getBeapInboxMessages: (...args: any[]) => mockGetBeapInboxMessages(...args),
  getBeapInboxMany: (...args: any[]) => mockGetBeapInboxMany(...args),
  beapInboxMarkRead: (...args: any[]) => mockBeapInboxMarkRead(...args),
  beapInboxArchive: (...args: any[]) => mockBeapInboxArchive(...args),
  beapInboxUnarchive: (...args: any[]) => mockBeapInboxUnarchive(...args),
  beapInboxClassify: (...args: any[]) => mockBeapInboxClassify(...args),
  beapInboxSetUrgency: (...args: any[]) => mockBeapInboxSetUrgency(...args),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(id: string, overrides: Partial<BeapInboxRow> = {}): BeapInboxRow {
  return {
    id,
    handshake_id: null,
    subject: `Subject ${id}`,
    body_text: `Body ${id}`,
    depackaged_json: JSON.stringify({ body: `CanonBody${id}`, transport_plaintext: '' }),
    received_at: 1_000_000,
    read_status: 0,
    archived: 0,
    has_attachments: 0,
    attachment_count: 0,
    ai_analysis_json: null,
    urgency_score: null,
    from_address: 'alice@example.com',
    from_name: 'Alice',
    source_type: 'beap_message',
    attachments: [],
    ...overrides,
  }
}

function mockList(rows: BeapInboxRow[], nextCursor: string | null = null): BeapInboxListResponse {
  return { items: rows, nextCursor }
}

async function getStore() {
  const { useBeapInboxStore } = await import('../useBeapInboxStore')
  useBeapInboxStore.setState({
    messages: new Map(),
    packages: new Map(),
    selectedMessageId: null,
    newMessageIds: new Set(),
    isRefreshing: false,
    nextCursor: null,
  })
  return useBeapInboxStore
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Phase B PR B-8.2 — patch mode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── §1  in-place row updates ─────────────────────────────────────────────────

  describe('§1 patch updates affected rows in place', () => {
    it('§1.1 updates a single row and leaves other rows untouched', async () => {
      const rows = [makeRow('a'), makeRow('b'), makeRow('c')]
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList(rows))
      const store = await getStore()
      await store.getState().refreshFromMain()

      // Patch only 'b'
      mockGetBeapInboxMany.mockResolvedValueOnce({ rows: [makeRow('b', { read_status: 1 })] })
      await store.getState().refreshFromMain({ kind: 'patch', rowIds: ['b'] })

      // 'b' updated
      expect(store.getState().getMessageById('b')?.isRead).toBe(true)
      // 'a' and 'c' untouched
      expect(store.getState().getMessageById('a')?.isRead).toBe(false)
      expect(store.getState().getMessageById('c')?.isRead).toBe(false)
    })

    it('§1.2 store size does not change when patch returns the same number of rows', async () => {
      const rows = [makeRow('a'), makeRow('b')]
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList(rows))
      const store = await getStore()
      await store.getState().refreshFromMain()

      mockGetBeapInboxMany.mockResolvedValueOnce({ rows: [makeRow('b', { read_status: 1 })] })
      await store.getState().refreshFromMain({ kind: 'patch', rowIds: ['b'] })

      expect(store.getState().messages.size).toBe(2)
    })

    it('§1.3 patch calls getBeapInboxMany with the supplied rowIds', async () => {
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('x')]))
      const store = await getStore()
      await store.getState().refreshFromMain()

      mockGetBeapInboxMany.mockResolvedValueOnce({ rows: [makeRow('x')] })
      await store.getState().refreshFromMain({ kind: 'patch', rowIds: ['x'] })

      expect(mockGetBeapInboxMany).toHaveBeenCalledWith({ rowIds: ['x'] })
    })
  })

  // ── §2  missing rows are removed ─────────────────────────────────────────────

  describe('§2 rows missing from getMany response are removed', () => {
    it('§2.1 removes a row when main does not return it (e.g., deleted)', async () => {
      const rows = [makeRow('a'), makeRow('b')]
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList(rows))
      const store = await getStore()
      await store.getState().refreshFromMain()

      // Main returns nothing for 'b' — it was hard-deleted or failed verification
      mockGetBeapInboxMany.mockResolvedValueOnce({ rows: [] })
      await store.getState().refreshFromMain({ kind: 'patch', rowIds: ['b'] })

      expect(store.getState().messages.has('b')).toBe(false)
      // 'a' is untouched
      expect(store.getState().messages.has('a')).toBe(true)
    })

    it('§2.2 store size decreases by the number of removed rows', async () => {
      const rows = [makeRow('a'), makeRow('b'), makeRow('c')]
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList(rows))
      const store = await getStore()
      await store.getState().refreshFromMain()

      // Patch b and c; main returns nothing (both deleted)
      mockGetBeapInboxMany.mockResolvedValueOnce({ rows: [] })
      await store.getState().refreshFromMain({ kind: 'patch', rowIds: ['b', 'c'] })

      expect(store.getState().messages.size).toBe(1)
      expect(store.getState().messages.has('a')).toBe(true)
    })
  })

  // ── §3  Decision D: never adds new rows ──────────────────────────────────────

  describe('§3 patch does NOT add rows not already in the store (Decision D)', () => {
    it('§3.1 row returned by main but not in store is silently ignored', async () => {
      // Load only 'a' into store
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('a')]))
      const store = await getStore()
      await store.getState().refreshFromMain()

      // Patch requests 'far-away' — which main returns — but it's not in the current window
      mockGetBeapInboxMany.mockResolvedValueOnce({
        rows: [makeRow('a'), makeRow('far-away')],
      })
      await store.getState().refreshFromMain({ kind: 'patch', rowIds: ['a', 'far-away'] })

      // 'far-away' must NOT be added
      expect(store.getState().messages.has('far-away')).toBe(false)
      // 'a' is updated normally
      expect(store.getState().messages.has('a')).toBe(true)
      // Store still has exactly 1 row
      expect(store.getState().messages.size).toBe(1)
    })
  })

  // ── §4  multi-row patch with mixed outcomes ───────────────────────────────────

  describe('§4 multi-row patch handles mixed update/remove outcomes', () => {
    it('§4.1 some rows updated, some removed in a single patch call', async () => {
      const rows = [makeRow('a'), makeRow('b'), makeRow('c')]
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList(rows))
      const store = await getStore()
      await store.getState().refreshFromMain()

      // Patch a, b, c: 'a' updated, 'b' removed (not returned), 'c' updated
      mockGetBeapInboxMany.mockResolvedValueOnce({
        rows: [
          makeRow('a', { read_status: 1 }),
          makeRow('c', { archived: 1 }),
        ],
      })
      await store.getState().refreshFromMain({ kind: 'patch', rowIds: ['a', 'b', 'c'] })

      expect(store.getState().getMessageById('a')?.isRead).toBe(true)
      expect(store.getState().messages.has('b')).toBe(false)   // removed
      expect(store.getState().getMessageById('c')?.archived).toBe(true)
      expect(store.getState().messages.size).toBe(2)
    })
  })

  // ── §5  empty rowIds is a no-op ──────────────────────────────────────────────

  describe('§5 empty rowIds patch is a no-op', () => {
    it('§5.1 does not call getBeapInboxMany and does not change store', async () => {
      const rows = [makeRow('a')]
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList(rows))
      const store = await getStore()
      await store.getState().refreshFromMain()

      await store.getState().refreshFromMain({ kind: 'patch', rowIds: [] })

      expect(mockGetBeapInboxMany).not.toHaveBeenCalled()
      expect(store.getState().messages.size).toBe(1)
    })
  })

  // ── §6  local-only UI state preserved ────────────────────────────────────────

  describe('§6 patch preserves local-only UI state (draftReply, deletionScheduled)', () => {
    it('§6.1 draftReply is preserved after patch', async () => {
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('a')]))
      const store = await getStore()
      await store.getState().refreshFromMain()

      // Set a draft reply locally
      store.getState().setDraftReply('a', { content: 'Draft!', mode: 'beap', status: 'draft' })
      expect(store.getState().getMessageById('a')?.draftReply?.content).toBe('Draft!')

      // Patch 'a' — main returns updated row (read_status changed)
      mockGetBeapInboxMany.mockResolvedValueOnce({ rows: [makeRow('a', { read_status: 1 })] })
      await store.getState().refreshFromMain({ kind: 'patch', rowIds: ['a'] })

      // draftReply must still be present after patch
      expect(store.getState().getMessageById('a')?.draftReply?.content).toBe('Draft!')
      // And the main-state update applied
      expect(store.getState().getMessageById('a')?.isRead).toBe(true)
    })

    it('§6.2 deletionScheduled is preserved after patch', async () => {
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('a')]))
      const store = await getStore()
      await store.getState().refreshFromMain()

      store.getState().scheduleDeletion('a', 5000)
      expect(store.getState().getMessageById('a')?.deletionScheduled).toBeDefined()

      mockGetBeapInboxMany.mockResolvedValueOnce({ rows: [makeRow('a', { read_status: 1 })] })
      await store.getState().refreshFromMain({ kind: 'patch', rowIds: ['a'] })

      expect(store.getState().getMessageById('a')?.deletionScheduled).toBeDefined()
    })
  })

  // ── §7  patch failure is non-fatal ───────────────────────────────────────────

  describe('§7 failed getBeapInboxMany does not corrupt store', () => {
    it('§7.1 store is unchanged when getBeapInboxMany throws', async () => {
      const rows = [makeRow('a'), makeRow('b')]
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList(rows))
      const store = await getStore()
      await store.getState().refreshFromMain()

      mockGetBeapInboxMany.mockRejectedValueOnce(new Error('network error'))
      await store.getState().refreshFromMain({ kind: 'patch', rowIds: ['a'] })

      // Store unchanged — both rows still present
      expect(store.getState().messages.size).toBe(2)
      expect(store.getState().getMessageById('a')?.isRead).toBe(false)
    })
  })

  // ── §8  unpatched rows are untouched (page stability) ────────────────────────

  describe('§8 unpatched rows are untouched (page-position stability)', () => {
    it('§8.1 patching row on page 2 does not affect rows on page 1', async () => {
      // Simulate 10 rows loaded; user is on page 2 (rows 5–9)
      const rows = Array.from({ length: 10 }, (_, i) => makeRow(`row${i}`))
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList(rows))
      const store = await getStore()
      await store.getState().refreshFromMain()

      // Patch only row5 (page 2)
      mockGetBeapInboxMany.mockResolvedValueOnce({ rows: [makeRow('row5', { read_status: 1 })] })
      await store.getState().refreshFromMain({ kind: 'patch', rowIds: ['row5'] })

      // All 10 rows still present
      expect(store.getState().messages.size).toBe(10)
      // Rows 0–4 (page 1) untouched
      for (let i = 0; i < 5; i++) {
        expect(store.getState().getMessageById(`row${i}`)?.isRead).toBe(false)
      }
      // row5 updated
      expect(store.getState().getMessageById('row5')?.isRead).toBe(true)
    })
  })

  // ── §9  batchClassify single patch call (Decision E) ─────────────────────────

  describe('§9 batchClassify makes a single patch call for all rows (Decision E)', () => {
    it('§9.1 batch of 3 classifications => one patch with 3 rowIds', async () => {
      const rows = [makeRow('a'), makeRow('b'), makeRow('c')]
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList(rows))
      const store = await getStore()
      await store.getState().refreshFromMain()

      mockBeapInboxClassify.mockResolvedValue({ rowId: 'placeholder' })
      mockBeapInboxClassify
        .mockResolvedValueOnce({ rowId: 'a' })
        .mockResolvedValueOnce({ rowId: 'b' })
        .mockResolvedValueOnce({ rowId: 'c' })
      mockGetBeapInboxMany.mockResolvedValueOnce({
        rows: [
          makeRow('a', { urgency_score: 90 }),
          makeRow('b', { urgency_score: 65 }),
          makeRow('c', { urgency_score: 40 }),
        ],
      })

      const classMap = new Map([
        ['a', { urgency: 'urgent', confidence: 0.9, summary: 'U', suggestedAction: 'R' } as any],
        ['b', { urgency: 'action-required', confidence: 0.8, summary: 'AR', suggestedAction: 'S' } as any],
        ['c', { urgency: 'informational', confidence: 0.7, summary: 'I', suggestedAction: 'N' } as any],
      ])
      await store.getState().batchClassify(['a', 'b', 'c'], classMap)

      // getBeapInboxMany called exactly once with all three ids
      expect(mockGetBeapInboxMany).toHaveBeenCalledTimes(1)
      expect(mockGetBeapInboxMany).toHaveBeenCalledWith({ rowIds: expect.arrayContaining(['a', 'b', 'c']) })
    })

    it('§9.2 partial classification failure: only successful rowIds go into patch', async () => {
      const rows = [makeRow('a'), makeRow('b')]
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList(rows))
      const store = await getStore()
      await store.getState().refreshFromMain()

      // 'a' succeeds; 'b' fails
      mockBeapInboxClassify
        .mockResolvedValueOnce({ rowId: 'a' })
        .mockRejectedValueOnce(new Error('b failed'))
      mockGetBeapInboxMany.mockResolvedValueOnce({ rows: [makeRow('a', { urgency_score: 90 })] })

      const classMap = new Map([
        ['a', { urgency: 'urgent', confidence: 0.9, summary: 'U', suggestedAction: 'R' } as any],
        ['b', { urgency: 'informational', confidence: 0.5, summary: 'I', suggestedAction: 'N' } as any],
      ])
      await store.getState().batchClassify(['a', 'b'], classMap)

      // Patch called only with 'a'
      expect(mockGetBeapInboxMany).toHaveBeenCalledWith({ rowIds: ['a'] })
    })

    it('§9.3 no patch call when all classifications fail', async () => {
      const rows = [makeRow('a')]
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList(rows))
      const store = await getStore()
      await store.getState().refreshFromMain()

      mockBeapInboxClassify.mockRejectedValueOnce(new Error('all fail'))
      mockGetBeapInboxMany.mockResolvedValue({ rows: [] })

      const classMap = new Map([
        ['a', { urgency: 'urgent', confidence: 0.9, summary: 'U', suggestedAction: 'R' } as any],
      ])
      await store.getState().batchClassify(['a'], classMap)

      expect(mockGetBeapInboxMany).not.toHaveBeenCalled()
    })
  })
})
