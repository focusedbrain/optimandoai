/**
 * BeapBulkInboxDashboard — Bulk inbox grid view for Electron dashboard.
 *
 * Full-width layout matching extension's BeapBulkInbox.
 * Compose buttons [+ BEAP] and [✉+] Email at bottom-right.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { BeapBulkInbox } from '@ext/beap-messages/components/BeapBulkInbox'
import { createBeapReplyAiProvider } from '@ext/beap-messages/services/beapReplyAiProvider'
import { EmailProvidersSection } from '@ext/wrguard/components/EmailProvidersSection'
import { ConnectEmailLaunchSource, useConnectEmailFlow } from '@ext/shared/email/connectEmailFlow'

interface BeapBulkInboxDashboardProps {
  onMessageSelect?: (messageId: string | null) => void
  onEmailAccountsChanged?: () => void
  onSetSearchContext?: (context: string) => void
  onNavigateToHandshake?: (handshakeId: string) => void
  onViewInInbox?: (messageId: string) => void
}

export default function BeapBulkInboxDashboard({
  onEmailAccountsChanged,
  onSetSearchContext,
  onNavigateToHandshake,
  onViewInInbox,
}: BeapBulkInboxDashboardProps) {
  const [emailAccounts, setEmailAccounts] = useState<
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
  const [isLoadingEmailAccounts, setIsLoadingEmailAccounts] = useState(true)
  const [selectedEmailAccountId, setSelectedEmailAccountId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null)
  const composeClickRef = useRef<number>(0)

  const handleComposeClick = useCallback((fn: () => void) => {
    const now = Date.now()
    if (now - composeClickRef.current < 600) return
    composeClickRef.current = now
    fn()
  }, [])

  const notify = useCallback((msg: string, type: 'success' | 'error' | 'info') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }, [])

  const loadEmailAccounts = useCallback(async () => {
    if (typeof (window as any).emailAccounts?.listAccounts !== 'function') {
      setIsLoadingEmailAccounts(false)
      return
    }
    try {
      const res = await (window as any).emailAccounts!.listAccounts()
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
        setEmailAccounts(
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
        setSelectedEmailAccountId((prev) =>
          prev && data.some((a) => a.id === prev) ? prev : (data[0]?.id ?? null),
        )
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingEmailAccounts(false)
    }
  }, [])

  useEffect(() => {
    loadEmailAccounts()
  }, [loadEmailAccounts])

  useEffect(() => {
    const unsub = (window as any).emailAccounts?.onAccountConnected?.(() => loadEmailAccounts())
    return () => unsub?.()
  }, [loadEmailAccounts])

  const { openConnectEmail, connectEmailFlowModal } = useConnectEmailFlow({
    onAfterConnected: loadEmailAccounts,
    theme: 'professional',
  })

  useEffect(() => {
    const unsub = window.emailAccounts?.onCredentialError?.((p) => {
      void loadEmailAccounts()
      if (p.provider === 'imap') {
        const open = window.confirm(`${p.message}\n\nOpen credential update for this account?`)
        if (open) {
          openConnectEmail(ConnectEmailLaunchSource.BeapBulkInboxDashboard, { reconnectAccountId: p.accountId })
        }
      }
    })
    return () => unsub?.()
  }, [loadEmailAccounts, openConnectEmail])

  const handleConnectEmail = useCallback(() => {
    openConnectEmail(ConnectEmailLaunchSource.BeapBulkInboxDashboard)
  }, [openConnectEmail])

  const handleUpdateImapCredentials = useCallback(
    (accountId: string) => {
      openConnectEmail(ConnectEmailLaunchSource.BeapBulkInboxDashboard, { reconnectAccountId: accountId })
    },
    [openConnectEmail],
  )

  const handleDisconnectEmail = useCallback(async (id: string) => {
    try {
      if (typeof (window as any).emailAccounts?.deleteAccount === 'function') {
        await (window as any).emailAccounts!.deleteAccount(id)
        loadEmailAccounts()
        onEmailAccountsChanged?.()
        notify('Email account disconnected', 'info')
      }
    } catch {
      notify('Failed to disconnect account', 'error')
    }
  }, [loadEmailAccounts, notify, onEmailAccountsChanged])

  const handleSetProcessingPaused = useCallback(
    async (id: string, paused: boolean) => {
      if (typeof window.emailAccounts?.setProcessingPaused !== 'function') return
      setEmailAccounts((rows) =>
        rows.map((a) => (a.id === id ? { ...a, processingPaused: paused } : a)),
      )
      try {
        const res = await window.emailAccounts.setProcessingPaused(id, paused)
        if (!res?.ok) throw new Error((res as { error?: string })?.error || 'Failed')
        await loadEmailAccounts()
        onEmailAccountsChanged?.()
        notify(paused ? 'Sync paused' : 'Sync resumed', 'info')
      } catch {
        await loadEmailAccounts()
        onEmailAccountsChanged?.()
        notify('Could not update pause state', 'error')
      }
    },
    [loadEmailAccounts, notify, onEmailAccountsChanged],
  )

  // Reply composer config: AI provider for Draft with AI + enhanced classification
  const replyComposerConfig = useMemo(() => {
    const generate = async (prompt: string): Promise<string> => {
      const fn = (window as any).handshakeView?.generateDraft
      if (typeof fn !== 'function') throw new Error('Draft generation not available')
      const result = await fn(prompt)
      if (!result?.success) throw new Error(result?.error ?? 'Draft generation failed')
      return result?.answer ?? ''
    }
    return {
      senderFingerprint: '',
      senderFingerprintShort: '',
      aiProvider: createBeapReplyAiProvider(generate),
      policy: { allowSemanticProcessing: true, allowActuatingProcessing: false },
    }
  }, [])

  return (
    <div style={{
      position: 'relative',
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      background: 'var(--color-bg, #0f172a)',
      color: 'var(--color-text, #e2e8f0)',
    }}>
      {/* Toolbar */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid var(--color-border, rgba(255,255,255,0.08))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '13px', fontWeight: 700 }}>Bulk Inbox</span>
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 12,
            right: 16,
            zIndex: 1001,
            padding: '10px 16px',
            borderRadius: 8,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
            background: toast.type === 'success' ? '#d1fae5' : toast.type === 'error' ? '#fee2e2' : '#e0e7ff',
            color: toast.type === 'success' ? '#065f46' : toast.type === 'error' ? '#991b1b' : '#3730a3',
          }}
        >
          {toast.msg}
        </div>
      )}

      {connectEmailFlowModal}

      {/* Connected Email Accounts */}
      <EmailProvidersSection
        theme="professional"
        emailAccounts={emailAccounts}
        isLoadingEmailAccounts={isLoadingEmailAccounts}
        selectedEmailAccountId={selectedEmailAccountId}
        onConnectEmail={handleConnectEmail}
        onDisconnectEmail={handleDisconnectEmail}
        onSetProcessingPaused={handleSetProcessingPaused}
        onSelectEmailAccount={setSelectedEmailAccountId}
        onUpdateImapCredentials={handleUpdateImapCredentials}
      />

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <BeapBulkInbox
          theme="professional"
          onSetSearchContext={onSetSearchContext}
          onViewHandshake={onNavigateToHandshake}
          onViewInInbox={onViewInInbox}
          replyComposerConfig={replyComposerConfig}
          onClassificationComplete={(count) => notify(`Analysis complete — ${count} message${count === 1 ? '' : 's'} classified`, 'success')}
          onArchiveComplete={(count) => notify(`Archived ${count} message${count === 1 ? '' : 's'}`, 'success')}
        />
      </div>

      {/* Compose buttons — bottom-right: [✉+] inner (left), [+ BEAP] outer (right) */}
      <div style={{ position: 'absolute', bottom: 20, right: 20, display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          onClick={() => handleComposeClick(() => window.analysisDashboard?.openEmailCompose?.())}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            padding: '10px 14px', borderRadius: '24px',
            background: '#2563eb', color: '#fff', border: 'none',
            fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(37,99,235,0.3)'
          }}
          title="New Email"
        >
          ✉️+
        </button>
        <button
          onClick={() => handleComposeClick(() => window.analysisDashboard?.openBeapDraft?.())}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '10px 18px', borderRadius: '24px',
            background: '#7c3aed', color: '#fff', border: 'none',
            fontSize: '14px', fontWeight: 600, cursor: 'pointer',
            boxShadow: '0 2px 8px rgba(124,58,237,0.3)'
          }}
          title="New BEAP™ Message"
        >
          + BEAP
        </button>
      </div>
    </div>
  )
}
