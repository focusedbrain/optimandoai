/**
 * useBeapInboxStore
 *
 * Phase B, PR B-8: Renderer stores are read-only mirrors of main-process
 * sealed storage. Every mutation that affects inbox content or operational
 * state goes through an IPC wrapper to Electron main's sealed-storage gate.
 *
 * One-way data flow (Decision A):
 *   Reads : main sealed storage → refreshFromMain() → store.messages
 *   Writes: renderer requests IPC → main validates/seals → renderer refreshes
 *
 * The store exposes:
 *   • Selectors / getters  (unchanged from pre-B-8)
 *   • IPC-wrapper mutators (now async; return { ok, error })
 *   • refreshFromMain()    (re-loads from main's sealedQuery result)
 *   • cachePackage()       (in-memory only; preserves "View Original" artefacts)
 *
 * Pure UI-local state (no inbox content, no persistence):
 *   selectMessage, setDraftReply, toggleAttachmentSelected — these remain
 *   synchronous and renderer-local.
 *
 * @version 2.0.0
 */

import { create } from 'zustand'
import type {
  BeapMessage,
  AiClassification,
  DraftReply,
  BulkViewPage,
  UrgencyLevel,
} from './beapInboxTypes'
import type { SanitisedDecryptedPackage } from './sandbox/sandboxProtocol'
import {
  getBeapInboxMessages,
  getBeapInboxMany,
  beapInboxMarkRead,
  beapInboxArchive,
  beapInboxUnarchive,
  beapInboxClassify,
  beapInboxSetUrgency,
} from '../handshake/handshakeRpc'
import { inboxRowToBeapMessage } from './inboxRowToBeapMessage'

// =============================================================================
// Store Interface
// =============================================================================

/** Result returned by all async IPC-wrapper mutations. */
export interface MutationResult {
  ok: boolean
  error?: string
}

/**
 * Controls how refreshFromMain loads rows from main.
 *
 * replace (default) — clears the store and loads the first batch (cursor=null).
 *   Called on mount and after mutations in previous PRs.
 *
 * extend — appends the next batch using the provided cursor.
 *   Called by loadMoreFromMain() / Next button pagination.
 *
 * patch (Phase B, PR B-8.2) — fetches only the specified rows via beapInbox.getMany
 *   and merges them into the existing store at their current positions.
 *   Other rows are untouched. The user's page position is preserved.
 *   Rows not returned by main (deleted/unavailable) are removed from the store.
 *   Rows not already in the store are NOT added (Decision D).
 */
export type RefreshMode =
  | { kind: 'replace' }
  | { kind: 'extend'; cursor: string }
  | { kind: 'patch'; rowIds: readonly string[] }

interface BeapInboxState {
  // ---------------------------------------------------------------------------
  // Core state
  // ---------------------------------------------------------------------------

  /** All received messages indexed by messageId. Populated via refreshFromMain(). */
  messages: Map<string, BeapMessage>

  /**
   * In-memory package cache keyed by messageId.
   * Populated by cachePackage() after a successful merge-to-main.
   * Used exclusively by the "View Original" feature.
   * NOT replaced during refreshFromMain() — survives across refreshes.
   */
  packages: Map<string, SanitisedDecryptedPackage>

  /** Currently selected message ID (null when nothing is selected). */
  selectedMessageId: string | null

  /** Message IDs marked "new" for ~1s after first appearance (R.14 animation). */
  newMessageIds: Set<string>

  /** True while refreshFromMain() is in flight. */
  isRefreshing: boolean

  /**
   * Opaque cursor for fetching the next batch of rows from main.
   * null = all rows already loaded (or store not yet populated).
   * Set by refreshFromMain after each successful fetch.
   */
  nextCursor: string | null

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  isNewMessage: (messageId: string) => boolean
  getMessageById: (messageId: string) => BeapMessage | null
  getPackageForMessage: (messageId: string) => SanitisedDecryptedPackage | null
  getSelectedMessage: () => BeapMessage | null
  getInboxMessages: () => BeapMessage[]
  getHandshakeMessages: (handshakeId: string) => BeapMessage[]
  getBulkViewPage: (batchSize: 12 | 24, pageIndex: number) => BulkViewPage
  getPendingDeletionMessages: () => BeapMessage[]
  getUrgentMessages: () => BeapMessage[]
  getResponseMode: (message: BeapMessage) => 'beap' | 'email'

  // ---------------------------------------------------------------------------
  // State-from-main
  // ---------------------------------------------------------------------------

  /**
   * Query main's sealed inbox rows and update store.messages.
   * Calls handshake.beapInbox.list (VAULT_RPC) → sealedQuery on main side.
   *
   * Phase B, PR B-8.1:
   *   replace (default) — replaces store with first batch; resets nextCursor.
   *   extend            — appends next batch using store.nextCursor; updates nextCursor.
   *
   * In replace mode, preserves packages cache and UI-local state
   * (selectedMessageId, drafts, attachment selection).
   */
  refreshFromMain: (mode?: RefreshMode) => Promise<void>

  /**
   * Convenience wrapper: fetch the next batch from main and append to the store.
   * No-op if nextCursor is null (all rows already loaded).
   */
  loadMoreFromMain: () => Promise<void>

  /**
   * Cache a SanitisedDecryptedPackage in-memory for "View Original".
   * Called after a successful merge-to-main. Never persisted.
   * Also marks the message as "new" briefly for the slide-down animation.
   */
  cachePackage: (pkg: SanitisedDecryptedPackage, handshakeId: string | null) => void

  // ---------------------------------------------------------------------------
  // IPC-wrapper mutators (async; update store only after main confirms)
  // ---------------------------------------------------------------------------

  /**
   * Mark a message as read or unread via main's operational gate.
   */
  markAsRead: (messageId: string, read?: boolean) => Promise<MutationResult>

  /**
   * Archive a message via main's operational gate.
   */
  archiveMessage: (messageId: string) => Promise<MutationResult>

  /**
   * Unarchive a message via main's operational gate.
   */
  unarchiveMessage: (messageId: string) => Promise<MutationResult>

  /**
   * Apply AI classifications to a batch of messages.
   * Each classification is sent to main via resealWithAiAnalysis (Decision A).
   * Missing messageIds are silently ignored.
   */
  batchClassify: (
    messageIds: string[],
    classifications: Map<string, AiClassification>,
  ) => Promise<void>

  /**
   * Manually override the urgency level for a message.
   * Translates UrgencyLevel to an urgency_score and writes via main's
   * operational gate.
   */
  setUrgency: (messageId: string, urgency: UrgencyLevel) => Promise<MutationResult>

  // ---------------------------------------------------------------------------
  // Pure UI-local state (synchronous; no IPC; not inbox content)
  // ---------------------------------------------------------------------------

  /** Select a message (pass null to deselect). */
  selectMessage: (messageId: string | null) => void

  /** Set or update the draft reply for a message. Pass null to clear. */
  setDraftReply: (messageId: string, draft: DraftReply | null) => void

  /** Toggle attachment selection state (bulk inbox view — UI only). */
  toggleAttachmentSelected: (messageId: string, attachmentId: string) => void

  /**
   * Schedule a message for deletion after a grace period.
   * Local-only: drives the pending-deletion UI without a DB write.
   * The actual purge (purgeExpiredDeletions) removes entries from the Map.
   */
  scheduleDeletion: (messageId: string, gracePeriodMs: number) => void

  /** Cancel a pending deletion. */
  cancelDeletion: (messageId: string) => void

  /**
   * Remove expired (grace period elapsed) messages that were scheduled for
   * deletion. Local-only UI state management.
   * Returns the IDs of removed messages.
   */
  purgeExpiredDeletions: () => string[]
}

// =============================================================================
// Helpers
// =============================================================================

function sortByTimestampDesc(msgs: BeapMessage[]): BeapMessage[] {
  return [...msgs].sort((a, b) => b.timestamp - a.timestamp)
}

function updateMessage(
  map: Map<string, BeapMessage>,
  messageId: string,
  updater: (msg: BeapMessage) => BeapMessage,
): Map<string, BeapMessage> {
  const existing = map.get(messageId)
  if (!existing) return map
  const next = new Map(map)
  next.set(messageId, updater(existing))
  return next
}

/** Translate UrgencyLevel → numeric urgency_score for main's operational column. */
function urgencyToScore(urgency: UrgencyLevel): number {
  switch (urgency) {
    case 'urgent':           return 90
    case 'action-required':  return 65
    case 'normal':           return 40
    case 'irrelevant':       return 5
  }
}

const NEW_MESSAGE_TTL_MS = 1000

// =============================================================================
// Store Implementation
// =============================================================================

export const useBeapInboxStore = create<BeapInboxState>((set, get) => ({
  messages: new Map(),
  packages: new Map(),
  selectedMessageId: null,
  newMessageIds: new Set(),
  isRefreshing: false,
  nextCursor: null,

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  isNewMessage: (messageId) => get().newMessageIds.has(messageId),

  getMessageById: (messageId) => get().messages.get(messageId) ?? null,

  getPackageForMessage: (messageId) => get().packages.get(messageId) ?? null,

  getSelectedMessage: () => {
    const { messages, selectedMessageId } = get()
    if (!selectedMessageId) return null
    return messages.get(selectedMessageId) ?? null
  },

  getInboxMessages: () => {
    const msgs = Array.from(get().messages.values()).filter((m) => !m.archived)
    return sortByTimestampDesc(msgs)
  },

  getHandshakeMessages: (handshakeId) => {
    const msgs = Array.from(get().messages.values()).filter(
      (m) => m.handshakeId === handshakeId && !m.archived,
    )
    return sortByTimestampDesc(msgs)
  },

  getBulkViewPage: (batchSize, pageIndex) => {
    const all = get().getInboxMessages()
    const totalCount = all.length
    const totalPages = Math.max(1, Math.ceil(totalCount / batchSize))
    const safePageIndex = Math.min(Math.max(0, pageIndex), totalPages - 1)
    const start = safePageIndex * batchSize
    const hasMore = get().nextCursor !== null
    return { messages: all.slice(start, start + batchSize), pageIndex: safePageIndex, totalPages, totalCount, hasMore }
  },

  getPendingDeletionMessages: () => {
    const now = Date.now()
    return Array.from(get().messages.values()).filter((m) => {
      if (!m.deletionScheduled) return false
      return now < m.deletionScheduled.scheduledAt + m.deletionScheduled.gracePeriodMs
    })
  },

  getUrgentMessages: () => {
    const msgs = Array.from(get().messages.values()).filter(
      (m) => !m.archived && m.urgency === 'urgent',
    )
    return sortByTimestampDesc(msgs)
  },

  getResponseMode: (message) => (message.handshakeId !== null ? 'beap' : 'email'),

  // ---------------------------------------------------------------------------
  // State-from-main
  // ---------------------------------------------------------------------------

  refreshFromMain: async (mode: RefreshMode = { kind: 'replace' }) => {
    // ── Patch mode: targeted in-place update for specific rows (B-8.2) ────────
    // Patch does NOT use isRefreshing — it's a lightweight targeted update that
    // should not block concurrent replace/extend operations.
    if (mode.kind === 'patch') {
      if (mode.rowIds.length === 0) return
      try {
        const { rows: updatedRows } = await getBeapInboxMany({ rowIds: mode.rowIds })
        const updatedMap = new Map(updatedRows.map((r) => [r.id, r]))
        const requestedSet = new Set(mode.rowIds)
        set((state) => {
          const next = new Map(state.messages)
          for (const rowId of requestedSet) {
            // Decision D: only update rows already in the current window.
            if (!next.has(rowId)) continue
            const updatedRow = updatedMap.get(rowId)
            if (updatedRow) {
              const existing = next.get(rowId)
              const msg = inboxRowToBeapMessage(updatedRow)
              next.set(rowId, {
                ...msg,
                draftReply: existing?.draftReply,
                deletionScheduled: existing?.deletionScheduled,
                attachments: msg.attachments.map((att, i) => ({
                  ...att,
                  selected:
                    existing?.attachments[i]?.attachmentId === att.attachmentId
                      ? (existing.attachments[i]?.selected ?? false)
                      : false,
                })),
              })
            } else {
              // Row not returned by main (deleted or failed seal verification) — remove.
              next.delete(rowId)
            }
          }
          return { messages: next }
        })
      } catch (err) {
        console.warn('[BeapInboxStore] refreshFromMain (patch) failed:', err)
      }
      return
    }

    // ── Replace / extend: full batch loads ────────────────────────────────────
    if (get().isRefreshing) return
    set({ isRefreshing: true })
    try {
      const cursor = mode.kind === 'extend' ? mode.cursor : null
      const { items, nextCursor } = await getBeapInboxMessages({ cursor })
      const existingMessages = get().messages

      if (mode.kind === 'replace') {
        const next = new Map<string, BeapMessage>()
        for (const row of items) {
          const msg = inboxRowToBeapMessage(row)
          // Preserve local-only UI state that isn't reflected in the sealed row.
          const existing = existingMessages.get(msg.messageId)
          next.set(msg.messageId, {
            ...msg,
            draftReply: existing?.draftReply,
            deletionScheduled: existing?.deletionScheduled,
            // Keep per-attachment selection state.
            attachments: msg.attachments.map((att, i) => ({
              ...att,
              selected: existing?.attachments[i]?.attachmentId === att.attachmentId
                ? (existing.attachments[i]?.selected ?? false)
                : false,
            })),
          })
        }
        set({ messages: next, nextCursor })
      } else {
        // extend: append rows not already present; preserve existing entries (with their UI state).
        const next = new Map(existingMessages)
        for (const row of items) {
          if (!next.has(row.id)) {
            next.set(row.id, inboxRowToBeapMessage(row))
          }
        }
        set({ messages: next, nextCursor })
      }
    } catch (err) {
      console.warn('[BeapInboxStore] refreshFromMain failed:', err)
    } finally {
      set({ isRefreshing: false })
    }
  },

  loadMoreFromMain: async () => {
    const { nextCursor } = get()
    if (!nextCursor) return
    await get().refreshFromMain({ kind: 'extend', cursor: nextCursor })
  },

  cachePackage: (pkg, _handshakeId) => {
    const hash = pkg.header.content_hash
    const messageId = hash.length <= 16 ? hash : hash.slice(0, 16)
    set((state) => {
      const nextPkgs = new Map(state.packages)
      nextPkgs.set(messageId, pkg)
      const nextNew = new Set(state.newMessageIds)
      nextNew.add(messageId)
      return { packages: nextPkgs, newMessageIds: nextNew }
    })
    setTimeout(() => {
      set((state) => {
        const nextNew = new Set(state.newMessageIds)
        nextNew.delete(messageId)
        return nextNew.size !== state.newMessageIds.size ? { newMessageIds: nextNew } : {}
      })
    }, NEW_MESSAGE_TTL_MS)
  },

  // ---------------------------------------------------------------------------
  // IPC-wrapper mutators
  // ---------------------------------------------------------------------------

  markAsRead: async (messageId, read = true) => {
    try {
      const { rowId } = await beapInboxMarkRead(messageId, read)
      // Patch: fetch the updated row from main and merge it in place (B-8.2).
      // No optimistic update — store only changes after main confirms (Decision A).
      await get().refreshFromMain({ kind: 'patch', rowIds: [rowId] })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error)?.message ?? 'markAsRead failed' }
    }
  },

  archiveMessage: async (messageId) => {
    try {
      const { rowId } = await beapInboxArchive(messageId)
      await get().refreshFromMain({ kind: 'patch', rowIds: [rowId] })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error)?.message ?? 'archiveMessage failed' }
    }
  },

  unarchiveMessage: async (messageId) => {
    try {
      const { rowId } = await beapInboxUnarchive(messageId)
      await get().refreshFromMain({ kind: 'patch', rowIds: [rowId] })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error)?.message ?? 'unarchiveMessage failed' }
    }
  },

  batchClassify: async (messageIds, classifications) => {
    const errors: string[] = []
    const patchIds: string[] = []
    for (const id of messageIds) {
      const classification = classifications.get(id)
      if (!classification) continue
      const aiAnalysis: Record<string, unknown> = {
        urgency: classification.urgency,
        confidence: classification.confidence,
        summary: classification.summary,
        suggestedAction: classification.suggestedAction,
      }
      const urgencyScore = urgencyToScore(classification.urgency)
      try {
        const { rowId } = await beapInboxClassify(id, aiAnalysis, urgencyScore)
        patchIds.push(rowId)
      } catch (err) {
        errors.push(`${id}: ${(err as Error)?.message ?? 'classify failed'}`)
      }
    }
    // One patch round-trip for all successfully classified rows (Decision E).
    if (patchIds.length > 0) {
      await get().refreshFromMain({ kind: 'patch', rowIds: patchIds })
    }
    if (errors.length > 0) {
      console.warn('[BeapInboxStore] batchClassify partial failures:', errors)
    }
  },

  setUrgency: async (messageId, urgency) => {
    try {
      const urgencyScore = urgencyToScore(urgency)
      const { rowId } = await beapInboxSetUrgency(messageId, urgencyScore)
      await get().refreshFromMain({ kind: 'patch', rowIds: [rowId] })
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error)?.message ?? 'setUrgency failed' }
    }
  },

  // ---------------------------------------------------------------------------
  // Pure UI-local state
  // ---------------------------------------------------------------------------

  selectMessage: (messageId) => {
    set({ selectedMessageId: messageId })
  },

  setDraftReply: (messageId, draft) => {
    set((state) => ({
      messages: updateMessage(state.messages, messageId, (m) => {
        if (draft === null) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { draftReply: _removed, ...rest } = m
          return rest as BeapMessage
        }
        return { ...m, draftReply: draft }
      }),
    }))
  },

  toggleAttachmentSelected: (messageId, attachmentId) => {
    set((state) => ({
      messages: updateMessage(state.messages, messageId, (m) => ({
        ...m,
        attachments: m.attachments.map((att) =>
          att.attachmentId === attachmentId ? { ...att, selected: !att.selected } : att,
        ),
      })),
    }))
  },

  scheduleDeletion: (messageId, gracePeriodMs) => {
    set((state) => ({
      messages: updateMessage(state.messages, messageId, (m) => ({
        ...m,
        deletionScheduled: { scheduledAt: Date.now(), gracePeriodMs },
      })),
    }))
  },

  cancelDeletion: (messageId) => {
    set((state) => ({
      messages: updateMessage(state.messages, messageId, (m) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { deletionScheduled: _removed, ...rest } = m
        return rest as BeapMessage
      }),
    }))
  },

  purgeExpiredDeletions: () => {
    const now = Date.now()
    const toDelete: string[] = []

    get().messages.forEach((msg, id) => {
      if (!msg.deletionScheduled) return
      const { scheduledAt, gracePeriodMs } = msg.deletionScheduled
      if (now >= scheduledAt + gracePeriodMs) toDelete.push(id)
    })

    if (toDelete.length === 0) return toDelete

    set((state) => {
      const nextMessages = new Map(state.messages)
      const nextPackages = new Map(state.packages)
      for (const id of toDelete) {
        nextMessages.delete(id)
        nextPackages.delete(id)
      }
      return { messages: nextMessages, packages: nextPackages }
    })

    return toDelete
  },
}))

// =============================================================================
// Selector Hooks
// =============================================================================

export const useInboxView = () =>
  useBeapInboxStore((state) => state.getInboxMessages())

export const useHandshakeMessages = (handshakeId: string) =>
  useBeapInboxStore((state) => state.getHandshakeMessages(handshakeId))

export const useBulkViewPage = (batchSize: 12 | 24, pageIndex: number) =>
  useBeapInboxStore((state) => state.getBulkViewPage(batchSize, pageIndex))

export const usePendingDeletionMessages = () =>
  useBeapInboxStore((state) => state.getPendingDeletionMessages())

export const useUrgentMessages = () =>
  useBeapInboxStore((state) => state.getUrgentMessages())

export const useSelectedBeapMessage = () =>
  useBeapInboxStore((state) => state.getSelectedMessage())
