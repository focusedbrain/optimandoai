import React, { useMemo } from 'react'
import {
  parseBracketedAccountSyncMessage,
  classifySyncFailureMessage,
  type SyncFailureKind,
} from '../utils/syncFailureUi'

const MUTED = '#64748b'

type AccountLite = { id: string; email: string; provider?: string }

type Props = {
  warnings: string[]
  accounts: AccountLite[]
  onUpdateCredentials: (accountId: string) => void
  onRemoveAccount: (accountId: string) => void
}

export function SyncFailureBanner({ warnings, accounts, onUpdateCredentials, onRemoveAccount }: Props) {
  const rows = useMemo(() => {
    const out: Array<{
      key: string
      accountId: string
      email: string
      isImap: boolean
      kind: SyncFailureKind
    }> = []
    const seen = new Set<string>()
    for (const line of warnings) {
      const parsed = parseBracketedAccountSyncMessage(line)
      const message = parsed?.message ?? line
      if (parsed?.accountId) {
        const accountId = parsed.accountId
        if (seen.has(accountId)) continue
        seen.add(accountId)
        const acc = accounts.find((a) => a.id === accountId)
        const email = acc?.email || accountId.slice(0, 8) + '…'
        const isImap = acc?.provider === 'imap' || (!acc && message.toLowerCase().includes('imap'))
        const kind = classifySyncFailureMessage(message)
        out.push({
          key: accountId,
          accountId,
          email,
          isImap,
          kind,
        })
      } else if (!seen.has('__unscoped__')) {
        seen.add('__unscoped__')
        out.push({
          key: '__unscoped__',
          accountId: '',
          email: 'Email account',
          isImap: true,
          kind: classifySyncFailureMessage(line),
        })
      }
    }
    return out
  }, [warnings, accounts])

  if (rows.length === 0) return null

  return (
    <div
      role="alert"
      style={{
        padding: '10px 12px',
        fontSize: 12,
        color: '#0f172a',
        background: 'rgba(251,191,36,0.12)',
        borderBottom: '1px solid rgba(251,191,36,0.35)',
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Sync issue</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.map((r) => (
          <div
            key={r.key}
            style={{
              padding: '8px 10px',
              borderRadius: 8,
              background: 'rgba(255,255,255,0.6)',
              border: '1px solid rgba(251,191,36,0.4)',
            }}
          >
            {r.kind === 'auth' && r.isImap ? (
              <>
                <div style={{ marginBottom: 6 }}>
                  <span style={{ marginRight: 6 }}>⚠️</span>
                  <strong>{r.email}</strong>: Authentication failed (live sync cannot update).
                </div>
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 8, lineHeight: 1.4 }}>
                  IMAP password may be incorrect or expired. For providers like web.de, use the full email as username,
                  enable IMAP in the provider, and create an app password if required.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {r.accountId ? (
                    <>
                      <button
                        type="button"
                        className="sync-failure-banner-btn sync-failure-banner-btn--primary"
                        onClick={() => onUpdateCredentials(r.accountId)}
                      >
                        Update credentials
                      </button>
                      <button
                        type="button"
                        className="sync-failure-banner-btn"
                        onClick={() => onRemoveAccount(r.accountId)}
                      >
                        Remove account
                      </button>
                    </>
                  ) : (
                    <span style={{ fontSize: 11, color: MUTED }}>Open Email Accounts below to reconnect.</span>
                  )}
                </div>
              </>
            ) : r.kind === 'timeout' ? (
              <div style={{ fontSize: 11, lineHeight: 1.45 }}>
                <strong>{r.email}</strong>: Live sync timed out. Messages you see may be from this device only until sync
                completes. Try again in a moment or reduce the sync window in settings.
              </div>
            ) : r.kind === 'tls' ? (
              <div style={{ fontSize: 11, lineHeight: 1.45 }}>
                <strong>{r.email}</strong>: TLS/SSL issue reaching the mail server. For web.de use host{' '}
                <code style={{ fontSize: 10 }}>imap.web.de</code>, port <code style={{ fontSize: 10 }}>993</code>, and
                SSL/TLS (not STARTTLS on that port).
              </div>
            ) : r.kind === 'network' ? (
              <div style={{ fontSize: 11, lineHeight: 1.45 }}>
                <strong>{r.email}</strong>: Network error — could not reach the mail server. Check your connection or VPN.
                Cached messages may still be shown.
              </div>
            ) : (
              <div style={{ fontSize: 11, lineHeight: 1.45 }}>
                <strong>{r.email}</strong>: Live sync failed. Cached messages may still be shown. Check the account in
                Email Accounts or try again.
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
