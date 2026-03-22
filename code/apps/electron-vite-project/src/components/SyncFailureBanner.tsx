import React, { useMemo } from 'react'
import { parseBracketedAccountSyncMessage, isAuthSyncFailureMessage } from '../utils/syncFailureUi'

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
      isAuth: boolean
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
        const isAuth = isAuthSyncFailureMessage(message)
        out.push({
          key: accountId,
          accountId,
          email,
          isImap,
          isAuth,
        })
      } else if (!seen.has('__unscoped__')) {
        seen.add('__unscoped__')
        out.push({
          key: '__unscoped__',
          accountId: '',
          email: 'Email account',
          isImap: true,
          isAuth: isAuthSyncFailureMessage(line),
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
            {r.isAuth && r.isImap ? (
              <>
                <div style={{ marginBottom: 6 }}>
                  <span style={{ marginRight: 6 }}>⚠️</span>
                  <strong>{r.email}</strong>: Authentication failed.
                </div>
                <div style={{ fontSize: 11, color: MUTED, marginBottom: 8, lineHeight: 1.4 }}>
                  IMAP password may be incorrect or expired. For providers like web.de, create an app password in the
                  provider&apos;s security settings.
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
            ) : (
              <div style={{ fontSize: 11, lineHeight: 1.45 }}>
                <strong>{r.email}</strong>: Connection issue. Check the account in Email Accounts or try again.
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
