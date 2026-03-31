/**
 * EmailInboxView — Main inbox view matching HandshakeView layout.
 * Left: toolbar + message list.
 * When no message selected: center = provider area, right = capsule drop.
 * When message selected: right = 50/50 message + AI workspace.
 */

import { useEffect, useCallback, useState, useRef, useMemo } from 'react'
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
import { tryParsePartialAnalysis, tryParseAnalysis, type NormalInboxAiResultKey } from '../utils/parseInboxAiJson'
import { reconcileAnalyzeTriage } from '../lib/inboxClassificationReconcile'
import { deriveInboxMessageKind } from '../lib/inboxMessageKind'
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
    peerX25519PublicKey: typeof raw.peer_x25519_public_key_b64 === 'string' ? raw.peer_x25519_public_key_b64 : undefined,
    peerPQPublicKey: typeof raw.peer_mlkem768_public_key_b64 === 'string' ? raw.peer_mlkem768_public_key_b64 : undefined,
    p2pEndpoint: (raw.p2p_endpoint as string | null | undefined) ?? null,
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

/** Apply AI `draftReply` to native BEAP capsule fields (string or capsule object). */
function applyCapsuleDraftFromDraftReply(
  dr: NormalInboxAiResult['draftReply'],
  setPublic: (s: string) => void,
  setEnc: (s: string) => void,
): void {
  if (dr == null) return
  if (typeof dr === 'object' && !Array.isArray(dr)) {
    const o = dr as Record<string, unknown>
    const pub =
      o.publicMessage ?? o.publicText ?? o.public
    const enc =
      o.encryptedMessage ?? o.encryptedText ?? o.text
    if (pub != null || enc != null) {
      setPublic(typeof pub === 'string' ? pub : '')
      setEnc(typeof enc === 'string' ? enc : '')
      return
    }
  }
  if (typeof dr === 'string') {
    setEnc(dr)
    setPublic('')
  }
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
  const [draft, setDraft] = useState<string | null>(null)
  const [draftLoading, setDraftLoading] = useState(false)
  const [draftError, setDraftError] = useState(false)
  const [editedDraft, setEditedDraft] = useState('')
  const [attachments, setAttachments] = useState<DraftAttachment[]>([])
  const [actionChecked, setActionChecked] = useState<Record<number, boolean>>({})
  const [draftSubFocused, setDraftSubFocused] = useState(false)
  const [visibleSections, setVisibleSections] = useState<Set<string>>(() => new Set(['summary', 'draft', 'analysis']))
  const [capsulePublicText, setCapsulePublicText] = useState('')
  const [capsuleEncryptedText, setCapsuleEncryptedText] = useState('')
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

  const runAnalysisStream = useCallback(async () => {
    const msg = messageRef.current
    console.log('[ANALYSIS] runAnalysisStream triggered for:', messageId)
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
      setReceivedFields(new Set(['needsReply', 'needsReplyReason', 'summary', 'urgencyScore', 'urgencyReason', 'actionItems', 'archiveRecommendation', 'archiveReason', 'draftReply']))
      if (!skipEmailDraft) {
        if (cachedAdj.draftReply && typeof cachedAdj.draftReply === 'string') {
          setDraft(cachedAdj.draftReply)
          setEditedDraft(cachedAdj.draftReply)
        } else {
          setDraft(null)
          setEditedDraft('')
        }
      } else if (cachedAdj.draftReply) {
        const dr = cachedAdj.draftReply
        if (typeof dr === 'string' && dr.trim()) {
          setCapsuleEncryptedText((prev) => (prev.trim() ? prev : dr))
        } else {
          applyCapsuleDraftFromDraftReply(dr, setCapsulePublicText, setCapsuleEncryptedText)
        }
      }
      setAnalysisLoading(false)
      return
    }
    streamCleanupRef.current?.()
    manualSummaryOverrideRef.current = null
    setAnalysisLoading(true)
    setAnalysis(null)
    setAnalysisError(null)
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
        if (skipEmailDraft && parsed.receivedKeys.includes('draftReply') && parsed.partial.draftReply != null) {
          const dr = parsed.partial.draftReply
          if (typeof dr === 'string' && dr.trim()) {
            setCapsuleEncryptedText((prev) => (prev.trim() ? prev : dr))
          } else {
            applyCapsuleDraftFromDraftReply(dr, setCapsulePublicText, setCapsuleEncryptedText)
          }
        }
      }
    })

    const unsubDone = window.emailInbox.onAiAnalyzeDone(({ messageId: mid }) => {
      if (mid !== messageId) return
      setAnalysisLoading(false)
      const final = tryParseAnalysis(accumulatedText)
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
        } else if (adjusted.draftReply) {
          const dr = adjusted.draftReply
          if (typeof dr === 'string' && dr.trim()) {
            setCapsuleEncryptedText((prev) => (prev.trim() ? prev : dr))
          } else {
            applyCapsuleDraftFromDraftReply(dr, setCapsulePublicText, setCapsuleEncryptedText)
          }
        }
        useEmailInboxStore.getState().setAnalysisCache(messageId, adjusted)
        autoAnalyzeStreamFailedRef.current.delete(messageId)
      }
      cleanup()
    })

    const unsubError = window.emailInbox.onAiAnalyzeError(({ messageId: mid, error }) => {
      if (mid !== messageId) return
      autoAnalyzeStreamFailedRef.current.add(messageId)
      setAnalysisLoading(false)
      setAnalysisError(
        error === 'timeout'
          ? 'Analysis timed out. Ollama may be slow or unavailable.'
          : 'Analysis failed. Check that Ollama is running.'
      )
      cleanup()
    })

    streamCleanupRef.current = cleanup

    try {
      console.warn('⚡ EmailInboxView calling aiAnalyzeMessageStream', new Date().toISOString(), { messageId })
      const res = await window.emailInbox.aiAnalyzeMessageStream(messageId)
      const deduped =
        res &&
        res.started === false &&
        (res as { reason?: string }).reason === 'already-running'
      if (res?.started === false && !deduped) {
        autoAnalyzeStreamFailedRef.current.add(messageId)
        setAnalysisLoading(false)
        setAnalysisError('Analysis failed. Check that Ollama is running.')
        cleanup()
      }
    } catch {
      autoAnalyzeStreamFailedRef.current.add(messageId)
      setAnalysisLoading(false)
      setAnalysisError('Analysis failed. Check that Ollama is running.')
      cleanup()
    }
  }, [messageId])

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
    setAnalysisLoading(true)
    setAnalysis(null)
    setReceivedFields(new Set())
    setSummarizeLoading(false)
    setDraft(null)
    setEditedDraft('')
    setDraftError(false)
    setActionChecked({})
    setDraftSubFocused(false)
    setVisibleSections(new Set(['summary', 'draft', 'analysis']))
    setCapsulePublicText('')
    setCapsuleEncryptedText('')
    setSelectedSessionId(null)
    setCapsuleAttachments([])
    setSendResult(null)
    setSendingCapsule(false)
    setAvailableSessions([])
    draftFallbackAttemptedRef.current = false
    runAnalysisStream()
    return () => {
      streamCleanupRef.current?.()
    }
  }, [messageId, runAnalysisStream])

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
    if (!draftRefineConnected || draftRefineMessageId !== messageId) return
    function handleClickOutside(e: MouseEvent) {
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
        setAnalysisError(
          'Couldn’t generate a summary. Check that Ollama is running, then try Summarize again.'
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
      setAnalysisError(
        'Summarize failed (unexpected error). Check the developer console and try again.'
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

  const handleDraftReply = useCallback(async () => {
    if (!window.emailInbox?.aiDraftReply) return
    setDraftLoading(true)
    setDraft(null)
    setDraftError(false)
    setAttachments([])
    try {
      const res = await window.emailInbox.aiDraftReply(messageId)
      const data = res.data
      const native = data?.isNativeBeap && data.capsuleDraft
      if (res.ok && native) {
        setCapsulePublicText(data.capsuleDraft!.publicText)
        setCapsuleEncryptedText(data.capsuleDraft!.encryptedText)
        setDraftError(!!data.error)
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
      } else {
        setDraftError(true)
      }
    } catch {
      setDraftError(true)
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
    handleDraftReply()
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
    autoAnalyzeStreamFailedRef.current.delete(messageId)
    setAnalysisError(null)
    runAnalysisStream()
  }, [messageId, runAnalysisStream])

  const handleRetryDraft = useCallback(() => {
    setDraftError(false)
    handleDraftReply()
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
              void runAnalysisStream()
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
        {analysisError && (
          <div className="inbox-detail-ai-error-banner">
            <span>{analysisError}</span>
            <button type="button" onClick={handleRetryAnalysis}>Retry</button>
          </div>
        )}

        {visibleSections.has('analysis') && (
          <div className="inbox-detail-ai-section inbox-detail-ai-section--tab-panel">
            <div className="ai-analysis-body">
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
                          <span>
                            ⚠ Could not generate AI draft. Check that Ollama is running.
                          </span>
                          <button
                            type="button"
                            className="capsule-draft-retry"
                            onClick={() => void handleDraftReply()}
                            disabled={draftLoading}
                          >
                            Retry
                          </button>
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
                            📨 Public Message (pBEAP)
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
                          placeholder="Public capsule text — transport-visible message body"
                          value={capsulePublicText}
                          onChange={(e) => setCapsulePublicText(e.target.value)}
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
                            🔒 End-to-End Encrypted (qBEAP)
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
                          placeholder="Encrypted capsule-bound message — end-to-end encrypted, fully readable by you"
                          value={capsuleEncryptedText}
                          onChange={(e) => setCapsuleEncryptedText(e.target.value)}
                          onFocus={() => {
                            useEmailInboxStore.getState().setEditingDraftForMessageId(messageId)
                          }}
                          rows={4}
                        />
                        <div className="capsule-field-hint">
                          ⚠ This content is end-to-end encrypted and capsule-bound.
                        </div>
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
                        <span>Draft generation failed.</span>
                        <button type="button" onClick={handleRetryDraft}>
                          Retry
                        </button>
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
}: InboxMessageRowProps) {
  const isBeap = message.source_type === 'email_beap' || message.source_type === 'direct_beap'
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

      {/* Source badge */}
      <div
        style={{
          flexShrink: 0,
          width: 24,
          height: 24,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 12,
          fontWeight: 700,
          background: isBeap ? 'var(--purple-accent, #9333ea)' : 'rgba(107,114,128,0.5)',
          color: '#fff',
        }}
      >
        {isBeap ? 'B' : '✉'}
      </div>

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
}

export default function EmailInboxView({
  accounts,
  onEmailAccountsChanged,
  selectedMessageId: selectedMessageIdProp,
  onSelectMessage,
  selectedAttachmentId: selectedAttachmentIdProp,
  onSelectAttachment,
  onNavigateToHandshake,
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
      setIsLoadingProviderAccounts(false)
      return
    }
    try {
      const res = await window.emailAccounts.listAccounts()
      if (res?.ok && res?.data) {
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
      } else {
        setProviderAccounts([])
      }
    } catch {
      setProviderAccounts([])
    } finally {
      setIsLoadingProviderAccounts(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedMessageId) loadProviderAccounts()
  }, [selectedMessageId, loadProviderAccounts])

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

  const handleReply = useCallback((msg: InboxMessage) => {
    const src = msg.source_type as string
    if (src === 'email_plain' || src === 'depackaged') {
      setComposeMode('email')
      setComposeReplyTo({
        to: msg.from_address || '',
        subject: 'Re: ' + (msg.subject || ''),
        body: '',
      })
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
