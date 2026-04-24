/**
 * EmailMessageDetail — Full detail panel for viewing a selected inbox message.
 * Header (From, To, date, subject, actions), source badge, body, attachments, deletion notice.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { InboxMessage } from '../stores/useEmailInboxStore'
import { useEmailInboxStore } from '../stores/useEmailInboxStore'
import InboxAttachmentRow from './InboxAttachmentRow'
import LinkWarningDialog from './LinkWarningDialog'
import { extractLinkParts } from '../utils/safeLinks'
import { deriveInboxMessageKind } from '../lib/inboxMessageKind'
import { isBeapQbeapOutboundEcho } from '../lib/inboxBeapOutbound'
import { canShowSandboxCloneAction } from '../lib/beapInboxSandboxVisibility'
import { isInboxMessageActionable } from '../lib/inboxMessageActionable'
import type { InternalSandboxTargetWire } from '../hooks/useInternalSandboxesList'
import { useOrchestratorMode } from '../hooks/useOrchestratorMode'
import { beapInboxCloneToSandboxApi } from '../lib/beapInboxCloneToSandbox'
import {
  beapHostSandboxCloneTooltipForAvailability,
  beapInboxRedirectTooltipPropsForDetail,
  beapInboxReplyTooltipProps,
} from '../lib/beapInboxActionTooltips'
import { resolveHostSandboxCloneClickAction } from '../lib/beapInboxHostSandboxClickPolicy'
import { InboxRedirectActionIcon, InboxSandboxCloneActionIcon } from './InboxActionIcons'
import type {
  AuthoritativeDeviceInternalRole,
  SandboxOrchestratorAvailability,
} from '../types/sandboxOrchestratorAvailability'
import { defaultSandboxAvailability } from '../types/sandboxOrchestratorAvailability'
import SessionImportDialog, { type SessionImportDialogSessionRef } from './SessionImportDialog'
import BeapRedirectDialog from './BeapRedirectDialog'
import { listHandshakes } from '../shims/handshakeRpc'
import { UI_BADGE } from '../styles/uiContrastTokens'

export interface EmailMessageDetailProps {
  message: InboxMessage | null
  /** When provided, used instead of store for attachment focus (e.g. bulk inbox → Hybrid Search) */
  selectedAttachmentId?: string | null
  /** When provided, called when user selects/deselects an attachment (for HybridSearch scope) */
  onSelectAttachment?: (attachmentId: string | null) => void
  /** When provided, called when user clicks Reply — parent routes depackaged → inline email compose, BEAP → capsule reply */
  onReply?: (message: InboxMessage) => void
  /**
   * Clone-eligible, connected internal Sandbox orchestrators (from main-process sandbox list / IPC).
   * May be empty when none are available — Host UI still shows Sandbox; click opens help or direct clone.
   */
  internalSandboxTargets?: InternalSandboxTargetWire[]
  /** More than one eligible sandbox: parent opens the target selector dialog. */
  onSandboxMultiSelect?: (message: InboxMessage) => void
  /** No eligible connected sandbox: parent shows the “No Sandbox orchestrator connected” explainer. */
  onNoSandboxConnectedInfo?: () => void
  /** After a direct single-target clone from this detail panel succeeds. */
  onSandboxCloneComplete?: () => void
  /** While internal Host→Sandbox list is loading (targets may be empty temporarily). */
  internalSandboxListLoading?: boolean
  /** Refresh internal sandbox list when user clicks Sandbox during loading. */
  onRequestInternalSandboxListRefresh?: () => void
  /** From `useInternalSandboxesList().sandboxAvailability`; drives Sandbox button hover. */
  sandboxAvailability?: SandboxOrchestratorAvailability
  /**
   * Authoritative internal Host/Sandbox (main-process). Required for Sandbox icon — omit only in tests
   * that do not need clone UI.
   */
  authoritativeDeviceInternalRole?: AuthoritativeDeviceInternalRole
  /** `useInternalSandboxesList().internalSandboxListReady` — false hides Sandbox until RPC succeeds. */
  internalSandboxListReady?: boolean
}

// ── Helpers ──

function formatDate(isoString: string | null): string {
  if (!isoString) return '—'
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

/** Basic HTML sanitization: strip script, style, iframe, object, embed; remove on* attributes */
function sanitizeHtml(html: string): string {
  if (!html || typeof html !== 'string') return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const remove = doc.querySelectorAll('script, style, iframe, object, embed')
  remove.forEach((el) => el.remove())
  doc.body.querySelectorAll('*').forEach((el) => {
    Array.from(el.attributes).forEach((attr) => {
      if (/^on/i.test(attr.name) || attr.name === 'href' && attr.value?.startsWith('javascript:')) {
        el.removeAttribute(attr.name)
      }
    })
  })
  return doc.body.innerHTML
}

function getAutomationTags(p: Record<string, unknown>): string[] {
  const a = p.automation
  if (!a || typeof a !== 'object') return []
  const tags = (a as { tags?: unknown }).tags
  if (!Array.isArray(tags)) return []
  return tags.filter((t): t is string => typeof t === 'string')
}

function getSessionRefs(p: Record<string, unknown>): Array<Record<string, unknown>> {
  const r = p.sessionRefs
  if (!Array.isArray(r)) return []
  return r.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
}

/** Join string fields from shallow nested objects (e.g. contact cards) instead of raw JSON. */
function humanizeObjectStrings(o: Record<string, unknown>, depth: number): string {
  if (depth > 3) return ''
  const parts: string[] = []
  for (const k of Object.keys(o)) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) parts.push(v.trim())
    else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = humanizeObjectStrings(v as Record<string, unknown>, depth + 1)
      if (inner.trim()) parts.push(inner.trim())
    }
  }
  return parts.join('\n\n')
}

/** Safe display string for depackaged body/subject when the value may be a nested object. */
function extractBodyText(body: unknown): string {
  if (body == null) return ''
  if (typeof body === 'string') return body
  if (typeof body === 'object') {
    const o = body as Record<string, unknown>
    for (const key of [
      'text',
      'content',
      'message',
      'body',
      'plaintext',
      'decrypted',
      'decryptedBody',
      'transport_plaintext',
      'capsule_text',
    ] as const) {
      const v = o[key]
      if (typeof v === 'string' && v.trim()) return v
    }
    if (o.body != null && typeof o.body === 'object') {
      const nested = extractBodyText(o.body)
      if (nested.trim()) return nested
    }
    if (typeof o.body === 'string' && o.body.trim()) return o.body
    const human = humanizeObjectStrings(o, 0).trim()
    if (human) return human
    try {
      return JSON.stringify(body, null, 2)
    } catch {
      return String(body)
    }
  }
  return String(body)
}

/** Same as extractBodyText — used for qBEAP / nested body objects. */
function extractText(val: unknown): string {
  return extractBodyText(val)
}

function isPlaceholder(s: string): boolean {
  return (
    s.includes('open in extension') ||
    s.includes('Encrypted qBEAP') ||
    s.includes('(Encrypted qBEAP')
  )
}

/** Main-process ingest placeholder before extension Stage-5 merge or native decrypt. */
function isPendingQbeapDepackaged(dp: Record<string, unknown> | null): boolean {
  if (!dp) return false
  if (dp.format === 'beap_qbeap_decrypted') return false
  if (dp.format === 'beap_qbeap_outbound') return false
  return dp.format === 'beap_qbeap_pending_main'
}

function partyEmail(p: unknown): string | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  for (const k of ['email', 'sender_email', 'receiver_email'] as const) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

function strField(o: unknown, key: string): string | null {
  if (!o || typeof o !== 'object') return null
  const v = (o as Record<string, unknown>)[key]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** Best-effort transport-visible text for native BEAP (avoid qBEAP ingestion placeholder). */
function transportPlaintextFromBeapPackageJson(jsonStr: string | null): string {
  if (!jsonStr || typeof jsonStr !== 'string') return ''
  try {
    const pkg = JSON.parse(jsonStr) as Record<string, unknown>
    if (typeof pkg.transport_plaintext === 'string' && pkg.transport_plaintext.trim()) {
      return pkg.transport_plaintext.trim()
    }
    const capsule = pkg.capsule as Record<string, unknown> | undefined
    if (capsule) {
      if (typeof capsule.text === 'string' && capsule.text.trim()) {
        return capsule.text.trim()
      }
      if (typeof capsule.transport_plaintext === 'string' && capsule.transport_plaintext.trim()) {
        return capsule.transport_plaintext.trim()
      }
    }
    const header = pkg.header as Record<string, unknown> | undefined
    if (header && typeof header.transport_plaintext === 'string' && header.transport_plaintext.trim()) {
      return header.transport_plaintext.trim()
    }
    const encoding = header?.encoding
    if (encoding === 'pBEAP' && typeof pkg.payload === 'string') {
      try {
        const binary = atob(pkg.payload)
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
        const capsuleJson = new TextDecoder().decode(bytes)
        const capsule = JSON.parse(capsuleJson) as Record<string, unknown>
        let transport = ''
        if (typeof capsule.transport_plaintext === 'string') transport = capsule.transport_plaintext
        else if (typeof capsule.body === 'string') transport = capsule.body
        else if (capsule.body && typeof capsule.body === 'object') {
          const bt = (capsule.body as Record<string, unknown>).text
          if (typeof bt === 'string') transport = bt
        }
        if (transport.trim()) return transport.trim()
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
  return ''
}

function formatToLine(raw: string | null): string {
  if (!raw || raw.trim() === '' || raw.trim() === '[]') return '—'
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) {
      const parts = parsed.filter((x): x is string => typeof x === 'string')
      return parts.length ? parts.join(', ') : '—'
    }
  } catch {
    /* ignore */
  }
  return raw
}

function sessionRefToDialogProps(ref: Record<string, unknown>): SessionImportDialogSessionRef {
  const sessionId = typeof ref.sessionId === 'string' ? ref.sessionId : String(ref.sessionId ?? '')
  const sessionName = typeof ref.sessionName === 'string' ? ref.sessionName : undefined
  const cap = ref.requiredCapability
  const requiredCapability =
    cap != null && typeof cap === 'object' ? JSON.stringify(cap) : cap != null ? String(cap) : undefined
  return { sessionId, sessionName, requiredCapability }
}

function renderDepackagedJson(jsonStr: string | null): ReactNode {
  if (!jsonStr || typeof jsonStr !== 'string') return null
  try {
    const parsed = JSON.parse(jsonStr)
    if (typeof parsed !== 'object' || parsed === null) return null
    return (
      <div className="msg-detail-beap-json">
        {JSON.stringify(parsed, null, 2)}
      </div>
    )
  } catch {
    return null
  }
}

export default function EmailMessageDetail({
  message,
  selectedAttachmentId: selectedAttachmentIdProp,
  onSelectAttachment,
  onReply,
  internalSandboxTargets,
  onSandboxMultiSelect,
  onNoSandboxConnectedInfo,
  onSandboxCloneComplete,
  internalSandboxListLoading,
  onRequestInternalSandboxListRefresh,
  sandboxAvailability = defaultSandboxAvailability,
  authoritativeDeviceInternalRole = 'none',
  internalSandboxListReady = false,
}: EmailMessageDetailProps) {
  const { mode: orchestratorMode, ready: modeReady } = useOrchestratorMode()
  const [beapRedirectOpen, setBeapRedirectOpen] = useState(false)
  const [beapPanelOpen, setBeapPanelOpen] = useState(false)
  const [pendingLinkUrl, setPendingLinkUrl] = useState<string | null>(null)
  const [importingSession, setImportingSession] = useState<Record<string, unknown> | null>(null)
  const [importStatus, setImportStatus] = useState<Record<string, 'idle' | 'importing' | 'imported' | 'error'>>({})
  const [hostSandboxBusy, setHostSandboxBusy] = useState(false)
  const [hostSandboxInlineFeedback, setHostSandboxInlineFeedback] = useState<string | null>(null)
  const {
    selectedAttachmentId: storeSelectedAttachmentId,
    selectAttachment,
    mergeMessageAttachments,
    toggleStar,
    archiveMessages,
    deleteMessages,
    cancelDeletion,
    editingDraftForMessageId,
    setEditingDraftForMessageId,
  } = useEmailInboxStore()
  const attachmentHydrateSettledRef = useRef<string | null>(null)

  const messageKind = message ? deriveInboxMessageKind(message) : 'depackaged'
  const isNativeBeap = messageKind === 'handshake'

  const parsedDepackaged = useMemo(() => {
    if (!message?.depackaged_json) return null
    try {
      return JSON.parse(message.depackaged_json) as Record<string, unknown>
    } catch {
      return null
    }
  }, [message?.depackaged_json])

  const parsedPackage = useMemo(() => {
    if (!message?.beap_package_json) return null
    try {
      return JSON.parse(message.beap_package_json) as Record<string, unknown>
    } catch {
      return null
    }
  }, [message?.beap_package_json])

  const [resolvedSender, setResolvedSender] = useState<string | null>(null)
  const [resolvedRecipient, setResolvedRecipient] = useState<string | null>(null)

  useEffect(() => {
    if (!message?.handshake_id || !isNativeBeap) {
      setResolvedSender(null)
      setResolvedRecipient(null)
      return
    }
    const rawFrom = (message.from_address || '').trim()
    const fromLower = rawFrom.toLowerCase()
    const needsSender =
      !rawFrom ||
      fromLower === 'unknown' ||
      fromLower === 'unknown sender'
    const rawTo = (message.to_addresses || '').trim()
    const needsRecipient = !rawTo || rawTo === '' || rawTo === '[]'
    if (!needsSender && !needsRecipient) {
      setResolvedSender(null)
      setResolvedRecipient(null)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const list = await listHandshakes('all')
        type HsRow = {
          handshake_id: string
          local_role: 'initiator' | 'acceptor'
          initiator?: unknown
          acceptor?: unknown
          receiver_email?: string | null
        }
        const rec = list.find((h) => h.handshake_id === message.handshake_id) as HsRow | undefined
        if (!rec || cancelled) return
        const { initiator, acceptor, local_role } = rec
        const localParty = local_role === 'initiator' ? initiator : acceptor
        const peerParty = local_role === 'initiator' ? acceptor : initiator
        const counterparty =
          strField(rec, 'counterparty_email') ||
          strField(rec, 'their_email') ||
          strField(rec, 'partner_email') ||
          strField(rec, 'remote_email')
        const peerResolved =
          partyEmail(peerParty) ||
          counterparty ||
          (local_role === 'initiator' && rec.receiver_email ? String(rec.receiver_email).trim() : '') ||
          null
        const localResolved =
          partyEmail(localParty) ||
          (local_role === 'acceptor' && rec.receiver_email ? String(rec.receiver_email).trim() : '') ||
          strField(rec, 'local_email') ||
          strField(rec, 'my_email') ||
          null
        if (needsSender) setResolvedSender(peerResolved || message.handshake_id)
        if (needsRecipient) setResolvedRecipient(localResolved || 'You')
      } catch (e) {
        console.warn('Handshake lookup failed:', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [message?.handshake_id, message?.from_address, message?.to_addresses, isNativeBeap])

  const publicBody = useMemo(() => {
    if (!message || !isNativeBeap) return ''
    const pkg = parsedPackage
    const dp = parsedDepackaged
    const pick = (s: string | undefined) => {
      const t = (s ?? '').trim()
      return t && !isPlaceholder(t) ? t : ''
    }
    if (pkg) {
      const a = typeof pkg.transport_plaintext === 'string' ? pick(pkg.transport_plaintext) : ''
      if (a) return a
      const header = pkg.header as Record<string, unknown> | undefined
      if (header && typeof header.transport_plaintext === 'string') {
        const b = pick(header.transport_plaintext)
        if (b) return b
      }
      const capsule = pkg.capsule as Record<string, unknown> | undefined
      if (capsule && typeof capsule.text === 'string') {
        const c = pick(capsule.text)
        if (c) return c
      }
    }
    const fromLegacy = transportPlaintextFromBeapPackageJson(message.beap_package_json)
    if (fromLegacy && !isPlaceholder(fromLegacy)) return fromLegacy
    if (dp) {
      if (typeof dp.transport_plaintext === 'string') {
        const t = pick(dp.transport_plaintext)
        if (t) return t
      }
      if (typeof dp.transport === 'string') {
        const t = pick(dp.transport)
        if (t) return t
      }
    }
    if (message.body_text) {
      const t = pick(message.body_text)
      if (t) return t
    }
    return ''
  }, [message, isNativeBeap, parsedPackage, parsedDepackaged])

  const encryptedBody = useMemo(() => {
    if (!isNativeBeap) return ''
    if (parsedDepackaged) {
      const b =
        extractText(parsedDepackaged.body) ||
        extractText(parsedDepackaged.content) ||
        extractText(parsedDepackaged.decryptedBody) ||
        extractText(parsedDepackaged.encryptedMessage) ||
        extractText(parsedDepackaged.encrypted_message) ||
        extractText(parsedDepackaged.decrypted_body)
      const trimmed = b.trim()
      if (trimmed && !isPlaceholder(trimmed)) return trimmed
    }
    const cap = parsedPackage?.capsule as Record<string, unknown> | undefined
    if (cap?.body != null) {
      const b = extractText(cap.body).trim()
      if (b && !isPlaceholder(b)) return b
    }
    return ''
  }, [isNativeBeap, parsedDepackaged, parsedPackage])

  const fromDisplay = useMemo((): ReactNode => {
    if (!message) return '—'
    if (isNativeBeap) {
      const rawAddr = (message.from_address || '').trim()
      const addrLower = rawAddr.toLowerCase()
      const addrIsUnknown =
        !rawAddr || addrLower === 'unknown' || addrLower === 'unknown sender'
      const sender =
        message.from_name || (!addrIsUnknown ? message.from_address : null) || resolvedSender
      return (
        <span>
          {sender || (message.handshake_id ? 'Resolving…' : 'Unknown sender')}
          {message.handshake_id ? (
            <span className="beap-identity-badge" title="Verified via BEAP handshake">
              🤝 Handshake
            </span>
          ) : null}
        </span>
      )
    }
    return message.from_name
      ? `${message.from_name} <${message.from_address || ''}>`
      : message.from_address || '—'
  }, [isNativeBeap, message, resolvedSender])

  const toDisplay = useMemo((): ReactNode => {
    if (!message) return '—'
    if (isNativeBeap) {
      if (resolvedRecipient) return resolvedRecipient
      const raw = message.to_addresses
      if (raw && raw.trim() && raw.trim() !== '[]') return formatToLine(raw)
      return 'You'
    }
    return message.to_addresses || '—'
  }, [isNativeBeap, message, resolvedRecipient])

  useEffect(() => {
    setImportingSession(null)
    setImportStatus({})
  }, [message?.id])

  useEffect(() => {
    setHostSandboxInlineFeedback(null)
  }, [message?.id])

  /** List rows sometimes omit attachment rows while `has_attachments` is set — hydrate like BulkInboxAttachmentsStrip. */
  useEffect(() => {
    const mid = message?.id
    if (!mid) return
    const expectAtt =
      message.has_attachments === 1 ||
      (typeof message.attachment_count === 'number' && message.attachment_count > 0)
    if (!expectAtt) {
      attachmentHydrateSettledRef.current = null
      return
    }
    const atts = message.attachments
    if (atts && atts.length > 0) {
      attachmentHydrateSettledRef.current = null
      return
    }
    if (attachmentHydrateSettledRef.current === mid) return

    const p = window.emailInbox?.getMessage?.(mid)
    if (!p || typeof p.then !== 'function') {
      attachmentHydrateSettledRef.current = mid
      return
    }
    let cancelled = false
    p.then((res) => {
      if (cancelled) return
      attachmentHydrateSettledRef.current = mid
      if (!res?.ok || !res.data) return
      const row = res.data as InboxMessage
      mergeMessageAttachments(mid, row.attachments ?? [])
    }).catch(() => {
      if (!cancelled) attachmentHydrateSettledRef.current = mid
    })
    return () => {
      cancelled = true
    }
  }, [message?.id, message?.has_attachments, message?.attachment_count, message?.attachments, mergeMessageAttachments])

  useEffect(() => {
    if (!import.meta.env.DEV || !message || !isNativeBeap) return
    console.log('[BEAP attachment debug] message.attachments:', message.attachments)
    console.log('[BEAP attachment debug] message.attachment_count:', message.attachment_count)
    console.log('[BEAP attachment debug] message.has_attachments:', message.has_attachments)
  }, [message, isNativeBeap])

  const handleSessionImport = useCallback(async (raw: Record<string, unknown>) => {
    const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : String(raw.sessionId ?? '')
    const sessionName = typeof raw.sessionName === 'string' ? raw.sessionName : sessionId
    setImportStatus((prev) => ({ ...prev, [sessionId]: 'importing' }))
    try {
      const api = window.orchestrator
      if (!api?.importSessionFromBeap) {
        throw new Error('Orchestrator bridge unavailable')
      }
      const mid = message?.id
      if (!mid) {
        throw new Error('No message context')
      }
      const result = await api.importSessionFromBeap({
        sessionId,
        sessionName,
        config: raw,
        sourceMessageId: mid,
        handshakeId: message?.handshake_id ?? null,
      })
      if (!result?.success) {
        throw new Error(result?.error || 'Import failed')
      }
      setImportStatus((prev) => ({ ...prev, [sessionId]: 'imported' }))
      setImportingSession(null)
    } catch (e) {
      console.error('Session import failed:', e)
      setImportStatus((prev) => ({ ...prev, [sessionId]: 'error' }))
    }
  }, [message?.id, message?.handshake_id])

  const dialogSessionRef = useMemo(
    () => (importingSession ? sessionRefToDialogProps(importingSession) : null),
    [importingSession],
  )

  const isOutboundQbeap =
    message != null &&
    isNativeBeap &&
    (parsedDepackaged?.format === 'beap_qbeap_outbound' || isBeapQbeapOutboundEcho(message))
  const showHostSandboxStrip = canShowSandboxCloneAction({
    modeReady,
    orchestratorMode,
    message,
    authoritativeDeviceInternalRole,
    internalSandboxListReady,
  })

  const handleHostSandboxClick = useCallback(async () => {
    if (!message) return
    const targets = internalSandboxTargets ?? []
    const next = resolveHostSandboxCloneClickAction({
      internalListLoading: internalSandboxListLoading ?? false,
      cloneEligibleTargetCount: targets.length,
    })
    if (next === 'loading_refresh') {
      onRequestInternalSandboxListRefresh?.()
      setHostSandboxInlineFeedback('Checking Sandbox connection…')
      window.setTimeout(() => setHostSandboxInlineFeedback(null), 5000)
      return
    }
    if (next === 'open_unavailable_dialog') {
      onNoSandboxConnectedInfo?.()
      return
    }
    if (next === 'open_target_picker') {
      onSandboxMultiSelect?.(message)
      return
    }
    setHostSandboxBusy(true)
    setHostSandboxInlineFeedback(null)
    try {
      const r = await beapInboxCloneToSandboxApi({ sourceMessageId: message.id })
      if (r.success) {
        onSandboxCloneComplete?.()
        setHostSandboxInlineFeedback('Clone sent to Sandbox orchestrator.')
        window.setTimeout(() => setHostSandboxInlineFeedback(null), 4000)
      } else {
        setHostSandboxInlineFeedback('error' in r ? r.error : 'Failed to send clone')
      }
    } catch (e) {
      setHostSandboxInlineFeedback(e instanceof Error ? e.message : 'Failed to send clone')
    } finally {
      setHostSandboxBusy(false)
    }
  }, [
    message,
    internalSandboxTargets,
    internalSandboxListLoading,
    onRequestInternalSandboxListRefresh,
    onNoSandboxConnectedInfo,
    onSandboxMultiSelect,
    onSandboxCloneComplete,
  ])

  if (!message) return null

  const attachments = message.attachments ?? []
  const attachmentMetaExpected =
    message.has_attachments === 1 ||
    (typeof message.attachment_count === 'number' && message.attachment_count > 0)
  /** Show block if we have rows, or DB says attachments exist (list may omit rows until merge). */
  const showAttachmentsBlock = attachments.length > 0 || attachmentMetaExpected
  const attachmentsPendingRows = attachmentMetaExpected && attachments.length === 0
  const isDeleted = message.deleted === 1

  const actionable = isInboxMessageActionable(message)
  const canShowDetailReply = Boolean(onReply) && actionable
  const canShowInboxRedirectAndSandbox = actionable
  const showDetailActionEnd = canShowDetailReply || canShowInboxRedirectAndSandbox
  const beapRedirectDetailTip = beapInboxRedirectTooltipPropsForDetail()
  const beapSandboxDetailTip = beapHostSandboxCloneTooltipForAvailability(sandboxAvailability, 'detail')

  const automationTags = parsedDepackaged ? getAutomationTags(parsedDepackaged) : []
  const sessionRefsList = parsedDepackaged ? getSessionRefs(parsedDepackaged) : []

  const handleStar = useCallback(() => {
    toggleStar(message.id)
  }, [message.id, toggleStar])

  const handleArchive = useCallback(() => {
    archiveMessages([message.id])
  }, [message.id, archiveMessages])

  const handleDelete = useCallback(() => {
    deleteMessages([message.id])
  }, [message.id, deleteMessages])

  const handleCancelDeletion = useCallback(() => {
    cancelDeletion(message.id)
  }, [message.id, cancelDeletion])

  const handleReply = useCallback(() => {
    onReply?.(message)
  }, [message, onReply])

  const handleLinkClick = useCallback((url: string) => setPendingLinkUrl(url), [])
  const handleLinkConfirm = useCallback(() => {
    if (pendingLinkUrl) {
      window.open(pendingLinkUrl, '_blank', 'noopener,noreferrer')
      setPendingLinkUrl(null)
    }
  }, [pendingLinkUrl])
  const handleLinkCancel = useCallback(() => setPendingLinkUrl(null), [])

  return (
    <>
      <LinkWarningDialog
        isOpen={!!pendingLinkUrl}
        url={pendingLinkUrl || ''}
        onConfirm={handleLinkConfirm}
        onCancel={handleLinkCancel}
      />
      {importingSession && dialogSessionRef ? (
        <SessionImportDialog
          sessionRef={dialogSessionRef}
          messageId={message.id}
          onConfirm={() => handleSessionImport(importingSession)}
          onCancel={() => setImportingSession(null)}
          importing={importStatus[dialogSessionRef.sessionId] === 'importing'}
        />
      ) : null}
      {beapRedirectOpen && (
        <BeapRedirectDialog
          message={message}
          onClose={() => setBeapRedirectOpen(false)}
        />
      )}
    <div
      className={`inbox-detail-message-inner inbox-detail-message-inner--premium${editingDraftForMessageId === message.id ? ' inbox-detail-message-inner--editing-draft' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }}>
        {/* Deletion notice */}
        {isDeleted && (
          <div
            style={{
              padding: 12,
              marginBottom: 16,
              borderRadius: 8,
              ...UI_BADGE.red,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Message scheduled for deletion
            </div>
            <div style={{ fontSize: 12, marginBottom: 10 }}>
              {message.purge_after
                ? `Permanent deletion: ${formatDate(message.purge_after)}`
                : 'Permanent deletion pending'}
            </div>
            <button
              type="button"
              onClick={handleCancelDeletion}
              style={{
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 6,
                cursor: 'pointer',
                ...UI_BADGE.green,
              }}
            >
              Cancel Deletion
            </button>
          </div>
        )}

        {/* Header — stacked: subject full-width, then actions, then metadata */}
        <div style={{ marginBottom: 16 }}>
          <h2
            style={{
              margin: 0,
              fontSize: 18,
              fontWeight: 700,
              width: '100%',
              wordBreak: 'break-word',
              marginBottom: 10,
            }}
          >
            {message.subject || '(No subject)'}
          </h2>
          <div className="inbox-detail-action-toolbar">
            <div className="inbox-detail-action-group inbox-detail-action-group--start" aria-label="Message actions">
              {editingDraftForMessageId === message.id && (
                <span
                  role="button"
                  tabIndex={0}
                  className="inbox-detail-editing-draft-indicator"
                  onClick={() => setEditingDraftForMessageId(null)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setEditingDraftForMessageId(null)
                    }
                  }}
                  title="Click to exit edit mode"
                >
                  Editing draft
                </span>
              )}
              <button
                type="button"
                onClick={handleStar}
                title={message.starred === 1 ? 'Unstar' : 'Star'}
                aria-label={message.starred === 1 ? 'Unstar' : 'Star'}
                className={
                  message.starred === 1
                    ? 'inbox-detail-icon-btn inbox-detail-icon-btn--starred'
                    : 'inbox-detail-icon-btn'
                }
              >
                {message.starred === 1 ? '★' : '☆'}
              </button>
              <button
                type="button"
                onClick={handleArchive}
                className="inbox-detail-toolbar-text-btn"
                aria-label="Archive"
              >
                Archive
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="inbox-detail-toolbar-text-btn inbox-detail-toolbar-text-btn--danger"
                aria-label="Delete"
              >
                Delete
              </button>
            </div>
            {showDetailActionEnd ? (
              <div
                className="inbox-detail-action-group inbox-detail-action-group--end"
                aria-label="Reply, redirect, and Sandbox"
              >
                {canShowDetailReply && (
                  <button
                    type="button"
                    onClick={handleReply}
                    className="inbox-action-icon-only inbox-detail-reply-icon-only"
                    {...beapInboxReplyTooltipProps()}
                  >
                    <span className="inbox-detail-reply-glyph" aria-hidden>
                      ↩
                    </span>
                  </button>
                )}
                {canShowInboxRedirectAndSandbox && (
                  <>
                    <InboxRedirectActionIcon
                      title={beapRedirectDetailTip.title}
                      ariaLabel={beapRedirectDetailTip['aria-label']}
                      onClick={() => setBeapRedirectOpen(true)}
                    />
                    {showHostSandboxStrip ? (
                      <InboxSandboxCloneActionIcon
                        title={beapSandboxDetailTip.title}
                        ariaLabel={beapSandboxDetailTip['aria-label']}
                        onClick={() => void handleHostSandboxClick()}
                        disabled={hostSandboxBusy}
                      />
                    ) : null}
                  </>
                )}
              </div>
            ) : null}
          </div>
          {showHostSandboxStrip && hostSandboxInlineFeedback ? (
            <div
              role="status"
              style={{
                marginTop: 8,
                marginBottom: 0,
                fontSize: 11,
                color: hostSandboxInlineFeedback.startsWith('Clone sent') ? '#4ade80' : '#f87171',
                maxWidth: 480,
                lineHeight: 1.4,
              }}
            >
              {hostSandboxInlineFeedback}
            </div>
          ) : null}
          <div style={{ fontSize: 12, color: 'var(--color-text-muted, #94a3b8)' }}>
            <div>From: {fromDisplay}</div>
            <div>To: {toDisplay}</div>
            <div>{formatDate(message.received_at)}</div>
          </div>
        </div>

        {/* Body — human-readable by default; native BEAP uses structured depackaged sections */}
        <div style={{ marginBottom: 20 }}>
          {isNativeBeap ? (
            <div className="native-beap-body">
              {isOutboundQbeap ? (
                <div
                  style={{
                    padding: 24,
                    textAlign: 'center',
                    color: 'var(--color-text-muted, #6b7280)',
                    fontStyle: 'italic',
                    fontSize: 14,
                    lineHeight: 1.5,
                  }}
                >
                  📤 You sent this message. Content is encrypted for the recipient and cannot be viewed here. Check the{' '}
                  <strong>Sent</strong> tab for your copy.
                </div>
              ) : (
                <>
                  {publicBody ? (
                    <div className="beap-body-section">
                      <div className="beap-body-label">📨 Public Message (pBEAP)</div>
                      <pre
                        className="beap-body-pre beap-body-content beap-body-content--public"
                        style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}
                      >
                        {publicBody}
                      </pre>
                    </div>
                  ) : null}

                  {encryptedBody ? (
                    <div className="beap-body-section">
                      <div className="beap-body-label beap-body-label--encrypted beap-body-label--confidential">
                        🔒 End-to-End Encrypted (qBEAP)
                      </div>
                      <div className="beap-body-content--encrypted beap-body-content beap-body-content--confidential">
                        <pre
                          className="beap-body-pre"
                          style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit' }}
                        >
                          {encryptedBody}
                        </pre>
                      </div>
                    </div>
                  ) : null}

                  {!publicBody && !encryptedBody ? (
                    <div className="beap-body-section" style={{ opacity: 0.5 }}>
                      {parsedDepackaged && isPendingQbeapDepackaged(parsedDepackaged) ? (
                        <>
                          Waiting for decryption… Content will appear when the extension processes this message (merge into
                          the desktop inbox).
                        </>
                      ) : (
                        'Content not yet decrypted on this device.'
                      )}
                    </div>
                  ) : null}
                </>
              )}

              {parsedDepackaged && automationTags.length > 0 ? (
                <div className="beap-body-section">
                  <div className="beap-body-label">🏷️ Automation Tags</div>
                  <div className="beap-automation-tags">
                    {automationTags.map((tag, i) => (
                      <span key={i} className="beap-automation-tag">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {parsedDepackaged && sessionRefsList.length > 0 ? (
                <div className="beap-body-section beap-session-indicator">
                  <div className="beap-body-label">⚙️ Attached Session</div>
                  {sessionRefsList.map((ref, i) => {
                    const sessionId =
                      typeof ref.sessionId === 'string' ? ref.sessionId : String(ref.sessionId ?? '')
                    const sessionName =
                      typeof ref.sessionName === 'string'
                        ? ref.sessionName
                        : sessionId || 'Session'
                    const cap = ref.requiredCapability
                    const capLabel =
                      cap != null && typeof cap === 'object'
                        ? JSON.stringify(cap)
                        : cap != null
                          ? String(cap)
                          : ''
                    const status = importStatus[sessionId]
                    return (
                      <div key={`${sessionId}-${i}`} className="beap-session-ref">
                        <span className="beap-session-name">{sessionName || sessionId}</span>
                        {capLabel ? (
                          <span className="beap-session-capability">Requires: {capLabel}</span>
                        ) : null}
                        {status === 'imported' ? (
                          <span className="beap-session-imported">✓ Imported</span>
                        ) : (
                          <>
                            {status === 'error' ? (
                              <span className="beap-session-import-error">Import failed</span>
                            ) : null}
                            <button
                              type="button"
                              className="beap-session-import-btn"
                              onClick={() => setImportingSession(ref)}
                              disabled={status === 'importing'}
                            >
                              {status === 'importing' ? 'Importing…' : status === 'error' ? 'Retry' : '▶ Import & Run'}
                            </button>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : null}
            </div>
          ) : (
            <>
              {message.body_html ? (
                <div
                  className="msg-detail-body-html"
                  onClick={(e) => {
                    const a = (e.target as HTMLElement).closest('a[href]')
                    if (a) {
                      e.preventDefault()
                      e.stopPropagation()
                      const href = (a as HTMLAnchorElement).href
                      if (href && !href.startsWith('mailto:')) handleLinkClick(href)
                    }
                  }}
                  style={{
                    fontSize: 13,
                    lineHeight: 1.6,
                    color: 'var(--color-text, #e2e8f0)',
                  }}
                >
                  <div
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(message.body_html) }}
                    style={{ fontSize: 'inherit', lineHeight: 'inherit', color: 'inherit' }}
                  />
                </div>
              ) : (
                <pre
                  style={{
                    margin: 0,
                    fontSize: 13,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'inherit',
                  }}
                >
                  {extractLinkParts(message.body_text || '(No body)').map((part, i) =>
                    part.type === 'text' ? (
                      <span key={i}>{part.text}</span>
                    ) : (
                      <button
                        key={i}
                        type="button"
                        className="msg-safe-link-btn"
                        onClick={() => handleLinkClick(part.url!)}
                      >
                        {part.text}
                      </button>
                    )
                  )}
                </pre>
              )}

              {message.depackaged_json && !isNativeBeap ? (
                <div style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="msg-detail-beap-toggle"
                    onClick={() => setBeapPanelOpen((o) => !o)}
                  >
                    BEAP content
                  </button>
                  {beapPanelOpen && (
                    <div className="msg-detail-beap-panel">
                      {renderDepackagedJson(message.depackaged_json)}
                    </div>
                  )}
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Attachments — all source types; rows load even when list omitted attachment join */}
        {showAttachmentsBlock && (
          <div className="inbox-detail-attachments-block" data-subfocus="attachment">
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--color-text-muted, #94a3b8)',
                marginBottom: 12,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              📎 ATTACHMENTS
            </div>
            {attachments.length > 0 ? (
              attachments.map((att) => (
                <InboxAttachmentRow
                  key={att.id}
                  attachment={att}
                  selectedAttachmentId={selectedAttachmentIdProp ?? storeSelectedAttachmentId}
                  onSelectAttachment={onSelectAttachment ?? ((id) => selectAttachment(message.id, id))}
                />
              ))
            ) : attachmentsPendingRows ? (
              <div
                className="inbox-detail-attachments-loading"
                style={{ fontSize: 12, color: 'var(--color-text-muted, #94a3b8)' }}
              >
                Loading attachment list…
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
    </>
  )
}
