/**
 * EmailInboxView — Normal inbox: workflow buckets + type filter + sync (no bulk-only tools).
 * Left: toolbar + list. No selection: providers + import. Selection: message detail + per-message AI panel (50/50).
 */

import { useEffect, useCallback, useState, useRef, useMemo } from 'react'
import EmailInboxToolbar from './EmailInboxToolbar'
import { emailInboxSyncWindowSelectValue } from './EmailInboxSyncControls'
import EmailMessageDetail from './EmailMessageDetail'
import EmailComposeOverlay, { type DraftAttachment } from './EmailComposeOverlay'
import BeapMessageImportZone from './BeapMessageImportZone'
import { EmailProvidersSection } from '@ext/wrguard/components/EmailProvidersSection'
import { ConnectEmailLaunchSource, useConnectEmailFlow } from '@ext/shared/email/connectEmailFlow'
import { SyncFailureBanner } from './SyncFailureBanner'
import { pickDefaultEmailAccountRowId } from '@ext/shared/email/pickDefaultAccountRow'
import { useEmailInboxStore, activeEmailAccountIdsForSync, type InboxMessage } from '../stores/useEmailInboxStore'
import '../components/handshakeViewTypes'
import { InboxHandshakeNavIconButton } from './InboxHandshakeNavIcon'
import { deriveInboxMessageKind } from '../lib/inboxMessageKind'
import { useInboxPreloadQueue } from '../hooks/useInboxPreloadQueue'
import { InboxDetailAiPanel } from './InboxDetailAiPanel'

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

// ── InboxMessageRow ──

interface InboxMessageRowProps {
  message: InboxMessage
  selected: boolean
  onSelect: () => void
  onMouseEnter?: () => void
  onNavigateToHandshake?: (handshakeId: string) => void
}

function InboxMessageRow({ message, selected, onSelect, onMouseEnter, onNavigateToHandshake }: InboxMessageRowProps) {
  const isHandshakeKind = deriveInboxMessageKind(message) === 'handshake'
  const bodyPreview = (message.body_text || '').slice(0, 100).replace(/\s+/g, ' ').trim()
  const hasAttachments = message.has_attachments === 1

  return (
    <div
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      className={`inbox-message-row ${selected ? 'inbox-message-row--selected' : ''}`}
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
      {selected && (
        <span
          style={{
            flexShrink: 0,
            fontSize: 14,
            lineHeight: 1,
            color: 'var(--purple-accent, #a78bfa)',
          }}
          title="Focused — chat/search scoped to this message"
          aria-hidden
        >
          👉
        </span>
      )}

      {/* Kind badge (aligned with Type: Native BEAP vs Depackaged Email) */}
      <div
        title={isHandshakeKind ? 'Native BEAP' : 'Depackaged Email'}
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
          background: isHandshakeKind ? 'var(--purple-accent, #9333ea)' : 'rgba(107,114,128,0.5)',
          color: '#fff',
        }}
      >
        {isHandshakeKind ? 'B' : '✉'}
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
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
          {onNavigateToHandshake ? (
            <InboxHandshakeNavIconButton message={message} onNavigateToHandshake={onNavigateToHandshake} />
          ) : null}
        </div>
      </div>
    </div>
  )
}

// ── Main component ──

export interface EmailInboxViewProps {
  accounts: Array<{ id: string; email: string; status?: string }>
  selectedMessageId?: string | null
  onSelectMessage?: (messageId: string | null) => void
  selectedAttachmentId?: string | null
  onSelectAttachment?: (attachmentId: string | null) => void
  /** Open Handshakes view and select this relationship (when message has navigable handshake id). */
  onNavigateToHandshake?: (handshakeId: string) => void
}

export default function EmailInboxView({
  accounts,
  selectedMessageId: selectedMessageIdProp,
  onSelectMessage,
  selectedAttachmentId: selectedAttachmentIdProp,
  onSelectAttachment,
  onNavigateToHandshake,
}: EmailInboxViewProps) {
  const {
    messages,
    total,
    tabCounts,
    loading,
    error,
    lastSyncWarnings,
    selectedMessageId,
    selectedMessage,
    selectedAttachmentId,
    filter,
    analysisCache,
    autoSyncEnabled,
    syncing,
    fetchMessages,
    selectMessage,
    selectAttachment,
    setFilter,
    archiveMessages,
    deleteMessages,
    syncAllAccounts,
    toggleAutoSync,
    loadSyncState,
    accountSyncWindowDays,
    patchAccountSyncPreferences,
  } = useEmailInboxStore()

  const { prioritize } = useInboxPreloadQueue({ messages, analysisCache })

  const primaryAccountId = pickDefaultEmailAccountRowId(accounts)

  useEffect(() => {
    if (primaryAccountId) loadSyncState(primaryAccountId)
  }, [primaryAccountId, loadSyncState])

  const [aiPanelCollapsed, setAiPanelCollapsed] = useState(false)
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
      lastError?: string
    }>
  >([])
  const [isLoadingProviderAccounts, setIsLoadingProviderAccounts] = useState(true)
  const [selectedProviderAccountId, setSelectedProviderAccountId] = useState<string | null>(null)
  const [showEmailCompose, setShowEmailCompose] = useState(false)
  const [replyToMessage, setReplyToMessage] = useState<InboxMessage | null>(null)
  const [replyDraftBody, setReplyDraftBody] = useState<string>('')
  const [replyDraftAttachments, setReplyDraftAttachments] = useState<DraftAttachment[]>([])
  const composeClickRef = useRef<number>(0)

  const loadProviderAccounts = useCallback(async () => {
    if (typeof window.emailAccounts?.listAccounts !== 'function') {
      setIsLoadingProviderAccounts(false)
      return
    }
    try {
      const res = await window.emailAccounts.listAccounts()
      if (res?.ok && res?.data) {
        const data = res.data as Array<{ id: string; displayName?: string; email: string; provider?: string; status?: string; lastError?: string }>
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
        }
      } catch {
        /* ignore */
      }
    },
    [loadProviderAccounts]
  )

  // Sync App-level selection to store when props change
  useEffect(() => {
    if (selectedMessageIdProp !== undefined && selectedMessageIdProp !== selectedMessageId) {
      selectMessage(selectedMessageIdProp)
    }
  }, [selectedMessageIdProp, selectedMessageId, selectMessage])

  useEffect(() => {
    if (selectedAttachmentIdProp !== undefined && selectedAttachmentIdProp !== selectedAttachmentId) {
      selectAttachment(selectedMessageId ?? '', selectedAttachmentIdProp)
    }
  }, [selectedAttachmentIdProp, selectedAttachmentId, selectedMessageId, selectAttachment])

  const handleSelectMessage = useCallback(
    (id: string) => {
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

  useEffect(() => {
    fetchMessages()
  }, [fetchMessages])

  useEffect(() => {
    const unsub = window.emailInbox?.onNewMessages?.(() => {
      if (useEmailInboxStore.getState().syncing) return
      void fetchMessages()
    })
    return () => unsub?.()
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
    if (typeof window.analysisDashboard?.openEmailCompose === 'function') {
      window.analysisDashboard.openEmailCompose()
    } else {
      setReplyToMessage(null)
      setReplyDraftBody('')
      setShowEmailCompose(true)
    }
  }, [])

  const handleOpenBeapDraft = useCallback(() => {
    if (typeof window.analysisDashboard?.openBeapDraft === 'function') {
      window.analysisDashboard.openBeapDraft()
    }
  }, [])

  const handleReply = useCallback((msg: InboxMessage) => {
    const isDepackaged = msg.source_type === 'email_plain'
    if (isDepackaged) {
      const subject = msg.subject?.startsWith('Re:') ? msg.subject : `Re: ${msg.subject || '(No subject)'}`
      setReplyToMessage({ ...msg, subject })
      setReplyDraftBody('')
      setShowEmailCompose(true)
    } else {
      window.analysisDashboard?.openBeapDraft?.()
    }
  }, [])

  const [sendEmailToast, setSendEmailToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleSendDraft = useCallback(
    async (draft: string, msg: InboxMessage, attachments?: DraftAttachment[]): Promise<boolean> => {
      const isDepackaged = msg.source_type === 'email_plain'
      if (!isDepackaged) {
        navigator.clipboard?.writeText(draft).catch(() => {})
        window.analysisDashboard?.openBeapDraft?.()
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
          if (res?.ok && res.data) {
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
    [fetchMessages],
  )

  const gridCols = selectedMessageId ? 'minmax(260px, 320px) 1fr' : 'minmax(260px, 320px) 1fr minmax(260px, 300px)'

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        height: '100%',
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
      {/* Left panel: toolbar + message list */}
      <div
        className="email-inbox-normal-sidebar"
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
          onFilterChange={(partial) => setFilter(partial)}
          tabCounts={tabCounts}
          total={total}
          accounts={accounts}
          autoSyncEnabled={autoSyncEnabled}
          syncing={syncing}
          remoteSyncBusy={remoteSyncBusy}
          onUnifiedSync={() => void handleUnifiedSync()}
          accountSyncWindowDays={accountSyncWindowDays}
          onSyncWindowChange={handleSyncWindowChange}
          onToggleAutoSync={toggleAutoSync}
          pullOnly={inboxToolbarPullOnly}
        />

        {lastSyncWarnings && lastSyncWarnings.length > 0 ? (
          <SyncFailureBanner
            warnings={lastSyncWarnings}
            accounts={providerAccounts.map((a) => ({ id: a.id, email: a.email, provider: a.provider }))}
            onUpdateCredentials={handleUpdateImapCredentials}
            onRemoveAccount={handleDisconnectEmail}
          />
        ) : null}

        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          {loading ? (
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
                onSelect={() => handleSelectMessage(msg.id)}
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
          {total} message{total !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Center + Right when no message selected: provider area + capsule drop */}
      {!selectedMessageId && (
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
              onSelectEmailAccount={setSelectedProviderAccountId}
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

      {/* Message + per-message AI panel (50/50) */}
      {selectedMessageId && (
        <div className={`inbox-detail-workspace${aiPanelCollapsed ? ' inbox-detail-workspace--ai-collapsed' : ''}`}>
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

      {/* Inline email compose overlay (fallback when analysisDashboard.openEmailCompose not available) */}
      {showEmailCompose && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 200,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
          }}
          onClick={(e) => e.target === e.currentTarget && setShowEmailCompose(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 520,
              maxHeight: '90vh',
              overflow: 'hidden',
              background: 'var(--color-bg, #0f172a)',
              borderRadius: 12,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <EmailComposeOverlay
              theme="default"
              onClose={() => {
                setShowEmailCompose(false)
                setReplyToMessage(null)
                setReplyDraftBody('')
                setReplyDraftAttachments([])
              }}
              onSent={() => {
                setShowEmailCompose(false)
                setReplyToMessage(null)
                setReplyDraftBody('')
                setReplyDraftAttachments([])
                fetchMessages()
              }}
              replyTo={
                replyToMessage
                  ? {
                      to: replyToMessage.from_address ?? undefined,
                      subject: replyToMessage.subject ?? undefined,
                      body: replyDraftBody || undefined,
                      initialAttachments: replyDraftAttachments.length > 0 ? replyDraftAttachments : undefined,
                    }
                  : undefined
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}
