/**
 * useBulkSend
 *
 * Hook for the "Send All Drafts" batch operation in the bulk inbox toolbar.
 *
 * Flow
 * ────
 * 1. Caller provides a list of BeapMessages.
 * 2. Hook filters to messages with draftReply.status === 'draft' or 'ready'.
 * 3. Sends each draft in sequence (not concurrent — email rate limits).
 * 4. After each send:
 *    - On success: writes DraftReply{status:'sent'} to the Zustand store.
 *    - On failure: marks that message as 'failed' in local state.
 * 5. Exposes live progress (N of M sent), failed IDs, and retry action.
 *
 * Send logic mirrors useReplyComposer:
 *   BEAP mode  → buildPackage → record as sent (stub)
 *   Email mode → buildPackage + executeEmailAction → record as sent
 *
 * @version 1.0.0
 */

import { useState, useCallback, useRef } from 'react'
import type { BeapMessage, DraftReply } from '../beapInboxTypes'
import { useBeapInboxStore } from '../useBeapInboxStore'
import { buildPackage, executeEmailAction } from '../services'
import type { BeapPackageConfig } from '../services'
import { deriveReplySubject, EMAIL_SIGNATURE } from './useReplyComposer'

// =============================================================================
// Types
// =============================================================================

export type BulkSendItemStatus = 'pending' | 'sending' | 'sent' | 'failed'

export interface BulkSendItem {
  messageId: string
  senderEmail: string
  mode: 'beap' | 'email'
  status: BulkSendItemStatus
  error: string | null
  sentAt: number | null
}

export interface BulkSendProgress {
  /** Items ready to send at the start of the run. */
  total: number
  /** Successfully sent. */
  sent: number
  /** Failed to send. */
  failed: number
  /** Currently being sent. */
  current: BulkSendItem | null
}

export interface UseBulkSendConfig {
  /** Sender fingerprint for BEAP reply capsule headers. */
  senderFingerprint?: string
  senderFingerprintShort?: string
  /** Called after each individual send attempt. */
  onItemComplete?: (item: BulkSendItem) => void
  /** Called when the entire batch completes. */
  onBatchComplete?: (progress: BulkSendProgress) => void
}

export interface UseBulkSendReturn {
  /** Whether a batch send is currently running. */
  isSending: boolean
  /** Progress snapshot, updated after each item. */
  progress: BulkSendProgress
  /** All items (includes pending, sent, failed). */
  items: BulkSendItem[]
  /**
   * Start sending all draft messages.
   * Filters to messages where draftReply.status is 'draft' or 'ready'.
   */
  sendAllDrafts: (messages: BeapMessage[]) => Promise<void>
  /** Retry only the failed items from the last run. */
  retryFailed: (messages: BeapMessage[]) => Promise<void>
  /** Cancel an in-flight batch (sends the current item to completion first). */
  cancel: () => void
  /** Reset state (clears progress and items). */
  reset: () => void
}

// =============================================================================
// Hook
// =============================================================================

export function useBulkSend(config: UseBulkSendConfig = {}): UseBulkSendReturn {
  const setDraftReply = useBeapInboxStore((s) => s.setDraftReply)

  const [isSending, setIsSending]     = useState(false)
  const [items, setItems]             = useState<BulkSendItem[]>([])
  const [progress, setProgress]       = useState<BulkSendProgress>({
    total: 0, sent: 0, failed: 0, current: null,
  })

  const cancelledRef = useRef(false)

  const reset = useCallback(() => {
    cancelledRef.current = false
    setIsSending(false)
    setItems([])
    setProgress({ total: 0, sent: 0, failed: 0, current: null })
  }, [])

  const cancel = useCallback(() => {
    cancelledRef.current = true
  }, [])

  // ── Core send function for a single item ─────────────────────────

  async function sendSingleItem(
    message: BeapMessage,
    draft: DraftReply,
  ): Promise<{ success: boolean; error: string | null }> {
    const content = draft.content.trim()
    if (!content) return { success: false, error: 'Draft content is empty.' }

    try {
      if (draft.mode === 'beap') {
        const beapRecipientMode =
          message.encoding === 'pBEAP' ? 'public' : 'private'
        const packageConfig: BeapPackageConfig = {
          recipientMode: beapRecipientMode,
          selectedRecipient: beapRecipientMode === 'private' ? {
            handshake_id: message.handshakeId!,
            counterparty_email: message.senderEmail,
            counterparty_user_id: '',
            sharing_mode: 'reciprocal',
          } : null,
          deliveryMethod: 'email',
          emailTo: message.senderEmail,
          subject: deriveReplySubject(message),
          messageBody: content,
          attachments: [],
          senderFingerprint: config.senderFingerprint ?? '',
          senderFingerprintShort: config.senderFingerprintShort ?? '',
        }

        const buildResult = await buildPackage(packageConfig)
        if (!buildResult.success || !buildResult.package) {
          const err = buildResult.error ?? 'BEAP build failed.'
          console.error('[BEAP-SEND] Delivery failed — full debug:', JSON.stringify({ message: err, phase: 'package_build' }))
          return { success: false, error: err }
        }
        return { success: true, error: null }
      } else {
        // email mode
        const fullBody = content + EMAIL_SIGNATURE
        const packageConfig: BeapPackageConfig = {
          recipientMode: 'public',
          selectedRecipient: null,
          deliveryMethod: 'email',
          emailTo: message.senderEmail,
          subject: deriveReplySubject(message),
          messageBody: fullBody,
          attachments: [],
          senderFingerprint: config.senderFingerprint ?? '',
          senderFingerprintShort: config.senderFingerprintShort ?? '',
        }

        const buildResult = await buildPackage(packageConfig)
        if (!buildResult.success || !buildResult.package) {
          const err = buildResult.error ?? 'Email build failed.'
          console.error('[BEAP-SEND] Delivery failed — full debug:', JSON.stringify({ message: err, phase: 'package_build' }))
          return { success: false, error: err }
        }

        const emailResult = await executeEmailAction(buildResult.package, packageConfig)
        if (!emailResult.success) {
          const err = emailResult.message || 'Email delivery failed.'
          console.error(
            '[BEAP-SEND] Delivery failed — full debug:',
            JSON.stringify({
              message: emailResult.message,
              action: emailResult.action,
              clientSendFailureDebug: emailResult.clientSendFailureDebug,
              outbound_debug: emailResult.p2pOutboundDebug,
            }),
          )
          return { success: false, error: err }
        }
        return { success: true, error: null }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[BEAP-SEND] Send exception — full debug:', msg, err)
      return {
        success: false,
        error: msg,
      }
    }
  }

  // ── Batch runner ─────────────────────────────────────────────────

  const runBatch = useCallback(
    async (messagesToSend: BeapMessage[]) => {
      if (messagesToSend.length === 0) return

      cancelledRef.current = false
      setIsSending(true)

      // Build initial item list
      const initialItems: BulkSendItem[] = messagesToSend.map((m) => ({
        messageId: m.messageId,
        senderEmail: m.senderEmail,
        mode: m.draftReply!.mode,
        status: 'pending',
        error: null,
        sentAt: null,
      }))

      setItems(initialItems)
      setProgress({ total: messagesToSend.length, sent: 0, failed: 0, current: null })

      let sent   = 0
      let failed = 0

      for (let i = 0; i < messagesToSend.length; i++) {
        if (cancelledRef.current) break

        const message = messagesToSend[i]
        const draft   = message.draftReply!

        const currentItem: BulkSendItem = {
          messageId: message.messageId,
          senderEmail: message.senderEmail,
          mode: draft.mode,
          status: 'sending',
          error: null,
          sentAt: null,
        }

        // Mark as sending
        setItems((prev) =>
          prev.map((it) =>
            it.messageId === message.messageId ? currentItem : it,
          ),
        )
        setProgress((p) => ({ ...p, current: currentItem }))

        const result = await sendSingleItem(message, draft)

        const completedItem: BulkSendItem = {
          ...currentItem,
          status: result.success ? 'sent' : 'failed',
          error: result.error,
          sentAt: result.success ? Date.now() : null,
        }

        if (result.success) {
          sent++
          setDraftReply(message.messageId, { ...draft, status: 'sent' })
        } else {
          failed++
        }

        setItems((prev) =>
          prev.map((it) =>
            it.messageId === message.messageId ? completedItem : it,
          ),
        )
        setProgress((p) => ({
          ...p,
          sent,
          failed,
          current: i < messagesToSend.length - 1 ? null : completedItem,
        }))

        config.onItemComplete?.(completedItem)
      }

      const finalProgress: BulkSendProgress = { total: messagesToSend.length, sent, failed, current: null }
      setProgress(finalProgress)
      setIsSending(false)
      config.onBatchComplete?.(finalProgress)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setDraftReply, config.senderFingerprint, config.senderFingerprintShort],
  )

  const sendAllDrafts = useCallback(
    async (messages: BeapMessage[]) => {
      const eligible = messages.filter(
        (m) => m.draftReply && (m.draftReply.status === 'draft' || m.draftReply.status === 'ready'),
      )
      await runBatch(eligible)
    },
    [runBatch],
  )

  const retryFailed = useCallback(
    async (messages: BeapMessage[]) => {
      const failedIds = new Set(items.filter((i) => i.status === 'failed').map((i) => i.messageId))
      if (failedIds.size === 0) return
      const eligible = messages.filter(
        (m) => failedIds.has(m.messageId) && m.draftReply,
      )
      await runBatch(eligible)
    },
    [items, runBatch],
  )

  return {
    isSending,
    progress,
    items,
    sendAllDrafts,
    retryFailed,
    cancel,
    reset,
  }
}
