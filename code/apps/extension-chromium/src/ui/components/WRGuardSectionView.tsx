/**
 * WRGuard Section View Component
 * 
 * Renders the appropriate UI for each WRGuard entry point.
 * This component is reused across all view modes (docked, app, admin).
 * 
 * @version 1.0.0
 */

import React, { useState } from 'react'
import { ProtectedSitesList, RuntimeConfigLightbox, FullAutoStatusBanner } from '../../wrguard'
import { useFullAutoStatus } from '../../handshake'

export type WRGuardEntry = 'provider-setup' | 'protected-sites' | 'runtime-config'

interface WRGuardSectionViewProps {
  entry: WRGuardEntry
  theme: 'default' | 'dark' | 'professional'
  emailAccounts: { id?: string; email: string; provider?: string; status?: string; displayName?: string; lastError?: string }[]
  isLoadingEmailAccounts: boolean
  onConnectEmail: () => void
  onDisconnectEmail: (accountId: string) => void
  onNotification: (message: string, type: 'success' | 'error' | 'info') => void
}

export function WRGuardSectionView({ 
  entry, 
  theme, 
  emailAccounts,
  isLoadingEmailAccounts,
  onConnectEmail,
  onDisconnectEmail,
  onNotification 
}: WRGuardSectionViewProps) {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const bgColor = isProfessional ? '#f8fafc' : 'rgba(255,255,255,0.04)'
  
  const [showRuntimeConfig, setShowRuntimeConfig] = useState(false)
  const fullAutoStatus = useFullAutoStatus()
  
  // PROVIDER SETUP VIEW - Email Accounts Connection
  if (entry === 'provider-setup') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: bgColor, overflowY: 'auto' }}>
        <div style={{ 
          padding: '16px 18px', 
          borderBottom: `1px solid ${borderColor}`,
          background: isProfessional ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.1)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '16px' }}>🔗</span>
              <span style={{ fontSize: '13px', fontWeight: '600', color: textColor }}>Connected Email Accounts</span>
            </div>
            <button
              onClick={onConnectEmail}
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
          
          {isLoadingEmailAccounts ? (
            <div style={{ padding: '12px', textAlign: 'center', opacity: 0.6, fontSize: '12px' }}>
              Loading accounts...
            </div>
          ) : emailAccounts.length === 0 ? (
            <div style={{ 
              padding: '20px', 
              background: isProfessional ? 'white' : 'rgba(255,255,255,0.05)',
              borderRadius: '8px',
              border: `1px dashed ${isProfessional ? 'rgba(15,23,42,0.2)' : 'rgba(255,255,255,0.2)'}`,
              textAlign: 'center'
            }}>
              <div style={{ fontSize: '24px', marginBottom: '8px' }}>📧</div>
              <div style={{ fontSize: '13px', color: mutedColor, marginBottom: '4px' }}>No email accounts connected</div>
              <div style={{ fontSize: '11px', color: isProfessional ? '#94a3b8' : 'rgba(255,255,255,0.5)' }}>
                Connect your email account to enable BEAP™ package delivery
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {emailAccounts.map(account => (
                <div 
                  key={account.id || account.email} 
                  style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    background: isProfessional ? 'white' : 'rgba(255,255,255,0.08)',
                    borderRadius: '8px',
                    border: account.status === 'active' 
                      ? `1px solid ${isProfessional ? 'rgba(34,197,94,0.3)' : 'rgba(34,197,94,0.4)'}`
                      : `1px solid ${isProfessional ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.4)'}`
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
                    onClick={() => onDisconnectEmail(account.id || account.email)}
                    title="Disconnect account"
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: mutedColor,
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
          
          {/* Info about WRGuard protection */}
          {emailAccounts.length > 0 && (
            <div style={{ 
              marginTop: '12px', 
              padding: '10px 12px', 
              background: isProfessional ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.15)',
              borderRadius: '6px',
              border: '1px solid rgba(34,197,94,0.2)',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px'
            }}>
              <span style={{ fontSize: '14px' }}>🛡️</span>
              <div style={{ fontSize: '11px', color: isProfessional ? '#166534' : 'rgba(255,255,255,0.8)', lineHeight: '1.5' }}>
                <strong>WRGuard Active:</strong> All BEAP™ packages are verified before display. No tracking pixels or scripts will execute.
              </div>
            </div>
          )}
        </div>
        
        {/* Additional Provider Info */}
        <div style={{ padding: '16px 18px', flex: 1 }}>
          <div style={{ 
            padding: '20px', 
            background: isProfessional ? 'white' : 'rgba(255,255,255,0.05)',
            borderRadius: '10px',
            border: `1px solid ${borderColor}`
          }}>
            <div style={{ fontSize: '14px', fontWeight: 600, color: textColor, marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>⚙️</span> Provider Configuration
            </div>
            <div style={{ fontSize: '12px', color: mutedColor, lineHeight: '1.6' }}>
              <p style={{ margin: '0 0 8px 0' }}>
                Connected email accounts are used for sending BEAP™ packages from the Drafts section.
              </p>
              <p style={{ margin: '0' }}>
                Supported providers: Gmail, Microsoft 365, and IMAP-compatible email servers.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }
  
  // PROTECTED SITES VIEW
  if (entry === 'protected-sites') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: bgColor, overflowY: 'auto' }}>
        {/* Full-Auto Status Banner - Handshake-scoped only */}
        <div style={{ padding: '16px 16px 0 16px' }}>
          <FullAutoStatusBanner status={fullAutoStatus} theme={theme} />
        </div>
        <ProtectedSitesList theme={theme} />
      </div>
    )
  }
  
  // RUNTIME CONFIG VIEW
  if (entry === 'runtime-config') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: bgColor }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 20px' }}>
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontSize: '48px', display: 'block', marginBottom: '16px' }}>🎛️</span>
            <div style={{ fontSize: '16px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>
              Runtime Configuration
            </div>
            <div style={{ fontSize: '13px', color: mutedColor, maxWidth: '280px', marginBottom: '20px' }}>
              Adjust WRGuard protection settings and overlay behavior in real-time.
            </div>
            <button
              onClick={() => setShowRuntimeConfig(true)}
              style={{
                background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                border: 'none',
                color: 'white',
                borderRadius: '8px',
                padding: '12px 24px',
                fontSize: '14px',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              🎛️ Open Configuration
            </button>
          </div>
        </div>
        
        {/* Runtime Config Lightbox */}
        {showRuntimeConfig && (
          <RuntimeConfigLightbox
            theme={theme}
            onClose={() => setShowRuntimeConfig(false)}
          />
        )}
      </div>
    )
  }
  
  // Fallback
  return null
}



