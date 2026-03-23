/**
 * useBeapInboxStore
 *
 * Reactive Zustand store that is the single source of truth for all received
 * BEAP messages. Consumed by:
 *   - Inbox view         (inboxView)
 *   - Handshake panel    (handshakeView)
 *   - Bulk inbox         (bulkView)
 *
 * Data model: Map<messageId, BeapMessage> for O(1) access by ID.
 * Derived views are computed inline (not cached) — Zustand's shallow
 * equality prevents unnecessary re-renders for array-typed selectors.
 *
 * Ordering convention: all view arrays are sorted newest-first
 * (timestamp descending) unless otherwise noted.
 *
 * @version 1.0.0
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
import { sanitisedPackageToBeapMessage } from './sanitisedPackageToBeapMessage'

// =============================================================================
// Store Interface
// =============================================================================

interface BeapInboxState {
  // ---------------------------------------------------------------------------
  // Core state
  // ---------------------------------------------------------------------------

  /**
   * All received messages indexed by messageId.
   * Map gives O(1) lookup; derived views iterate values() when needed.
   */
  messages: Map<string, BeapMessage>

  /**
   * Sanitised packages keyed by messageId.
   * Used for retrieving original artefacts when user clicks "View Original".
   */
  packages: Map<string, SanitisedDecryptedPackage>

  /** Currently selected message ID (null when nothing is selected). */
  selectedMessageId: string | null

  /** Message IDs marked "new" for ~1s after addMessage (R.14 animation). */
  newMessageIds: Set<string>

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** True if message was recently added (for slide-down animation). */
  isNewMessage: (messageId: string) => boolean

  /** Get a single message by ID. O(1). */
  getMessageById: (messageId: string) => BeapMessage | null

  /** Get the sanitised package for a message (for artefact retrieval). */
  getPackageForMessage: (messageId: string) => SanitisedDecryptedPackage | null

  /** Get the currently selected message. */
  getSelectedMessage: () => BeapMessage | null

  /**
   * Inbox view: all non-archived messages, sorted by timestamp descending.
   * Equivalent to the "All Messages" tab in the inbox UI.
   */
  getInboxMessages: () => BeapMessage[]

  /**
   * Handshake view: messages filtered to a single handshake relationship,
   * sorted by timestamp descending.
   * Returns [] when handshakeId has no associated messages.
   */
  getHandshakeMessages: (handshakeId: string) => BeapMessage[]

  /**
   * Bulk view: paginated inbox messages.
   * `batchSize` must be 12 or 24 (throws on invalid value).
   * `pageIndex` is 0-based.
   */
  getBulkViewPage: (batchSize: 12 | 24, pageIndex: number) => BulkViewPage

  /**
   * Pending deletion view: messages with a `deletionScheduled` entry where
   * the grace period has NOT yet elapsed at the time of the call.
   */
  getPendingDeletionMessages: () => BeapMessage[]

  /**
   * Urgent view: non-archived messages with urgency === 'urgent', newest-first.
   */
  getUrgentMessages: () => BeapMessage[]

  /**
   * Derive reply mode from a message.
   * 'beap' when handshakeId is present; 'email' for depackaged messages.
   */
  getResponseMode: (message: BeapMessage) => 'beap' | 'email'

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Add a received message from a sanitised sandbox package.
   * Derives all fields via `sanitisedPackageToBeapMessage`.
   * If a message with the same messageId already exists, it is overwritten
   * (idempotent import from the same capsule).
   *
   * @param pkg         Sanitised package from Stage 5 sandbox boundary.
   * @param handshakeId Handshake ID if known; null for depackaged emails.
   * @returns The newly created BeapMessage.
   */
  addMessage: (
    pkg: SanitisedDecryptedPackage,
    handshakeId: string | null,
  ) => BeapMessage

  /**
   * Add a plain (non-BEAP) email as a depackaged BeapMessage (Canon §6).
   * No package; message is injected directly. Shows with ✉️ icon.
   *
   * @param msg BeapMessage from plainEmailToBeapMessage (Electron).
   * @returns The added message.
   */
  addPlainEmailMessage: (msg: BeapMessage) => BeapMessage

  /** Select a message (pass null to deselect). */
  selectMessage: (messageId: string | null) => void

  /**
   * Apply AI classifications to a batch of messages in one atomic update.
   * Missing messageIds are silently ignored.
   * Also updates `urgency` on each message to match classification.urgency.
   */
  batchClassify: (
    messageIds: string[],
    classifications: Map<string, AiClassification>,
  ) => void

  /**
   * Schedule a message for deletion after a grace period.
   * If the message is already scheduled, the schedule is reset (not stacked).
   * Does nothing if the messageId does not exist.
   */
  scheduleDeletion: (messageId: string, gracePeriodMs: number) => void

  /**
   * Cancel a pending deletion.
   * Removes the `deletionScheduled` field from the message.
   * Does nothing if the messageId does not exist or has no scheduled deletion.
   */
  cancelDeletion: (messageId: string) => void

  /**
   * Archive a message.
   * Sets `archived = true`. The message disappears from `inboxView` and
   * handshake views but remains accessible by ID.
   */
  archiveMessage: (messageId: string) => void

  /**
   * Unarchive a message (restore to inbox).
   * Sets `archived = false`.
   */
  unarchiveMessage: (messageId: string) => void

  /**
   * Set or update the draft reply for a message.
   * Pass `null` to clear an existing draft.
   */
  setDraftReply: (messageId: string, draft: DraftReply | null) => void

  /**
   * Mark a message as read.
   */
  markAsRead: (messageId: string) => void

  /**
   * Manually override the urgency level for a message.
   * Useful when the receiver disagrees with AI classification.
   */
  setUrgency: (messageId: string, urgency: UrgencyLevel) => void

  /**
   * Toggle attachment selection state (used in bulk inbox view).
   * Does nothing if the message or attachment does not exist.
   */
  toggleAttachmentSelected: (
    messageId: string,
    attachmentId: string,
  ) => void

  /**
   * Remove expired (grace period elapsed) messages that were scheduled for
   * deletion. Intended to be called periodically (e.g. on tab focus).
   * Returns the IDs of deleted messages.
   */
  purgeExpiredDeletions: () => string[]
}

// =============================================================================
// Helpers
// =============================================================================

/** Sort messages newest-first by timestamp. Pure function, no side effects. */
function sortByTimestampDesc(msgs: BeapMessage[]): BeapMessage[] {
  return [...msgs].sort((a, b) => b.timestamp - a.timestamp)
}

/**
 * Update a single message in an immutable Map.
 * Returns a new Map; the original is not mutated.
 */
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

// =============================================================================
// Store Implementation
// =============================================================================

const NEW_MESSAGE_TTL_MS = 1000

export const useBeapInboxStore = create<BeapInboxState>((set, get) => ({
  messages: new Map(),
  packages: new Map(),
  selectedMessageId: null,
  newMessageIds: new Set(),

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  isNewMessage: (messageId) => get().newMessageIds.has(messageId),

  getMessageById: (messageId) => {
    return get().messages.get(messageId) ?? null
  },

  getPackageForMessage: (messageId) => {
    return get().packages.get(messageId) ?? null
  },

  getSelectedMessage: () => {
    const { messages, selectedMessageId } = get()
    if (!selectedMessageId) return null
    return messages.get(selectedMessageId) ?? null
  },

  getInboxMessages: () => {
    const msgs = Array.from(get().messages.values()).filter(
      (m) => !m.archived,
    )
    return sortByTimestampDesc(msgs)
  },

  getHandshakeMessages: (handshakeId) => {
    const msgs = Array.from(get().messages.values()).filter(
      (m) => m.handshakeId === handshakeId && !m.archived,
    )
    return sortByTimestampDesc(msgs)
  },

  getBulkViewPage: (batchSize, pageIndex) => {
    const all = get().getInboxMessages() // already sorted, non-archived
    const totalCount = all.length
    const totalPages = Math.max(1, Math.ceil(totalCount / batchSize))
    const safePageIndex = Math.min(Math.max(0, pageIndex), totalPages - 1)
    const start = safePageIndex * batchSize
    const messages = all.slice(start, start + batchSize)

    return { messages, pageIndex: safePageIndex, totalPages, totalCount }
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

  getResponseMode: (message) => {
    return message.handshakeId !== null ? 'beap' : 'email'
  },

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  addMessage: (pkg, handshakeId) => {
    const msg = sanitisedPackageToBeapMessage(pkg, handshakeId)
    set((state) => {
      const next = new Map(state.messages)
      next.set(msg.messageId, msg)
      const nextPkgs = new Map(state.packages)
      nextPkgs.set(msg.messageId, pkg)
      const nextNew = new Set(state.newMessageIds)
      nextNew.add(msg.messageId)
      return { messages: next, packages: nextPkgs, newMessageIds: nextNew }
    })
    setTimeout(() => {
      set((state) => {
        const nextNew = new Set(state.newMessageIds)
        nextNew.delete(msg.messageId)
        return nextNew.size !== state.newMessageIds.size ? { newMessageIds: nextNew } : {}
      })
    }, NEW_MESSAGE_TTL_MS)
    return msg
  },

  addPlainEmailMessage: (msg) => {
    set((state) => {
      const next = new Map(state.messages)
      next.set(msg.messageId, msg)
      const nextNew = new Set(state.newMessageIds)
      nextNew.add(msg.messageId)
      return { messages: next, newMessageIds: nextNew }
    })
    setTimeout(() => {
      set((state) => {
        const nextNew = new Set(state.newMessageIds)
        nextNew.delete(msg.messageId)
        return nextNew.size !== state.newMessageIds.size ? { newMessageIds: nextNew } : {}
      })
    }, NEW_MESSAGE_TTL_MS)
    return msg
  },

  selectMessage: (messageId) => {
    set({ selectedMessageId: messageId })
  },

  batchClassify: (messageIds, classifications) => {
    set((state) => {
      let next = state.messages
      for (const id of messageIds) {
        const classification = classifications.get(id)
        if (!classification) continue
        next = updateMessage(next, id, (m) => ({
          ...m,
          aiClassification: classification,
          urgency: classification.urgency,
        }))
      }
      // Only trigger a re-render if the map reference changed.
      return next === state.messages ? {} : { messages: next }
    })
  },

  scheduleDeletion: (messageId, gracePeriodMs) => {
    set((state) => ({
      messages: updateMessage(state.messages, messageId, (m) => ({
        ...m,
        deletionScheduled: {
          scheduledAt: Date.now(),
          gracePeriodMs,
        },
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

  archiveMessage: (messageId) => {
    set((state) => ({
      messages: updateMessage(state.messages, messageId, (m) => ({
        ...m,
        archived: true,
      })),
    }))
  },

  unarchiveMessage: (messageId) => {
    set((state) => ({
      messages: updateMessage(state.messages, messageId, (m) => ({
        ...m,
        archived: false,
      })),
    }))
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

  markAsRead: (messageId) => {
    set((state) => ({
      messages: updateMessage(state.messages, messageId, (m) => ({
        ...m,
        isRead: true,
      })),
    }))
  },

  setUrgency: (messageId, urgency) => {
    set((state) => ({
      messages: updateMessage(state.messages, messageId, (m) => ({
        ...m,
        urgency,
      })),
    }))
  },

  toggleAttachmentSelected: (messageId, attachmentId) => {
    set((state) => ({
      messages: updateMessage(state.messages, messageId, (m) => ({
        ...m,
        attachments: m.attachments.map((att) =>
          att.attachmentId === attachmentId
            ? { ...att, selected: !att.selected }
            : att,
        ),
      })),
    }))
  },

  purgeExpiredDeletions: () => {
    const now = Date.now()
    const toDelete: string[] = []

    get().messages.forEach((msg, id) => {
      if (!msg.deletionScheduled) return
      const { scheduledAt, gracePeriodMs } = msg.deletionScheduled
      if (now >= scheduledAt + gracePeriodMs) {
        toDelete.push(id)
      }
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
// Fine-grained hooks that subscribe to only the slice of state they need,
// preventing unnecessary re-renders.

/** All non-archived inbox messages, newest-first. */
export const useInboxView = () =>
  useBeapInboxStore((state) => state.getInboxMessages())

/** Messages for a specific handshake, newest-first. */
export const useHandshakeMessages = (handshakeId: string) =>
  useBeapInboxStore((state) => state.getHandshakeMessages(handshakeId))

/** A single page of the bulk inbox. */
export const useBulkViewPage = (batchSize: 12 | 24, pageIndex: number) =>
  useBeapInboxStore((state) => state.getBulkViewPage(batchSize, pageIndex))

/** Messages scheduled for deletion where grace period not yet elapsed. */
export const usePendingDeletionMessages = () =>
  useBeapInboxStore((state) => state.getPendingDeletionMessages())

/** Urgent (urgency === 'urgent') non-archived messages, newest-first. */
export const useUrgentMessages = () =>
  useBeapInboxStore((state) => state.getUrgentMessages())

/** Currently selected message. */
export const useSelectedBeapMessage = () =>
  useBeapInboxStore((state) => state.getSelectedMessage())
