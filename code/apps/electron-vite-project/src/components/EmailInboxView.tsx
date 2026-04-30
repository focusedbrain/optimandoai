/**
 * EmailInboxView — Main inbox view matching HandshakeView layout.
 * Left: toolbar + message list.
 * When no message selected: center = provider area, right = capsule drop.
 * When message selected: right = 50/50 message + AI workspace.
 */

import { useEffect, useCallback, useState, useRef, useMemo, type MouseEvent } from 'react'
import EmailInboxToolbar from './EmailInboxToolbar'
import { emailInboxSyncWindowSelectValue } from './EmailInboxSyncControls'
import EmailMessageDetail from './EmailMessageDetail'
import { type DraftAttachment } from './EmailComposeOverlay'
import { EmailInlineComposer } from './EmailInlineComposer'
import BeapMessageImportZone from './BeapMessageImportZone'
import { BeapInlineComposer } from './BeapInlineComposer'
import { EmailProvidersSection } from '@ext/wrguard/components/EmailProvidersSection'
import { ConnectEmailLaunchSource, useConnectEmailFlow } from '@ext/shared/email/connectEmailFlow'
import { SyncFailureBanner } from './SyncFailureBanner'
import { pickDefaultEmailAccountRowId } from '@ext/shared/email/pickDefaultAccountRow'
import { useEmailInboxStore, activeEmailAccountIdsForSync, type InboxMessage } from '../stores/useEmailInboxStore'
import { useDraftRefineStore } from '../stores/useDraftRefineStore'
import type { NormalInboxAiResult } from '../types/inboxAi'
import { useInboxPreloadQueue } from '../hooks/useInboxPreloadQueue'
import { useInternalSandboxesList } from '../hooks/useInternalSandboxesList'
import { resolveActiveSandboxCloneTargets } from '../lib/resolveActiveSandboxCloneTargets'
import { useOrchestratorMode } from '../hooks/useOrchestratorMode'
import { beapInboxCloneToSandboxApi, sandboxCloneFeedbackFromOutcome } from '../lib/beapInboxCloneToSandbox'
import {
  SANDBOX_CLONE_COPY,
  viewSandboxChecking,
  viewSandboxCloning,
  viewSandboxIdentityIncomplete,
  viewSandboxKeyingIncomplete,
  viewSandboxListLoadFailed,
  viewSandboxNoOrchestrator,
  type SandboxCloneFeedbackView,
} from '../lib/sandboxCloneFeedbackUi'
import SandboxCloneFeedbackBadge from './SandboxCloneFeedbackBadge'
import { InboxBeapSourceBadgeListRow } from './InboxBeapSourceBadge'
import { beapHostSandboxCloneTooltipForAvailability, beapInboxRedirectTooltipPropsForRow } from '../lib/beapInboxActionTooltips'
import { InboxRedirectActionIcon, InboxSandboxCloneActionIcon } from './InboxActionIcons'
import type {
  AuthoritativeDeviceInternalRole,
  SandboxOrchestratorAvailability,
} from '../types/sandboxOrchestratorAvailability'
import BeapSandboxCloneDialog from './BeapSandboxCloneDialog'
import BeapSandboxUnavailableDialog, { type BeapSandboxUnavailableVariant } from './BeapSandboxUnavailableDialog'
import BeapRedirectDialog from './BeapRedirectDialog'
import {
  canShowSandboxCloneAction,
  logSandboxActionVisibility,
  logSandboxCloneEligibilityDebug,
} from '../lib/beapInboxSandboxVisibility'
import { isInboxMessageActionable } from '../lib/inboxMessageActionable'
import {
  logSandboxTargetResolution,
  mapSandboxClickActionToResolutionDecision,
  resolveHostSandboxCloneClickAction,
  sandboxCloneUnavailableDialogVariant,
} from '../lib/beapInboxHostSandboxClickPolicy'
import { tryParsePartialAnalysis, tryParseAnalysis, tryParseAnalysisWithMeta, type NormalInboxAiResultKey } from '../utils/parseInboxAiJson'
import { reconcileAnalyzeTriage } from '../lib/inboxClassificationReconcile'
import { deriveInboxMessageKind } from '../lib/inboxMessageKind'
import { autosortDiagLog, DEBUG_AUTOSORT_DIAGNOSTICS } from '../lib/autosortDiagnostics'
import {
  inboxAiAnalyzeStreamErrorDisplay,
  inboxAiDraftReplyErrorDisplay,
  type InboxAiErrorDebugPayload,
} from '../lib/inboxAiUserMessages'

/** True when error text points at embedding /api/embed rather than chat completion. */
function inboxFailureLooksEmbeddingOnly(message: string | undefined): boolean {
  const m = (message ?? '').toLowerCase()
  if (!m) return false
  return /\/api\/embed|embedding failed|generateembedding|nomic-embed|semantic_search|semantic search/i.test(m) &&
    !/\/api\/chat|generatechat|host inference|internal inference/i.test(m)
}
import { InboxUrgencyMeter } from './InboxUrgencyMeter'
import { InboxHandshakeNavIconButton } from './InboxHandshakeNavIcon'
import '../components/handshakeViewTypes'
import { executeDeliveryAction, type BeapPackageConfig } from '@ext/beap-messages/services/BeapPackageBuilder'
import { getSigningKeyPair } from '@ext/beap-messages/services/beapCrypto'
import { hasHandshakeKeyMaterial, type SelectedHandshakeRecipient } from '@ext/handshake/rpcTypes'
import { listHandshakes } from '../shims/handshakeRpc'
import { UI_BADGE } from '../styles/uiContrastTokens'

/** Local HTTP API for orchestrator DB (matches `HTTP_PORT` in electron/main.ts). */

/** Map ledger handshake row (main DB shape) to builder `SelectedHandshakeRecipient`. */
function mapLedgerRecordToSelectedRecipient(raw: Record<string, unknown>): SelectedHandshakeRecipient {
  const isInitiator = raw.local_role === 'initiator'
  const counterparty = (isInitiator ? raw.acceptor : raw.initiator) as
    | { email?: string; wrdesk_user_id?: string }
    | null
    | undefined
  const cpk = raw.counterparty_public_key
  const fpFull =
    typeof cpk === 'string' && cpk.length >= 64
      ? cpk
      : `fp${String(raw.handshake_id ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 40)}`
  const fpShort = fpFull.length > 12 ? `${fpFull.slice(0, 4)}…${fpFull.slice(-4)}` : fpFull
  const sm = raw.sharing_mode
  const sharing = sm === 'reciprocal' ? 'reciprocal' : 'receive-only'
  return {
    handshake_id: String(raw.handshake_id ?? ''),
    counterparty_email: counterparty?.email ?? '',
    counterparty_user_id: counterparty?.wrdesk_user_id ?? '',
    sharing_mode: sharing,
    receiver_fingerprint_full: fpFull,
    receiver_fingerprint_short: fpShort,
    receiver_display_name: (counterparty?.email ?? 'peer').split('@')[0] ?? 'Peer',
    peerX25519PublicKey:
      typeof raw.peer_x25519_public_key_b64 === 'string'
        ? raw.peer_x25519_public_key_b64
        : typeof raw.peerX25519PublicKey === 'string'
          ? raw.peerX25519PublicKey
          : undefined,
    peerPQPublicKey:
      typeof raw.peer_mlkem768_public_key_b64 === 'string'
        ? raw.peer_mlkem768_public_key_b64
        : typeof raw.peerPQPublicKey === 'string'
          ? raw.peerPQPublicKey
          : undefined,
    p2pEndpoint:
      ((raw.p2p_endpoint ?? raw.p2pEndpoint) as string | null | undefined) ?? null,
  }
}

// ── Relative date ──

function formatRelativeDate(isoString: string): string {
  if (!isoString) return '—'
  const d = new Date(isoString)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffM = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMs / 3600000)
  const diffD = Math.floor(diffMs / 86400000)

  if (diffM < 1) return 'now'
  if (diffM < 60) return `${diffM}m`
  if (diffH < 24) return `${diffH}h`
  if (diffD < 7) return `${diffD}d`
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' }).replace(/\//g, '.')
}

type NativeBeapDraftData = {
  qbeapReply?: unknown
  pbeapReply?: unknown
  draftReply?: unknown
  draftReplyFull?: unknown
  draftReplyPublic?: unknown
  capsuleDraft?: { publicText?: unknown; encryptedText?: unknown }
}

function firstNonEmptyString(
  candidates: Array<{ source: string; value: unknown }>,
): { source: string; value: string } {
  for (const candidate of candidates) {
    if (typeof candidate.value === 'string' && candidate.value.trim()) {
      return { source: candidate.source, value: candidate.value }
    }
  }
  return { source: 'none', value: '' }
}

function resolveNativeBeapDraftFields(data: NativeBeapDraftData): {
  mainDraft: string
  mainSource: string
  publicPreview: string
  publicSource: string
  equalsPublicText: boolean
  equalsEncryptedText: boolean
} {
  const capsulePublic = data.capsuleDraft?.publicText
  const capsuleEncrypted = data.capsuleDraft?.encryptedText
  const main = firstNonEmptyString([
    { source: 'data.qbeapReply', value: data.qbeapReply },
    { source: 'data.draftReplyFull', value: data.draftReplyFull },
    { source: 'data.draftReply', value: data.draftReply },
    { source: 'data.capsuleDraft.encryptedText', value: capsuleEncrypted },
  ])
  const preview = firstNonEmptyString([
    { source: 'data.pbeapReply', value: data.pbeapReply },
    { source: 'data.draftReplyPublic', value: data.draftReplyPublic },
    { source: 'data.capsuleDraft.publicText', value: capsulePublic },
  ])
  return {
    mainDraft: main.value,
    mainSource: main.source,
    publicPreview: preview.value,
    publicSource: preview.source,
    equalsPublicText: typeof capsulePublic === 'string' && main.value === capsulePublic,
    equalsEncryptedText: typeof capsuleEncrypted === 'string' && main.value === capsuleEncrypted,
  }
}

/**
 * Maps `inbox:aiAnalyzeMessageError` payloads to banners. Main uses `buildInboxAiAnalyzeErrorPayload`:
 * — `LLM_TIMEOUT`/`InboxLlmTimeoutError` → `inboxErrorCode: 'timeout'`, legacy `error: 'timeout'`
 * — Abort stream → thrown `LLM_ABORTED` retained on `payload.message`
 * — `assertMinimumAnalysisOutput` → message includes `Analysis output too short` / `[INBOX_ANALYSIS_TOO_SHORT]`
 */
function inboxAnalyzeStreamPrivilegedBannerMessage(payload: {
  error?: string
  message?: string
  inboxErrorCode?: string
}): string | null {
  const raw = typeof payload.message === 'string' ? payload.message : ''
  const code = typeof payload.inboxErrorCode === 'string' ? payload.inboxErrorCode : ''
  const errField = typeof payload.error === 'string' ? payload.error : ''

  if (code === 'timeout' || errField === 'timeout' || raw.startsWith('LLM_TIMEOUT')) {
    return 'Analysis took too long (>45s) and timed out. The host may be busy. Try again.'
  }
  if (raw === 'LLM_ABORTED' || raw.startsWith('LLM_ABORTED')) {
    return 'Analysis was cancelled.'
  }
  if (raw.includes('Analysis output too short') || raw.includes('[INBOX_ANALYSIS_TOO_SHORT]')) {
    return 'The AI returned an incomplete response. Try again or check that your model is responding properly.'
  }
  return null
}

/** AI preview line for list rows — aligns with Bulk (summary / reason / sort_reason). */
function getMessageAiPreviewLine(msg: InboxMessage): string | null {
  let text = ''
  const raw = msg.ai_analysis_json
  if (raw) {
    const parsed = tryParseAnalysis(raw)
    if (parsed) {
      text = (parsed.summary || parsed.urgencyReason || '').trim()
    } else {
      try {
        const o = JSON.parse(raw) as Record<string, unknown>
        const s = o.summary ?? o.reason ?? o.urgencyReason
        if (typeof s === 'string') text = s.trim()
      } catch {
        /* ignore */
      }
    }
  }
  if (!text && msg.sort_reason) text = String(msg.sort_reason).trim()
  return text || null
}

// ── InboxDetailAiPanel (right column: multi-section AI dashboard) ──
// Uses NormalInboxAiResult — advisory AI: informative only, no silent actions

interface InboxDetailAiPanelProps {
  messageId: string
  message: InboxMessage | null
  onSendDraft?: (draft: string, message: InboxMessage, attachments?: DraftAttachment[]) => void | Promise<boolean>
  onArchive?: (messageIds: string[]) => void
  onDelete?: (messageIds: string[]) => void
  onCollapsedChange?: (collapsed: boolean) => void
}

function InboxDetailAiPanel({ messageId, message, onSendDraft, onArchive, onDelete, onCollapsedChange }: InboxDetailAiPanelProps) {
  const [analysis, setAnalysis] = useState<NormalInboxAiResult | null>(null)
  const [receivedFields, setReceivedFields] = useState<Set<NormalInboxAiResultKey>>(new Set())
  const [analysisLoading, setAnalysisLoading] = useState(false)
  /** Manual Summarize (IPC) — separate from auto-analysis stream so the button stays usable while streaming. */
  const [summarizeLoading, setSummarizeLoading] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  /** Final buffered stream failed tryParseAnalysis — IPC succeeded but JSON was unusable (see [INBOX_ANALYSIS_PARSE_FAIL]). */
  const [analysisStreamParseFailed, setAnalysisStreamParseFailed] = useState(false)
  const [inboxAiAnalyzeDebug, setInboxAiAnalyzeDebug] = useState<InboxAiErrorDebugPayload | null>(null)
  const [inboxAiSemanticDevNote, setInboxAiSemanticDevNote] = useState<string | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState(false)
  const [draftErrorMessage, setDraftErrorMessage] = useState<string | null>(null)
  const [draftErrorDebug, setDraftErrorDebug] = useState<InboxAiErrorDebugPayload | null>(null)
  const [editedDraft, setEditedDraft] = useState('')
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const [actionChecked, setActionChecked] = useState<Record<number, boolean>>({})
  const [draftSubFocused, setDraftSubFocused] = useState(false)
  const [visibleSections, setVisibleSections] = useState<Set<string>>(() => new Set(['summary', 'draft', 'analysis']))
  const [capsulePublicText, setCapsulePublicText] = useState('')
  const [capsuleEncryptedText, setCapsuleEncryptedText] = useState('')
  const [capsulePublicSource, setCapsulePublicSource] = useState('none')
  const [capsuleEncryptedSource, setCapsuleEncryptedSource] = useState('none')
  const [capsuleDraftIssue, setCapsuleDraftIssue] = useState<
    'full_reply_missing' | 'full_reply_suspiciously_short' | null
  >(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [availableSessions, setAvailableSessions] = useState<Array<{ id: string; name: string }>>([])
  const [capsuleAttachments, setCapsuleAttachments] = useState<File[]>([])
  const [sendingCapsule, setSendingCapsule] = useState(false)
  const [sendResult, setSendResult] = useState<{ success: boolean; error?: string } | null>(null)
  const capsuleSendSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const draftRef = useRef<HTMLDivElement>(null)
  const draftTextareaRef = useRef<HTMLTextAreaElement>(null)
  const streamCleanupRef = useRef<(() => void) | null>(null)
  /** Stops auto re-entry: effect re-runs after stream error (e.g. Zustand or StrictMode) must not call analyze again. */
  const autoAnalyzeStreamFailedRef = useRef<Set<string>>(new Set())
  /**
   * When the user runs manual Summarize while the analysis stream is still running (or before it finishes),
   * stream chunks / completion must not overwrite that summary. Cleared on message change and when a fresh stream starts (e.g. Retry).
   */
  const manualSummaryOverrideRef = useRef<{ messageId: string; summary: string } | null>(null)

  const draftRefineConnect = useDraftRefineStore((s) => s.connect)
  const draftRefineDisconnect = useDraftRefineStore((s) => s.disconnect)
  const draftRefineConnected = useDraftRefineStore((s) => s.connected)
  const draftRefineMessageId = useDraftRefineStore((s) => s.messageId)
  const draftRefineTarget = useDraftRefineStore((s) => s.refineTarget)
  /** Email: one aiDraftReply when needsReply and no draft. Native BEAP: one aiDraftReply on view when capsules empty (no needsReply / analysis wait). */
  const draftFallbackAttemptedRef = useRef(false)
  const refinedDraftText = useDraftRefineStore((s) => s.refinedDraftText)
  const acceptRefinement = useDraftRefineStore((s) => s.acceptRefinement)

  /** Latest row for streaming — avoids re-creating runAnalysisStream when body/subject updates (e.g. qBEAP decrypt) and re-triggering the effect loop. */
  const messageRef = useRef(message)
  useEffect(() => {
    messageRef.current = message
  }, [message])

  const messageKind = message ? deriveInboxMessageKind(message) : null
  const isNativeBeap = messageKind === 'handshake'
  const isSortingActive = useEmailInboxStore((s) => s.isSortingActive)
  /** Tracks prior `isSortingActive` so we can start deferred auto-analysis when bulk sort finishes. */
  const prevSortingActiveRef = useRef(useEmailInboxStore.getState().isSortingActive)

  const runAnalysisStream = useCallback(async (opts?: { manual?: boolean; supersede?: boolean }) => {
    const manual = !!opts?.manual
    const msg = messageRef.current
    if (DEBUG_AUTOSORT_DIAGNOSTICS) {
      console.log('[ANALYSIS] runAnalysisStream triggered for:', messageId)
    }
    if (!window.emailInbox?.aiAnalyzeMessageStream || !window.emailInbox.onAiAnalyzeChunk) return
    const skipEmailDraft = !!(msg && deriveInboxMessageKind(msg) === 'handshake')
    const cached = useEmailInboxStore.getState().analysisCache[messageId]
    if (cached) {
      autoAnalyzeStreamFailedRef.current.delete(messageId)
      const tri = reconcileAnalyzeTriage(
        {
          urgencyScore: cached.urgencyScore,
          needsReply: cached.needsReply,
          urgencyReason: cached.urgencyReason,
          summary: cached.summary,
        },
        { subject: msg?.subject, body: msg?.body_text }
      )
      const cachedAdj = {
        ...cached,
        urgencyScore: tri.urgencyScore,
        needsReply: tri.needsReply,
        draftReply: skipEmailDraft
          ? cached.draftReply
          : tri.needsReply
            ? cached.draftReply
            : null,
      }
      setAnalysis(cachedAdj)
      setAnalysisStreamParseFailed(false)
      setReceivedFields(new Set(['needsReply', 'needsReplyReason', 'summary', 'urgencyScore', 'urgencyReason', 'actionItems', 'archiveRecommendation', 'archiveReason', 'draftReply']))
      if (!skipEmailDraft) {
        if (cachedAdj.draftReply && typeof cachedAdj.draftReply === 'string') {
          setDraft(cachedAdj.draftReply)
          setEditedDraft(cachedAdj.draftReply)
        } else {
          setDraft(null)
          setEditedDraft('')
        }
      }
      setAnalysisLoading(false)
      return
    }

    if (!manual && useEmailInboxStore.getState().isSortingActive) {
      autosortDiagLog('aiAnalyzeMessageStream:skip-auto-inbox', {
        messageId,
        reason: 'bulk-sort-active',
      })
      setAnalysisLoading(false)
      return
    }

    streamCleanupRef.current?.()
    manualSummaryOverrideRef.current = null
    setAnalysisLoading(true)
    setAnalysisStreamParseFailed(false)
    setAnalysis(null)
    setAnalysisError(null)
    setInboxAiAnalyzeDebug(null)
    setInboxAiSemanticDevNote(null)
    let accumulatedText = ''

    const DEFAULTS: NormalInboxAiResult = {
      needsReply: false,
      needsReplyReason: '',
      summary: '',
      urgencyScore: 5,
      urgencyReason: '',
      actionItems: [],
      archiveRecommendation: 'keep',
      archiveReason: '',
    }

    const cleanup = () => {
      unsubChunk()
      unsubDone()
      unsubError()
      streamCleanupRef.current = null
    }

    const unsubChunk = window.emailInbox.onAiAnalyzeChunk(({ messageId: mid, chunk }) => {
      if (mid !== messageId) return
      accumulatedText += chunk
      console.log(
        `[INBOX_ANALYSIS_RENDERER_CHUNK_RECEIVED] ${JSON.stringify({
          messageId,
          chunkChars: chunk.length,
          accumulatedChars: accumulatedText.length,
        })}`,
      )
      const parsed = tryParsePartialAnalysis(accumulatedText)
      if (parsed) {
        setAnalysis((prev) => {
          const merged = { ...DEFAULTS, ...(prev ?? {}), ...parsed.partial } as NormalInboxAiResult
          const ov = manualSummaryOverrideRef.current
          if (ov && ov.messageId === messageId && ov.summary.trim()) {
            merged.summary = ov.summary
          }
          return merged
        })
        setReceivedFields((prev) => new Set([...prev, ...parsed.receivedKeys]))
        if (
          !skipEmailDraft &&
          parsed.receivedKeys.includes('draftReply') &&
          parsed.partial.draftReply &&
          typeof parsed.partial.draftReply === 'string'
        ) {
          setDraft(parsed.partial.draftReply)
          setEditedDraft(parsed.partial.draftReply)
        }
      }
    })

    const unsubDone = window.emailInbox.onAiAnalyzeDone(({ messageId: mid }) => {
      if (mid !== messageId) return
      console.log(
        `[INBOX_ANALYSIS_RENDERER_DONE_RECEIVED] ${JSON.stringify({
          messageId,
          accumulatedChars: accumulatedText.length,
        })}`,
      )
      setAnalysisLoading(false)
      const finalMeta = tryParseAnalysisWithMeta(accumulatedText)
      console.log(
        `[INBOX_ANALYSIS_RENDERER_PARSE_ATTEMPT] ${JSON.stringify({
          messageId,
          accumulatedChars: accumulatedText.length,
          success: !!finalMeta.result,
          strippedFence: finalMeta.meta.strippedFence,
          usedBalancedExtract: finalMeta.meta.usedBalancedExtract,
          usedTrailingCommaRepair: finalMeta.meta.usedTrailingCommaRepair,
        })}`,
      )
      const final = finalMeta.result
      if (final) {
        const tri = reconcileAnalyzeTriage(
          {
            urgencyScore: final.urgencyScore,
            needsReply: final.needsReply,
            urgencyReason: final.urgencyReason,
            summary: final.summary,
          },
          { subject: msg?.subject, body: msg?.body_text }
        )
        let adjusted = {
          ...final,
          urgencyScore: tri.urgencyScore,
          needsReply: tri.needsReply,
          draftReply: skipEmailDraft
            ? final.draftReply
            : tri.needsReply
              ? final.draftReply
              : null,
        }
        const ov = manualSummaryOverrideRef.current
        if (ov && ov.messageId === messageId && ov.summary.trim()) {
          adjusted = { ...adjusted, summary: ov.summary }
        }
        setAnalysis(adjusted)
        setReceivedFields(new Set(['needsReply', 'needsReplyReason', 'summary', 'urgencyScore', 'urgencyReason', 'actionItems', 'archiveRecommendation', 'archiveReason', 'draftReply']))
        if (!skipEmailDraft) {
          if (adjusted.draftReply && typeof adjusted.draftReply === 'string') {
            setDraft(adjusted.draftReply)
            setEditedDraft(adjusted.draftReply)
          } else {
            setDraft(null)
            setEditedDraft('')
          }
        }
        useEmailInboxStore.getState().setAnalysisCache(messageId, adjusted)
        autoAnalyzeStreamFailedRef.current.delete(messageId)
        setAnalysisStreamParseFailed(false)
        setAnalysisError(null)
        setInboxAiAnalyzeDebug(null)
        setInboxAiSemanticDevNote(null)
      } else {
        const rawLen = accumulatedText.length
        const { meta } = finalMeta
        console.warn(
          `[INBOX_ANALYSIS_PARSE_FAIL] ${JSON.stringify({
            message_id: messageId,
            raw_length: rawLen,
            has_fence: meta.strippedFence,
            trimmed_preamble_chars: meta.trimmedPreambleChars,
            balanced_extract: meta.usedBalancedExtract,
            trailing_comma_repair: meta.usedTrailingCommaRepair,
            ...(import.meta.env.DEV
              ? { dev_raw_sample: accumulatedText.slice(0, 240).replace(/\r?\n/g, ' ') }
              : {}),
          })}`,
        )
        setAnalysisStreamParseFailed(true)
        setAnalysisError(null)
        setAnalysis(null)
        setReceivedFields(new Set())
      }
      cleanup()
    })

    const unsubError = window.emailInbox.onAiAnalyzeError((payload) => {
      if (payload.messageId !== messageId) return
      console.log(
        `[INBOX_ANALYSIS_RENDERER_ERROR_RECEIVED] ${JSON.stringify({
          messageId,
          error: payload.error ?? null,
          inboxErrorCode: payload.inboxErrorCode ?? null,
        })}`,
      )
      autoAnalyzeStreamFailedRef.current.add(messageId)
      setAnalysisLoading(false)
      setAnalysisStreamParseFailed(false)

      const priv = inboxAnalyzeStreamPrivilegedBannerMessage({
        error: payload.error,
        message: payload.message,
        inboxErrorCode: payload.inboxErrorCode,
      })
      const { fatalMessage, semanticDevNote } = inboxAiAnalyzeStreamErrorDisplay({
        error: payload.error,
        message: payload.message,
        inboxErrorCode: payload.inboxErrorCode,
      })
      if (priv != null) {
        setAnalysisError(priv)
        setInboxAiSemanticDevNote(null)
      } else if (fatalMessage) {
        setAnalysisError(fatalMessage)
        setInboxAiSemanticDevNote(null)
      } else if (typeof payload.message === 'string' && payload.message.trim()) {
        setAnalysisError(`Analysis failed: ${payload.message.trim()}`)
        setInboxAiSemanticDevNote(null)
      } else {
        setAnalysisError(null)
        setInboxAiSemanticDevNote(semanticDevNote)
      }
      if (import.meta.env.DEV && payload.debug && typeof payload.debug === 'object') {
        setInboxAiAnalyzeDebug(payload.debug as InboxAiErrorDebugPayload)
      } else {
        setInboxAiAnalyzeDebug(null)
      }
      cleanup()
    })

    streamCleanupRef.current = cleanup

    try {
      if (DEBUG_AUTOSORT_DIAGNOSTICS) {
        console.warn('⚡ EmailInboxView calling aiAnalyzeMessageStream', new Date().toISOString(), { messageId })
      }
      const res = await window.emailInbox.aiAnalyzeMessageStream(messageId, { supersede: !!opts?.supersede })
      const deduped = res?.deduped === true
      if (res?.started === false && !deduped) {
        autoAnalyzeStreamFailedRef.current.add(messageId)
        setAnalysisLoading(false)
        setAnalysisStreamParseFailed(false)
        const { fatalMessage, semanticDevNote } = inboxAiAnalyzeStreamErrorDisplay({
          inboxErrorCode: 'generation_failed',
        })
        setAnalysisError(fatalMessage)
        setInboxAiSemanticDevNote(semanticDevNote)
        cleanup()
      }
    } catch {
      autoAnalyzeStreamFailedRef.current.add(messageId)
      setAnalysisLoading(false)
      setAnalysisStreamParseFailed(false)
      const { fatalMessage, semanticDevNote } = inboxAiAnalyzeStreamErrorDisplay({
        inboxErrorCode: 'generation_failed',
      })
      setAnalysisError(fatalMessage)
      setInboxAiSemanticDevNote(semanticDevNote)
      cleanup()
    }
  }, [messageId])

  const runAnalysisStreamRef = useRef(runAnalysisStream)
  runAnalysisStreamRef.current = runAnalysisStream

  useEffect(() => {
    if (!messageId) return
    if (capsuleSendSuccessTimerRef.current) {
      clearTimeout(capsuleSendSuccessTimerRef.current)
      capsuleSendSuccessTimerRef.current = null
    }
    manualSummaryOverrideRef.current = null
    useDraftRefineStore.getState().disconnect()
    if (autoAnalyzeStreamFailedRef.current.has(messageId)) {
      return () => {
        streamCleanupRef.current?.()
      }
    }
    setAnalysisError(null)
    setAnalysisStreamParseFailed(false)
    setInboxAiAnalyzeDebug(null)
    setInboxAiSemanticDevNote(null)
    setAnalysisLoading(true)
    setAnalysis(null)
    setReceivedFields(new Set())
    setSummarizeLoading(false)
    setDraft(null)
    setEditedDraft('')
    setDraftError(false)
    setDraftErrorMessage(null)
    setDraftErrorDebug(null)
    setActionChecked({})
    setDraftSubFocused(false)
    setVisibleSections(new Set(['summary', 'draft', 'analysis']))
    setCapsulePublicText('')
    setCapsuleEncryptedText('')
    setCapsulePublicSource('none')
    setCapsuleEncryptedSource('none')
    setCapsuleDraftIssue(null)
    setSelectedSessionId(null)
    setCapsuleAttachments([])
    setSendResult(null)
    setSendingCapsule(false)
    setAvailableSessions([])
    draftFallbackAttemptedRef.current = false
    void runAnalysisStreamRef.current()
    return () => {
      streamCleanupRef.current?.()
    }
  }, [messageId, isNativeBeap])

  /** When bulk auto-sort ends, run deferred advisory stream for the selected message (auto path only). */
  useEffect(() => {
    const wasSorting = prevSortingActiveRef.current
    prevSortingActiveRef.current = isSortingActive
    if (!wasSorting || isSortingActive || !messageId) return
    if (autoAnalyzeStreamFailedRef.current.has(messageId)) return
    if (useEmailInboxStore.getState().analysisCache[messageId]) return
    void runAnalysisStreamRef.current()
  }, [isSortingActive, messageId])

  /** FIX-H6: Clear draft-edit indicator when switching to a different message. */
  useEffect(() => {
    const store = useEmailInboxStore.getState()
    if (store.editingDraftForMessageId && store.editingDraftForMessageId !== messageId) {
      store.setEditingDraftForMessageId(null)
    }
  }, [messageId])

  /** Analysis visibility controlled ONLY by user toggle. Never auto-collapse when draft is generated (FIX-H1). */
  /** Analysis collapse only hides content; panel width stays constant. Never trigger panel collapse. */
  useEffect(() => {
    onCollapsedChange?.(false)
  }, [onCollapsedChange])

  /** Connect to chat bar for draft refinement — on click or focus (FIX-ISSUE-5). */
  const handleDraftRefineConnect = useCallback(() => {
    const text = (editedDraft || draft) ?? ''
    if (!text.trim()) return
    const subject = message?.subject ?? null
    draftRefineConnect(
      messageId,
      subject,
      text,
      (refined) => {
        setDraft(refined)
        setEditedDraft(refined)
      },
      'email',
    )
  }, [messageId, message?.subject, editedDraft, draft, draftRefineConnect])

  const handleCapsulePublicRefineConnect = useCallback(() => {
    const st = useDraftRefineStore.getState()
    if (st.connected && st.messageId === messageId && st.refineTarget === 'capsule-public') {
      draftRefineDisconnect()
      useEmailInboxStore.getState().setEditingDraftForMessageId(null)
      return
    }
    const subject = message?.subject ?? null
    draftRefineConnect(
      messageId,
      subject,
      capsulePublicText,
      (refined) => {
        setCapsulePublicText(refined)
      },
      'capsule-public',
    )
    useEmailInboxStore.getState().setEditingDraftForMessageId(messageId)
  }, [messageId, message?.subject, capsulePublicText, draftRefineConnect, draftRefineDisconnect])

  const handleCapsuleEncryptedRefineConnect = useCallback(() => {
    const st = useDraftRefineStore.getState()
    if (st.connected && st.messageId === messageId && st.refineTarget === 'capsule-encrypted') {
      draftRefineDisconnect()
      useEmailInboxStore.getState().setEditingDraftForMessageId(null)
      return
    }
    const subject = message?.subject ?? null
    draftRefineConnect(
      messageId,
      subject,
      capsuleEncryptedText,
      (refined) => {
        setCapsuleEncryptedText(refined)
      },
      'capsule-encrypted',
    )
    useEmailInboxStore.getState().setEditingDraftForMessageId(messageId)
  }, [messageId, message?.subject, capsuleEncryptedText, draftRefineConnect, draftRefineDisconnect])

  useEffect(() => {
    if (!isNativeBeap || !visibleSections.has('draft')) return
    console.log(
      `[BEAP_DRAFT_EDITOR_RENDER] ${JSON.stringify({
        messageId,
        fieldName: 'pBEAP public preview',
        renderedValueLength: capsulePublicText.length,
        sourcePath: capsulePublicSource,
      })}`,
    )
  }, [isNativeBeap, visibleSections, messageId, capsulePublicText, capsulePublicSource])

  useEffect(() => {
    if (!isNativeBeap || !visibleSections.has('draft')) return
    console.log(
      `[BEAP_DRAFT_EDITOR_RENDER] ${JSON.stringify({
        messageId,
        fieldName: 'qBEAP full draft reply',
        renderedValueLength: capsuleEncryptedText.length,
        sourcePath: capsuleEncryptedSource,
      })}`,
    )
    if (
      capsuleEncryptedText.trim() &&
      capsulePublicText.trim() &&
      (capsuleEncryptedSource === 'data.draftReplyPublic' ||
        capsuleEncryptedSource === 'data.capsuleDraft.publicText')
    ) {
      console.error(
        `[BEAP_DRAFT_FIELD_SOURCE_BUG] ${JSON.stringify({
          messageId,
          fieldName: 'qBEAP full draft reply',
          sourcePath: capsuleEncryptedSource,
          renderedValueLength: capsuleEncryptedText.length,
          publicPreviewLength: capsulePublicText.length,
        })}`,
      )
    }
  }, [
    isNativeBeap,
    visibleSections,
    messageId,
    capsuleEncryptedText,
    capsuleEncryptedSource,
    capsulePublicText,
  ])

  useEffect(() => {
    if (!draftRefineConnected || draftRefineMessageId !== messageId) return
    function handleClickOutside(e: globalThis.MouseEvent) {
      const target = e.target as Node
      // Top HybridSearch bar lives outside draftRef — exclude it so refinement can be typed there.
      const chatBar = document.querySelector('.hs-root')
      if (chatBar && chatBar.contains(target)) return
      if (draftRef.current && !draftRef.current.contains(target)) {
        draftRefineDisconnect()
        useEmailInboxStore.getState().setEditingDraftForMessageId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [draftRefineConnected, draftRefineMessageId, messageId, draftRefineDisconnect])

  useEffect(() => {
    if (!draftRefineConnected || draftRefineMessageId !== messageId) return
    const rt = useDraftRefineStore.getState().refineTarget
    if (rt === 'capsule-public') {
      useDraftRefineStore.getState().updateDraftText(capsulePublicText)
    } else if (rt === 'capsule-encrypted') {
      useDraftRefineStore.getState().updateDraftText(capsuleEncryptedText)
    } else {
      useDraftRefineStore.getState().updateDraftText(editedDraft || draft || '')
    }
  }, [
    draftRefineConnected,
    draftRefineMessageId,
    messageId,
    editedDraft,
    draft,
    capsulePublicText,
    capsuleEncryptedText,
    draftRefineTarget,
  ])

  const handleSummarize = useCallback(async () => {
    if (!window.emailInbox?.aiSummarize) {
      console.warn(`[AI-SUMMARIZE][detail] missing bridge messageId=${messageId}`)
      setAnalysisError(
        'Summarize unavailable: email AI API is not connected (reload the app or check the preload bridge).'
      )
      return
    }
    console.log(`[AI-SUMMARIZE][detail] start messageId=${messageId}`)
    setSummarizeLoading(true)
    setAnalysisError(null)
    try {
      const res = await window.emailInbox.aiSummarize(messageId)
      const data = res.data as { summary?: string; error?: boolean } | undefined
      const isError = !res.ok || !data?.summary || !!data.error
      const failReason = !res.ok
        ? 'http_not_ok'
        : !data?.summary
          ? 'empty_summary'
          : data.error
            ? 'api_error_flag'
            : 'ok'
      if (isError) {
        console.warn(`[AI-SUMMARIZE][detail] fail messageId=${messageId} reason=${failReason}`)
        const httpMsg = !res.ok ? String((res as { message?: string; error?: string }).message ?? (res as { error?: string }).error ?? '') : ''
        setAnalysisError(
          inboxFailureLooksEmbeddingOnly(httpMsg)
            ? 'Semantic context unavailable; generated without retrieval context.'
            : 'Couldn’t generate a summary. Check that your AI model is available, then try Summarize again.',
        )
      } else {
        console.log(`[AI-SUMMARIZE][detail] ok messageId=${messageId}`)
        const summaryText = data!.summary!
        manualSummaryOverrideRef.current = { messageId, summary: summaryText }
        setAnalysis((prev) => {
          const next: NormalInboxAiResult =
            prev === null
              ? {
                  needsReply: false,
                  needsReplyReason: '',
                  summary: summaryText,
                  urgencyScore: 5,
                  urgencyReason: '',
                  actionItems: [],
                  archiveRecommendation: 'keep',
                  archiveReason: '',
                }
              : {
                  needsReply: prev.needsReply,
                  needsReplyReason: prev.needsReplyReason,
                  summary: summaryText,
                  urgencyScore: prev.urgencyScore,
                  urgencyReason: prev.urgencyReason,
                  actionItems: prev.actionItems,
                  archiveRecommendation: prev.archiveRecommendation,
                  archiveReason: prev.archiveReason,
                  ...(prev.draftReply !== undefined ? { draftReply: prev.draftReply } : {}),
                }
          useEmailInboxStore.getState().setAnalysisCache(messageId, next)
          return next
        })
        setReceivedFields((prev) => new Set([...prev, 'summary' as NormalInboxAiResultKey]))
      }
    } catch (err) {
      console.warn(`[AI-SUMMARIZE][detail] fail messageId=${messageId} reason=exception`, err)
      const msg = err instanceof Error ? err.message : ''
      setAnalysisError(
        inboxFailureLooksEmbeddingOnly(msg)
          ? 'Semantic context unavailable; generated without retrieval context.'
          : 'Summarize failed (unexpected error). Check the developer console and try again.',
      )
    } finally {
      setSummarizeLoading(false)
    }
    summaryRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messageId])

  useEffect(() => {
    setAttachments([])
  }, [messageId])

  useEffect(() => {
    if (!isNativeBeap) return
    const loadSessions = async () => {
      const api = window.orchestrator
      if (typeof api?.connect !== 'function' || typeof api?.listSessions !== 'function') {
        setAvailableSessions([])
        return
      }
      try {
        await api.connect()
        const json = (await api.listSessions()) as {
          success?: boolean
          data?: Array<{ id: string; name: string }>
        }
        if (json.success && Array.isArray(json.data)) {
          setAvailableSessions(json.data.map((s) => ({ id: s.id, name: s.name })))
        } else {
          setAvailableSessions([])
        }
      } catch (e) {
        console.warn('Failed to load orchestrator sessions (IPC):', e)
        setAvailableSessions([])
      }
    }
    void loadSessions()
  }, [isNativeBeap])

  const handleDraftReply = useCallback(async (opts?: { supersede?: boolean }) => {
    if (!window.emailInbox?.aiDraftReply) return
    setDraftLoading(true)
    setDraft(null)
    setDraftError(false)
    setDraftErrorMessage(null)
    setDraftErrorDebug(null)
    setAttachments([])
    setCapsuleDraftIssue(null)
    try {
      const res = await window.emailInbox.aiDraftReply(messageId, opts)
      const data = res.data
      const native = data?.isNativeBeap && data.capsuleDraft
      const payload = res as {
        ok: boolean
        inboxErrorCode?: string
        message?: string
        error?: string
        debug?: InboxAiErrorDebugPayload
        data?: typeof data
      }
      if (res.ok && native) {
        const fieldSelection = resolveNativeBeapDraftFields(data as NativeBeapDraftData)
        const dq = data as NativeBeapDraftData & {
          draftReplyFull?: unknown
          draftReplyPublic?: unknown
        }
        const draftReplyLen = typeof dq.draftReply === 'string' ? dq.draftReply.length : 0
        const draftReplyFullLen = typeof dq.draftReplyFull === 'string' ? dq.draftReplyFull.length : 0
        const draftReplyPublicLen = typeof dq.draftReplyPublic === 'string' ? dq.draftReplyPublic.length : 0
        const qbeapReplyLen = typeof dq.qbeapReply === 'string' ? dq.qbeapReply.length : 0
        const pbeapReplyLen = typeof dq.pbeapReply === 'string' ? dq.pbeapReply.length : 0
        const capsuleEncryptedLen =
          typeof data?.capsuleDraft?.encryptedText === 'string' ? data.capsuleDraft.encryptedText.length : 0
        const capsulePublicLen =
          typeof data?.capsuleDraft?.publicText === 'string' ? data.capsuleDraft.publicText.length : 0
        console.log(
          `[BEAP_DRAFT_RENDERER_RECEIVED] ${JSON.stringify({
            messageId,
            dataKeys: Object.keys(data ?? {}),
            qbeapReplyLen,
            pbeapReplyLen,
            draftReplyLen,
            draftReplyFullLen,
            draftReplyPublicLen,
            capsuleEncryptedLen,
            capsulePublicLen,
          })}`,
        )
        console.log(
          `[BEAP_DRAFT_RENDERER_RESULT] ${JSON.stringify({
            resultKeys: Object.keys(res ?? {}),
            dataKeys: Object.keys(data ?? {}),
            qbeapDraftSource: fieldSelection.mainSource,
            qbeapDraftLen: fieldSelection.mainDraft.length,
            pbeapDraftSource: fieldSelection.publicSource,
            pbeapDraftLen: fieldSelection.publicPreview.length,
          })}`,
        )
        if (
          fieldSelection.mainDraft.length > 0 &&
          fieldSelection.publicPreview.length > 0 &&
          (fieldSelection.mainSource === 'data.draftReplyPublic' ||
            fieldSelection.mainSource === 'data.capsuleDraft.publicText' ||
            fieldSelection.equalsPublicText)
        ) {
          console.error(
            `[BEAP_DRAFT_FIELD_SOURCE_BUG] ${JSON.stringify({
              messageId,
              mainDraftSourceBug: fieldSelection.mainSource,
              mainDraftLen: fieldSelection.mainDraft.length,
              publicPreviewLen: fieldSelection.publicPreview.length,
            })}`,
          )
        }
        const issue = (data as { capsuleDraftIssue?: 'full_reply_missing' | 'full_reply_suspiciously_short' })
          .capsuleDraftIssue
        setCapsuleDraftIssue(issue ?? null)
        console.log(
          `[BEAP_EDITOR_FIELD_SOURCE] ${JSON.stringify({
            messageId,
            fieldType: 'pbeap',
            sourcePath: fieldSelection.publicSource,
            renderedLen: fieldSelection.publicPreview.length,
          })}`,
        )
        console.log(
          `[BEAP_EDITOR_FIELD_SOURCE] ${JSON.stringify({
            messageId,
            fieldType: 'qbeap',
            sourcePath: fieldSelection.mainSource,
            renderedLen: fieldSelection.mainDraft.length,
          })}`,
        )
        const pubText = fieldSelection.publicPreview.trim()
        const encText = fieldSelection.mainDraft.trim()
        setCapsulePublicText(pubText)
        setCapsulePublicSource(pubText ? fieldSelection.publicSource : 'none')
        setCapsuleEncryptedText(encText)
        setCapsuleEncryptedSource(encText ? fieldSelection.mainSource : 'none')
        setDraftError(false)
        setDraftErrorMessage(null)
        setDraftErrorDebug(null)
        setVisibleSections((prev) => {
          if (prev.has('draft')) return prev
          const next = new Set(prev)
          next.add('draft')
          return next
        })
      } else if (res.ok && data?.draft) {
        setDraft(data.draft)
        setEditedDraft(data.draft)
        setDraftError(!!data.error)
        if (data.error) {
          const { userMessage, debug } = inboxAiDraftReplyErrorDisplay(payload)
          setDraftErrorMessage(userMessage || 'AI generation failed for the selected model.')
          if (import.meta.env.DEV) setDraftErrorDebug(debug ?? null)
        } else {
          setDraftErrorMessage(null)
          setDraftErrorDebug(null)
        }
      } else {
        setDraftError(true)
        const { userMessage, debug } = inboxAiDraftReplyErrorDisplay(payload)
        setDraftErrorMessage(userMessage || 'AI generation failed for the selected model.')
        if (import.meta.env.DEV) setDraftErrorDebug(debug ?? null)
      }
    } catch {
      setDraftError(true)
      setDraftErrorMessage('AI generation failed for the selected model.')
      setDraftErrorDebug(null)
    } finally {
      setDraftLoading(false)
    }
    draftRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messageId])

  /** If analyze stream ends with needsReply but no draftReply, fetch draft once via aiDraftReply. */
  useEffect(() => {
    if (!messageId || !visibleSections.has('draft')) return
    if (isNativeBeap) return
    if (analysisLoading || !analysis?.needsReply) return
    if ((draft ?? '').trim() || draftLoading) return
    if (editedDraft.trim()) return
    if (draftFallbackAttemptedRef.current) return
    draftFallbackAttemptedRef.current = true
    void handleDraftReply()
  }, [
    messageId,
    visibleSections,
    isNativeBeap,
    analysisLoading,
    analysis?.needsReply,
    draft,
    draftLoading,
    editedDraft,
    handleDraftReply,
  ])

  /** Native BEAP: fetch capsule draft once when both fields empty — do not wait for analysis or needsReply. */
  useEffect(() => {
    if (!messageId || !visibleSections.has('draft')) return
    if (!isNativeBeap) return
    if (capsuleEncryptedText.trim() || capsulePublicText.trim()) return
    if (draftLoading) return
    if (draftFallbackAttemptedRef.current) return
    draftFallbackAttemptedRef.current = true
    void handleDraftReply()
  }, [
    messageId,
    visibleSections,
    isNativeBeap,
    capsuleEncryptedText,
    capsulePublicText,
    draftLoading,
    handleDraftReply,
  ])

  const handleRegenerateDraft = useCallback(() => {
    void handleDraftReply({ supersede: true })
  }, [handleDraftReply])

  const handleAddAttachment = useCallback(async () => {
    if (!window.emailInbox?.showOpenDialogForAttachments) return
    const res = await window.emailInbox.showOpenDialogForAttachments()
    const picked = res?.ok ? res.data?.files : undefined
    if (picked?.length) {
      setAttachments((prev) => [...prev, ...picked])
    }
  }, [])

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const [sending, setSending] = useState(false)

  const handleSendCapsuleReply = useCallback(async () => {
    if (!message?.handshake_id) {
      setSendResult({ success: false, error: 'No handshake linked to this message' })
      return
    }
    setSendingCapsule(true)
    setSendResult(null)
    try {
      const records = await listHandshakes('active')
      const raw = records.find((r: { handshake_id?: string }) => r.handshake_id === message.handshake_id) as
        | Record<string, unknown>
        | undefined
      if (!raw) {
        setSendResult({ success: false, error: 'Handshake not found' })
        return
      }
      const selectedRecipient = mapLedgerRecordToSelectedRecipient(raw)
      if (!hasHandshakeKeyMaterial(selectedRecipient)) {
        setSendResult({
          success: false,
          error: 'Handshake is missing X25519 / ML-KEM keys — re-establish the handshake for qBEAP.',
        })
        return
      }
      const kp = await getSigningKeyPair()
      const senderFp = kp.publicKey
      const senderShort =
        senderFp.length > 12 ? `${senderFp.slice(0, 4)}…${senderFp.slice(-4)}` : senderFp
      const pub = capsulePublicText.trim()
      const enc = capsuleEncryptedText.trim()
      const config: BeapPackageConfig = {
        recipientMode: 'private',
        deliveryMethod: 'p2p',
        selectedRecipient,
        senderFingerprint: senderFp,
        senderFingerprintShort: senderShort,
        messageBody: pub,
        encryptedMessage: enc || undefined,
        attachments: [],
      }
      const delivery = await executeDeliveryAction(config)
      if (delivery.success) {
        try {
          const subj =
            message.subject?.startsWith('Re:') ? message.subject : `Re: ${message.subject || '(No subject)'}`
          void window.outbox
            ?.insertSent?.({
              id: crypto.randomUUID(),
              handshakeId: message.handshake_id ?? undefined,
              counterpartyDisplay: message.from_address || message.from_name || 'Unknown',
              subject: subj,
              publicBodyPreview: pub.slice(0, 500),
              encryptedBodyPreview: enc ? enc.slice(0, 500) : undefined,
              hasEncryptedInner: !!enc,
              deliveryMethod: 'p2p',
              deliveryStatus: 'sent',
              deliveryDetailJson: JSON.stringify({
                action: delivery.action,
                message: delivery.message,
                coordinationRelayDelivery: delivery.coordinationRelayDelivery,
                delivered: delivery.delivered,
              }),
            })
            ?.catch((err: unknown) => console.warn('[Outbox] insert failed:', err))
        } catch {
          /* fire-and-forget */
        }
        setSendResult({ success: true })
        if (capsuleSendSuccessTimerRef.current) {
          clearTimeout(capsuleSendSuccessTimerRef.current)
          capsuleSendSuccessTimerRef.current = null
        }
        capsuleSendSuccessTimerRef.current = setTimeout(() => {
          capsuleSendSuccessTimerRef.current = null
          setCapsulePublicText('')
          setCapsuleEncryptedText('')
          setSelectedSessionId(null)
          setCapsuleAttachments([])
          setSendResult(null)
        }, 2000)
      } else {
        setSendResult({ success: false, error: delivery.message || 'Send failed' })
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Send failed'
      setSendResult({ success: false, error: msg })
    } finally {
      setSendingCapsule(false)
    }
  }, [message, capsulePublicText, capsuleEncryptedText])

  const handleSend = useCallback(async () => {
    if (!message || !onSendDraft) return
    const draftToSend = isNativeBeap
      ? [capsulePublicText, capsuleEncryptedText].map((s) => s.trim()).filter(Boolean).join('\n\n---\n\n')
      : (editedDraft || draft) ?? ''
    if (!draftToSend.trim()) return
    setSending(true)
    try {
      const result = await onSendDraft(draftToSend, message, attachments.length > 0 ? attachments : undefined)
      if (result) {
        setDraft(null)
        setEditedDraft('')
        setAttachments([])
        if (isNativeBeap) {
          setCapsulePublicText('')
          setCapsuleEncryptedText('')
          setSelectedSessionId(null)
          setCapsuleAttachments([])
        }
      }
    } finally {
      setSending(false)
    }
  }, [
    message,
    onSendDraft,
    isNativeBeap,
    editedDraft,
    draft,
    attachments,
    capsulePublicText,
    capsuleEncryptedText,
  ])

  const handleArchive = useCallback(() => {
    if (onArchive && messageId) onArchive([messageId])
  }, [onArchive, messageId])

  const handleDelete = useCallback(() => {
    if (onDelete && messageId) onDelete([messageId])
  }, [onDelete, messageId])

  const handleRetryAnalysis = useCallback(() => {
    if (analysisLoading) return
    autoAnalyzeStreamFailedRef.current.delete(messageId)
    setAnalysisError(null)
    setAnalysisStreamParseFailed(false)
    setInboxAiAnalyzeDebug(null)
    setInboxAiSemanticDevNote(null)
    void runAnalysisStream({ manual: true, supersede: true })
  }, [messageId, runAnalysisStream, analysisLoading])

  const handleRetryDraft = useCallback(() => {
    setDraftError(false)
    setDraftErrorMessage(null)
    setDraftErrorDebug(null)
    void handleDraftReply({ supersede: true })
  }, [handleDraftReply])

  const toggleActionChecked = useCallback((idx: number) => {
    setActionChecked((prev) => ({ ...prev, [idx]: !prev[idx] }))
  }, [])

  const toggleSection = useCallback((section: string) => {
    setVisibleSections((prev) => {
      const next = new Set(prev)
      if (next.has(section)) {
        if (next.size > 1) {
          next.delete(section)
        }
      } else {
        next.add(section)
      }
      return next
    })
  }, [])

  const isDepackaged = message?.source_type === 'email_plain'

  const inboxAiWorkInFlight = analysisLoading || draftLoading
  /** Combined / single-flight labels shown in `inbox-detail-ai-loading`. */
  const inboxAiWorkLabel =
    analysisLoading && draftLoading
      ? 'AI is processing this message…'
      : draftLoading
        ? 'Generating reply…'
        : analysisLoading
          ? 'Analyzing message…'
          : null

  return (
    <div className="inbox-detail-ai-inner inbox-detail-ai-premium" role="complementary" aria-label="AI email analysis">
      <div className="inbox-detail-ai-action-bar">
        <button
          type="button"
          className={`inbox-detail-ai-section-toggle${visibleSections.has('summary') ? ' inbox-detail-ai-section-toggle--active' : ''}`}
          onClick={() => {
            const willShow = !visibleSections.has('summary')
            toggleSection('summary')
            if (willShow && !(analysis?.summary ?? '').trim() && !summarizeLoading) {
              void handleSummarize()
            }
          }}
          aria-pressed={visibleSections.has('summary')}
          aria-label="Toggle summary section"
        >
          <span className="inbox-detail-ai-section-toggle-check" aria-hidden>
            {visibleSections.has('summary') ? '☑' : '☐'}
          </span>
          <span>Summary</span>
        </button>
        <button
          type="button"
          className={`inbox-detail-ai-section-toggle${visibleSections.has('draft') ? ' inbox-detail-ai-section-toggle--active' : ''}`}
          onClick={() => {
            const willShow = !visibleSections.has('draft')
            toggleSection('draft')
            if (willShow && !draft && !draftLoading && !isNativeBeap) {
              void handleDraftReply()
            }
          }}
          aria-pressed={visibleSections.has('draft')}
          aria-label="Toggle draft section"
        >
          <span className="inbox-detail-ai-section-toggle-check" aria-hidden>
            {visibleSections.has('draft') ? '☑' : '☐'}
          </span>
          <span>✎ Draft</span>
        </button>
        <button
          type="button"
          className={`inbox-detail-ai-section-toggle${visibleSections.has('analysis') ? ' inbox-detail-ai-section-toggle--active' : ''}`}
          onClick={() => {
            const willShow = !visibleSections.has('analysis')
            toggleSection('analysis')
            if (willShow && !analysis && !analysisLoading) {
              void runAnalysisStream({ manual: true })
            }
          }}
          aria-pressed={visibleSections.has('analysis')}
          aria-label="Toggle analysis section"
        >
          <span className="inbox-detail-ai-section-toggle-check" aria-hidden>
            {visibleSections.has('analysis') ? '☑' : '☐'}
          </span>
          <span>Analysis</span>
        </button>
        {onDelete && messageId ? (
          <button
            type="button"
            className="inbox-detail-ai-action-btn inbox-detail-ai-action-btn--danger inbox-detail-ai-action-bar-delete"
            onClick={handleDelete}
            aria-label="Delete email"
          >
            🗑️
          </button>
        ) : null}
      </div>
      <div className="inbox-detail-ai-scroll">
        {inboxAiWorkInFlight && inboxAiWorkLabel ? (
          <div className="inbox-detail-ai-loading" role="status" aria-live="polite" aria-busy="true">
            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="inbox-detail-ai-skeleton-inline" style={{ width: 18, minHeight: 14, flexShrink: 0 }} aria-hidden />
              <span>{inboxAiWorkLabel}</span>
            </div>
          </div>
        ) : null}
        {analysisError && !analysisStreamParseFailed ? (
          <div className="inbox-detail-ai-error-banner">
            <span>{analysisError}</span>
            <button type="button" onClick={handleRetryAnalysis} disabled={analysisLoading}>Retry</button>
            {import.meta.env.DEV && inboxAiAnalyzeDebug && (
              <pre
                className="inbox-detail-ai-debug-json"
                style={{ marginTop: 8, fontSize: 11, opacity: 0.85, whiteSpace: 'pre-wrap' }}
              >
                {JSON.stringify(inboxAiAnalyzeDebug, null, 2)}
              </pre>
            )}
          </div>
        ) : null}
        {import.meta.env.DEV && inboxAiSemanticDevNote && (
          <div className="inbox-detail-ai-muted" style={{ marginBottom: 8, fontSize: 12 }}>
            {inboxAiSemanticDevNote}
          </div>
        )}

        {visibleSections.has('analysis') && (
          <div className="inbox-detail-ai-section inbox-detail-ai-section--tab-panel">
            <div className="ai-analysis-body">
            {analysisStreamParseFailed && (
              <div className="inbox-detail-ai-error-banner" style={{ marginBottom: 12 }}>
                <span>
                  Analysis unavailable — the AI response could not be parsed. Check the developer console for{' '}
                  <code style={{ fontSize: '0.95em' }}>[INBOX_ANALYSIS_PARSE_FAIL]</code>.
                </span>
                <button type="button" onClick={handleRetryAnalysis} disabled={analysisLoading}>
                  Retry
                </button>
              </div>
            )}
            {/* Response Needed */}
            <div className="inbox-detail-ai-row">
              <span className="inbox-detail-ai-row-label">Response Needed</span>
              <div className="inbox-detail-ai-row-value">
                {analysisLoading && !receivedFields.has('needsReply') ? (
                  <span className="inbox-detail-ai-skeleton-inline" />
                ) : analysis ? (
                  <span className="inbox-detail-ai-response-needed">
                    <span className="inbox-detail-ai-dot" style={{ background: analysis.needsReply ? '#ef4444' : '#22c55e' }} />
                    {analysis.needsReply ? 'Yes' : 'No'} — {analysis.needsReplyReason || '—'}
                  </span>
                ) : (
                  <span className="inbox-detail-ai-muted">—</span>
                )}
              </div>
            </div>

            {/* Summary */}
            <div className="inbox-detail-ai-row" ref={summaryRef}>
              <span className="inbox-detail-ai-row-label">Summary</span>
              <div className="inbox-detail-ai-row-value">
                {summarizeLoading ? (
                  <span className="inbox-detail-ai-skeleton-inline" style={{ width: '80%' }} aria-busy="true" />
                ) : analysisLoading && !receivedFields.has('summary') ? (
                  <span className="inbox-detail-ai-skeleton-inline" style={{ width: '80%' }} />
                ) : analysis?.summary ? (
                  <span className="inbox-detail-ai-text">{analysis.summary}</span>
                ) : (
                  <span className="inbox-detail-ai-muted">—</span>
                )}
              </div>
            </div>

            {/* Urgency */}
            <div className="inbox-detail-ai-row">
              <span className="inbox-detail-ai-row-label">Urgency</span>
              <div className="inbox-detail-ai-row-value">
                {analysisLoading && !receivedFields.has('urgencyScore') ? (
                  <span className="inbox-detail-ai-skeleton-inline" />
                ) : analysis ? (
                  <InboxUrgencyMeter
                    score={analysis.urgencyScore}
                    variant="panel"
                    reason={analysis.urgencyReason || '—'}
                  />
                ) : (
                  <span className="inbox-detail-ai-muted">—</span>
                )}
              </div>
            </div>

            {/* Action Items */}
            <div className="inbox-detail-ai-row">
              <span className="inbox-detail-ai-row-label">Action Items</span>
              <div className="inbox-detail-ai-row-value">
                {analysisLoading && !receivedFields.has('actionItems') ? (
                  <span className="inbox-detail-ai-skeleton-inline" />
                ) : analysis?.actionItems?.length ? (
                  <ul className="inbox-detail-ai-action-list">
                    {analysis.actionItems.map((item, idx) => (
                      <li key={idx} className="inbox-detail-ai-action-item">
                        <input type="checkbox" checked={!!actionChecked[idx]} onChange={() => toggleActionChecked(idx)} />
                        <span style={{ textDecoration: actionChecked[idx] ? 'line-through' : undefined }}>{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="inbox-detail-ai-muted">None.</span>
                )}
              </div>
            </div>

            {/* Suggested action */}
            <div className="inbox-detail-ai-row">
              <span className="inbox-detail-ai-row-label">Suggested action</span>
              <div className="inbox-detail-ai-row-value">
                {analysisLoading && !receivedFields.has('archiveRecommendation') ? (
                  <span className="inbox-detail-ai-skeleton-inline" />
                ) : analysis ? (
                  <>
                    <span className="inbox-detail-ai-text">
                      {analysis.archiveRecommendation === 'archive'
                        ? `Consider archiving — ${analysis.archiveReason || '—'}`
                        : `Keep for now — ${analysis.archiveReason || '—'}`}
                    </span>
                    {analysis.archiveRecommendation === 'archive' && onArchive && (
                      <button
                        type="button"
                        className="inbox-detail-ai-btn-primary inbox-detail-ai-archive-btn"
                        aria-label="Archive email"
                        onClick={handleArchive}
                      >
                        Archive
                      </button>
                    )}
                  </>
                ) : (
                  <span className="inbox-detail-ai-muted">—</span>
                )}
              </div>
            </div>
            </div>
          </div>
        )}

        {visibleSections.has('summary') && !visibleSections.has('analysis') && (
          <div className="inbox-detail-ai-section inbox-detail-ai-section--tab-panel">
            <div className="inbox-detail-ai-section-heading">SUMMARY</div>
            <div className="inbox-detail-ai-section-body" ref={summaryRef}>
              {summarizeLoading ? (
                <span className="inbox-detail-ai-skeleton-inline" style={{ width: '80%' }} aria-busy="true" />
              ) : analysisLoading && !receivedFields.has('summary') ? (
                <span className="inbox-detail-ai-skeleton-inline" style={{ width: '80%' }} />
              ) : (analysis?.summary ?? '').trim() ? (
                <span className="inbox-detail-ai-text">{analysis?.summary}</span>
              ) : (
                <span className="inbox-detail-ai-muted">Use the Summary checkbox to generate…</span>
              )}
            </div>
            <div className="inbox-detail-ai-row">
              <span className="inbox-detail-ai-row-label">Urgency</span>
              <div className="inbox-detail-ai-row-value">
                {analysisLoading && !receivedFields.has('urgencyScore') ? (
                  <span className="inbox-detail-ai-skeleton-inline" />
                ) : analysis ? (
                  <InboxUrgencyMeter
                    score={analysis.urgencyScore}
                    variant="panel"
                    reason={analysis.urgencyReason || '—'}
                  />
                ) : (
                  <span className="inbox-detail-ai-muted">—</span>
                )}
              </div>
            </div>
          </div>
        )}

        {visibleSections.has('draft') && (
          <div className="inbox-detail-ai-section inbox-detail-ai-section--tab-panel">
            <div
              className={`inbox-detail-ai-row inbox-detail-ai-row-draft ai-draft-expanded${
                draftRefineConnected && draftRefineMessageId === messageId ? ' ai-draft-connected' : ''
              }`}
              ref={draftRef}
            >
              {isNativeBeap ? (
                <>
                  <div className="ai-section-draft-header">
                    {draftRefineConnected &&
                    draftRefineMessageId === messageId &&
                    draftRefineTarget === 'capsule-public' ? (
                      <span
                        className="bulk-action-card-draft-subfocus-indicator"
                        title="Public field selected — chat scoped to this field"
                        aria-hidden
                      >
                        👉
                      </span>
                    ) : draftRefineConnected &&
                      draftRefineMessageId === messageId &&
                      draftRefineTarget === 'capsule-encrypted' ? (
                      <span
                        className="bulk-action-card-draft-subfocus-indicator"
                        title="Encrypted field selected — chat scoped to this field"
                        aria-hidden
                      >
                        👉
                      </span>
                    ) : null}
                    <span className="inbox-detail-ai-row-label">Capsule reply</span>
                    <span className="ai-draft-connect-hint">click a field to refine with AI ↑</span>
                  </div>
                  <div className="inbox-detail-ai-row-value">
                    <div className="inbox-ai-capsule-draft">
                      {draftError && isNativeBeap && (
                        <div
                          className="capsule-draft-error inbox-detail-ai-error-banner"
                          role="alert"
                        >
                          <span>{draftErrorMessage || 'AI generation failed for the selected model.'}</span>
                          <button
                            type="button"
                            className="capsule-draft-retry"
                            onClick={() => void handleDraftReply()}
                            disabled={draftLoading}
                          >
                            Retry
                          </button>
                          {import.meta.env.DEV && draftErrorDebug && (
                            <pre
                              className="inbox-detail-ai-debug-json"
                              style={{ marginTop: 8, fontSize: 11, opacity: 0.85, whiteSpace: 'pre-wrap' }}
                            >
                              {JSON.stringify(draftErrorDebug, null, 2)}
                            </pre>
                          )}
                        </div>
                      )}
                      <div
                        className={`capsule-draft-field${
                          draftRefineConnected &&
                          draftRefineMessageId === messageId &&
                          draftRefineTarget === 'capsule-public'
                            ? ' capsule-draft-field--selected'
                            : ''
                        }`}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                            flexWrap: 'wrap',
                            marginBottom: 4,
                          }}
                        >
                          <label className="capsule-field-label" style={{ marginBottom: 0 }}>
                            📨 Public Message (pBEAP) — AI summary preview
                            {draftRefineConnected &&
                            draftRefineMessageId === messageId &&
                            draftRefineTarget === 'capsule-public'
                              ? ' — connected to chat'
                              : ''}
                          </label>
                          <button
                            type="button"
                            onClick={handleCapsulePublicRefineConnect}
                            title={
                              draftRefineConnected &&
                              draftRefineMessageId === messageId &&
                              draftRefineTarget === 'capsule-public'
                                ? 'Disconnect AI refinement'
                                : 'Connect top chat for AI refinement'
                            }
                            style={{
                              flexShrink: 0,
                              background:
                                draftRefineConnected &&
                                draftRefineMessageId === messageId &&
                                draftRefineTarget === 'capsule-public'
                                  ? '#7c3aed'
                                  : 'transparent',
                              color:
                                draftRefineConnected &&
                                draftRefineMessageId === messageId &&
                                draftRefineTarget === 'capsule-public'
                                  ? '#fff'
                                  : '#7c3aed',
                              border: '1px solid #7c3aed',
                              borderRadius: 4,
                              padding: '4px 10px',
                              fontSize: 10,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {draftRefineConnected &&
                            draftRefineMessageId === messageId &&
                            draftRefineTarget === 'capsule-public'
                              ? '✏️ AI connected'
                              : '✏️ AI refine'}
                          </button>
                        </div>
                        {draftRefineConnected &&
                          draftRefineMessageId === messageId &&
                          draftRefineTarget === 'capsule-public' && (
                            <span className="ai-draft-connect-hint" style={{ marginBottom: 4 }}>
                              Connected to chat ↑ — type instructions to refine
                            </span>
                          )}
                        <textarea
                          className={`capsule-draft-textarea${
                            draftRefineConnected &&
                            draftRefineMessageId === messageId &&
                            draftRefineTarget === 'capsule-public'
                              ? ' capsule-draft-textarea--refine-connected'
                              : ''
                          }`}
                          placeholder="Short public preview (1–2 sentences). Full reply belongs in the encrypted field."
                          value={capsulePublicText}
                          onChange={(e) => {
                            setCapsulePublicText(e.target.value)
                            setCapsulePublicSource('user_edit')
                          }}
                          onFocus={() => {
                            useEmailInboxStore.getState().setEditingDraftForMessageId(messageId)
                          }}
                          rows={3}
                        />
                      </div>
                      <div
                        className={`capsule-draft-field capsule-draft-field--encrypted${
                          draftRefineConnected &&
                          draftRefineMessageId === messageId &&
                          draftRefineTarget === 'capsule-encrypted'
                            ? ' capsule-draft-field--selected'
                            : ''
                        }`}
                      >
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            gap: 8,
                            flexWrap: 'wrap',
                            marginBottom: 4,
                          }}
                        >
                          <label className="capsule-field-label capsule-field-label--encrypted" style={{ marginBottom: 0 }}>
                            🔒 Full draft reply (qBEAP · encrypted)
                            {draftRefineConnected &&
                            draftRefineMessageId === messageId &&
                            draftRefineTarget === 'capsule-encrypted'
                              ? ' — connected to chat'
                              : ''}
                          </label>
                          <button
                            type="button"
                            onClick={handleCapsuleEncryptedRefineConnect}
                            title={
                              draftRefineConnected &&
                              draftRefineMessageId === messageId &&
                              draftRefineTarget === 'capsule-encrypted'
                                ? 'Disconnect AI refinement'
                                : 'Connect top chat for AI refinement'
                            }
                            style={{
                              flexShrink: 0,
                              background:
                                draftRefineConnected &&
                                draftRefineMessageId === messageId &&
                                draftRefineTarget === 'capsule-encrypted'
                                  ? '#7c3aed'
                                  : 'transparent',
                              color:
                                draftRefineConnected &&
                                draftRefineMessageId === messageId &&
                                draftRefineTarget === 'capsule-encrypted'
                                  ? '#fff'
                                  : '#7c3aed',
                              border: '1px solid #7c3aed',
                              borderRadius: 4,
                              padding: '4px 10px',
                              fontSize: 10,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {draftRefineConnected &&
                            draftRefineMessageId === messageId &&
                            draftRefineTarget === 'capsule-encrypted'
                              ? '✏️ AI connected'
                              : '✏️ AI refine'}
                          </button>
                        </div>
                        {draftRefineConnected &&
                          draftRefineMessageId === messageId &&
                          draftRefineTarget === 'capsule-encrypted' && (
                            <span className="ai-draft-connect-hint" style={{ marginBottom: 4 }}>
                              Connected to chat ↑ — type instructions to refine
                            </span>
                          )}
                        <textarea
                          className={`capsule-draft-textarea capsule-draft-textarea--encrypted${
                            draftRefineConnected &&
                            draftRefineMessageId === messageId &&
                            draftRefineTarget === 'capsule-encrypted'
                              ? ' capsule-draft-textarea--refine-connected'
                              : ''
                          }`}
                          placeholder="Full AI draft reply — encrypted capsule body (authoritative when present)."
                          value={capsuleEncryptedText}
                          onChange={(e) => {
                            setCapsuleEncryptedText(e.target.value)
                            setCapsuleEncryptedSource('user_edit')
                          }}
                          onFocus={() => {
                            useEmailInboxStore.getState().setEditingDraftForMessageId(messageId)
                          }}
                          rows={4}
                        />
                        <div className="capsule-field-hint">
                          ⚠ This content is end-to-end encrypted and capsule-bound.
                        </div>
                        {capsuleDraftIssue === 'full_reply_missing' && (
                          <div className="capsule-field-hint" style={{ color: '#b45309', marginTop: 8 }}>
                            Full draft generation returned no text; only the public preview above may be shown. Try
                            another model or retry draft generation.
                          </div>
                        )}
                        {capsuleDraftIssue === 'full_reply_suspiciously_short' && (
                          <div className="capsule-field-hint" style={{ color: '#b45309', marginTop: 8 }}>
                            Full draft looks incomplete compared to the preview. Verify the encrypted field or retry.
                          </div>
                        )}
                      </div>
                      {/* Refined text: use chat expansion "USE ↓" only — no duplicate preview here (capsule fields). */}
                      <div className="capsule-draft-field">
                        <label className="capsule-field-label">Session (optional)</label>
                        <select
                          className="capsule-session-select"
                          value={selectedSessionId ?? ''}
                          onChange={(e) => setSelectedSessionId(e.target.value || null)}
                        >
                          <option value="">— No session —</option>
                          {availableSessions.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="capsule-draft-field">
                        <label className="capsule-field-label">Attachments</label>
                        <input
                          type="file"
                          accept=".pdf,.txt,.json,application/pdf,text/plain,application/json"
                          multiple
                          className="capsule-file-input"
                          onChange={(e) => {
                            if (e.target.files) setCapsuleAttachments(Array.from(e.target.files))
                          }}
                        />
                        {capsuleAttachments.length > 0 && (
                          <div className="capsule-attachment-list">
                            {capsuleAttachments.map((f, i) => (
                              <div key={`${f.name}-${i}`} className="capsule-attachment-chip">
                                📎 {f.name}
                                <button
                                  type="button"
                                  className="capsule-attachment-remove"
                                  onClick={() => setCapsuleAttachments((prev) => prev.filter((_, j) => j !== i))}
                                  aria-label="Remove attachment"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {visibleSections.has('draft') && (
                      <>
                        <div className="capsule-draft-actions">
                          <button
                            type="button"
                            className="capsule-draft-send"
                            onClick={() => void handleSendCapsuleReply()}
                            disabled={
                              sendingCapsule ||
                              sendResult?.success === true ||
                              (!capsulePublicText.trim() && !capsuleEncryptedText.trim())
                            }
                          >
                            {sendingCapsule ? 'Sending…' : '📤 Send BEAP Reply'}
                          </button>
                          <button
                            type="button"
                            className="capsule-draft-clear"
                            onClick={() => {
                              if (capsuleSendSuccessTimerRef.current) {
                                clearTimeout(capsuleSendSuccessTimerRef.current)
                                capsuleSendSuccessTimerRef.current = null
                              }
                              setCapsulePublicText('')
                              setCapsuleEncryptedText('')
                              setSelectedSessionId(null)
                              setCapsuleAttachments([])
                              setSendResult(null)
                            }}
                          >
                            Clear
                          </button>
                          <button
                            type="button"
                            className="capsule-draft-clear"
                            onClick={() => void handleDraftReply()}
                            disabled={draftLoading}
                          >
                            {draftLoading ? 'Generating…' : 'Draft'}
                          </button>
                        </div>
                        {sendResult && (
                          <div
                            className={`capsule-send-result ${
                              sendResult.success ? 'capsule-send-result--success' : 'capsule-send-result--error'
                            }`}
                          >
                            {sendResult.success
                              ? '✅ BEAP™ message sent successfully'
                              : `✗ ${sendResult.error}`}
                          </div>
                        )}
                      </>
                    )}
                    <div className="bulk-draft-actions-toolbar-wrap inbox-detail-ai-draft-actions">
                      <div className="bulk-draft-actions-toolbar">
                        {onArchive && messageId ? (
                          <button
                            type="button"
                            className="bulk-action-card-btn bulk-action-card-btn--secondary"
                            onClick={handleArchive}
                          >
                            Archive
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="ai-section-draft-header">
                    {draft && draftSubFocused ? (
                      <span
                        className="bulk-action-card-draft-subfocus-indicator"
                        title="Draft selected — chat scoped to this draft"
                        aria-hidden
                      >
                        ✏️
                      </span>
                    ) : null}
                    <span className="inbox-detail-ai-row-label">{draft ? 'DRAFT REPLY' : 'Draft Reply'}</span>
                    {draft ? <span className="ai-draft-connect-hint">click to refine with AI ↑</span> : null}
                  </div>
                  <div className="inbox-detail-ai-row-value inbox-ai-draft-section">
                      {draftError && (
                      <div className="inbox-detail-ai-error-banner">
                        <span>{draftErrorMessage || 'AI generation failed for the selected model.'}</span>
                        <button type="button" onClick={handleRetryDraft}>
                          Retry
                        </button>
                        {import.meta.env.DEV && draftErrorDebug && (
                          <pre
                            className="inbox-detail-ai-debug-json"
                            style={{ marginTop: 8, fontSize: 11, opacity: 0.85, whiteSpace: 'pre-wrap' }}
                          >
                            {JSON.stringify(draftErrorDebug, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                    {draftRefineConnected && draftRefineMessageId === messageId && (
                      <span className="ai-draft-connect-hint" style={{ marginBottom: 4 }}>
                        Connected to chat ↑ — type instructions to refine
                      </span>
                    )}
                    <textarea
                      ref={draftTextareaRef}
                      value={editedDraft || draft || ''}
                      onChange={(e) => setEditedDraft(e.target.value)}
                      onClick={handleDraftRefineConnect}
                      onFocus={() => {
                        setDraftSubFocused(true)
                        useEmailInboxStore.getState().setEditingDraftForMessageId(messageId)
                        handleDraftRefineConnect()
                      }}
                      onBlur={() => {
                        const stillConnected = useDraftRefineStore.getState().connected
                        setDraftSubFocused(false)
                        if (!stillConnected) {
                          useEmailInboxStore.getState().setEditingDraftForMessageId(null)
                        }
                      }}
                      className="inbox-detail-ai-draft-textarea"
                      readOnly={draftLoading}
                      aria-busy={draftLoading}
                      placeholder={
                        draftLoading
                          ? 'Draft will be generated…'
                          : analysisLoading
                            ? 'Draft will be generated when analysis finishes…'
                            : analysis?.needsReply
                              ? 'Edit draft before sending…'
                              : 'Optional reply — no response required for this message.'
                      }
                    />
                    {refinedDraftText && draftRefineConnected && draftRefineMessageId === messageId && (
                      <div className="inbox-detail-ai-refined-preview">
                        <div className="inbox-detail-ai-refined-header">
                          <span className="inbox-detail-ai-refined-label">Suggested refinement:</span>
                          <button
                            type="button"
                            className="inbox-detail-ai-accept-refinement"
                            onClick={acceptRefinement}
                            title="Apply refined draft"
                            aria-label="Apply refined draft"
                          >
                            ✓ Accept
                          </button>
                        </div>
                        <div className="inbox-detail-ai-refined-content">{refinedDraftText}</div>
                      </div>
                    )}
                    {attachments.length > 0 && (
                      <div className="draft-attachments">
                        {attachments.map((a, i) => (
                          <div key={i} className="attachment-chip">
                            <span>{a.name}</span>
                            <span className="attachment-size">{Math.round(a.size / 1024)}KB</span>
                            <button type="button" onClick={() => removeAttachment(i)} aria-label="Remove attachment">
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="bulk-draft-actions-toolbar-wrap inbox-detail-ai-draft-actions">
                      <div className="bulk-draft-actions-toolbar">
                        {isDepackaged && (
                          <button
                            type="button"
                            className="bulk-action-card-btn bulk-action-card-btn--secondary"
                            onClick={handleAddAttachment}
                            title="Add attachment"
                          >
                            📎 Attach
                          </button>
                        )}
                        {message && onSendDraft && !draftError && (
                          <button
                            type="button"
                            className="bulk-action-card-btn bulk-action-card-btn--primary bulk-action-card-btn--primary-emphasis"
                            onClick={handleSend}
                            disabled={sending || !(editedDraft || draft)?.trim()}
                          >
                            {sending ? 'Sending...' : isDepackaged ? 'Send via Email' : 'Send via BEAP'}
                          </button>
                        )}
                        {onArchive && messageId ? (
                          <button type="button" className="bulk-action-card-btn bulk-action-card-btn--secondary" onClick={handleArchive}>
                            Archive
                          </button>
                        ) : null}
                        <button type="button" className="bulk-action-card-btn bulk-action-card-btn--secondary" onClick={handleRegenerateDraft}>
                          Regenerate
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── InboxMessageRow ──

interface InboxMessageRowProps {
  message: InboxMessage
  selected: boolean
  bulkMode: boolean
  multiSelected: boolean
  onSelect: () => void
  onToggleMultiSelect: () => void
  onMouseEnter?: () => void
  onNavigateToHandshake?: (handshakeId: string) => void
  /**
   * Host orchestrator + internal list — row uses `canShowSandboxCloneAction` (same as message detail).
   * `authoritativeDeviceInternalRole` from main comes from persisted internal handshakes, not from mode alone.
   */
  sandboxOrchestrator: {
    modeReady: boolean
    orchestratorMode: 'host' | 'sandbox' | null
    authoritativeDeviceInternalRole: AuthoritativeDeviceInternalRole
    internalSandboxListReady: boolean
  }
  /** For dev visibility diagnostics only. */
  sandboxVisibilityDiagnostics: {
    activeInternalHandshakeCount: number
    internalListLoading: boolean
  }
  /** Drives Sandbox button hover (connected / offline / not configured). */
  sandboxAvailability: SandboxOrchestratorAvailability
  onSandboxInRow?: (e: MouseEvent, message: InboxMessage) => void
  /** Row-level Redirect (forwarding); independent of Sandbox clone eligibility. */
  onRedirectInRow?: (e: MouseEvent, message: InboxMessage) => void
}

function InboxMessageRow({
  message,
  selected,
  bulkMode,
  multiSelected,
  onSelect,
  onToggleMultiSelect,
  onMouseEnter,
  onNavigateToHandshake,
  sandboxOrchestrator,
  sandboxVisibilityDiagnostics,
  sandboxAvailability,
  onSandboxInRow,
  onRedirectInRow,
}: InboxMessageRowProps) {
  const canRowAction = isInboxMessageActionable(message)
  const canRowRedirect = Boolean(onRedirectInRow) && canRowAction
  const canShowParams = useMemo(
    () => ({ ...sandboxOrchestrator, message }),
    [
      message,
      sandboxOrchestrator.modeReady,
      sandboxOrchestrator.orchestratorMode,
      sandboxOrchestrator.authoritativeDeviceInternalRole,
      sandboxOrchestrator.internalSandboxListReady,
    ],
  )
  const canRowSandbox = canShowSandboxCloneAction(canShowParams)
  const rowRedirectTip = beapInboxRedirectTooltipPropsForRow()
  const rowSandboxTip = beapHostSandboxCloneTooltipForAvailability(sandboxAvailability, 'row')

  useEffect(() => {
    logSandboxActionVisibility({
      message_id: message.id,
      modeReady: sandboxOrchestrator.modeReady,
      orchestratorMode: sandboxOrchestrator.orchestratorMode,
      activeInternalSandboxHandshakeCount: sandboxVisibilityDiagnostics.activeInternalHandshakeCount,
      internalSandboxesLoading: sandboxVisibilityDiagnostics.internalListLoading,
      canShowParams,
    })
  }, [
    canShowParams,
    message.id,
    sandboxOrchestrator.modeReady,
    sandboxOrchestrator.orchestratorMode,
    sandboxVisibilityDiagnostics.activeInternalHandshakeCount,
    sandboxVisibilityDiagnostics.internalListLoading,
  ])
  const bodyPreview = (message.body_text || '').slice(0, 100).replace(/\s+/g, ' ').trim()
  const hasAttachments = message.has_attachments === 1

  const handleClick = () => {
    if (bulkMode) {
      onToggleMultiSelect()
    } else {
      onSelect()
    }
  }

  return (
    <div
      onClick={handleClick}
      onMouseEnter={onMouseEnter}
      className={`inbox-message-row ${selected && !bulkMode ? 'inbox-message-row--selected' : ''} ${bulkMode && multiSelected ? 'inbox-message-row--multi' : ''}`}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '12px 14px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        cursor: 'pointer',
        minWidth: 0,
      }}
    >
      {bulkMode && (
        <div
          style={{
            flexShrink: 0,
            width: 18,
            height: 18,
            borderRadius: 4,
            border: `2px solid ${multiSelected ? 'var(--purple-accent, #9333ea)' : 'var(--color-border, rgba(255,255,255,0.2))'}`,
            background: multiSelected ? 'var(--purple-accent, #9333ea)' : 'transparent',
          }}
        />
      )}
      {!bulkMode && selected && (
        <span
          style={{
            flexShrink: 0,
            fontSize: 14,
            lineHeight: 1,
            color: 'var(--purple-accent, #a78bfa)',
          }}
          title="Focused message — chat/search scoped to this BEAP message"
          aria-hidden
        >
          👉
        </span>
      )}

      {/* B = normal BEAP row; S = sandbox clone (see inboxMessageIsSandboxBeapClone) */}
      <InboxBeapSourceBadgeListRow message={message} />

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
          {onNavigateToHandshake ? (
            <InboxHandshakeNavIconButton message={message} onNavigateToHandshake={onNavigateToHandshake} />
          ) : null}
          <div className="msg-sender" style={{ minWidth: 0, flex: 1 }}>
            <span
              className="msg-sender-name"
              style={{
                fontSize: 12,
                fontWeight: message.read_status === 0 ? 700 : 500,
                color: 'var(--color-text, #e2e8f0)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'block',
              }}
            >
              {message.from_name || message.from_address || '—'}
              {message.from_address &&
                message.from_name &&
                message.from_name.trim() !== message.from_address.trim() && (
                  <span style={{ color: '#888', marginLeft: 6, fontSize: '0.9em' }}>{message.from_address}</span>
                )}
            </span>
          </div>
          <span
            style={{
              flexShrink: 0,
              fontSize: 10,
              color: 'var(--color-text-muted, #94a3b8)',
            }}
          >
            {formatRelativeDate(message.received_at)}
          </span>
        </div>
        <div
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: 'var(--color-text, #e2e8f0)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {message.subject || '(No subject)'}
        </div>
        {(() => {
          const preview = getMessageAiPreviewLine(message)
          if (!preview) return null
          return (
            <div
              className="bulk-view-message-preview-line"
              style={{ fontStyle: 'italic', fontSize: '0.85em', opacity: 0.7, marginTop: 2 }}
            >
              {preview.slice(0, 120)}
              {preview.length > 120 ? '…' : ''}
            </div>
          )
        })()}
        {bodyPreview && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-muted, #94a3b8)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {bodyPreview}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {canRowRedirect && onRedirectInRow && (
            <InboxRedirectActionIcon
              row
              title={rowRedirectTip.title}
              ariaLabel={rowRedirectTip['aria-label']}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onRedirectInRow(e, message)
              }}
            />
          )}
          {canRowSandbox && onSandboxInRow && (
            <InboxSandboxCloneActionIcon
              row
              title={rowSandboxTip.title}
              ariaLabel={rowSandboxTip['aria-label']}
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
                onSandboxInRow(e, message)
              }}
            />
          )}
          {hasAttachments && (
            <span style={{ fontSize: 10, color: 'var(--color-text-muted, #94a3b8)' }}>📎</span>
          )}
          {message.starred === 1 && (
            <span style={{ fontSize: 10, color: 'var(--purple-accent, #9333ea)' }}>⭐</span>
          )}
          {message.sort_category && (
            <span
              style={{
                fontSize: 9,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'var(--color-surface, rgba(255,255,255,0.04))',
                color: 'var(--color-text-muted, #94a3b8)',
              }}
            >
              {message.sort_category}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main component ──

export interface EmailInboxViewProps {
  accounts: Array<{ id: string; email: string; status?: string; processingPaused?: boolean }>
  /** Refresh app-level account list after pause/resume so sync targets stay in sync. */
  onEmailAccountsChanged?: () => void
  selectedMessageId?: string | null
  onSelectMessage?: (messageId: string | null) => void
  selectedAttachmentId?: string | null
  onSelectAttachment?: (attachmentId: string | null) => void
  onNavigateToHandshake?: (handshakeId: string) => void
  /** Inbox “Open Handshakes” from Sandbox help and similar affordances. */
  onOpenHandshakesView?: () => void
}

export default function EmailInboxView({
  accounts,
  onEmailAccountsChanged,
  selectedMessageId: selectedMessageIdProp,
  onSelectMessage,
  selectedAttachmentId: selectedAttachmentIdProp,
  onSelectAttachment,
  onNavigateToHandshake,
  onOpenHandshakesView,
}: EmailInboxViewProps) {
  const {
    messages,
    total,
    loading,
    error,
    lastSyncWarnings,
    selectedMessageId,
    selectedMessage,
    selectedAttachmentId,
    filter,
    tabCounts,
    bulkMode,
    multiSelectIds,
    analysisCache,
    autoSyncEnabled,
    syncing,
    fetchMessages,
    selectMessage,
    selectAttachment,
    setFilter,
    setBulkMode,
    toggleMultiSelect,
    clearMultiSelect,
    markRead,
    archiveMessages,
    deleteMessages,
    setCategory,
    syncAllAccounts,
    toggleAutoSyncForActiveAccounts,
    refreshInboxSyncBackendState,
    accountSyncWindowDays,
    patchAccountSyncPreferences,
  } = useEmailInboxStore()

  const { prioritize } = useInboxPreloadQueue({ messages, analysisCache })

  const { mode: orchestratorMode, ready: hostModeReady } = useOrchestratorMode()
  const {
    sandboxes: internalSandboxes,
    incomplete: internalSandboxesIncomplete,
    loading: internalSandboxesLoading,
    hasUsableSandbox,
    lastSuccess: internalSandboxesListLastSuccess,
    cloneEligibleSandboxes,
    sendableCloneSandboxes,
    sandboxAvailability,
    refresh: refreshInternalSandboxesList,
    authoritativeDeviceInternalRole,
    internalSandboxListReady,
  } = useInternalSandboxesList()
  const activeHostSandboxHandshakeCount =
    internalSandboxes.length + internalSandboxesIncomplete.length

  const showInternalSandboxInboxRow =
    hostModeReady &&
    orchestratorMode === 'host' &&
    authoritativeDeviceInternalRole !== 'sandbox' &&
    (internalSandboxesLoading || hasUsableSandbox || internalSandboxesIncomplete.length > 0)

  useEffect(() => {
    if (!selectedMessage) return
    logSandboxCloneEligibilityDebug(
      {
        modeReady: hostModeReady,
        orchestratorMode,
        message: selectedMessage,
        authoritativeDeviceInternalRole,
        internalSandboxListReady,
      },
      { selectedHandshakeId: sendableCloneSandboxes[0]?.handshake_id ?? null },
    )
  }, [
    selectedMessage,
    hostModeReady,
    orchestratorMode,
    authoritativeDeviceInternalRole,
    internalSandboxListReady,
    sendableCloneSandboxes,
  ])

  const primaryAccountId = pickDefaultEmailAccountRowId(accounts)
  const autoSyncEligibleAccountIds = useMemo(() => activeEmailAccountIdsForSync(accounts), [accounts])

  useEffect(() => {
    void refreshInboxSyncBackendState({
      syncTargetIds: autoSyncEligibleAccountIds,
      primaryAccountId: primaryAccountId ?? null,
    })
  }, [autoSyncEligibleAccountIds, primaryAccountId, refreshInboxSyncBackendState])

  useEffect(() => {
    setAiPanelCollapsed(false)
  }, [selectedMessageId])

  // Provider/account state for no-selection workspace
  const [providerAccounts, setProviderAccounts] = useState<
    Array<{
      id: string
      displayName: string
      email: string
      provider: 'gmail' | 'microsoft365' | 'zoho' | 'imap'
      status: 'active' | 'auth_error' | 'error' | 'disabled'
      processingPaused?: boolean
      lastError?: string
    }>
  >([])
  const [isLoadingProviderAccounts, setIsLoadingProviderAccounts] = useState(true)
  const [providerListError, setProviderListError] = useState<string | null>(null)
  const [selectedProviderAccountId, setSelectedProviderAccountId] = useState<string | null>(null)
  const composeClickRef = useRef<number>(0)
  const [aiPanelCollapsed, setAiPanelCollapsed] = useState(false)
  const [composeMode, setComposeMode] = useState<'beap' | 'email' | null>(null)
  const [composeReplyTo, setComposeReplyTo] = useState<{
    to: string
    subject: string
    body: string
    handshakeId?: string
  } | null>(null)

  const [sandboxCloneForMessage, setSandboxCloneForMessage] = useState<InboxMessage | null>(null)
  const [sandboxClonePickerContext, setSandboxClonePickerContext] = useState<{
    cloneReason: 'external_link_or_artifact_review'
    triggeredUrl: string
  } | null>(null)
  const [sandboxUnavailableOpen, setSandboxUnavailableOpen] = useState(false)
  const [sandboxUnavailableVariant, setSandboxUnavailableVariant] =
    useState<BeapSandboxUnavailableVariant>('not_configured')
  const [sandboxRowFeedback, setSandboxRowFeedback] = useState<SandboxCloneFeedbackView | null>(null)
  const [beapRedirectForMessage, setBeapRedirectForMessage] = useState<InboxMessage | null>(null)

  const [leftPanelTab, setLeftPanelTab] = useState<'inbox' | 'sent'>('inbox')
  const [sentMessages, setSentMessages] = useState<Array<Record<string, unknown>>>([])
  const [sentLoading, setSentLoading] = useState(false)

  const loadSentMessages = useCallback(async () => {
    setSentLoading(true)
    try {
      const result = await window.outbox?.listSent?.({ limit: 50, offset: 0 })
      if (result?.success && Array.isArray(result.messages)) {
        setSentMessages(result.messages as Array<Record<string, unknown>>)
      }
    } catch (e) {
      console.warn('[Outbox] load failed:', e)
    } finally {
      setSentLoading(false)
    }
  }, [])

  useEffect(() => {
    if (leftPanelTab !== 'sent') return
    void loadSentMessages()
  }, [leftPanelTab, loadSentMessages])

  useEffect(() => {
    if (!composeMode) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setComposeMode(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [composeMode])

  const loadProviderAccounts = useCallback(async () => {
    if (typeof window.emailAccounts?.listAccounts !== 'function') {
      setProviderListError('Email accounts are not available in this context (bridge missing).')
      setIsLoadingProviderAccounts(false)
      return
    }
    setIsLoadingProviderAccounts(true)
    setProviderListError(null)
    try {
      const res = await window.emailAccounts.listAccounts()
      if (!res?.ok) {
        setProviderAccounts([])
        setProviderListError(String(res?.error ?? '').trim() || 'Could not list email accounts.')
        if (import.meta.env.DEV) {
          console.debug('[EmailInboxView] loadProviderAccounts IPC not ok', res?.error)
        }
        return
      }
      const persistence = res.persistence
      const loadHints: string[] = []
      if (persistence?.load && !persistence.load.ok) {
        const L = persistence.load
        loadHints.push(
          L.phase === 'read'
            ? `Could not read saved accounts file: ${L.message}`
            : `Saved accounts file is not valid JSON: ${L.message}`,
        )
      }
      if (
        persistence &&
        persistence.credentialDecryptIssues &&
        persistence.credentialDecryptIssues.length > 0
      ) {
        loadHints.push(
          `${persistence.credentialDecryptIssues.length} account(s) have stored credentials that could not be decrypted — reconnect those providers.`,
        )
      }
      if (persistence?.secureStorageAvailable === false) {
        loadHints.push(
          'OS secure storage is unavailable (e.g. Windows DPAPI). Adding or updating email accounts may fail until you use a normal interactive user session or fix the OS profile.',
        )
      }

      if (!Array.isArray(res.data)) {
        setProviderAccounts([])
        setProviderListError(
          loadHints.join(' ') || 'Account list response was missing or invalid.',
        )
        return
      }

      const data = res.data as Array<{
        id: string
        displayName?: string
        email: string
        provider?: string
        status?: string
        processingPaused?: boolean
        lastError?: string
      }>
      setProviderAccounts(
        data.map((a) => {
          const p = a.provider
          const provider: 'gmail' | 'microsoft365' | 'zoho' | 'imap' =
            p === 'gmail'
              ? 'gmail'
              : p === 'microsoft365'
                ? 'microsoft365'
                : p === 'zoho'
                  ? 'zoho'
                  : 'imap'
          const status: 'active' | 'auth_error' | 'error' | 'disabled' =
            a.status === 'active'
              ? 'active'
              : a.status === 'auth_error'
                ? 'auth_error'
                : a.status === 'error'
                  ? 'error'
                  : 'disabled'
          return {
            id: a.id,
            displayName: a.displayName ?? a.email,
            email: a.email,
            provider,
            status,
            processingPaused: a.processingPaused === true,
            lastError: a.lastError,
          }
        }),
      )
      setSelectedProviderAccountId((prev) => {
        if (prev && data.some((a: { id: string }) => a.id === prev)) return prev
        const pick = pickDefaultEmailAccountRowId(
          data.map((a) => ({ id: a.id, status: a.status })),
        )
        return pick ?? data[0]?.id ?? null
      })
      if (
        data.length === 0 &&
        persistence?.load &&
        persistence.load.ok === true &&
        persistence.load.fileMissing === true
      ) {
        loadHints.push('No saved accounts file yet — connect an account to create one.')
      } else if (
        data.length === 0 &&
        persistence?.load &&
        persistence.load.ok === true &&
        !persistence.load.fileMissing
      ) {
        loadHints.push('Saved accounts file exists but lists no accounts.')
      }
      setProviderListError(loadHints.length ? loadHints.join(' ') : null)
      if (import.meta.env.DEV) {
        console.debug('[EmailInboxView] loadProviderAccounts', {
          rows: data.length,
          load: persistence?.load,
          rehydrate: persistence?.rehydrateSnapshot,
          decryptIssues: persistence?.credentialDecryptIssues?.length ?? 0,
          hintCount: loadHints.length,
        })
      }
    } catch (e) {
      setProviderAccounts([])
      setProviderListError(e instanceof Error ? e.message : 'Could not list email accounts.')
      if (import.meta.env.DEV) {
        console.debug('[EmailInboxView] loadProviderAccounts failed', e)
      }
    } finally {
      setIsLoadingProviderAccounts(false)
    }
  }, [])

  useEffect(() => {
    void loadProviderAccounts()
  }, [loadProviderAccounts])

  useEffect(() => {
    const unsub = window.emailAccounts?.onAccountConnected?.(() => loadProviderAccounts())
    return () => unsub?.()
  }, [loadProviderAccounts])

  const handleAfterEmailConnected = useCallback(async () => {
    await loadProviderAccounts()
    useEmailInboxStore.getState().clearLastSyncWarnings()
    useEmailInboxStore.getState().clearRemoteSyncLog()
  }, [loadProviderAccounts])

  const { openConnectEmail, connectEmailFlowModal } = useConnectEmailFlow({
    onAfterConnected: handleAfterEmailConnected,
    theme: 'dark',
  })

  useEffect(() => {
    const unsub = window.emailAccounts?.onCredentialError?.((p) => {
      void loadProviderAccounts()
      if (p.provider === 'imap') {
        const open = window.confirm(`${p.message}\n\nOpen credential update for this account?`)
        if (open) {
          openConnectEmail(ConnectEmailLaunchSource.Inbox, { reconnectAccountId: p.accountId })
        }
      }
    })
    return () => unsub?.()
  }, [loadProviderAccounts, openConnectEmail])

  const handleConnectEmail = useCallback(
    () => openConnectEmail(ConnectEmailLaunchSource.Inbox),
    [openConnectEmail],
  )

  const handleUpdateImapCredentials = useCallback(
    (accountId: string) => {
      openConnectEmail(ConnectEmailLaunchSource.Inbox, { reconnectAccountId: accountId })
    },
    [openConnectEmail],
  )

  const imapProbeDoneRef = useRef(false)
  useEffect(() => {
    if (isLoadingProviderAccounts || imapProbeDoneRef.current) return
    if (!providerAccounts.some((a) => a.provider === 'imap')) return
    imapProbeDoneRef.current = true
    let cancelled = false
    ;(async () => {
      for (const acc of providerAccounts) {
        if (acc.provider !== 'imap') continue
        try {
          const r = await window.emailAccounts?.testConnection?.(acc.id)
          if (cancelled) return
          if (r?.ok && r.data && !r.data.success) {
            await loadProviderAccounts()
            break
          }
        } catch {
          /* ignore */
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isLoadingProviderAccounts, providerAccounts, loadProviderAccounts])
  const handleDisconnectEmail = useCallback(
    async (id: string) => {
      try {
        if (typeof window.emailAccounts?.deleteAccount === 'function') {
          await window.emailAccounts.deleteAccount(id)
          loadProviderAccounts()
          onEmailAccountsChanged?.()
        }
      } catch {
        /* ignore */
      }
    },
    [loadProviderAccounts, onEmailAccountsChanged],
  )

  const handleSetProcessingPaused = useCallback(
    async (id: string, paused: boolean) => {
      if (typeof window.emailAccounts?.setProcessingPaused !== 'function') return
      setProviderAccounts((rows) =>
        rows.map((a) => (a.id === id ? { ...a, processingPaused: paused } : a)),
      )
      try {
        const res = await window.emailAccounts.setProcessingPaused(id, paused)
        if (!res?.ok) throw new Error((res as { error?: string })?.error || 'Failed')
        await loadProviderAccounts()
        onEmailAccountsChanged?.()
      } catch {
        await loadProviderAccounts()
        onEmailAccountsChanged?.()
      }
    },
    [loadProviderAccounts, onEmailAccountsChanged],
  )

  // Sync App-level selection to store when props change
  useEffect(() => {
    if (selectedMessageIdProp !== undefined && selectedMessageIdProp !== selectedMessageId) {
      selectMessage(selectedMessageIdProp)
    }
  }, [selectedMessageIdProp, selectedMessageId, selectMessage])

  /**
   * Normal inbox loads a single page (`messages`). After sync / Pull / onNewMessages / filter, the
   * visible list can omit the current `selectedMessageId` while `selectedMessage` from `getMessage`
   * still fills the detail pane — no row matches `selected`. Clear focus (store + App) when the id
   * is absent from the visible page.
   */
  useEffect(() => {
    if (!selectedMessageId || loading) return
    if (messages.some((m) => m.id === selectedMessageId)) return
    void selectMessage(null)
    onSelectMessage?.(null)
  }, [messages, selectedMessageId, loading, selectMessage, onSelectMessage])

  useEffect(() => {
    if (selectedAttachmentIdProp !== undefined && selectedAttachmentIdProp !== selectedAttachmentId) {
      selectAttachment(selectedMessageId ?? '', selectedAttachmentIdProp)
    }
  }, [selectedAttachmentIdProp, selectedAttachmentId, selectedMessageId, selectAttachment])

  const handleSelectMessage = useCallback(
    (id: string) => {
      setComposeMode(null)
      setComposeReplyTo(null)
      const next = selectedMessageId === id ? null : id
      selectMessage(next)
      onSelectMessage?.(next)
    },
    [selectedMessageId, selectMessage, onSelectMessage]
  )

  const handleSelectAttachment = useCallback(
    (attachmentId: string | null) => {
      selectAttachment(selectedMessageId ?? '', attachmentId)
      onSelectAttachment?.(attachmentId)
    },
    [selectedMessageId, selectAttachment, onSelectAttachment]
  )
  const selectedCount = multiSelectIds.size

  const handleSyncWindowChange = useCallback(
    async (days: number) => {
      if (!primaryAccountId || !window.emailInbox?.patchAccountSyncPreferences) return
      if (days === 0) {
        const ok = window.confirm('Syncing all messages may take a long time. Continue?')
        if (!ok) return
      }
      await patchAccountSyncPreferences(primaryAccountId, { syncWindowDays: days })
    },
    [primaryAccountId, patchAccountSyncPreferences],
  )

  const handleToggleAutoSyncAll = useCallback(
    (enabled: boolean) => {
      if (autoSyncEligibleAccountIds.length === 0) return
      void toggleAutoSyncForActiveAccounts(enabled, autoSyncEligibleAccountIds, primaryAccountId ?? null)
    },
    [autoSyncEligibleAccountIds, primaryAccountId, toggleAutoSyncForActiveAccounts],
  )

  const [remoteSyncBusy, setRemoteSyncBusy] = useState(false)

  /** Same as Bulk Inbox: full remote reconcile after pull when any OAuth account exists. */
  const enqueueFullRemoteSync = useCallback(async (): Promise<void> => {
    const fn = window.emailInbox?.fullRemoteSyncAllAccounts
    if (!fn) {
      console.warn('[Inbox] fullRemoteSyncAllAccounts not available (update app)')
      useEmailInboxStore.getState().addRemoteSyncLog('Sync: remote reconcile not available — update WR Desk')
      return
    }
    setRemoteSyncBusy(true)
    try {
      const r = await fn()
      if (r?.ok) {
        console.log(
          '[Inbox] Sync Remote enqueued:',
          `accounts=${r.accountCount ?? '?'} enqueued=${r.enqueued ?? 0} skipped=${r.skipped ?? 0}`,
        )
        useEmailInboxStore.getState().addRemoteSyncLog(
          `Sync Remote: ${r.enqueued ?? 0} enqueued, ${r.skipped ?? 0} skipped` +
            (typeof r.unmirroredEnqueued === 'number' && r.unmirroredEnqueued > 0
              ? ` (${r.unmirroredEnqueued} backfill unmirrored)`
              : '') +
            (typeof r.orphanPendingCleared === 'number' && r.orphanPendingCleared > 0
              ? `, ${r.orphanPendingCleared} orphan queue row(s) cleared`
              : '') +
            ' — background drain until empty (see 🔧 Debug for pending)',
        )
      } else {
        console.warn('[Inbox] Sync Remote:', r?.error)
        useEmailInboxStore.getState().addRemoteSyncLog(`Sync Remote failed: ${r?.error ?? 'unknown'}`)
      }
    } catch (e) {
      console.warn('[Inbox] Sync Remote failed:', e)
      useEmailInboxStore.getState().addRemoteSyncLog(
        `Sync Remote error: ${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      setRemoteSyncBusy(false)
    }
  }, [])

  /** Matches Bulk Inbox toolbar: pull then enqueue remote when not IMAP-only. */
  const handleUnifiedSync = useCallback(async () => {
    const ids = activeEmailAccountIdsForSync(accounts)
    const toSync = ids.length > 0 ? ids : primaryAccountId ? [primaryAccountId] : []
    if (toSync.length === 0) return
    await syncAllAccounts(toSync)
    let shouldEnqueueRemote = true
    if (typeof window.emailAccounts?.listAccounts === 'function') {
      try {
        const res = await window.emailAccounts.listAccounts()
        if (res?.ok && res.data && res.data.length > 0) {
          const allImap = res.data.every((a: { provider?: string }) => {
            const p = a.provider
            return p !== 'gmail' && p !== 'microsoft365' && p !== 'zoho'
          })
          if (allImap) shouldEnqueueRemote = false
        }
      } catch {
        /* keep shouldEnqueueRemote true */
      }
    }
    if (shouldEnqueueRemote) await enqueueFullRemoteSync()
  }, [accounts, primaryAccountId, syncAllAccounts, enqueueFullRemoteSync])

  /** True when every listed account is IMAP — unified Sync runs pull only (matches Bulk Inbox). */
  const inboxToolbarPullOnly = useMemo(
    () => providerAccounts.length > 0 && providerAccounts.every((a) => a.provider === 'imap'),
    [providerAccounts],
  )

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(multiSelectIds)
    if (ids.length) deleteMessages(ids)
    clearMultiSelect()
  }, [multiSelectIds, deleteMessages, clearMultiSelect])

  const handleBulkArchive = useCallback(() => {
    const ids = Array.from(multiSelectIds)
    if (ids.length) archiveMessages(ids)
    clearMultiSelect()
  }, [multiSelectIds, archiveMessages, clearMultiSelect])

  const handleBulkMoveToPendingReview = useCallback(async () => {
    const ids = Array.from(multiSelectIds)
    if (!ids.length || !window.emailInbox?.moveToPendingReview) return
    const res = await window.emailInbox.moveToPendingReview(ids)
    if (res.ok) {
      clearMultiSelect()
      fetchMessages()
    }
  }, [multiSelectIds, clearMultiSelect, fetchMessages])

  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  useEffect(() => {
    const add = useEmailInboxStore.getState().addRemoteSyncLog
    const unsubDrain = window.emailInbox?.onDrainProgress?.((raw) => {
      const p = raw as {
        processed?: number
        pending?: number
        failed?: number
        deferred?: number
        phase?: string
        batchSize?: number
        batchMoved?: number
        batchSkipped?: number
        batchErrors?: number
        batchImapDeferred?: number
      }
      if (p.phase === 'simple_processing') {
        add(`Drain batch: starting up to ${p.batchSize ?? 0} row(s)…`)
        return
      }
      if (p.phase === 'simple_idle' && p.batchSize != null) {
        const moved = p.batchMoved ?? 0
        const skipped = p.batchSkipped ?? 0
        const errors = p.batchErrors ?? p.failed ?? 0
        const imapDef = p.batchImapDeferred ?? 0
        const tail = imapDef > 0 ? `, ${imapDef} deferred (IMAP ping)` : ''
        add(
          `Drain: ${p.batchSize} processed (${moved} moved, ${skipped} skipped, ${errors} errors${tail}) | ${p.pending ?? 0} pending`,
        )
        return
      }
      add(
        `Drain: processed=${p.processed ?? 0} pending=${p.pending ?? 0} failed=${p.failed ?? 0} deferred(pull)=${p.deferred ?? 0}`,
      )
    })
    const unsubRow = window.emailInbox?.onSimpleDrainRow?.((raw) => {
      const r = raw as {
        status?: string
        op?: string
        msgId?: string
        dest?: string
        error?: string
      }
      const op = r.op ?? '?'
      const msg = String(r.msgId ?? '').slice(0, 8)
      if (r.status === 'moved') {
        add(`MOVED: ${op} → ${r.dest ?? '?'} (msg ${msg})`)
      } else if (r.status === 'skipped') {
        add(`SKIPPED: ${op} → ${r.dest ?? '?'} (msg ${msg})`)
      } else if (r.status === 'error') {
        add(`ERROR: ${op} — ${r.error ?? '?'} (msg ${msg})`)
      }
    })
    return () => {
      unsubDrain?.()
      unsubRow?.()
    }
  }, [])

  const handleComposeClick = useCallback((fn: () => void) => {
    const now = Date.now()
    if (now - composeClickRef.current < 600) return
    composeClickRef.current = now
    fn()
  }, [])

  const handleOpenEmailCompose = useCallback(() => {
    setComposeMode('email')
    setComposeReplyTo(null)
    selectMessage(null)
    onSelectMessage?.(null)
  }, [selectMessage, onSelectMessage])

  const handleOpenBeapDraft = useCallback(() => {
    setComposeMode('beap')
    setComposeReplyTo(null)
    selectMessage(null)
    onSelectMessage?.(null)
  }, [selectMessage, onSelectMessage])

  const openSandboxUnavailableDialog = useCallback(() => {
    setSandboxUnavailableVariant(sandboxCloneUnavailableDialogVariant(sandboxAvailability))
    setSandboxUnavailableOpen(true)
  }, [sandboxAvailability])

  const handleInboxRowSandbox = useCallback(
    (_e: MouseEvent, m: InboxMessage) => {
      if (!hostModeReady || orchestratorMode !== 'host') {
        if (orchestratorMode === 'sandbox') {
          logSandboxTargetResolution({
            source: 'inbox_row',
            messageId: m.id,
            modeReady: hostModeReady,
            orchestratorMode,
            isHost: false,
            targetCount: 0,
            internalSandboxRowsCount: internalSandboxes.length,
            activeSandboxTargetsCount: activeHostSandboxHandshakeCount,
            liveSandboxTargetsCount: cloneEligibleSandboxes.length,
            selectedTargetHandshakeId: sendableCloneSandboxes[0]?.handshake_id ?? null,
            action: null,
            decision: 'sandbox_mode_hide_action',
            reason: 'orchestrator_sandbox',
          })
        } else {
          logSandboxTargetResolution({
            source: 'inbox_row',
            messageId: m.id,
            modeReady: hostModeReady,
            orchestratorMode,
            isHost: false,
            targetCount: 0,
            internalSandboxRowsCount: internalSandboxes.length,
            activeSandboxTargetsCount: activeHostSandboxHandshakeCount,
            liveSandboxTargetsCount: cloneEligibleSandboxes.length,
            selectedTargetHandshakeId: sendableCloneSandboxes[0]?.handshake_id ?? null,
            action: null,
            decision: 'mode_not_ready_hide_action',
            reason: 'orchestrator_mode_not_ready',
          })
        }
        return
      }
      void (async () => {
        const snap = await refreshInternalSandboxesList()
        if (!snap.success) {
          // eslint-disable-next-line no-console
          console.log('[BEAP_SANDBOX_CLONE] list_refresh_failed', { message_id: m.id, error: snap.error })
          const v = viewSandboxListLoadFailed(snap.error)
          setSandboxRowFeedback(v)
          if (!v.persistUntilDismiss) {
            window.setTimeout(() => setSandboxRowFeedback(null), 8000)
          }
          return
        }
        const resolved = resolveActiveSandboxCloneTargets(snap.sandboxes, snap.incomplete)
        const {
          sendableTargets,
          activeHostSandboxCount,
          liveEligibleCount,
          identityCompleteRows,
          incompleteRows,
        } = resolved
        // eslint-disable-next-line no-console
        console.log('[BEAP_SANDBOX_CLONE] click', {
          message_id: m.id,
          host_mode: true,
          active_sandbox_count: activeHostSandboxCount,
        })
        const next = resolveHostSandboxCloneClickAction({
          internalListLoading: false,
          listLastSuccess: true,
          sendableTargetCount: sendableTargets.length,
          activeIdentityCompleteHostSandboxCount: identityCompleteRows.length,
          identityIncompleteHostSandboxCount: incompleteRows.length,
        })
        logSandboxTargetResolution({
          source: 'inbox_row',
          messageId: m.id,
          modeReady: hostModeReady,
          orchestratorMode,
          isHost: true,
          targetCount: sendableTargets.length,
          internalSandboxRowsCount: identityCompleteRows.length,
          activeSandboxTargetsCount: activeHostSandboxCount,
          liveSandboxTargetsCount: liveEligibleCount,
          selectedTargetHandshakeId: sendableTargets[0]?.handshake_id ?? null,
          action: next,
          decision: mapSandboxClickActionToResolutionDecision(next),
          reason: 'host_sandbox_routing_fresh_list',
        })
        if (next === 'loading_refresh') {
          setSandboxRowFeedback(viewSandboxChecking())
          window.setTimeout(() => setSandboxRowFeedback(null), 5000)
          return
        }
        if (next === 'open_unavailable_dialog') {
          // eslint-disable-next-line no-console
          console.log('[BEAP_SANDBOX_CLONE] no_active_target_show_setup', { message_id: m.id })
          setSandboxRowFeedback(viewSandboxNoOrchestrator())
          openSandboxUnavailableDialog()
          return
        }
        if (next === 'keying_incomplete') {
          // eslint-disable-next-line no-console
          console.log('[BEAP_SANDBOX_CLONE] keying_incomplete', { message_id: m.id })
          setSandboxRowFeedback(viewSandboxKeyingIncomplete())
          window.setTimeout(() => setSandboxRowFeedback(null), 8000)
          return
        }
        if (next === 'identity_incomplete') {
          // eslint-disable-next-line no-console
          console.log('[BEAP_SANDBOX_CLONE] identity_incomplete', { message_id: m.id })
          setSandboxRowFeedback(viewSandboxIdentityIncomplete())
          window.setTimeout(() => setSandboxRowFeedback(null), 8000)
          return
        }
        if (next === 'open_target_picker') {
          setSandboxCloneForMessage(m)
          return
        }
        // eslint-disable-next-line no-console
        console.log('[BEAP_SANDBOX_CLONE] start', {
          message_id: m.id,
          target_handshake_id: sendableTargets[0]?.handshake_id,
        })
        try {
          setSandboxRowFeedback(viewSandboxCloning())
          const r = await beapInboxCloneToSandboxApi({ sourceMessageId: m.id })
          if (r.success) {
            const fb = sandboxCloneFeedbackFromOutcome(r)
            if (fb.kind === 'success_queued') {
              // eslint-disable-next-line no-console
              console.log('[BEAP_SANDBOX_CLONE] queued', {
                message_id: m.id,
                deliveryMode: 'deliveryMode' in r ? r.deliveryMode : undefined,
              })
            } else if (fb.kind === 'success_live') {
              // eslint-disable-next-line no-console
              console.log('[BEAP_SANDBOX_CLONE] success', {
                message_id: m.id,
                deliveryMode: 'deliveryMode' in r ? r.deliveryMode : undefined,
              })
            }
            // eslint-disable-next-line no-console
            console.log('[BEAP_SANDBOX_CLONE] send_result', {
              message_id: m.id,
              deliveryMode: 'deliveryMode' in r ? r.deliveryMode : undefined,
            })
            setSandboxRowFeedback(fb.view)
            void fetchMessages()
            if (!fb.view.persistUntilDismiss) {
              window.setTimeout(() => setSandboxRowFeedback(null), 5500)
            }
          } else {
            // eslint-disable-next-line no-console
            console.log('[BEAP_SANDBOX_CLONE] send_result', { message_id: m.id, error: r })
            setSandboxRowFeedback(sandboxCloneFeedbackFromOutcome(r).view)
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.log('[BEAP_SANDBOX_CLONE] error', { message_id: m.id, error: e })
          setSandboxRowFeedback({
            variant: 'error',
            message: SANDBOX_CLONE_COPY.failedGeneric,
            persistUntilDismiss: true,
            screenReaderDetail: e instanceof Error ? e.message : String(e),
          })
        }
      })()
    },
    [
      hostModeReady,
      orchestratorMode,
      openSandboxUnavailableDialog,
      refreshInternalSandboxesList,
      fetchMessages,
    ],
  )

  const handleReply = useCallback((msg: InboxMessage) => {
    const src = msg.source_type as string
    if (src === 'email_plain' || src === 'depackaged') {
      setComposeMode('email')
      setComposeReplyTo({
        to: msg.from_address || '',
        subject: 'Re: ' + (msg.subject || ''),
        body: '',
      })
      return
    }
    if (src === 'direct_beap' || src === 'email_beap') {
      setAiPanelCollapsed(false)
      useEmailInboxStore.getState().setEditingDraftForMessageId(msg.id)
    }
  }, [])

  const [sendEmailToast, setSendEmailToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleSendDraft = useCallback(
    async (draft: string, msg: InboxMessage, attachments?: DraftAttachment[]): Promise<boolean> => {
      const isDepackaged = msg.source_type === 'email_plain'
      if (!isDepackaged) {
        navigator.clipboard?.writeText(draft).catch(() => {})
        setComposeMode('beap')
        return false
      }
      const to = msg.from_address?.trim()
      if (!to) {
        setSendEmailToast({ type: 'error', message: 'No sender address' })
        return false
      }
      if (typeof window.emailAccounts?.listAccounts !== 'function' || typeof window.emailAccounts?.sendEmail !== 'function') {
        setSendEmailToast({ type: 'error', message: 'Email send not available' })
        return false
      }
      const accountsRes = await window.emailAccounts.listAccounts()
      if (!accountsRes?.ok || !accountsRes.data?.length) {
        setSendEmailToast({ type: 'error', message: 'No email account connected' })
        return false
      }
      const accountId = accountsRes.data[0].id
      const subject = msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject || '(No subject)'}`
      const fullBody = (draft || '').trim() + '\n\n—\nAutomate your inbox. Try wrdesk.com\nhttps://wrdesk.com'
      const emailAttachments: { filename: string; mimeType: string; contentBase64: string }[] = []
      if (window.emailInbox?.readFileForAttachment && attachments?.length) {
        for (const pa of attachments) {
          const res = await window.emailInbox.readFileForAttachment(pa.path)
          if (res?.ok && res?.data) {
            emailAttachments.push({
              filename: res.data.filename,
              mimeType: res.data.mimeType,
              contentBase64: res.data.contentBase64,
            })
          }
        }
      }
      try {
        const res = await window.emailAccounts.sendEmail(accountId, {
          to: [to],
          subject: subject.trim() || '(No subject)',
          bodyText: fullBody,
          attachments: emailAttachments.length > 0 ? emailAttachments : undefined,
        })
        if (res.ok && res.data?.success) {
          setSendEmailToast({ type: 'success', message: `Email sent to ${to}` })
          setTimeout(() => setSendEmailToast(null), 3000)
          fetchMessages()
          return true
        }
        setSendEmailToast({ type: 'error', message: res.error || 'Failed to send' })
        return false
      } catch (err) {
        setSendEmailToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to send' })
        return false
      }
    },
    [fetchMessages, setComposeMode]
  )

  /** Full-width compose: hide list column (see composer-audit Phase 1). Browse modes keep 320px list. */
  const gridCols = composeMode ? '1fr' : selectedMessageId ? '320px 1fr' : '320px 1fr 320px'

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        gridTemplateRows: 'minmax(0, 1fr)',
        flex: 1,
        minHeight: 0,
        width: '100%',
        minWidth: 0,
        overflow: 'hidden',
        background: 'var(--color-bg, #0f172a)',
        color: 'var(--color-text, #e2e8f0)',
      }}
    >
      {sendEmailToast && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 300,
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: sendEmailToast.type === 'success' ? 'rgba(34,197,94,0.9)' : 'rgba(239,68,68,0.9)',
            color: 'white',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
        >
          <span>{sendEmailToast.message}</span>
          <button
            type="button"
            onClick={() => setSendEmailToast(null)}
            style={{
              padding: '2px 8px',
              fontSize: 11,
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: 4,
              color: 'white',
              cursor: 'pointer',
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      {/* Left panel: toolbar + message list (hidden during compose — composer uses full main width) */}
      {!composeMode && (
      <div
        style={{
          borderRight: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <EmailInboxToolbar
          filter={filter}
          tabCounts={{
            all: tabCounts.all ?? 0,
            urgent: tabCounts.urgent ?? 0,
            pending_delete: tabCounts.pending_delete ?? 0,
            pending_review: tabCounts.pending_review ?? 0,
            archived: tabCounts.archived ?? 0,
          }}
          messageKind={filter.messageKind}
          onMessageKindChange={(kind) => setFilter({ messageKind: kind, sourceType: 'all' })}
          onFilterChange={(partial) => setFilter(partial)}
          accounts={accounts}
          autoSyncEnabled={autoSyncEnabled}
          syncing={syncing}
          remoteSyncBusy={remoteSyncBusy}
          onUnifiedSync={() => void handleUnifiedSync()}
          accountSyncWindowDays={accountSyncWindowDays}
          onSyncWindowChange={handleSyncWindowChange}
          autoSyncEligibleAccountIds={autoSyncEligibleAccountIds}
          onToggleAutoSync={handleToggleAutoSyncAll}
          pullOnly={inboxToolbarPullOnly}
          bulkMode={bulkMode}
          onBulkModeChange={setBulkMode}
          selectedCount={selectedCount}
          onBulkDelete={handleBulkDelete}
          onBulkArchive={handleBulkArchive}
          onBulkMoveToPendingReview={selectedCount > 0 ? handleBulkMoveToPendingReview : undefined}
          onBulkCategorize={
            selectedCount > 0
              ? () => {
                  const ids = Array.from(multiSelectIds)
                  if (ids.length) {
                    const cat = window.prompt('Category name (or leave empty to clear):')
                    if (cat !== null) setCategory(ids, cat)
                  }
                }
              : undefined
          }
          internalSandbox={
            showInternalSandboxInboxRow
              ? {
                  loading: internalSandboxesLoading,
                  hasUsable: hasUsableSandbox,
                  hasIdentityIncomplete:
                    !hasUsableSandbox && internalSandboxesIncomplete.length > 0,
                  liveStatusLabel: internalSandboxes[0]?.live_status_optional ?? null,
                  onOpenHandshake: () => {
                    const id =
                      internalSandboxes[0]?.handshake_id ??
                      internalSandboxesIncomplete[0]?.handshake_id
                    if (id) onNavigateToHandshake?.(id)
                  },
                }
              : undefined
          }
        />

        <div style={{ display: 'flex', gap: 4, margin: '8px 12px 4px', flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => {
              setLeftPanelTab('inbox')
            }}
            style={{
              padding: '4px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              background: leftPanelTab === 'inbox' ? '#7c3aed' : '#f3f4f6',
              color: leftPanelTab === 'inbox' ? '#fff' : '#374151',
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Inbox ({tabCounts.all ?? total ?? 0})
          </button>
          <button
            type="button"
            onClick={() => {
              setLeftPanelTab('sent')
              selectMessage(null)
              onSelectMessage?.(null)
              void loadSentMessages()
            }}
            style={{
              padding: '4px 12px',
              borderRadius: 4,
              cursor: 'pointer',
              background: leftPanelTab === 'sent' ? '#7c3aed' : '#f3f4f6',
              color: leftPanelTab === 'sent' ? '#fff' : '#374151',
              border: 'none',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Sent
          </button>
        </div>

        {lastSyncWarnings && lastSyncWarnings.length > 0 ? (
          <SyncFailureBanner
            warnings={lastSyncWarnings}
            accounts={providerAccounts.map((a) => ({ id: a.id, email: a.email, provider: a.provider }))}
            onUpdateCredentials={handleUpdateImapCredentials}
            onRemoveAccount={handleDisconnectEmail}
          />
        ) : null}

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {sandboxRowFeedback && leftPanelTab === 'inbox' ? (
            <div
              style={{
                padding: '8px 12px 10px',
                borderBottom: '1px solid var(--color-border, #e5e7eb)',
                flexShrink: 0,
                background: 'var(--color-surface, #f9fafb)',
              }}
            >
              <SandboxCloneFeedbackBadge
                view={sandboxRowFeedback}
                onDismiss={() => setSandboxRowFeedback(null)}
                maxWidth="100%"
              />
            </div>
          ) : null}
          {leftPanelTab === 'sent' ? (
            sentLoading ? (
              <div
                style={{
                  padding: 24,
                  textAlign: 'center',
                  fontSize: 12,
                  color: 'var(--color-text-muted, #94a3b8)',
                }}
              >
                Loading…
              </div>
            ) : sentMessages.length === 0 ? (
              <div
                style={{
                  padding: 28,
                  textAlign: 'center',
                  color: 'var(--color-text-muted, #94a3b8)',
                  fontSize: 12,
                }}
              >
                No sent messages yet.
              </div>
            ) : (
              sentMessages.map((row) => {
                const sid = String(row.id ?? '')
                const toLabel = String(row.counterparty_display ?? 'Unknown')
                const subj = String(row.subject ?? 'BEAP™ Message')
                const preview = String(row.public_body_preview ?? '')
                const createdAt = String(row.created_at ?? '')
                const dm = String(row.delivery_method ?? '').toLowerCase()
                const ds = String(row.delivery_status ?? 'sent')
                const hasEnc = row.has_encrypted_inner === 1
                const deliveryBadge =
                  dm === 'p2p'
                    ? UI_BADGE.blue
                    : dm === 'email'
                      ? UI_BADGE.amber
                      : UI_BADGE.gray
                return (
                  <div
                    key={sid}
                    style={{
                      padding: '10px 12px',
                      borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                      fontSize: 13,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--color-text, #e2e8f0)' }}>
                        To: {toLabel}
                      </span>
                      <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>
                        {createdAt ? new Date(createdAt).toLocaleString() : ''}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--color-text, #e2e8f0)', marginTop: 2 }}>{subj}</div>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#94a3b8',
                        marginTop: 2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {preview ? preview.slice(0, 80) : '(no preview)'}
                      {preview.length > 80 ? '…' : ''}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                      <span
                        style={{
                          fontSize: 10,
                          padding: '1px 6px',
                          borderRadius: 8,
                          ...deliveryBadge,
                        }}
                      >
                        {dm.toUpperCase() || '—'}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          padding: '1px 6px',
                          borderRadius: 8,
                          ...(ds === 'sent' ? UI_BADGE.green : UI_BADGE.red),
                        }}
                      >
                        {ds === 'sent' ? '✅ Sent' : `❌ ${ds}`}
                      </span>
                      {hasEnc ? (
                        <span
                          style={{
                            fontSize: 10,
                            padding: '1px 6px',
                            borderRadius: 8,
                            ...UI_BADGE.purple,
                          }}
                        >
                          🔒 qBEAP
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: 10,
                            padding: '1px 6px',
                            borderRadius: 8,
                            ...UI_BADGE.gray,
                          }}
                        >
                          📨 pBEAP
                        </span>
                      )}
                    </div>
                  </div>
                )
              })
            )
          ) : loading ? (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--color-text-muted, #94a3b8)',
              }}
            >
              Loading…
            </div>
          ) : error ? (
            <div
              style={{
                padding: 24,
                textAlign: 'center',
                fontSize: 12,
                color: '#ef4444',
              }}
            >
              {error}
            </div>
          ) : messages.length === 0 ? (
            <div
              style={{
                padding: 28,
                textAlign: 'center',
                color: 'var(--color-text-muted, #94a3b8)',
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.4 }}>✉</div>
              <div style={{ fontSize: 12, lineHeight: 1.6 }}>
                No messages.
                <br />
                Pull to sync or connect an email account.
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <InboxMessageRow
                key={msg.id}
                message={msg}
                selected={selectedMessageId === msg.id}
                bulkMode={bulkMode}
                multiSelected={multiSelectIds.has(msg.id)}
                onSelect={() => handleSelectMessage(msg.id)}
                onToggleMultiSelect={() => toggleMultiSelect(msg.id)}
                onMouseEnter={() => prioritize(msg.id)}
                onNavigateToHandshake={onNavigateToHandshake}
                sandboxOrchestrator={{
                  modeReady: hostModeReady,
                  orchestratorMode,
                  authoritativeDeviceInternalRole,
                  internalSandboxListReady,
                }}
                sandboxVisibilityDiagnostics={{
                  activeInternalHandshakeCount: activeHostSandboxHandshakeCount,
                  internalListLoading: internalSandboxesLoading,
                }}
                sandboxAvailability={sandboxAvailability}
                onSandboxInRow={handleInboxRowSandbox}
                onRedirectInRow={(_e, m) => setBeapRedirectForMessage(m)}
              />
            ))
          )}
        </div>

        <div
          style={{
            padding: '8px 14px',
            fontSize: 11,
            color: 'var(--color-text-muted, #94a3b8)',
            borderTop: '1px solid var(--color-border, rgba(255,255,255,0.08))',
          }}
        >
          {leftPanelTab === 'sent'
            ? `${sentMessages.length} sent (newest first)`
            : `${total} message(s) in this tab (${messages.length} loaded)`}
        </div>
      </div>
      )}

      {/* Center + Right when no message selected: provider area + capsule drop */}
      {!selectedMessageId && !composeMode && (
        <>
          <div
            className="inbox-no-selection-center"
            style={{
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto',
              overflowX: 'hidden',
              minWidth: 0,
              minHeight: 0,
              borderRight: '1px solid var(--color-border, rgba(255,255,255,0.08))',
            }}
          >
            <div className="inbox-provider-section">
              <EmailProvidersSection
                theme="professional"
                emailAccounts={providerAccounts}
                isLoadingEmailAccounts={isLoadingProviderAccounts}
                selectedEmailAccountId={selectedProviderAccountId}
                onConnectEmail={handleConnectEmail}
                onDisconnectEmail={handleDisconnectEmail}
                onSetProcessingPaused={handleSetProcessingPaused}
                onSelectEmailAccount={setSelectedProviderAccountId}
                onUpdateImapCredentials={handleUpdateImapCredentials}
                listAccountsError={providerListError}
              />
              {primaryAccountId && window.emailInbox?.patchAccountSyncPreferences && (
                <div
                  style={{
                    padding: '12px 18px',
                    borderTop: '1px solid rgba(15,23,42,0.08)',
                    background: 'rgba(59,130,246,0.04)',
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#0f172a', marginBottom: 8 }}>Account sync</div>
                  <label
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 12,
                      color: '#0f172a',
                    }}
                  >
                    <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>Sync window</span>
                    <select
                      className="bulk-view-toolbar-sync-select"
                      aria-label="Initial sync window"
                      value={emailInboxSyncWindowSelectValue(accountSyncWindowDays)}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10)
                        if (!Number.isNaN(v)) void handleSyncWindowChange(v)
                      }}
                      style={{ fontSize: 12, padding: '6px 10px' }}
                      title="How far back the first inbox pull reaches (same as Bulk Inbox toolbar)"
                    >
                      <option value={7}>7d</option>
                      <option value={30}>30d</option>
                      <option value={90}>90d</option>
                      <option value={365}>1y</option>
                    </select>
                  </label>
                  <div style={{ fontSize: 10, color: '#64748b', marginTop: 8, lineHeight: 1.45 }}>
                    Editable after connecting. Only recent mail syncs initially; expand the sync window to include older mail.
                    {accountSyncWindowDays === 0 ? (
                      <span style={{ color: '#b45309', display: 'block', marginTop: 4 }}>
                        Warning: syncing all mail may take a long time.
                      </span>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-text-muted, #94a3b8)',
                padding: 24,
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>✉</div>
              <div style={{ fontSize: 13, textAlign: 'center' }}>
                {messages.length === 0
                  ? 'Connect an email account or import a .beap file to get started'
                  : 'Select a message to view details'}
              </div>
            </div>
          </div>
          <div
            className="inbox-no-selection-right"
            style={{
              borderLeft: '1px solid var(--color-border, rgba(255,255,255,0.08))',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minWidth: 0,
            }}
          >
            <div
              style={{
                padding: '14px 12px',
                borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
                fontSize: 13,
                fontWeight: 700,
              }}
            >
              Import & Compose
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              <BeapMessageImportZone onSubmitted={fetchMessages} />
            </div>
          </div>
        </>
      )}

      {/* Compose placeholders or detail workspace */}
      {composeMode === 'beap' ? (
        <BeapInlineComposer
          onClose={() => {
            setComposeMode(null)
            setComposeReplyTo(null)
          }}
          onSent={() => {
            setComposeMode(null)
            setComposeReplyTo(null)
            void fetchMessages()
          }}
          replyToHandshakeId={composeReplyTo?.handshakeId}
        />
      ) : composeMode === 'email' ? (
        <EmailInlineComposer
          onClose={() => {
            setComposeMode(null)
            setComposeReplyTo(null)
          }}
          onSent={() => {
            setComposeMode(null)
            setComposeReplyTo(null)
            void fetchMessages()
          }}
          replyTo={composeReplyTo}
        />
      ) : selectedMessageId && selectedMessage ? (
        <div
          className={`inbox-detail-workspace${aiPanelCollapsed ? ' inbox-detail-workspace--ai-collapsed' : ''}`}
          style={{ minHeight: 0 }}
        >
          <div className="inbox-detail-message">
            <EmailMessageDetail
              message={selectedMessage}
              onSelectAttachment={onSelectAttachment ? handleSelectAttachment : undefined}
              onReply={handleReply}
              internalSandboxTargets={sendableCloneSandboxes}
              activeInternalHandshakeCount={activeHostSandboxHandshakeCount}
              internalSandboxesListLastSuccess={internalSandboxesListLastSuccess}
              activeIdentityCompleteHostSandboxCount={internalSandboxes.length}
              identityIncompleteHostSandboxCount={internalSandboxesIncomplete.length}
              onSandboxMultiSelect={
                sendableCloneSandboxes.length > 1
                  ? (m, ctx) => {
                      setSandboxCloneForMessage(m)
                      setSandboxClonePickerContext(ctx ?? null)
                    }
                  : undefined
              }
              onNoSandboxConnectedInfo={openSandboxUnavailableDialog}
              onSandboxCloneComplete={() => void fetchMessages()}
              internalSandboxListLoading={internalSandboxesLoading}
              onRequestInternalSandboxListRefresh={() => void refreshInternalSandboxesList()}
              internalSandboxesRefresh={refreshInternalSandboxesList}
              sandboxAvailability={sandboxAvailability}
              authoritativeDeviceInternalRole={authoritativeDeviceInternalRole}
              internalSandboxListReady={internalSandboxListReady}
              onOpenHandshakesView={onOpenHandshakesView}
              sandboxLiveEligibleCount={cloneEligibleSandboxes.length}
            />
          </div>
          <div className="inbox-detail-ai" data-collapsed={aiPanelCollapsed}>
            <InboxDetailAiPanel
              messageId={selectedMessageId}
              message={selectedMessage}
              onSendDraft={handleSendDraft}
              onArchive={archiveMessages}
              onDelete={deleteMessages}
              onCollapsedChange={setAiPanelCollapsed}
            />
          </div>
        </div>
      ) : null}

      {sandboxCloneForMessage && sendableCloneSandboxes.length > 1 && (
        <BeapSandboxCloneDialog
          message={sandboxCloneForMessage}
          sandboxes={sendableCloneSandboxes}
          cloneContext={sandboxClonePickerContext}
          onClose={() => {
            setSandboxCloneForMessage(null)
            setSandboxClonePickerContext(null)
          }}
          onSent={() => {
            setSandboxCloneForMessage(null)
            setSandboxClonePickerContext(null)
            void fetchMessages()
          }}
        />
      )}

      <BeapSandboxUnavailableDialog
        isOpen={sandboxUnavailableOpen}
        variant={sandboxUnavailableVariant}
        onClose={() => setSandboxUnavailableOpen(false)}
        onOpenHandshakes={() => onOpenHandshakesView?.()}
      />

      {beapRedirectForMessage && (
        <BeapRedirectDialog
          message={beapRedirectForMessage}
          onClose={() => setBeapRedirectForMessage(null)}
          onSent={() => {
            setBeapRedirectForMessage(null)
            void fetchMessages()
          }}
        />
      )}

      {connectEmailFlowModal}

      {/* Compose buttons — floating bottom-right */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          zIndex: 100,
        }}
      >
        <button
          type="button"
          onClick={() => handleComposeClick(handleOpenEmailCompose)}
          title="New Email"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '10px 14px',
            borderRadius: 24,
            background: '#2563eb',
            color: '#fff',
            border: 'none',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(37,99,235,0.3)',
          }}
        >
          ✉️+
        </button>
        <button
          type="button"
          onClick={() => handleComposeClick(handleOpenBeapDraft)}
          title="New BEAP™ Message"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '10px 18px',
            borderRadius: 24,
            background: '#7c3aed',
            color: '#fff',
            border: 'none',
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
          }}
        >
          + BEAP
        </button>
      </div>

      {/* EmailComposeOverlay disabled — use EmailInlineComposer via composeMode === 'email' (Prompt 3) */}
      {/* {showEmailCompose && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, ... }}>
          <EmailComposeOverlay ... />
        </div>
      )} */}
    </div>
  )
}
