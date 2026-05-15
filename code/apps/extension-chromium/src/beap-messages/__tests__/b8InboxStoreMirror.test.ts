/**
 * Phase B, PR B-8 — Renderer Store Read-Only Mirror tests
 *
 * Verifies that useBeapInboxStore is a read-only mirror of main-process
 * sealed storage with the following properties:
 *
 *   §1  refreshFromMain() — populates store from main's sealed rows
 *   §2  cachePackage()    — in-memory package cache (not replaced on refresh)
 *   §3  IPC-wrapper mutators — call main before updating store
 *   §4  Mutators do not update store on IPC failure
 *   §5  UI-local state    — selectMessage / setDraftReply stay renderer-local
 *   §6  inboxRowToBeapMessage — field mapping
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { BeapInboxRow, BeapInboxListResponse } from '../../handshake/handshakeRpc'
import { inboxRowToBeapMessage } from '../inboxRowToBeapMessage'

// ---------------------------------------------------------------------------
// Stubs for handshakeRpc IPC functions
// ---------------------------------------------------------------------------

// Phase B, PR B-8.1: getBeapInboxMessages now returns BeapInboxListResponse
const mockGetBeapInboxMessages = vi.fn<[opts?: { cursor?: string | null; limit?: number }], Promise<BeapInboxListResponse>>()
// Phase B, PR B-8.2: mutation functions now return { rowId: string }; getBeapInboxMany added
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

function makeRow(overrides: Partial<BeapInboxRow> = {}): BeapInboxRow {
  return {
    id: 'msg1',
    handshake_id: 'hs1',
    subject: 'Hello',
    body_text: 'Body',
    depackaged_json: JSON.stringify({ body: 'CanonBody', transport_plaintext: 'Transport' }),
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** Wrap rows in the B-8.1 response envelope with a null nextCursor (no more pages). */
function mockList(rows: BeapInboxRow[], nextCursor: string | null = null): BeapInboxListResponse {
  return { items: rows, nextCursor }
}

// Import the store after mocks are set up
async function getStore() {
  const { useBeapInboxStore } = await import('../useBeapInboxStore')
  // Reset state between tests
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

describe('Phase B PR B-8 — useBeapInboxStore read-only mirror', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // ── §1  refreshFromMain ─────────────────────────────────────────────────────

  describe('§1 refreshFromMain', () => {
    it('§1.1 populates messages from main sealed rows', async () => {
      const row = makeRow()
      mockGetBeapInboxMessages.mockResolvedValue(mockList([row]))

      const store = await getStore()
      await store.getState().refreshFromMain()

      const msg = store.getState().getMessageById('msg1')
      expect(msg).not.toBeNull()
      expect(msg?.handshakeId).toBe('hs1')
    })

    it('§1.2 replaces existing messages (full mirror)', async () => {
      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow()]))
      const store = await getStore()
      await store.getState().refreshFromMain()
      expect(store.getState().messages.size).toBe(1)

      // Second refresh with different row
      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow({ id: 'msg2', handshake_id: 'hs2' })]))
      await store.getState().refreshFromMain()
      expect(store.getState().messages.size).toBe(1)
      expect(store.getState().getMessageById('msg1')).toBeNull()
      expect(store.getState().getMessageById('msg2')).not.toBeNull()
    })

    it('§1.3 does not replace packages cache on refresh', async () => {
      const store = await getStore()
      const fakePkg = { header: { content_hash: 'msg1' } } as any
      store.getState().cachePackage(fakePkg, null)

      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow()]))
      await store.getState().refreshFromMain()

      expect(store.getState().getPackageForMessage('msg1')).not.toBeNull()
    })

    it('§1.4 handles IPC failure gracefully (does not throw)', async () => {
      mockGetBeapInboxMessages.mockRejectedValue(new Error('vault locked'))
      const store = await getStore()
      await expect(store.getState().refreshFromMain()).resolves.not.toThrow()
    })

    it('§1.5 preserves draft reply across refresh', async () => {
      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow()]))
      const store = await getStore()
      await store.getState().refreshFromMain()

      store.getState().setDraftReply('msg1', { content: 'draft text', mode: 'beap', status: 'draft' })

      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow()]))
      await store.getState().refreshFromMain()

      const msg = store.getState().getMessageById('msg1')
      expect(msg?.draftReply?.content).toBe('draft text')
    })

    it('§1.6 sets nextCursor from response', async () => {
      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow()], 'cursor-abc'))
      const store = await getStore()
      await store.getState().refreshFromMain()
      expect(store.getState().nextCursor).toBe('cursor-abc')
    })

    it('§1.7 clears nextCursor when response has no more rows', async () => {
      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow()], 'old-cursor'))
      const store = await getStore()
      await store.getState().refreshFromMain()

      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow()], null))
      await store.getState().refreshFromMain()
      expect(store.getState().nextCursor).toBeNull()
    })
  })

  // ── §2  cachePackage ────────────────────────────────────────────────────────

  describe('§2 cachePackage', () => {
    it('§2.1 stores package keyed by content_hash prefix', async () => {
      const store = await getStore()
      const fakePkg = { header: { content_hash: 'abcdef0123456789extra' } } as any
      store.getState().cachePackage(fakePkg, 'hs1')
      const cached = store.getState().getPackageForMessage('abcdef0123456789')
      expect(cached).toBe(fakePkg)
    })

    it('§2.2 marks message as "new" briefly (newMessageIds set)', async () => {
      const store = await getStore()
      const fakePkg = { header: { content_hash: 'newhash' } } as any
      store.getState().cachePackage(fakePkg, null)
      expect(store.getState().isNewMessage('newhash')).toBe(true)
    })
  })

  // ── §3  IPC-wrapper mutators succeed — patch mode (B-8.2) ────────────────────

  describe('§3 IPC-wrapper mutators update store via patch mode (B-8.2)', () => {
    it('§3.1 markAsRead sends IPC then patches the affected row', async () => {
      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow()]))
      const store = await getStore()
      await store.getState().refreshFromMain()

      mockBeapInboxMarkRead.mockResolvedValue({ rowId: 'msg1' })
      mockGetBeapInboxMany.mockResolvedValue({ rows: [makeRow({ read_status: 1 })] })
      const result = await store.getState().markAsRead('msg1', true)

      expect(result.ok).toBe(true)
      expect(mockBeapInboxMarkRead).toHaveBeenCalledWith('msg1', true)
      expect(mockGetBeapInboxMany).toHaveBeenCalledWith({ rowIds: ['msg1'] })
      expect(store.getState().getMessageById('msg1')?.isRead).toBe(true)
    })

    it('§3.2 archiveMessage sends IPC then patches — archived becomes true', async () => {
      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow()]))
      const store = await getStore()
      await store.getState().refreshFromMain()

      mockBeapInboxArchive.mockResolvedValue({ rowId: 'msg1' })
      mockGetBeapInboxMany.mockResolvedValue({ rows: [makeRow({ archived: 1 })] })
      const result = await store.getState().archiveMessage('msg1')

      expect(result.ok).toBe(true)
      expect(store.getState().getMessageById('msg1')?.archived).toBe(true)
    })

    it('§3.3 unarchiveMessage sends IPC then patches — archived becomes false', async () => {
      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow({ archived: 1 })]))
      const store = await getStore()
      await store.getState().refreshFromMain()

      mockBeapInboxUnarchive.mockResolvedValue({ rowId: 'msg1' })
      mockGetBeapInboxMany.mockResolvedValue({ rows: [makeRow({ archived: 0 })] })
      await store.getState().unarchiveMessage('msg1')

      expect(store.getState().getMessageById('msg1')?.archived).toBe(false)
    })

    it('§3.4 batchClassify calls classify per message then patches all at once', async () => {
      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow()]))
      const store = await getStore()
      await store.getState().refreshFromMain()

      mockBeapInboxClassify.mockResolvedValue({ rowId: 'msg1' })
      mockGetBeapInboxMany.mockResolvedValue({
        rows: [makeRow({ urgency_score: 90 })],
      })
      const classMap = new Map([['msg1', { urgency: 'urgent', confidence: 0.9, summary: 'Urgent', suggestedAction: 'Reply' } as any]])
      await store.getState().batchClassify(['msg1'], classMap)

      expect(mockBeapInboxClassify).toHaveBeenCalledWith(
        'msg1',
        expect.objectContaining({ urgency: 'urgent' }),
        90, // urgencyToScore('urgent')
      )
      // Single patch call for all classified rows
      expect(mockGetBeapInboxMany).toHaveBeenCalledWith({ rowIds: ['msg1'] })
    })

    it('§3.5 setUrgency calls beapInboxSetUrgency and patches the row', async () => {
      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow()]))
      const store = await getStore()
      await store.getState().refreshFromMain()

      mockBeapInboxSetUrgency.mockResolvedValue({ rowId: 'msg1' })
      mockGetBeapInboxMany.mockResolvedValue({ rows: [makeRow({ urgency_score: 65 })] })
      const result = await store.getState().setUrgency('msg1', 'action-required')

      expect(result.ok).toBe(true)
      expect(mockBeapInboxSetUrgency).toHaveBeenCalledWith('msg1', 65) // urgencyToScore('action-required')
      expect(store.getState().getMessageById('msg1')?.urgency).toBe('action-required')
    })
  })

  // ── §4  IPC-wrapper mutators fail ────────────────────────────────────────────

  describe('§4 IPC-wrapper mutators do not update store on IPC failure', () => {
    it('§4.1 markAsRead returns { ok: false } when IPC throws; no patch called', async () => {
      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow()]))
      const store = await getStore()
      await store.getState().refreshFromMain()

      mockBeapInboxMarkRead.mockRejectedValue(new Error('vault locked'))
      const result = await store.getState().markAsRead('msg1')

      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/vault locked/)
      expect(mockGetBeapInboxMany).not.toHaveBeenCalled()
    })

    it('§4.2 archiveMessage returns { ok: false } and leaves archived = false on IPC failure', async () => {
      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow({ archived: 0 })]))
      const store = await getStore()
      await store.getState().refreshFromMain()

      mockBeapInboxArchive.mockRejectedValue(new Error('network'))
      const result = await store.getState().archiveMessage('msg1')

      expect(result.ok).toBe(false)
      expect(store.getState().getMessageById('msg1')?.archived).toBe(false)
      expect(mockGetBeapInboxMany).not.toHaveBeenCalled()
    })
  })

  // ── §5  UI-local state ──────────────────────────────────────────────────────

  describe('§5 UI-local state stays renderer-local', () => {
    it('§5.1 selectMessage does not trigger IPC', async () => {
      const store = await getStore()
      store.getState().selectMessage('msg1')
      expect(store.getState().selectedMessageId).toBe('msg1')
      expect(mockBeapInboxMarkRead).not.toHaveBeenCalled()
    })

    it('§5.2 setDraftReply does not trigger IPC', async () => {
      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow()]))
      const store = await getStore()
      await store.getState().refreshFromMain()

      store.getState().setDraftReply('msg1', { content: 'Hi', mode: 'beap', status: 'draft' })
      expect(store.getState().getMessageById('msg1')?.draftReply?.content).toBe('Hi')
      expect(mockBeapInboxMarkRead).not.toHaveBeenCalled()
    })

    it('§5.3 scheduleDeletion is local-only', async () => {
      mockGetBeapInboxMessages.mockResolvedValue(mockList([makeRow()]))
      const store = await getStore()
      await store.getState().refreshFromMain()

      store.getState().scheduleDeletion('msg1', 60_000)
      expect(store.getState().getMessageById('msg1')?.deletionScheduled?.gracePeriodMs).toBe(60_000)
    })
  })

  // ── §6  inboxRowToBeapMessage mapping ───────────────────────────────────────

  describe('§6 inboxRowToBeapMessage', () => {
    it('§6.1 maps basic fields correctly', () => {
      const row = makeRow()
      const msg = inboxRowToBeapMessage(row)

      expect(msg.messageId).toBe('msg1')
      expect(msg.handshakeId).toBe('hs1')
      expect(msg.senderEmail).toBe('alice@example.com')
      expect(msg.senderDisplayName).toBe('Alice')
      expect(msg.isRead).toBe(false)
      expect(msg.archived).toBe(false)
    })

    it('§6.2 maps urgency_score to UrgencyLevel', () => {
      expect(inboxRowToBeapMessage(makeRow({ urgency_score: 90 })).urgency).toBe('urgent')
      expect(inboxRowToBeapMessage(makeRow({ urgency_score: 65 })).urgency).toBe('action-required')
      expect(inboxRowToBeapMessage(makeRow({ urgency_score: 40 })).urgency).toBe('normal')
      expect(inboxRowToBeapMessage(makeRow({ urgency_score: 5 })).urgency).toBe('irrelevant')
      expect(inboxRowToBeapMessage(makeRow({ urgency_score: null })).urgency).toBe('normal')
    })

    it('§6.3 parses ai_analysis_json into aiClassification', () => {
      const row = makeRow({
        ai_analysis_json: JSON.stringify({
          urgency: 'urgent',
          confidence: 0.92,
          summary: 'Critical issue',
          suggestedAction: 'Reply immediately',
        }),
      })
      const msg = inboxRowToBeapMessage(row)
      expect(msg.aiClassification?.urgency).toBe('urgent')
      expect(msg.aiClassification?.confidence).toBe(0.92)
      expect(msg.aiClassification?.summary).toBe('Critical issue')
    })

    it('§6.4 extracts canonicalContent and messageBody from depackaged_json', () => {
      const row = makeRow({
        depackaged_json: JSON.stringify({
          body: 'InnerBody',
          transport_plaintext: 'TransportText',
        }),
      })
      const msg = inboxRowToBeapMessage(row)
      expect(msg.canonicalContent).toBe('InnerBody')
      expect(msg.messageBody).toBe('TransportText')
    })

    it('§6.5 maps attachments from row', () => {
      const row = makeRow({
        attachments: [
          { attachment_id: 'att1', filename: 'doc.pdf', mime_type: 'application/pdf', size_bytes: 9999, content_sha256: 'sha' },
        ],
      })
      const msg = inboxRowToBeapMessage(row)
      expect(msg.attachments).toHaveLength(1)
      expect(msg.attachments[0].attachmentId).toBe('att1')
      expect(msg.attachments[0].filename).toBe('doc.pdf')
      expect(msg.attachments[0].selected).toBe(false)
    })

    it('§6.6 marks read_status = 1 as isRead = true', () => {
      const msg = inboxRowToBeapMessage(makeRow({ read_status: 1 }))
      expect(msg.isRead).toBe(true)
    })

    it('§6.7 marks archived = 1 as archived = true', () => {
      const msg = inboxRowToBeapMessage(makeRow({ archived: 1 }))
      expect(msg.archived).toBe(true)
    })
  })
})
