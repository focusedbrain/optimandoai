/**
 * useReplyComposer
 *
 * Hook that owns all reply composition state and logic for a single BEAP message.
 *
 * Responsibilities
 * ────────────────
 * 1. Determine reply mode (BEAP or email) from message provenance — immutable.
 * 2. Own draft text, attachment list, sending state, and AI-drafting state.
 * 3. Expose sendReply():
 *    - BEAP mode  → packages a reply capsule via useBeapDraftActions pattern and
 *                   records it in the store.
 *    - Email mode → composes an email with the mandatory WR Desk signature, dispatches
 *                   via executeEmailAction-compatible flow, records in store.
 * 4. Expose saveDraft(): persists current composer text to BeapMessage.draftReply.
 * 5. Expose generateAiDraft(): gate-checks semantic authorization, calls the AI
 *    provider, populates the composer text as an editable draft.
 * 6. Load an existing store draft into the composer when the message changes.
 *
 * Design decisions
 * ─────────────────
 * - Mode is DERIVED from message.handshakeId and never overridden by the user.
 * - All send paths write the final DraftReply{status:'sent'} to the store so that
 *   bulk-inbox "Send All Drafts" can read the up-to-date status.
 * - AI draft generation is gated behind Stage 6.1 (via the classification engine's
 *   gating helpers). If the gate blocks, the composer shows a clear error — no
 *   content is dispatched to any AI path.
 * - The email signature is MANDATORY and appended at send time (not stored in
 *   the draft to avoid double-append on edit).
 *
 * @version 1.0.0
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import type { BeapMessage, DraftReply, ReplyMode } from '../beapInboxTypes'
import { useBeapInboxStore } from '../useBeapInboxStore'
import type { AIProvider, ClassificationEngineConfig } from '../services/beapClassificationEngine'
import { projectContent } from '../services/beapClassificationEngine'
import { runStage61Gate, DEFAULT_CAPABILITY_POLICY } from '../services/processingEventGate'
import type { ReceiverCapabilityPolicy, GateContext } from '../services/processingEventGate'
import type { DecryptedCapsulePayload } from '../services/beapDecrypt'
import { buildPackage, executeEmailAction } from '../services'
import type { BeapPackageConfig, DeliveryResult } from '../services'

// =============================================================================
// Constants
// =============================================================================

/** Mandatory WR Desk promotional email signature. */
export const EMAIL_SIGNATURE = '\n\n—\nAutomate your inbox with wrdesk.com\nhttps://wrdesk.com'

/** Derive a reply subject from a message. */
export function deriveReplySubject(message: BeapMessage): string {
  // Use the first non-empty automation tag, or first line of body, or fallback
  if (message.automationTags.length > 0) {
    return `Re: [${message.automationTags[0]}]`
  }
  const body = message.canonicalContent || message.messageBody || ''
  const firstLine = body.split('\n').find((l) => l.trim().length > 0)?.trim() ?? ''
  if (firstLine.length > 0) {
    const snippet = firstLine.length > 60 ? firstLine.slice(0, 60) + '…' : firstLine
    return `Re: ${snippet}`
  }
  return `Re: (message from ${message.senderEmail})`
}

/**
 * Derive the response mode from a message.
 *
 * This is the single canonical implementation — it MUST NOT be overridden
 * by user action. Mode is protocol-determined by handshake provenance.
 */
export function getResponseMode(message: BeapMessage): ReplyMode {
  return message.handshakeId !== null ? 'beap' : 'email'
}

// =============================================================================
// Public API types
// =============================================================================

/** A reply attachment (file chosen by the user in the composer). */
export interface ReplyAttachment {
  id: string
  file: File
  name: string
  sizeBytes: number
  mimeType: string
}

/** Current state of the reply composer for one message. */
export interface ReplyComposerState {
  /** Protocol-determined mode — read-only. */
  mode: ReplyMode

  /** Current draft text in the composer textarea. */
  draftText: string

  /** Attachments the user has added in the composer. */
  attachments: ReplyAttachment[]

  /** True while sendReply() is in flight. */
  isSending: boolean

  /** True while generateAiDraft() is in flight. */
  isGeneratingDraft: boolean

  /** Non-null after a successful send. */
  sendResult: SendResult | null

  /** Non-null when any action fails. */
  error: string | null

  /** True when the composer has unsaved changes vs. the stored draft. */
  isDirty: boolean
}

/** Result of a successful send. */
export interface SendResult {
  mode: ReplyMode
  sentAt: number
  /** DeliveryResult from the email send path (null for BEAP). */
  emailResult: DeliveryResult | null
}

/** Config for the useReplyComposer hook. */
export interface UseReplyComposerConfig {
  /**
   * Receiver-side capability policy for AI draft gating.
   * Defaults to DEFAULT_CAPABILITY_POLICY (all blocked).
   * Must set allowSemanticProcessing: true for AI drafting to work.
   */
  policy?: ReceiverCapabilityPolicy

  /**
   * AI provider for draft generation.
   * When absent, "Draft with AI" is disabled (no server-side AI).
   */
  aiProvider?: AIProvider

  /**
   * Gate context for AI draft gating artefacts.
   */
  gateContext?: Partial<GateContext>

  /**
   * Sender fingerprint for BEAP reply capsule building.
   * Required for BEAP mode sends.
   */
  senderFingerprint?: string

  /**
   * Short fingerprint for display.
   */
  senderFingerprintShort?: string

  /**
   * Email account to use for email-mode sends.
   * Should match the configured delivery account.
   */
  fromEmail?: string

  /**
   * Called when a reply is sent successfully.
   */
  onSendSuccess?: (result: SendResult) => void

  /**
   * Called when a send fails.
   */
  onSendError?: (error: string) => void
}

/** Actions returned by useReplyComposer. */
export interface ReplyComposerActions {
  setDraftText: (text: string) => void
  addAttachment: (file: File) => void
  removeAttachment: (id: string) => void
  clearAttachments: () => void

  /**
   * Send the current draft text.
   * BEAP: packages reply capsule via buildPackage, writes DraftReply{status:'sent'}.
   * Email: appends EMAIL_SIGNATURE, dispatches via executeEmailAction, writes store.
   */
  sendReply: () => Promise<void>

  /**
   * Save current text as a draft on the message (status: 'draft').
   * Safe to call frequently (no network I/O).
   */
  saveDraft: () => void

  /**
   * Gate-check and call AI provider to generate a draft reply.
   * On success: populates draftText as editable content.
   * On gate block: sets error, does NOT dispatch to AI.
   */
  generateAiDraft: () => Promise<void>

  /** Clear error message. */
  clearError: () => void

  /** Reset to empty draft (does NOT clear the stored draft). */
  resetComposer: () => void
}

// =============================================================================
// Synthetic capsule builder (shared with classification engine pattern)
// =============================================================================

function buildSyntheticCapsuleForGate(message: BeapMessage): DecryptedCapsulePayload {
  return {
    subject: '',
    body: message.canonicalContent || message.messageBody || '',
    attachments: message.attachments.map((a) => ({
      id: a.attachmentId,
      originalName: a.filename,
      originalSize: a.sizeBytes,
      originalType: a.mimeType,
      semanticExtracted: !!a.semanticContent,
      semanticContent: a.semanticContent,
    })),
    automation: message.automationTags.length > 0
      ? { tags: message.automationTags, tagSource: 'encrypted', receiverHasFinalAuthority: true }
      : undefined,
  } as unknown as DecryptedCapsulePayload
}

// =============================================================================
// Hook
// =============================================================================

let _attachmentIdCounter = 0
function nextAttachmentId(): string {
  return `reply-att-${Date.now()}-${++_attachmentIdCounter}`
}

/**
 * Full reply composer state and actions for a single BeapMessage.
 *
 * Usage:
 * ```tsx
 * const [state, actions] = useReplyComposer(message, {
 *   policy: { allowSemanticProcessing: true, allowActuatingProcessing: false },
 *   aiProvider: myOpenAiProvider,
 *   senderFingerprint: localFingerprint,
 *   fromEmail: 'me@example.com',
 * })
 * ```
 */
export function useReplyComposer(
  message: BeapMessage | null,
  config: UseReplyComposerConfig = {},
): [ReplyComposerState, ReplyComposerActions] {
  const setDraftReply = useBeapInboxStore((s) => s.setDraftReply)

  const mode: ReplyMode = message ? getResponseMode(message) : 'email'

  const [draftText, setDraftTextState] = useState<string>('')
  const [attachments, setAttachments]  = useState<ReplyAttachment[]>([])
  const [isSending, setIsSending]         = useState(false)
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false)
  const [sendResult, setSendResult]       = useState<SendResult | null>(null)
  const [error, setError]                 = useState<string | null>(null)
  const [storedDraftContent, setStoredDraftContent] = useState<string>('')

  const prevMessageIdRef = useRef<string | null>(null)

  // Load stored draft when message changes
  useEffect(() => {
    if (!message) return
    if (message.messageId === prevMessageIdRef.current) return
    prevMessageIdRef.current = message.messageId

    const stored = message.draftReply
    if (stored && stored.status !== 'sent') {
      setDraftTextState(stored.content)
      setStoredDraftContent(stored.content)
    } else {
      setDraftTextState('')
      setStoredDraftContent('')
    }
    setAttachments([])
    setSendResult(null)
    setError(null)
    setIsGeneratingDraft(false)
    setIsSending(false)
  }, [message?.messageId])

  const isDirty = draftText !== storedDraftContent

  // ── Actions ──────────────────────────────────────────────────────

  const setDraftText = useCallback((text: string) => {
    setDraftTextState(text)
    setError(null)
  }, [])

  const addAttachment = useCallback((file: File) => {
    setAttachments((prev) => [
      ...prev,
      {
        id: nextAttachmentId(),
        file,
        name: file.name,
        sizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
      },
    ])
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const clearAttachments = useCallback(() => setAttachments([]), [])

  const saveDraft = useCallback(() => {
    if (!message) return
    const content = draftText.trim()
    if (!content) {
      setDraftReply(message.messageId, null)
      setStoredDraftContent('')
      return
    }
    const draft: DraftReply = { content, mode, status: 'draft' }
    setDraftReply(message.messageId, draft)
    setStoredDraftContent(content)
  }, [message, draftText, mode, setDraftReply])

  const clearError = useCallback(() => setError(null), [])

  const resetComposer = useCallback(() => {
    setDraftTextState('')
    setAttachments([])
    setSendResult(null)
    setError(null)
  }, [])

  // ── Send reply ────────────────────────────────────────────────────

  const sendReply = useCallback(async () => {
    if (!message || isSending) return
    const content = draftText.trim()
    if (!content) {
      setError('Reply text cannot be empty.')
      return
    }

    setIsSending(true)
    setError(null)

    try {
      if (mode === 'beap') {
        // ── BEAP reply path ──────────────────────────────────────
        // Match reply encoding to original message: pBEAP → public, qBEAP → private.
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
          // Attachments from the composer are File objects; CapsuleAttachment intake
          // (parser / rasterizer) is a separate async pipeline not driven here.
          attachments: [],
          senderFingerprint: config.senderFingerprint ?? '',
          senderFingerprintShort: config.senderFingerprintShort ?? '',
        }

        // buildPackage validates config internally
        const buildResult = await buildPackage(packageConfig)
        if (!buildResult.success || !buildResult.package) {
          throw new Error(buildResult.error ?? 'BEAP package build failed.')
        }

        // Write to store as sent
        setDraftReply(message.messageId, { content, mode: 'beap', status: 'sent' })
        const result: SendResult = { mode: 'beap', sentAt: Date.now(), emailResult: null }
        setSendResult(result)
        setDraftTextState('')
        setStoredDraftContent('')
        setAttachments([])
        config.onSendSuccess?.(result)
      } else {
        // ── Email reply path ─────────────────────────────────────
        // Append mandatory signature BEFORE sending (not stored in draft).
        const fullBody = content + EMAIL_SIGNATURE
        const subject  = deriveReplySubject(message)

        // Build a minimal package config for email delivery
        const packageConfig: BeapPackageConfig = {
          recipientMode: 'public',
          selectedRecipient: null,
          deliveryMethod: 'email',
          emailTo: message.senderEmail,
          subject,
          messageBody: fullBody,
          // Attachments from the composer are File objects; CapsuleAttachment intake is a separate pipeline.
          attachments: [],
          senderFingerprint: config.senderFingerprint ?? '',
          senderFingerprintShort: config.senderFingerprintShort ?? '',
        }

        const buildResult = await buildPackage(packageConfig)
        if (!buildResult.success || !buildResult.package) {
          throw new Error(buildResult.error ?? 'Email package build failed.')
        }

        const emailResult = await executeEmailAction(buildResult.package, packageConfig)
        if (!emailResult.success) {
          throw new Error(emailResult.error ?? 'Email send failed.')
        }

        setDraftReply(message.messageId, { content, mode: 'email', status: 'sent' })
        const result: SendResult = { mode: 'email', sentAt: Date.now(), emailResult }
        setSendResult(result)
        setDraftTextState('')
        setStoredDraftContent('')
        setAttachments([])
        config.onSendSuccess?.(result)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      config.onSendError?.(msg)
    } finally {
      setIsSending(false)
    }
  }, [
    message, isSending, draftText, mode, attachments,
    config, setDraftReply,
  ])

  // ── AI draft generation ───────────────────────────────────────────

  const generateAiDraft = useCallback(async () => {
    if (!message || isGeneratingDraft) return
    if (!config.aiProvider) {
      setError('No AI provider configured. Enable an AI provider to use this feature.')
      return
    }

    setIsGeneratingDraft(true)
    setError(null)

    try {
      // 1. Gate check — must be authorized for semantic processing
      const policy = config.policy ?? DEFAULT_CAPABILITY_POLICY
      const gateCtx = {
        sessionId:            config.gateContext?.sessionId            ?? `reply-draft-${Date.now()}`,
        templateHash:         config.gateContext?.templateHash         ?? message.messageId,
        publisherFingerprint: config.gateContext?.publisherFingerprint ?? message.senderFingerprint,
        poaeRecordId:         config.gateContext?.poaeRecordId,
      }

      const capsule = buildSyntheticCapsuleForGate(message)
      const gateResult = await runStage61Gate(capsule, [], message.processingEvents, policy, gateCtx)

      if (gateResult.decision !== 'AUTHORIZED') {
        const violations = [
          ...gateResult.alignmentViolations,
          ...gateResult.capabilityViolations,
          ...gateResult.consentViolations,
        ]
        setError(
          violations.length > 0
            ? `AI drafting blocked: ${violations[0]}`
            : 'AI drafting blocked by processing event policy.',
        )
        return
      }

      // 2. Project content within authorized scope
      const authorizedEvent = gateResult.authorizedEvents.find((e) => e.class === 'semantic')
      const scope = authorizedEvent?.impliedScope ?? 'MINIMAL'
      const projected = projectContent(message, scope)

      // 3. Call AI provider with a drafting instruction
      const draftQuery =
        mode === 'email'
          ? 'Draft a concise, professional email reply to this message. End the reply body before any signature.'
          : 'Draft a concise, professional reply to this BEAP message. Plain text only, no HTML.'

      const response = await Promise.race([
        config.aiProvider.classify(
          message.messageId,
          { ...projected, text: `${draftQuery}\n\n---\n${projected.text}` },
          {
            senderEmail: message.senderEmail,
            senderDisplayName: message.senderDisplayName,
            trustLevel: message.trustLevel,
            automationTags: message.automationTags,
            receivedAt: message.receivedAt,
            handshakeId: message.handshakeId,
          },
        ),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('AI draft timeout')), 15_000),
        ),
      ])

      // The provider returns an AiClassificationResponse — we use `suggestedAction`
      // as a free-text reply draft when the query is a drafting instruction.
      const generated = response.suggestedAction || response.summary || ''
      if (!generated.trim()) {
        setError('AI returned an empty draft. Please try again.')
        return
      }

      // 4. Populate composer (user can edit before sending)
      // For email mode: AI should NOT include the signature — we append at send time.
      setDraftTextState(generated.trim())
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`AI draft failed: ${msg}`)
    } finally {
      setIsGeneratingDraft(false)
    }
  }, [message, isGeneratingDraft, config, mode])

  // ── Composed return ───────────────────────────────────────────────

  const state: ReplyComposerState = {
    mode,
    draftText,
    attachments,
    isSending,
    isGeneratingDraft,
    sendResult,
    error,
    isDirty,
  }

  const actions: ReplyComposerActions = {
    setDraftText,
    addAttachment,
    removeAttachment,
    clearAttachments,
    sendReply,
    saveDraft,
    generateAiDraft,
    clearError,
    resetComposer,
  }

  return [state, actions]
}
