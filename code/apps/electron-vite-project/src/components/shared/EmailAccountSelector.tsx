/**
 * Shared “send from” account picker + connect / manage — used by dashboard email, inbox email,
 * and BEAP composers when delivery is email. Connect flow uses the same wizard as the inbox * (`useConnectEmailFlow` / EmailConnectWizard).
 */

import { useCallback, useEffect, useState } from 'react'
import { pickDefaultEmailAccountRowId } from '@ext/shared/email/pickDefaultAccountRow'
import {
  ConnectEmailLaunchSource,
  useConnectEmailFlow,
  type ConnectEmailFlowTheme,
} from '@ext/shared/email/connectEmailFlow'
import './email-account-selector.css'

export type EmailAccountSelectorAccount = {
  id: string
  displayName: string
  email: string
  provider: string
  status?: string
  processingPaused?: boolean
  lastError?: string
}

function providerLabel(provider: string): string {
  switch (provider) {
    case 'gmail':
      return 'Gmail'
    case 'microsoft365':
      return 'Outlook'
    case 'zoho':
      return 'Zoho'
    case 'imap':
      return 'Custom (IMAP)'
    default:
      return provider || 'Email'
  }
}

function accountStatusLabel(a: EmailAccountSelectorAccount): string {
  if (a.status === 'active' && a.processingPaused) return 'Connected · sync paused'
  switch (a.status) {
    case 'active':
      return 'Connected'
    case 'auth_error':
      return a.lastError?.trim() ? `Sign-in issue: ${a.lastError}` : 'Sign-in required'
    case 'error':
      return a.lastError?.trim() ? a.lastError : 'Connection error'
    case 'disabled':
      return 'Disabled'
    default:
      return 'Unknown'
  }
}

async function fetchAccountRows(): Promise<EmailAccountSelectorAccount[]> {
  if (typeof window.emailAccounts?.listAccounts !== 'function') return []
  try {
    const res = await window.emailAccounts.listAccounts()
    if (res.ok && res.data && res.data.length > 0) {
      return res.data as EmailAccountSelectorAccount[]
    }
  } catch {
    /* ignore */
  }
  return []
}

export interface EmailAccountSelectorProps {
  selectedAccountId: string | null
  onAccountChange: (id: string | null) => void
  /** Wizard styling */
  connectTheme?: ConnectEmailFlowTheme
  connectLaunchSource?: ConnectEmailLaunchSource
  /** Fired after each load completes (initial + refresh). */
  onLoadingChange?: (loading: boolean) => void
}

export function EmailAccountSelector({
  selectedAccountId,
  onAccountChange,
  connectTheme = 'professional',
  connectLaunchSource = ConnectEmailLaunchSource.Inbox,
  onLoadingChange,
}: EmailAccountSelectorProps) {
  const [accounts, setAccounts] = useState<EmailAccountSelectorAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [showManage, setShowManage] = useState(false)

  const loadAccounts = useCallback(async (): Promise<EmailAccountSelectorAccount[]> => {
    setLoading(true)
    onLoadingChange?.(true)
    try {
      const list = await fetchAccountRows()
      setAccounts(list)
      return list
    } finally {
      setLoading(false)
      onLoadingChange?.(false)
    }
  }, [onLoadingChange])

  const { openConnectEmail, connectEmailFlowModal } = useConnectEmailFlow({
    theme: connectTheme,
    onAfterConnected: async () => {
      await loadAccounts()
    },
  })

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  useEffect(() => {
    const onChanged = () => {
      void loadAccounts()
    }
    window.addEventListener('wrdesk:email-accounts-changed', onChanged)
    return () => window.removeEventListener('wrdesk:email-accounts-changed', onChanged)
  }, [loadAccounts])

  useEffect(() => {
    const unsub = window.emailAccounts?.onAccountConnected?.((data) => {
      void (async () => {
        await loadAccounts()
        if (data.accountId) {
          onAccountChange(data.accountId)
          return
        }
        const em = data.email?.trim().toLowerCase()
        if (em) {
          const list = await fetchAccountRows()
          const row = list.find((a) => a.email?.trim().toLowerCase() === em)
          if (row) onAccountChange(row.id)
        }
      })()
    })
    return () => unsub?.()
  }, [loadAccounts, onAccountChange])

  useEffect(() => {
    if (accounts.length === 0) {
      if (selectedAccountId !== null) onAccountChange(null)
      return
    }
    const stillThere = selectedAccountId && accounts.some((a) => a.id === selectedAccountId)
    if (stillThere) return
    const pick =
      pickDefaultEmailAccountRowId(accounts.map((a) => ({ id: a.id, status: a.status }))) ??
      accounts[0].id
    onAccountChange(pick)
  }, [accounts, onAccountChange, selectedAccountId])

  if (loading && accounts.length === 0) {
    return (
      <div className="email-account-loading">
        Loading accounts…
        {connectEmailFlowModal}
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <div className="email-account-empty">
        <span>No email account connected.</span>
        <button type="button" onClick={() => openConnectEmail(connectLaunchSource)}>
          + Connect Email Account
        </button>
        {connectEmailFlowModal}
      </div>
    )
  }

  const active = accounts.find((a) => a.id === selectedAccountId) ?? accounts[0]

  return (
    <div className="email-account-selector">
      <div className="email-account-active">
        <label htmlFor="email-account-selector-select">Send from:</label>
        <select
          id="email-account-selector-select"
          value={selectedAccountId ?? active.id}
          onChange={(e) => onAccountChange(e.target.value || null)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.email || a.displayName} ({providerLabel(a.provider)})
            </option>
          ))}
        </select>
        <button type="button" className="btn-sm" onClick={() => openConnectEmail(connectLaunchSource)} title="Connect account">
          +
        </button>
        <button
          type="button"
          className="btn-sm"
          onClick={() => setShowManage((v) => !v)}
          title="Manage accounts"
          aria-expanded={showManage}
        >
          {'\u2699'}
        </button>
      </div>
      <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
        {providerLabel(active.provider)} · {accountStatusLabel(active)}
      </div>

      {showManage && (
        <div className="email-account-manage">
          {accounts.map((a) => (
            <div key={a.id} className="email-account-row">
              <span className="account-email">{a.email || a.displayName}</span>
              <span className="account-provider">{providerLabel(a.provider)}</span>
              {a.id === selectedAccountId ? (
                <span className="account-active-badge">Active</span>
              ) : (
                <button type="button" className="btn-sm" onClick={() => onAccountChange(a.id)}>
                  Set Active
                </button>
              )}
              <button
                type="button"
                className="btn-danger-sm"
                onClick={async () => {
                  if (typeof window.emailAccounts?.deleteAccount !== 'function') return
                  await window.emailAccounts.deleteAccount(a.id)
                  await loadAccounts()
                  try {
                    window.dispatchEvent(new CustomEvent('wrdesk:email-accounts-changed'))
                  } catch {
                    /* noop */
                  }
                }}
              >
                Disconnect
              </button>
            </div>
          ))}
        </div>
      )}

      {connectEmailFlowModal}
    </div>
  )
}

export default EmailAccountSelector
