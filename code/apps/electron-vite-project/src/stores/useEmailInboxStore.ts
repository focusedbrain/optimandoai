/**
 * useEmailInboxStore
 *
 * Zustand store for the email inbox UI state (inbox_messages from Electron).
 * Calls window.emailInbox IPC bridge. Matches useBeapInboxStore pattern.
 *
 * @version 1.0.0
 */

import { create } from 'zustand'
import type { AiOutputs } from '../types/inboxAi'
import '../components/handshakeViewTypes'

// =============================================================================
// Types
// =============================================================================

export type InboxSourceType = 'direct_beap' | 'email_beap' | 'email_plain'

export interface InboxAttachment {
  id: string
  message_id: string
  filename: string
  content_type: string | null
  size_bytes: number | null
  content_id: string | null
  storage_path: string | null
  extracted_text: string | null
  text_extraction_status: string | null
  raster_path: string | null
}

export interface InboxMessage {
  id: string
  source_type: InboxSourceType
  handshake_id: string | null
  account_id: string | null
  email_message_id: string | null
  from_address: string | null
  from_name: string | null
  to_addresses: string | null
  cc_addresses: string | null
  subject: string | null
  body_text: string | null
  body_html: string | null
  beap_package_json: string | null
  depackaged_json: string | null
  has_attachments: number
  attachment_count: number
  received_at: string
  ingested_at: string
  read_status: number
  starred: number
  archived: number
  deleted: number
  deleted_at: string | null
  purge_after: string | null
  remote_deleted: number | null
  sort_category: string | null
  sort_reason: string | null
  urgency_score: number | null
  needs_reply: number | null
  pending_delete: number
  pending_delete_at: string | null
  ai_summary: string | null
  ai_draft_response: string | null
  attachments?: InboxAttachment[]
}

export interface InboxFilter {
  filter: 'all' | 'unread' | 'starred' | 'deleted' | 'archived' | 'pending_delete'
  sourceType: InboxSourceType | 'all'
  handshakeId?: string
  category?: string
  search?: string
}

// =============================================================================
// Store Interface
// =============================================================================

interface EmailInboxState {
  messages: InboxMessage[]
  total: number
  loading: boolean
  error: string | null
  selectedMessageId: string | null
  selectedMessage: InboxMessage | null
  selectedAttachmentId: string | null
  multiSelectIds: Set<string>
  filter: InboxFilter
  bulkMode: boolean
  bulkPage: number
  bulkBatchSize: number
  bulkCompactMode: boolean
  bulkAiOutputs: AiOutputs
  /** messageId -> expiresAt ISO. Survives view switch. */
  pendingDeletePreviewExpiries: Record<string, string>
  /** messageId -> expiresAt ISO for archive grace. Survives view switch. */
  archivePreviewExpiries: Record<string, string>
  /** IDs user chose to keep during preview. Survives view switch. */
  keptDuringPreviewIds: Set<string>
  /** IDs user chose to keep during archive preview. Survives view switch. */
  keptDuringArchivePreviewIds: Set<string>
  /** Toast shown after move; Undo clears it. */
  pendingDeleteToast: { count: number; ids: string[] } | null
  /** Recent undoable batches (max 5) — supports recovery when multiple actions happen quickly. */
  recentPendingDeleteBatches: Array<{ count: number; ids: string[] }>
  /** Incremented every second when previews exist; drives live countdown. */
  countdownTick: number
  /** Session counters: reset when bulk mode exits. */
  bulkSessionArchived: number
  bulkSessionPendingDelete: number
  autoSyncEnabled: boolean
  syncing: boolean
  lastSyncAt: string | null

  fetchMessages: () => Promise<void>
  selectMessage: (id: string | null) => Promise<void>
  selectAttachment: (id: string | null) => void
  toggleMultiSelect: (id: string) => void
  clearMultiSelect: () => void
  setFilter: (partial: Partial<InboxFilter>) => void
  setBulkMode: (enabled: boolean) => void
  setBulkPage: (page: number) => void
  setBulkBatchSize: (size: number) => void
  setBulkCompactMode: (enabled: boolean) => void
  syncBulkBatchSizeFromSettings: () => Promise<void>
  setBulkAiOutputs: (updater: (prev: AiOutputs) => AiOutputs) => void
  clearBulkAiOutputsForIds: (ids: string[]) => void
  addPendingDeletePreview: (ids: string[]) => void
  addArchivePreview: (ids: string[]) => void
  keepDuringPreview: (id: string) => void
  keepDuringArchivePreview: (id: string) => void
  setPendingDeleteToast: (toast: { count: number; ids: string[] } | null) => void
  /** Remove a batch from recent list after Undo. */
  removeRecentPendingDeleteBatch: (ids: string[]) => void
  /** Decrement session pending-delete count when Undo restores messages. */
  decrementBulkSessionPendingDelete: (count: number) => void
  /** Fully reset pending-delete state for ids after Undo. Clears preview, grace-period, and AI output flags. */
  clearPendingDeleteStateForIds: (ids: string[]) => void
  incrementCountdownTick: () => void
  processExpiredPendingDeletes: () => Promise<void>
  processExpiredArchivePreviews: () => Promise<void>
  markRead: (ids: string[], read: boolean) => Promise<void>
  toggleStar: (id: string) => Promise<void>
  archiveMessages: (ids: string[]) => Promise<void>
  deleteMessages: (ids: string[], gracePeriodHours?: number) => Promise<void>
  cancelDeletion: (id: string) => Promise<void>
  setCategory: (ids: string[], category: string) => Promise<void>
  syncAccount: (accountId: string) => Promise<void>
  toggleAutoSync: (accountId: string, enabled: boolean) => Promise<void>
  /** Load autoSyncEnabled from backend for the given account. Call when Inbox view mounts. */
  loadSyncState: (accountId: string) => Promise<void>
}

// =============================================================================
// Helpers
// =============================================================================

function getBridge() {
  return typeof window !== 'undefined' ? window.emailInbox : undefined
}

const DEFAULT_FILTER: InboxFilter = {
  filter: 'all',
  sourceType: 'all',
}

// Auto-hide for pending-delete toast: 5 seconds
const PENDING_DELETE_TOAST_VISIBILITY_MS = 5000
const RECENT_PENDING_DELETE_MAX = 5

let pendingDeleteToastTimeoutId: ReturnType<typeof setTimeout> | null = null

// =============================================================================
// Store Implementation
// =============================================================================

export const useEmailInboxStore = create<EmailInboxState>((set, get) => ({
  messages: [],
  total: 0,
  loading: false,
  error: null,
  selectedMessageId: null,
  selectedMessage: null,
  selectedAttachmentId: null,
  multiSelectIds: new Set(),
  filter: DEFAULT_FILTER,
  bulkMode: false,
  bulkPage: 0,
  bulkAiOutputs: {},
  pendingDeletePreviewExpiries: {},
  archivePreviewExpiries: {},
  keptDuringPreviewIds: new Set(),
  keptDuringArchivePreviewIds: new Set(),
  pendingDeleteToast: null,
  recentPendingDeleteBatches: [],
  countdownTick: 0,
  bulkSessionArchived: 0,
  bulkSessionPendingDelete: 0,
  bulkCompactMode: (() => {
    try {
      return localStorage?.getItem('wrdesk_bulkCompactMode') === '1'
    } catch {
      return false
    }
  })(),
  bulkBatchSize: (() => {
    try {
      const s = localStorage?.getItem('wrdesk_bulkBatchSize')
      const n = s ? parseInt(s, 10) : 10
      return [10, 12, 24, 48].includes(n) ? n : 10
    } catch {
      return 10
    }
  })(),
  autoSyncEnabled: false,
  syncing: false,
  lastSyncAt: null,

  fetchMessages: async () => {
    const bridge = getBridge()
    if (!bridge?.listMessages) {
      set({ error: 'Email inbox bridge not available' })
      return
    }
    set({ loading: true, error: null })
    try {
      const { filter, bulkMode, bulkPage, bulkBatchSize } = get()
      const options: Parameters<typeof bridge.listMessages>[0] = {
        filter: filter.filter,
        sourceType: filter.sourceType === 'all' ? undefined : filter.sourceType,
        handshakeId: filter.handshakeId,
        category: filter.category,
        search: filter.search,
      }
      if (bulkMode) {
        options.limit = bulkBatchSize
        options.offset = bulkPage * bulkBatchSize
      } else {
        options.limit = 50
        options.offset = 0
      }
      const res = await bridge.listMessages(options)
      if (res.ok && res.data) {
        set({
          messages: (res.data.messages ?? []) as InboxMessage[],
          total: res.data.total ?? 0,
          loading: false,
          error: null,
        })
      } else {
        set({
          loading: false,
          error: res.error ?? 'Failed to fetch messages',
        })
      }
    } catch (err: unknown) {
      set({
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to fetch messages',
      })
    }
  },

  selectMessage: async (id) => {
    if (!id) {
      set({ selectedMessageId: null, selectedMessage: null, selectedAttachmentId: null })
      return
    }
    const bridge = getBridge()
    if (!bridge?.getMessage) {
      set({ selectedMessageId: id, selectedMessage: null })
      return
    }
    set({ selectedAttachmentId: null })
    try {
      const res = await bridge.getMessage(id)
      if (res.ok && res.data) {
        const msg = res.data as InboxMessage
        set({ selectedMessageId: id, selectedMessage: msg })
        set((state) => {
          const idx = state.messages.findIndex((m) => m.id === id)
          if (idx < 0 || state.messages[idx].read_status === 1) return {}
          const next = [...state.messages]
          next[idx] = { ...next[idx], read_status: 1 }
          return { messages: next }
        })
      } else {
        set({ selectedMessageId: id, selectedMessage: null })
      }
    } catch {
      set({ selectedMessageId: id, selectedMessage: null })
    }
  },

  selectAttachment: (id) => {
    set({ selectedAttachmentId: id })
  },

  toggleMultiSelect: (id) => {
    set((state) => {
      const next = new Set(state.multiSelectIds)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return { multiSelectIds: next }
    })
  },

  clearMultiSelect: () => {
    set({ multiSelectIds: new Set() })
  },

  setFilter: (partial) => {
    set((state) => ({
      filter: { ...state.filter, ...partial },
    }))
    get().fetchMessages()
  },

  setBulkMode: (enabled) => {
    set({
      bulkMode: enabled,
      bulkPage: 0,
      ...(enabled ? {} : { bulkSessionArchived: 0, bulkSessionPendingDelete: 0 }),
    })
    get().fetchMessages()
  },

  setBulkPage: (page) => {
    set({ bulkPage: page })
    get().fetchMessages()
  },

  setBulkBatchSize: (size) => {
    if (![10, 12, 24, 48].includes(size)) return
    set({ bulkBatchSize: size, bulkPage: 0 })
    try {
      localStorage?.setItem('wrdesk_bulkBatchSize', String(size))
      const bridge = getBridge()
      if (bridge?.setInboxSettings) bridge.setInboxSettings({ batchSize: size })
    } catch {
      /* ignore */
    }
    get().fetchMessages()
  },

  setBulkCompactMode: (enabled) => {
    set({ bulkCompactMode: enabled })
    try {
      localStorage?.setItem('wrdesk_bulkCompactMode', enabled ? '1' : '0')
    } catch {
      /* ignore */
    }
  },

  setBulkAiOutputs: (updater) => {
    set((state) => ({ bulkAiOutputs: updater(state.bulkAiOutputs) }))
  },

  clearBulkAiOutputsForIds: (ids) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    set((state) => {
      const next = { ...state.bulkAiOutputs }
      for (const id of idSet) delete next[id]
      return { bulkAiOutputs: next }
    })
  },

  addPendingDeletePreview: (ids) => {
    if (ids.length === 0) return
    const expiresAt = new Date(Date.now() + 5 * 1000).toISOString()
    set((state) => {
      const next = { ...state.pendingDeletePreviewExpiries }
      for (const id of ids) next[id] = expiresAt
      const kept = new Set(state.keptDuringPreviewIds)
      for (const id of ids) kept.delete(id)
      return { pendingDeletePreviewExpiries: next, keptDuringPreviewIds: kept }
    })
  },

  addArchivePreview: (ids) => {
    if (ids.length === 0) return
    const expiresAt = new Date(Date.now() + 5 * 1000).toISOString()
    set((state) => {
      const next = { ...state.archivePreviewExpiries }
      for (const id of ids) next[id] = expiresAt
      const kept = new Set(state.keptDuringArchivePreviewIds)
      for (const id of ids) kept.delete(id)
      return { archivePreviewExpiries: next, keptDuringArchivePreviewIds: kept }
    })
  },

  keepDuringPreview: (id) => {
    set((state) => ({
      keptDuringPreviewIds: new Set([...state.keptDuringPreviewIds, id]),
    }))
  },

  keepDuringArchivePreview: (id) => {
    set((state) => ({
      keptDuringArchivePreviewIds: new Set([...state.keptDuringArchivePreviewIds, id]),
    }))
  },

  setPendingDeleteToast: (toast) => {
    if (pendingDeleteToastTimeoutId) {
      clearTimeout(pendingDeleteToastTimeoutId)
      pendingDeleteToastTimeoutId = null
    }
    const state = get()
    if (state.pendingDeleteToast) {
      set((s) => ({
        recentPendingDeleteBatches: [
          ...s.recentPendingDeleteBatches,
          { count: state.pendingDeleteToast!.count, ids: state.pendingDeleteToast!.ids },
        ].slice(-RECENT_PENDING_DELETE_MAX),
      }))
    }
    set({ pendingDeleteToast: toast })
    if (toast) {
      pendingDeleteToastTimeoutId = setTimeout(() => {
        pendingDeleteToastTimeoutId = null
        const current = get().pendingDeleteToast
        if (current) {
          set((s) => ({
            pendingDeleteToast: null,
            recentPendingDeleteBatches: [
              ...s.recentPendingDeleteBatches,
              { count: current.count, ids: current.ids },
            ].slice(-RECENT_PENDING_DELETE_MAX),
          }))
        } else {
          set({ pendingDeleteToast: null })
        }
      }, PENDING_DELETE_TOAST_VISIBILITY_MS)
    }
  },

  removeRecentPendingDeleteBatch: (ids) => {
    const idSet = new Set(ids)
    set((s) => ({
      recentPendingDeleteBatches: s.recentPendingDeleteBatches.filter(
        (b) => !(b.ids.length === ids.length && b.ids.every((id) => idSet.has(id)))
      ),
    }))
  },

  decrementBulkSessionPendingDelete: (count) => {
    set((s) => ({ bulkSessionPendingDelete: Math.max(0, s.bulkSessionPendingDelete - count) }))
  },

  clearPendingDeleteStateForIds: (ids) => {
    if (ids.length === 0) return
    const idSet = new Set(ids)
    set((state) => {
      const nextExpiries = { ...state.pendingDeletePreviewExpiries }
      const nextArchiveExpiries = { ...state.archivePreviewExpiries }
      const nextKept = new Set(state.keptDuringPreviewIds)
      const nextArchiveKept = new Set(state.keptDuringArchivePreviewIds)
      const nextOutputs = { ...state.bulkAiOutputs }
      for (const id of idSet) {
        delete nextExpiries[id]
        delete nextArchiveExpiries[id]
        nextKept.delete(id)
        nextArchiveKept.delete(id)
        if (nextOutputs[id]) {
          const entry = { ...nextOutputs[id] }
          delete entry.pendingDeletePreviewUntil
          delete entry.archivePreviewUntil
          if (entry.recommendedAction === 'pending_delete') {
            entry.recommendedAction = 'keep_for_manual_action'
          }
          nextOutputs[id] = entry
        }
      }
      const nextMessages = state.messages.map((m) =>
        idSet.has(m.id) ? { ...m, pending_delete: 0, pending_delete_at: null } : m
      )
      const nextSelected =
        state.selectedMessage && idSet.has(state.selectedMessage.id)
          ? { ...state.selectedMessage, pending_delete: 0, pending_delete_at: null }
          : state.selectedMessage
      return {
        pendingDeletePreviewExpiries: nextExpiries,
        archivePreviewExpiries: nextArchiveExpiries,
        keptDuringPreviewIds: nextKept,
        keptDuringArchivePreviewIds: nextArchiveKept,
        bulkAiOutputs: nextOutputs,
        messages: nextMessages,
        selectedMessage: nextSelected,
      }
    })
  },

  incrementCountdownTick: () => {
    set((s) => ({ countdownTick: s.countdownTick + 1 }))
  },

  processExpiredPendingDeletes: async () => {
    const bridge = getBridge()
    if (!bridge?.markPendingDelete) return
    const state = get()
    const now = Date.now()
    const expired: string[] = []
    for (const [id, expiresAt] of Object.entries(state.pendingDeletePreviewExpiries)) {
      if (new Date(expiresAt).getTime() <= now) expired.push(id)
    }
    if (expired.length === 0) return
    const idsToMove = expired.filter((id) => !state.keptDuringPreviewIds.has(id))
    set((s) => {
      const nextExpiries = { ...s.pendingDeletePreviewExpiries }
      const nextKept = new Set(s.keptDuringPreviewIds)
      for (const id of expired) {
        delete nextExpiries[id]
        nextKept.delete(id)
      }
      return { pendingDeletePreviewExpiries: nextExpiries, keptDuringPreviewIds: nextKept }
    })
    if (idsToMove.length === 0) return
    const res = await bridge.markPendingDelete(idsToMove)
    if (res.ok) {
      set((s) => {
        const next = { ...s.bulkAiOutputs }
        for (const id of idsToMove) {
          if (next[id]) next[id] = { ...next[id], status: 'action_taken' as const }
        }
        return { bulkAiOutputs: next, bulkSessionPendingDelete: s.bulkSessionPendingDelete + idsToMove.length }
      })
      get().setPendingDeleteToast({ count: idsToMove.length, ids: idsToMove })
      get().fetchMessages()
    }
  },

  processExpiredArchivePreviews: async () => {
    const bridge = getBridge()
    if (!bridge?.archiveMessages) return
    const state = get()
    const now = Date.now()
    const expired: string[] = []
    for (const [id, expiresAt] of Object.entries(state.archivePreviewExpiries)) {
      if (new Date(expiresAt).getTime() <= now) expired.push(id)
    }
    if (expired.length === 0) return
    const idsToArchive = expired.filter((id) => !state.keptDuringArchivePreviewIds.has(id))
    set((s) => {
      const nextExpiries = { ...s.archivePreviewExpiries }
      const nextKept = new Set(s.keptDuringArchivePreviewIds)
      for (const id of expired) {
        delete nextExpiries[id]
        nextKept.delete(id)
      }
      return { archivePreviewExpiries: nextExpiries, keptDuringArchivePreviewIds: nextKept }
    })
    if (idsToArchive.length === 0) return
    const res = await bridge.archiveMessages(idsToArchive)
    if (res.ok) {
      set((s) => {
        const next = { ...s.bulkAiOutputs }
        for (const id of idsToArchive) {
          if (next[id]) next[id] = { ...next[id], status: 'action_taken' as const }
        }
        return { bulkAiOutputs: next, bulkSessionArchived: s.bulkSessionArchived + idsToArchive.length }
      })
      get().fetchMessages()
    }
  },

  syncBulkBatchSizeFromSettings: async () => {
    const bridge = getBridge()
    if (!bridge?.getInboxSettings) return
    try {
      const res = await bridge.getInboxSettings()
      if (res?.ok && res?.data?.batchSize != null) {
        const n = res.data.batchSize
        if ([10, 12, 24, 48].includes(n)) {
          set({ bulkBatchSize: n })
          try {
            localStorage?.setItem('wrdesk_bulkBatchSize', String(n))
          } catch {
            /* ignore */
          }
        }
      }
    } catch {
      /* ignore */
    }
  },

  markRead: async (ids, read) => {
    const bridge = getBridge()
    if (!bridge?.markRead) return
    const res = await bridge.markRead(ids, read)
    if (res.ok) {
      set((state) => ({
        messages: state.messages.map((m) =>
          ids.includes(m.id) ? { ...m, read_status: read ? 1 : 0 } : m
        ),
        selectedMessage:
          state.selectedMessage && ids.includes(state.selectedMessage.id)
            ? { ...state.selectedMessage, read_status: read ? 1 : 0 }
            : state.selectedMessage,
      }))
    }
  },

  toggleStar: async (id) => {
    const bridge = getBridge()
    if (!bridge?.toggleStar) return
    const res = await bridge.toggleStar(id)
    if (res.ok && res.data?.starred !== undefined) {
      const starred = res.data.starred ? 1 : 0
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === id ? { ...m, starred } : m
        ),
        selectedMessage:
          state.selectedMessage?.id === id
            ? { ...state.selectedMessage, starred }
            : state.selectedMessage,
      }))
    }
  },

  archiveMessages: async (ids) => {
    const bridge = getBridge()
    if (!bridge?.archiveMessages) return
    const res = await bridge.archiveMessages(ids)
    if (res.ok) {
      get().clearBulkAiOutputsForIds(ids)
      set((state) => ({
        messages: state.messages.filter((m) => !ids.includes(m.id)),
        total: Math.max(0, state.total - ids.length),
        multiSelectIds: new Set([...state.multiSelectIds].filter((x) => !ids.includes(x))),
        selectedMessageId:
          state.selectedMessageId && ids.includes(state.selectedMessageId)
            ? null
            : state.selectedMessageId,
        selectedMessage:
          state.selectedMessage && ids.includes(state.selectedMessage.id)
            ? null
            : state.selectedMessage,
        bulkSessionArchived: state.bulkSessionArchived + ids.length,
      }))
    }
  },

  deleteMessages: async (ids, gracePeriodHours) => {
    const bridge = getBridge()
    if (!bridge?.deleteMessages) return
    const res = await bridge.deleteMessages(ids, gracePeriodHours)
    if (res.ok) {
      get().clearBulkAiOutputsForIds(ids)
      const now = new Date().toISOString()
      set((state) => {
        const updatedMsg = (m: InboxMessage) =>
          ids.includes(m.id)
            ? { ...m, deleted: 1, deleted_at: now, purge_after: null }
            : m
        const nextMessages = state.messages.map(updatedMsg)
        const selectedWasDeleted =
          state.selectedMessage && ids.includes(state.selectedMessage.id)
        return {
          messages: nextMessages,
          multiSelectIds: new Set([...state.multiSelectIds].filter((x) => !ids.includes(x))),
          selectedMessageId: state.selectedMessageId,
          selectedMessage: selectedWasDeleted
            ? updatedMsg(state.selectedMessage)
            : state.selectedMessage,
        }
      })
      get().fetchMessages()
    }
  },

  cancelDeletion: async (id) => {
    const bridge = getBridge()
    if (!bridge?.cancelDeletion) return
    const res = await bridge.cancelDeletion(id)
    if (res.ok && res.data?.cancelled) {
      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === id ? { ...m, deleted: 0, deleted_at: null, purge_after: null } : m
        ),
        selectedMessage:
          state.selectedMessage?.id === id
            ? { ...state.selectedMessage, deleted: 0, deleted_at: null, purge_after: null }
            : state.selectedMessage,
      }))
      get().fetchMessages()
    }
  },

  setCategory: async (ids, category) => {
    const bridge = getBridge()
    if (!bridge?.setCategory) return
    const res = await bridge.setCategory(ids, category)
    if (res.ok) {
      set((state) => ({
        messages: state.messages.map((m) =>
          ids.includes(m.id) ? { ...m, sort_category: category || null } : m
        ),
        selectedMessage:
          state.selectedMessage && ids.includes(state.selectedMessage.id)
            ? { ...state.selectedMessage, sort_category: category || null }
            : state.selectedMessage,
      }))
    }
  },

  syncAccount: async (accountId) => {
    const bridge = getBridge()
    if (!bridge?.syncAccount) return
    set({ syncing: true })
    try {
      const res = await bridge.syncAccount(accountId)
      if (res.ok) {
        set({ lastSyncAt: new Date().toISOString(), syncing: false })
        get().fetchMessages()
      } else {
        set({ syncing: false })
      }
    } catch {
      set({ syncing: false })
    }
  },

  toggleAutoSync: async (accountId, enabled) => {
    const bridge = getBridge()
    if (!bridge?.toggleAutoSync) return
    const res = await bridge.toggleAutoSync(accountId, enabled)
    if (res.ok) {
      set({ autoSyncEnabled: enabled })
    }
  },

  loadSyncState: async (accountId) => {
    const bridge = getBridge()
    if (!bridge?.getSyncState) return
    try {
      const res = await bridge.getSyncState(accountId)
      if (res.ok && res.data) {
        const row = res.data as { auto_sync_enabled?: number }
        set({ autoSyncEnabled: row.auto_sync_enabled === 1 })
      }
    } catch {
      /* ignore */
    }
  },
}))
