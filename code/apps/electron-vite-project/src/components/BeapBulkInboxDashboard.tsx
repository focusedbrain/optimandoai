/**
 * BeapBulkInboxDashboard — Bulk inbox grid view for Electron dashboard.
 *
 * Full-width layout matching extension's BeapBulkInbox.
 * Compose buttons [+ BEAP] and [✉+] Email at bottom-right.
 */

import { useState, useEffect, useCallback } from 'react'
import { BeapBulkInbox } from '@ext/beap-messages/components/BeapBulkInbox'
import { EmailProvidersSection } from '@ext/wrguard/components/EmailProvidersSection'

interface BeapBulkInboxDashboardProps {
  onMessageSelect?: (messageId: string | null) => void
  onSetSearchContext?: (context: string) => void
  onNavigateToHandshake?: (handshakeId: string) => void
  onViewInInbox?: (messageId: string) => void
}

export default function BeapBulkInboxDashboard({
  onSetSearchContext,
  onNavigateToHandshake,
  onViewInInbox,
}: BeapBulkInboxDashboardProps) {
  const [emailAccounts, setEmailAccounts] = useState<Array<{ id: string; displayName: string; email: string; provider: 'gmail' | 'microsoft365' | 'imap'; status: 'active' | 'error' | 'disabled'; lastError?: string }>>([])
  const [isLoadingEmailAccounts, setIsLoadingEmailAccounts] = useState(true)
  const [selectedEmailAccountId, setSelectedEmailAccountId] = useState<string | null>(null)

  const loadEmailAccounts = useCallback(async () => {
    if (typeof (window as any).emailAccounts?.listAccounts !== 'function') {
      setIsLoadingEmailAccounts(false)
      return
    }
    try {
      const res = await (window as any).emailAccounts!.listAccounts()
      if (res?.ok && res?.data) {
        setEmailAccounts(res.data)
        setSelectedEmailAccountId((prev) => (prev && res.data.some((a: { id: string }) => a.id === prev)) ? prev : (res.data[0]?.id ?? null))
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

  const handleConnectEmail = useCallback(async () => {
    try {
      if (typeof (window as any).emailAccounts?.connectGmail === 'function') {
        const res = await (window as any).emailAccounts!.connectGmail('Gmail Account')
        if (res?.ok) loadEmailAccounts()
      } else {
        window.analysisDashboard?.openEmailCompose?.()
      }
    } catch {
      window.analysisDashboard?.openEmailCompose?.()
    }
  }, [loadEmailAccounts])

  const handleDisconnectEmail = useCallback(async (id: string) => {
    try {
      if (typeof (window as any).emailAccounts?.deleteAccount === 'function') {
        await (window as any).emailAccounts!.deleteAccount(id)
        loadEmailAccounts()
      }
    } catch {
      // ignore
    }
  }, [loadEmailAccounts])

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

      {/* Connected Email Accounts */}
      <EmailProvidersSection
        theme="professional"
        emailAccounts={emailAccounts}
        isLoadingEmailAccounts={isLoadingEmailAccounts}
        selectedEmailAccountId={selectedEmailAccountId}
        onConnectEmail={handleConnectEmail}
        onDisconnectEmail={handleDisconnectEmail}
        onSelectEmailAccount={setSelectedEmailAccountId}
      />

      <div style={{ flex: 1, overflow: 'hidden' }}>
        <BeapBulkInbox
          theme="professional"
          onSetSearchContext={onSetSearchContext}
          onViewHandshake={onNavigateToHandshake}
          onViewInInbox={onViewInInbox}
        />
      </div>

      {/* Compose buttons — bottom-right: [✉+] inner (left), [+ BEAP] outer (right) */}
      <div style={{ position: 'absolute', bottom: 20, right: 20, display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          onClick={() => window.analysisDashboard?.openEmailCompose?.()}
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
          onClick={() => window.analysisDashboard?.openBeapDraft?.()}
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
