import React, { useMemo } from 'react'
import {
  parseBracketedAccountSyncMessage,
  classifySyncFailureMessage,
  buildTlsSyncFailureCopy,
  type SyncFailureKind,
} from '../utils/syncFailureUi'

const MUTED = 'var(--text-secondary, #64748b)'
const PRIMARY = 'var(--text-primary, var(--text-primary-prof, #0f172a))'
const ERR_BG = 'rgba(239,68,68,0.12)'
const ERR_BORDER = 'rgba(239,68,68,0.4)'

type AccountLite = {
  id: string
  email: string
  provider?: string
  imapHost?: string
  imapPort?: number
  imapSecurity?: string
}

type Props = {
  warnings: string[]
  accounts: AccountLite[]
  onUpdateCredentials: (accountId: string) => void
  onRemoveAccount: (accountId: string) => void
}

type ParsedRow = {
  key: string
  accountId: string
  email: string
  provider?: string
  imapHost?: string
  imapPort?: number
  imapSecurity?: string
  isImap: boolean
  kind: SyncFailureKind
  message: string
}

export function SyncFailureBanner({ warnings, accounts, onUpdateCredentials, onRemoveAccount }: Props) {
  const rows = useMemo(() => {
    const out: ParsedRow[] = []
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
          provider: acc?.provider,
          imapHost: acc?.imapHost,
          imapPort: acc?.imapPort,
          imapSecurity: acc?.imapSecurity,
          isImap,
          kind,
          message,
        })
      } else if (!seen.has('__unscoped__')) {
        seen.add('__unscoped__')
        out.push({
          key: '__unscoped__',
          accountId: '',
          email: 'Email account',
          isImap: true,
          kind: classifySyncFailureMessage(line),
          message: line,
        })
      }
    }
    return out
  }, [warnings, accounts])

  const delegatedRows = rows.filter((r) => r.kind === 'delegated')
  const ingestionRows = rows.filter((r) =>
    r.kind === 'sandbox_unreachable' || r.kind === 'sandbox_no_read' || r.kind === 'sandbox_fetch_failed',
  )
  const failureRows = rows.filter(
    (r) => r.kind !== 'delegated' && !ingestionRows.includes(r),
  )

  if (delegatedRows.length === 0 && failureRows.length === 0 && ingestionRows.length === 0) return null

  return (
    <>
      {delegatedRows.length > 0 ? (
        <div
          role="status"
          style={{
            padding: '10px 12px',
            fontSize: 12,
            color: PRIMARY,
            background: 'var(--bg-elevated, rgba(224,242,254,0.35))',
            borderBottom: '1px solid rgba(14,116,144,0.25)',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8, color: PRIMARY }}>Outbound only on this device</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {delegatedRows.map((r) => (
              <div
                key={r.key}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'var(--bg-surface, rgba(255,255,255,0.65))',
                  border: '1px solid rgba(14,116,144,0.2)',
                  color: PRIMARY,
                }}
              >
                <div style={{ fontSize: 11, lineHeight: 1.45 }}>
                  <strong>{r.email}</strong>: {r.message.replace(/\s*\(Settings.*\)\s*$/i, '').trim()}
                </div>
                <div style={{ fontSize: 10, color: MUTED, marginTop: 4, lineHeight: 1.4 }}>
                  Inbound mail is fetched on your sandbox device. This host account is for outbound mail only.
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {ingestionRows.length > 0 ? (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="sync-failure-ingestion-alert"
          style={{
            padding: '10px 12px',
            fontSize: 12,
            color: PRIMARY,
            background: ERR_BG,
            borderBottom: `1px solid ${ERR_BORDER}`,
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8, color: PRIMARY }}>Sandbox sync failed</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {ingestionRows.map((r) => (
              <div
                key={r.key}
                data-sync-failure-kind={r.kind}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'var(--bg-elevated, rgba(255,255,255,0.75))',
                  border: `1px solid ${ERR_BORDER}`,
                  color: PRIMARY,
                }}
              >
                <div style={{ fontSize: 11, lineHeight: 1.45 }}>
                  <strong>{r.email}</strong>: {r.message}
                </div>
                {r.kind === 'sandbox_unreachable' ? (
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 4, lineHeight: 1.4 }}>
                    Mail was not synced on this Sync. Start the sandbox app and confirm the internal handshake is active.
                  </div>
                ) : r.kind === 'sandbox_no_read' ? (
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 4, lineHeight: 1.4 }}>
                    The host reached the sandbox, but no read-only mailbox is configured there yet.
                  </div>
                ) : (
                  <div style={{ fontSize: 10, color: MUTED, marginTop: 4, lineHeight: 1.4 }}>
                    The sandbox is reachable but could not pull mail from the provider.
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {failureRows.length > 0 ? (
        <div
          role="alert"
          style={{
            padding: '10px 12px',
            fontSize: 12,
            color: PRIMARY,
            background: 'rgba(251,191,36,0.12)',
            borderBottom: '1px solid rgba(251,191,36,0.35)',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 8, color: PRIMARY }}>Sync issue</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {failureRows.map((r) => (
              <div
                key={r.key}
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.6)',
                  border: '1px solid rgba(251,191,36,0.4)',
                  color: PRIMARY,
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
                  (() => {
                    const copy = buildTlsSyncFailureCopy({
                      email: r.email,
                      provider: r.provider,
                      imapHost: r.imapHost,
                      imapPort: r.imapPort,
                      imapSecurity: r.imapSecurity,
                    })
                    return (
                      <div style={{ fontSize: 11, lineHeight: 1.45 }}>
                        <strong>{r.email}</strong>: {copy.lead}
                        <div style={{ fontSize: 10, color: MUTED, marginTop: 4, lineHeight: 1.4 }}>{copy.hint}</div>
                      </div>
                    )
                  })()
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
      ) : null}
    </>
  )
}
