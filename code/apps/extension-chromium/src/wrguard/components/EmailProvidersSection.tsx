/**
 * EmailProvidersSection
 * 
 * Configure email providers for BEAP message dispatch and receipt.
 * MIRRORS the Connect Email section in BEAP Messages Draft.
 * Uses the same shared email account state from the sidepanel.
 * 
 * @version 2.0.0
 */

import React from 'react'
import { pickDefaultEmailAccountRowId } from '../../shared/email/pickDefaultAccountRow'

function providerDisplayLabel(provider: EmailAccount['provider']): string {
  switch (provider) {
    case 'microsoft365':
      return 'Microsoft 365'
    case 'gmail':
      return 'Gmail'
    case 'zoho':
      return 'Zoho'
    default:
      return 'IMAP'
  }
}

function RemoteSyncBadge({ provider }: { provider: EmailAccount['provider'] }) {
  if (provider === 'microsoft365' || provider === 'gmail' || provider === 'zoho') {
    return (
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#15803d',
          letterSpacing: 0.2,
        }}
      >
        🟢 Smart Sync
      </span>
    )
  }
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color: '#0f766e',
        letterSpacing: 0.2,
      }}
      title="IMAP: fetch mail and classify locally. The app does not move folders on the mail server."
    >
      🟢 Pull & Classify
    </span>
  )
}

// Email account type matching sidepanel state
export interface EmailAccount {
  id: string
  displayName: string
  email: string
  provider: 'gmail' | 'microsoft365' | 'zoho' | 'imap'
  status: 'active' | 'auth_error' | 'error' | 'disabled'
  /** From Electron listAccounts — user paused processing (orthogonal to status). */
  processingPaused?: boolean
  lastError?: string
}

function pausedRowNoteStyle(isLightTheme: boolean): React.CSSProperties {
  return {
    fontSize: 10,
    marginTop: 6,
    lineHeight: 1.35,
    color: isLightTheme ? '#b45309' : '#fcd34d',
    fontWeight: 500,
  }
}

/** Status dot color + short label for the account row (IMAP auth / sync). */
function accountConnectionBadge(account: EmailAccount): { dot: string; label: string } {
  switch (account.status) {
    case 'active':
      return { dot: '#22c55e', label: 'Connected' }
    case 'auth_error':
      return {
        dot: '#ef4444',
        label: account.lastError?.trim() ? `Sign-in failed: ${account.lastError}` : 'Sign-in failed — update credentials',
      }
    case 'error':
      return {
        dot: '#eab308',
        label: account.lastError?.trim() ? account.lastError : 'Connection error',
      }
    case 'disabled':
      return { dot: '#64748b', label: 'Disabled' }
    default:
      return { dot: '#94a3b8', label: 'Unknown status' }
  }
}

export interface EmailProvidersSectionProps {
  theme: 'default' | 'dark' | 'professional' | 'standard' | 'pro'
  // Shared email account state from sidepanel
  emailAccounts: EmailAccount[]
  isLoadingEmailAccounts: boolean
  selectedEmailAccountId: string | null
  onConnectEmail: () => void
  onDisconnectEmail: (id: string) => void
  onSelectEmailAccount: (id: string) => void
  /** Opens IMAP/SMTP credential update (e.g. reconnect wizard) — shown when `auth_error` on IMAP rows. */
  onUpdateImapCredentials?: (accountId: string) => void
  /** Pause/resume background mail sync (non-destructive; credentials stay saved). */
  onSetProcessingPaused?: (accountId: string, paused: boolean) => void | Promise<void>
}

export const EmailProvidersSection: React.FC<EmailProvidersSectionProps> = ({
  theme,
  emailAccounts,
  isLoadingEmailAccounts,
  selectedEmailAccountId,
  onConnectEmail,
  onDisconnectEmail,
  onSelectEmailAccount,
  onUpdateImapCredentials,
  onSetProcessingPaused,
}) => {
  const defaultEmailAccountRowId = pickDefaultEmailAccountRowId(emailAccounts)
  const isLightTheme = theme === 'professional' || theme === 'standard'
  const textColor = isLightTheme ? '#0f172a' : 'white'
  const mutedColor = isLightTheme ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isLightTheme ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  
  // =========================================================================
  // Render - Mirrors BEAP Messages Connect Email section exactly
  // =========================================================================
  
  return (
    <div style={{ 
      padding: '16px 18px', 
      borderBottom: `1px solid ${borderColor}`,
        background: isLightTheme ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.1)'
    }}>
      {/* Header with Connect Email button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>🔗</span>
          <span style={{ fontSize: '13px', fontWeight: '600', color: textColor }}>Connected Email Accounts</span>
        </div>
        <button
          type="button"
          onClick={() => {
            console.log('[EmailProvidersSection] Connect Email button clicked')
            onConnectEmail()
          }}
          style={{
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            border: 'none',
            color: 'white',
            borderRadius: '6px',
            padding: '6px 12px',
            fontSize: '11px',
            fontWeight: '600',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px'
          }}
        >
          <span>+</span> Connect Email
        </button>
      </div>
      
      {/* Loading State */}
      {isLoadingEmailAccounts ? (
        <div style={{ padding: '12px', textAlign: 'center', opacity: 0.6, fontSize: '12px' }}>
          Loading accounts...
        </div>
      ) : emailAccounts.length === 0 ? (
        /* Empty State */
        <div style={{ 
          padding: '20px', 
          background: isLightTheme ? 'white' : 'rgba(255,255,255,0.05)',
          borderRadius: '8px',
          border: isLightTheme ? '1px dashed rgba(15,23,42,0.2)' : '1px dashed rgba(255,255,255,0.2)',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>📧</div>
          <div style={{ fontSize: '13px', color: mutedColor, marginBottom: '4px' }}>No email accounts connected</div>
          <div style={{ fontSize: '11px', color: isLightTheme ? '#94a3b8' : 'rgba(255,255,255,0.5)' }}>
            Connect your email account to use WRGuard email features
          </div>
        </div>
      ) : (
        /* Account List */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {emailAccounts.map((account) => {
            const badge = accountConnectionBadge(account)
            return (
            <div
              key={account.id}
              style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 12px',
                  background: isLightTheme ? 'white' : 'rgba(255,255,255,0.08)',
                  borderRadius: '8px',
                  border:
                    account.status === 'active'
                      ? isLightTheme
                        ? '1px solid rgba(34,197,94,0.3)'
                        : '1px solid rgba(34,197,94,0.4)'
                      : account.status === 'error'
                        ? isLightTheme
                          ? '1px solid rgba(234,179,8,0.45)'
                          : '1px solid rgba(234,179,8,0.5)'
                        : account.status === 'auth_error'
                          ? isLightTheme
                            ? '1px solid rgba(220,38,38,0.55)'
                            : '1px solid rgba(248,113,113,0.6)'
                          : isLightTheme
                            ? '1px solid rgba(239,68,68,0.3)'
                            : '1px solid rgba(239,68,68,0.4)',
                  ...(account.processingPaused
                    ? {
                        boxShadow: isLightTheme
                          ? 'inset 3px 0 0 rgba(217,119,6,0.85)'
                          : 'inset 3px 0 0 rgba(251,191,36,0.75)',
                      }
                    : {}),
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>
                    {account.provider === 'gmail'
                      ? '📧'
                      : account.provider === 'microsoft365'
                        ? '📨'
                        : account.provider === 'zoho'
                          ? '📬'
                          : '✉️'}
                  </span>
                  <div>
                    <div
                      style={{
                        fontSize: '13px',
                        fontWeight: '500',
                        color: textColor,
                        display: 'flex',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span>{account.email || account.displayName}</span>
                      <span style={{ color: mutedColor, fontWeight: 400 }}>·</span>
                      <span style={{ color: mutedColor, fontWeight: 500 }}>{providerDisplayLabel(account.provider)}</span>
                      <span style={{ color: mutedColor, fontWeight: 400 }}>·</span>
                      <RemoteSyncBadge provider={account.provider} />
                      {account.processingPaused ? (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: isLightTheme ? '#b45309' : '#fcd34d',
                            letterSpacing: 0.2,
                          }}
                          title="Mail sync is paused. Your sign-in is still saved."
                        >
                          ⏸ Paused
                        </span>
                      ) : null}
                    </div>
                    <div
                      style={{
                        fontSize: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        marginTop: '2px',
                      }}
                    >
                      <span
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          background: badge.dot,
                        }}
                      />
                      <span style={{ color: mutedColor }}>{badge.label}</span>
                    </div>
                    {account.processingPaused ? (
                      <div style={pausedRowNoteStyle(isLightTheme)}>
                        Syncing is off — this account stays connected. Your password and settings are unchanged.
                      </div>
                    ) : null}
                    <div
                      style={{
                        fontSize: '9px',
                        color: isLightTheme ? '#94a3b8' : 'rgba(255,255,255,0.45)',
                        marginTop: '4px',
                        fontFamily: 'ui-monospace, monospace',
                        wordBreak: 'break-all',
                      }}
                      title="Account id (debug / inbox DB account_id must match after reconnect)"
                    >
                      id {account.id} · {account.provider}
                    </div>
                    {account.status === 'auth_error' && account.provider === 'imap' && onUpdateImapCredentials ? (
                      <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: '#b91c1c',
                            textTransform: 'uppercase',
                            letterSpacing: 0.4,
                          }}
                        >
                          Credentials required
                        </span>
                        <button
                          type="button"
                          onClick={() => onUpdateImapCredentials(account.id)}
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: '6px 12px',
                            borderRadius: 6,
                            border: 'none',
                            cursor: 'pointer',
                            background: 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)',
                            color: 'white',
                          }}
                        >
                          Update credentials
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {typeof onSetProcessingPaused === 'function' ? (
                    <button
                      type="button"
                      onClick={() => void onSetProcessingPaused(account.id, !account.processingPaused)}
                      title={
                        account.processingPaused
                          ? 'Resume — turn mail sync back on (sign-in stays saved)'
                          : 'Pause — stop syncing mail; keeps account and credentials'
                      }
                      style={{
                        background: isLightTheme ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.08)',
                        border: isLightTheme ? '1px solid rgba(15,23,42,0.12)' : '1px solid rgba(255,255,255,0.15)',
                        color: textColor,
                        cursor: 'pointer',
                        padding: '6px 10px',
                        fontSize: 11,
                        fontWeight: 600,
                        borderRadius: 6,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {account.processingPaused ? 'Resume' : 'Pause'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onDisconnectEmail(account.id)}
                    title="Disconnect — remove this account from the app"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: isLightTheme ? '#94a3b8' : 'rgba(255,255,255,0.5)',
                      cursor: 'pointer',
                      padding: '4px',
                      fontSize: '14px',
                    }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      
      {/* Select account for sending */}
      {emailAccounts.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          <label style={{ 
            fontSize: '11px', 
            fontWeight: 600, 
            marginBottom: '6px', 
            display: 'block', 
            color: mutedColor, 
            textTransform: 'uppercase', 
            letterSpacing: '0.5px' 
          }}>
            Default Account:
          </label>
          <select 
            value={selectedEmailAccountId || defaultEmailAccountRowId || ''} 
            onChange={(e) => onSelectEmailAccount(e.target.value)} 
            style={{ 
              width: '100%', 
              background: isLightTheme ? 'white' : 'rgba(255,255,255,0.1)', 
              border: isLightTheme ? '1px solid rgba(15,23,42,0.2)' : '1px solid rgba(255,255,255,0.2)', 
              color: textColor, 
              borderRadius: '6px', 
              padding: '8px 12px', 
              fontSize: '13px', 
              cursor: 'pointer', 
              outline: 'none' 
            }}
          >
            {emailAccounts.map(account => (
              <option key={account.id} value={account.id}>
                {account.email || account.displayName} ({account.provider})
                {account.processingPaused ? ' — Paused' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

export default EmailProvidersSection
