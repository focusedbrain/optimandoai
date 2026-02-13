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

// Email account type matching sidepanel state
export interface EmailAccount {
  id: string
  displayName: string
  email: string
  provider: 'gmail' | 'microsoft365' | 'imap'
  status: 'active' | 'error' | 'disabled'
  lastError?: string
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
}

export const EmailProvidersSection: React.FC<EmailProvidersSectionProps> = ({
  theme,
  emailAccounts,
  isLoadingEmailAccounts,
  selectedEmailAccountId,
  onConnectEmail,
  onDisconnectEmail,
  onSelectEmailAccount
}) => {
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
          {emailAccounts.map(account => (
            <div 
              key={account.id} 
              style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'space-between',
                padding: '10px 12px',
                background: isLightTheme ? 'white' : 'rgba(255,255,255,0.08)',
                borderRadius: '8px',
                border: account.status === 'active' 
                  ? (isLightTheme ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(34,197,94,0.4)')
                  : (isLightTheme ? '1px solid rgba(239,68,68,0.3)' : '1px solid rgba(239,68,68,0.4)')
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>
                  {account.provider === 'gmail' ? '📧' : account.provider === 'microsoft365' ? '📨' : '✉️'}
                </span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '500', color: textColor }}>
                    {account.email || account.displayName}
                  </div>
                  <div style={{ 
                    fontSize: '10px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '6px',
                    marginTop: '2px'
                  }}>
                    <span style={{ 
                      width: '6px', 
                      height: '6px', 
                      borderRadius: '50%', 
                      background: account.status === 'active' ? '#22c55e' : '#ef4444' 
                    }} />
                    <span style={{ color: mutedColor }}>
                      {account.status === 'active' ? 'Connected' : account.lastError || 'Error'}
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => onDisconnectEmail(account.id)}
                title="Disconnect account"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: isLightTheme ? '#94a3b8' : 'rgba(255,255,255,0.5)',
                  cursor: 'pointer',
                  padding: '4px',
                  fontSize: '14px'
                }}
              >
                ✕
              </button>
            </div>
          ))}
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
            value={selectedEmailAccountId || emailAccounts[0]?.id || ''} 
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
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}

export default EmailProvidersSection
