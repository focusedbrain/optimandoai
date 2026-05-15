/**
 * Phase B, PR B-8.1 — refreshFromMain replace/extend modes + loadMoreFromMain
 *
 *   §1  replace mode — replaces store, sets nextCursor
 *   §2  extend mode  — appends new rows, preserves existing rows, updates nextCursor
 *   §3  loadMoreFromMain — no-op when nextCursor is null, extends when cursor exists
 *   §4  getBulkViewPage — hasMore reflects nextCursor
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { BeapInboxRow, BeapInboxListResponse } from '../../handshake/handshakeRpc'

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const mockGetBeapInboxMessages = vi.fn<
  [opts?: { cursor?: string | null; limit?: number }],
  Promise<BeapInboxListResponse>
>()

vi.mock('../../handshake/handshakeRpc', () => ({
  getBeapInboxMessages: (...args: any[]) => mockGetBeapInboxMessages(...args),
  beapInboxMarkRead: vi.fn().mockResolvedValue(undefined),
  beapInboxArchive: vi.fn().mockResolvedValue(undefined),
  beapInboxUnarchive: vi.fn().mockResolvedValue(undefined),
  beapInboxClassify: vi.fn().mockResolvedValue(undefined),
  beapInboxSetUrgency: vi.fn().mockResolvedValue(undefined),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(id: string, overrides: Partial<BeapInboxRow> = {}): BeapInboxRow {
  return {
    id,
    handshake_id: null,
    subject: `Subject ${id}`,
    body_text: 'Body',
    depackaged_json: JSON.stringify({ body: 'Body', transport_plaintext: '' }),
    received_at: parseInt(id.replace(/\D/g, '') || '0', 10) * 1000 || 1000,
    read_status: 0,
    archived: 0,
    has_attachments: 0,
    attachment_count: 0,
    ai_analysis_json: null,
    urgency_score: null,
    from_address: null,
    from_name: null,
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

describe('Phase B PR B-8.1 — refreshFromMain replace/extend + loadMoreFromMain', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── §1  replace mode ────────────────────────────────────────────────────────

  describe('§1 replace mode (default)', () => {
    it('§1.1 replace clears existing messages and loads new batch', async () => {
      const store = await getStore()

      // First load: row1
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('1')]))
      await store.getState().refreshFromMain({ kind: 'replace' })
      expect(store.getState().messages.size).toBe(1)

      // Replace with different set: row2 only
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('2')]))
      await store.getState().refreshFromMain({ kind: 'replace' })

      expect(store.getState().messages.size).toBe(1)
      expect(store.getState().getMessageById('1')).toBeNull()
      expect(store.getState().getMessageById('2')).not.toBeNull()
    })

    it('§1.2 replace sets nextCursor from response', async () => {
      const store = await getStore()
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('1')], 'cursor-page1'))
      await store.getState().refreshFromMain()

      expect(store.getState().nextCursor).toBe('cursor-page1')
    })

    it('§1.3 replace resets nextCursor to null when response has no more pages', async () => {
      const store = await getStore()
      // Set an existing cursor
      store.setState({ nextCursor: 'old-cursor' })

      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('1')], null))
      await store.getState().refreshFromMain()

      expect(store.getState().nextCursor).toBeNull()
    })

    it('§1.4 replace calls getBeapInboxMessages with cursor = null', async () => {
      const store = await getStore()
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([]))
      await store.getState().refreshFromMain({ kind: 'replace' })

      expect(mockGetBeapInboxMessages).toHaveBeenCalledWith({ cursor: null })
    })
  })

  // ── §2  extend mode ─────────────────────────────────────────────────────────

  describe('§2 extend mode', () => {
    it('§2.1 extend appends new rows to existing store without replacing them', async () => {
      const store = await getStore()

      // First batch
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('1'), makeRow('2')], 'cursor-1'))
      await store.getState().refreshFromMain({ kind: 'replace' })
      expect(store.getState().messages.size).toBe(2)

      // Extend: adds row3
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('3')], null))
      await store.getState().refreshFromMain({ kind: 'extend', cursor: 'cursor-1' })

      expect(store.getState().messages.size).toBe(3)
      expect(store.getState().getMessageById('1')).not.toBeNull()
      expect(store.getState().getMessageById('2')).not.toBeNull()
      expect(store.getState().getMessageById('3')).not.toBeNull()
    })

    it('§2.2 extend does not overwrite an already-loaded row', async () => {
      const store = await getStore()

      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('1')], 'cursor-1'))
      await store.getState().refreshFromMain({ kind: 'replace' })
      // Manually change local UI state
      store.getState().setDraftReply('1', { content: 'draft', mode: 'beap', status: 'draft' })

      // Extend returns row '1' again (overlap) plus row '2'
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('1'), makeRow('2')], null))
      await store.getState().refreshFromMain({ kind: 'extend', cursor: 'cursor-1' })

      // Existing entry for '1' is preserved (draft not overwritten)
      expect(store.getState().getMessageById('1')?.draftReply?.content).toBe('draft')
      expect(store.getState().getMessageById('2')).not.toBeNull()
    })

    it('§2.3 extend updates nextCursor to the new value', async () => {
      const store = await getStore()
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('1')], 'page2-cursor'))
      await store.getState().refreshFromMain({ kind: 'replace' })

      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('2')], 'page3-cursor'))
      await store.getState().refreshFromMain({ kind: 'extend', cursor: 'page2-cursor' })

      expect(store.getState().nextCursor).toBe('page3-cursor')
    })

    it('§2.4 extend sets nextCursor to null on last page', async () => {
      const store = await getStore()
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('1')], 'cursor-1'))
      await store.getState().refreshFromMain({ kind: 'replace' })

      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('2')], null))
      await store.getState().refreshFromMain({ kind: 'extend', cursor: 'cursor-1' })

      expect(store.getState().nextCursor).toBeNull()
    })

    it('§2.5 extend calls getBeapInboxMessages with the provided cursor', async () => {
      const store = await getStore()
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([]))
      await store.getState().refreshFromMain({ kind: 'extend', cursor: 'my-cursor' })

      expect(mockGetBeapInboxMessages).toHaveBeenCalledWith({ cursor: 'my-cursor' })
    })
  })

  // ── §3  loadMoreFromMain ────────────────────────────────────────────────────

  describe('§3 loadMoreFromMain', () => {
    it('§3.1 is a no-op when nextCursor is null', async () => {
      const store = await getStore()
      store.setState({ nextCursor: null })

      await store.getState().loadMoreFromMain()

      expect(mockGetBeapInboxMessages).not.toHaveBeenCalled()
    })

    it('§3.2 calls extend mode with the current nextCursor', async () => {
      const store = await getStore()
      store.setState({ nextCursor: 'cursor-abc' })

      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('99')], null))
      await store.getState().loadMoreFromMain()

      expect(mockGetBeapInboxMessages).toHaveBeenCalledWith({ cursor: 'cursor-abc' })
      expect(store.getState().getMessageById('99')).not.toBeNull()
    })

    it('§3.3 updates nextCursor after loading more', async () => {
      const store = await getStore()
      store.setState({ nextCursor: 'page2' })

      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('x')], 'page3'))
      await store.getState().loadMoreFromMain()

      expect(store.getState().nextCursor).toBe('page3')
    })

    it('§3.4 does not replace existing rows', async () => {
      const store = await getStore()

      // Pre-load row '1' in the store
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('1')], 'cursor-1'))
      await store.getState().refreshFromMain({ kind: 'replace' })
      expect(store.getState().messages.size).toBe(1)

      // loadMoreFromMain should ADD row '2'
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('2')], null))
      await store.getState().loadMoreFromMain()

      expect(store.getState().messages.size).toBe(2)
      expect(store.getState().getMessageById('1')).not.toBeNull()
    })
  })

  // ── §4  getBulkViewPage hasMore ─────────────────────────────────────────────

  describe('§4 getBulkViewPage hasMore field', () => {
    it('§4.1 hasMore is false when nextCursor is null', async () => {
      const store = await getStore()
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('1')], null))
      await store.getState().refreshFromMain()

      const page = store.getState().getBulkViewPage(12, 0)
      expect(page.hasMore).toBe(false)
    })

    it('§4.2 hasMore is true when nextCursor is set', async () => {
      const store = await getStore()
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('1')], 'cursor-xyz'))
      await store.getState().refreshFromMain()

      const page = store.getState().getBulkViewPage(12, 0)
      expect(page.hasMore).toBe(true)
    })

    it('§4.3 hasMore transitions to false after loadMoreFromMain reaches end', async () => {
      const store = await getStore()
      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('1')], 'c1'))
      await store.getState().refreshFromMain()
      expect(store.getState().getBulkViewPage(12, 0).hasMore).toBe(true)

      mockGetBeapInboxMessages.mockResolvedValueOnce(mockList([makeRow('2')], null))
      await store.getState().loadMoreFromMain()
      expect(store.getState().getBulkViewPage(12, 0).hasMore).toBe(false)
    })
  })
})
