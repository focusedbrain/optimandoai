/**
 * Popup Chat Entry Point
 * 
 * React entry for the Command Chat popup window.
 * Uses shared components from the UI library.
 */

import React, { useState, useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { useUIStore } from './stores/useUIStore'
import { 
  ModeSelect, 
  ModeHeaderBadge,
  CommandChatView,
  P2PChatPlaceholder,
  P2PStreamPlaceholder,
  GroupChatPlaceholder,
  AdminPoliciesPlaceholder
} from './ui/components'
import { WORKSPACE_INFO } from './shared/ui/uiState'
import { generateMockFingerprint, formatFingerprintShort, formatFingerprintGrouped } from './handshake/fingerprint'
import { HANDSHAKE_REQUEST_TEMPLATE, POLICY_NOTES } from './handshake/microcopy'

// =============================================================================
// Theme Type
// =============================================================================

type Theme = 'default' | 'dark' | 'professional'
type Submode = 'command' | 'p2p-chat' | 'p2p-stream' | 'group-stream' | 'handshake'

// Get initial theme from window (set by inline script in HTML)
const getInitialTheme = (): Theme => {
  const t = (window as any).__INITIAL_THEME__
  if (t === 'professional' || t === 'dark') return t
  return 'default'
}

// =============================================================================
// Main App Component
// =============================================================================

function PopupChatApp() {
  const [theme] = useState<Theme>(getInitialTheme)
  const { workspace, mode, role, setRole } = useUIStore()
  
  // Submode state for WR Chat
  const [submode, setSubmode] = useState<Submode>('command')
  
  // Generate a stable fingerprint for this session's handshake requests
  const ourFingerprint = useMemo(() => generateMockFingerprint(), [])
  const ourFingerprintShort = formatFingerprintShort(ourFingerprint)
  
  // Initialize handshake message with fingerprint directly
  const initialHandshakeMessage = useMemo(() => 
    HANDSHAKE_REQUEST_TEMPLATE.replace('[FINGERPRINT]', ourFingerprint), 
    [ourFingerprint]
  )
  
  // BEAP Handshake Request state
  const [handshakeDelivery, setHandshakeDelivery] = useState<'email' | 'messenger' | 'download'>('email')
  const [handshakeTo, setHandshakeTo] = useState('')
  const [handshakeSubject, setHandshakeSubject] = useState('Request to Establish BEAP™ Secure Communication Handshake')
  const [handshakeMessage, setHandshakeMessage] = useState(() => 
    HANDSHAKE_REQUEST_TEMPLATE.replace('[FINGERPRINT]', generateMockFingerprint())
  )
  const [fingerprintCopied, setFingerprintCopied] = useState(false)
  
  // Sync message with fingerprint if it changes (backup)
  useEffect(() => {
    if (!handshakeMessage || handshakeMessage.trim() === '') {
      setHandshakeMessage(initialHandshakeMessage)
    }
  }, [initialHandshakeMessage, handshakeMessage])
  
  // For debugging: toggle admin role with keyboard shortcut
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+A to toggle admin
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        setRole(role === 'admin' ? 'user' : 'admin')
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [role, setRole])

  // Render the appropriate view based on workspace and mode
  const renderContent = () => {
    // Non-chat workspaces
    if (workspace === 'mailguard') {
      return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.6 }}>
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontSize: '40px' }}>{WORKSPACE_INFO.mailguard.icon}</span>
            <div style={{ marginTop: '12px', fontSize: '14px', fontWeight: 600 }}>
              {WORKSPACE_INFO.mailguard.label}
            </div>
            <div style={{ marginTop: '4px', fontSize: '12px', opacity: 0.7 }}>
              Switch to Docked Panel for MailGuard
            </div>
          </div>
        </div>
      )
    }
    
    if (workspace === 'overlay') {
      return (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.6 }}>
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontSize: '40px' }}>{WORKSPACE_INFO.overlay.icon}</span>
            <div style={{ marginTop: '12px', fontSize: '14px', fontWeight: 600 }}>
              {WORKSPACE_INFO.overlay.label}
            </div>
            <div style={{ marginTop: '4px', fontSize: '12px', opacity: 0.7 }}>
              Switch to Docked Panel for Overlay
            </div>
          </div>
        </div>
      )
    }

    // WR Chat modes - respect submode for commands mode
    if (mode === 'commands') {
      switch (submode) {
        case 'command':
          return <CommandChatView theme={theme} />
        case 'p2p-chat':
          return <P2PChatPlaceholder theme={theme} />
        case 'p2p-stream':
          return <P2PStreamPlaceholder theme={theme} />
        case 'group-stream':
          return <GroupChatPlaceholder theme={theme} />
        case 'handshake':
          return renderHandshakeRequest()
        default:
          return <CommandChatView theme={theme} />
      }
    }
    
    // Other modes
    switch (mode) {
      case 'p2p':
        return <P2PChatPlaceholder theme={theme} />
      case 'p2p_stream':
        return <P2PStreamPlaceholder theme={theme} />
      case 'group':
        return <GroupChatPlaceholder theme={theme} />
      case 'admin_policies':
        return <AdminPoliciesPlaceholder theme={theme} />
      default:
        return <CommandChatView theme={theme} />
    }
  }
  
  // Render BEAP Handshake Request Interface
  const renderHandshakeRequest = () => {
    const isProfessional = theme === 'professional'
    
    return (
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        flexDirection: 'column', 
        background: theme === 'default' ? 'rgba(118,75,162,0.25)' : (isProfessional ? '#f8fafc' : 'rgba(255,255,255,0.06)'), 
        overflow: 'hidden' 
      }}>
        {/* Header */}
        <div style={{ 
          padding: '12px 14px', 
          borderBottom: `1px solid ${isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`, 
          display: 'flex', 
          alignItems: 'center', 
          gap: '10px' 
        }}>
          <span style={{ fontSize: '18px' }}>🤝</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: isProfessional ? '#1f2937' : 'white' }}>BEAP™ Handshake Request</span>
        </div>
        
        <div style={{ flex: 1, padding: '14px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Your Fingerprint - PROMINENT */}
          <div style={{
            padding: '12px 14px',
            background: isProfessional ? 'rgba(139, 92, 246, 0.08)' : 'rgba(139, 92, 246, 0.15)',
            border: `2px solid ${isProfessional ? 'rgba(139, 92, 246, 0.2)' : 'rgba(139, 92, 246, 0.3)'}`,
            borderRadius: '10px',
          }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              marginBottom: '8px',
            }}>
              <div style={{ 
                fontSize: '11px', 
                fontWeight: 600, 
                color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.7)', 
                textTransform: 'uppercase', 
                letterSpacing: '0.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
              }}>
                🔐 Your Fingerprint
                <span 
                  style={{ cursor: 'help', fontSize: '11px', fontWeight: 400 }}
                  title="A fingerprint is a short identifier derived from the handshake identity. It helps prevent mix-ups and look-alike contacts. It is not a secret key."
                >
                  ⓘ
                </span>
              </div>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(ourFingerprint)
                    setFingerprintCopied(true)
                    setTimeout(() => setFingerprintCopied(false), 2000)
                  } catch (err) {
                    console.error('Failed to copy:', err)
                  }
                }}
                style={{
                  padding: '4px 10px',
                  fontSize: '10px',
                  background: isProfessional ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)',
                  border: 'none',
                  borderRadius: '4px',
                  color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.7)',
                  cursor: 'pointer',
                }}
              >
                {fingerprintCopied ? '✓ Copied' : '📋 Copy'}
              </button>
            </div>
            <div style={{
              fontFamily: 'monospace',
              fontSize: '11px',
              color: isProfessional ? '#1f2937' : 'white',
              wordBreak: 'break-all',
              lineHeight: 1.5,
            }}>
              {formatFingerprintGrouped(ourFingerprint)}
            </div>
            <div style={{
              marginTop: '8px',
              fontSize: '10px',
              color: isProfessional ? '#9ca3af' : 'rgba(255,255,255,0.5)',
            }}>
              Short: <span style={{ fontFamily: 'monospace' }}>{ourFingerprintShort}</span>
            </div>
          </div>
          
          {/* Delivery Method */}
          <div>
            <label style={{ 
              fontSize: '11px', 
              fontWeight: 600, 
              marginBottom: '6px', 
              display: 'block', 
              color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.7)', 
              textTransform: 'uppercase', 
              letterSpacing: '0.5px' 
            }}>
              Delivery Method
            </label>
            <select
              value={handshakeDelivery}
              onChange={(e) => setHandshakeDelivery(e.target.value as 'email' | 'messenger' | 'download')}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: isProfessional ? 'white' : '#1f2937',
                border: `1px solid ${isProfessional ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: '8px',
                color: isProfessional ? '#1f2937' : 'white',
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              <option value="email" style={{ background: isProfessional ? 'white' : '#1f2937', color: isProfessional ? '#1f2937' : 'white' }}>📧 Email</option>
              <option value="messenger" style={{ background: isProfessional ? 'white' : '#1f2937', color: isProfessional ? '#1f2937' : 'white' }}>💬 Messenger (Web)</option>
              <option value="download" style={{ background: isProfessional ? 'white' : '#1f2937', color: isProfessional ? '#1f2937' : 'white' }}>💾 Download (USB/Wallet)</option>
            </select>
          </div>
          
          {/* To & Subject Fields - Only for Email */}
          {handshakeDelivery === 'email' && (
            <>
              <div>
                <label style={{ 
                  fontSize: '11px', 
                  fontWeight: 600, 
                  marginBottom: '6px', 
                  display: 'block', 
                  color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.7)', 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.5px' 
                }}>
                  To:
                </label>
                <input
                  type="email"
                  value={handshakeTo}
                  onChange={(e) => setHandshakeTo(e.target.value)}
                  placeholder="recipient@example.com"
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: isProfessional ? 'white' : 'rgba(255,255,255,0.08)',
                    border: `1px solid ${isProfessional ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
                    borderRadius: '8px',
                    color: isProfessional ? '#1f2937' : 'white',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div>
                <label style={{ 
                  fontSize: '11px', 
                  fontWeight: 600, 
                  marginBottom: '6px', 
                  display: 'block', 
                  color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.7)', 
                  textTransform: 'uppercase', 
                  letterSpacing: '0.5px' 
                }}>
                  Subject:
                </label>
                <input
                  type="text"
                  value={handshakeSubject}
                  onChange={(e) => setHandshakeSubject(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: isProfessional ? 'white' : 'rgba(255,255,255,0.08)',
                    border: `1px solid ${isProfessional ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
                    borderRadius: '8px',
                    color: isProfessional ? '#1f2937' : 'white',
                    fontSize: '13px',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </>
          )}
          
          {/* Message */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <label style={{ 
              fontSize: '11px', 
              fontWeight: 600, 
              marginBottom: '6px', 
              display: 'block', 
              color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.7)', 
              textTransform: 'uppercase', 
              letterSpacing: '0.5px' 
            }}>
              Message
            </label>
            <textarea
              value={handshakeMessage}
              onChange={(e) => setHandshakeMessage(e.target.value)}
              style={{
                flex: 1,
                minHeight: '180px',
                padding: '10px 12px',
                background: isProfessional ? 'white' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${isProfessional ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
                borderRadius: '8px',
                color: isProfessional ? '#1f2937' : 'white',
                fontSize: '13px',
                lineHeight: '1.5',
                resize: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>
          
          {/* Info */}
          <div style={{
            padding: '10px 12px',
            background: isProfessional ? 'rgba(139, 92, 246, 0.08)' : 'rgba(139, 92, 246, 0.15)',
            borderRadius: '8px',
            fontSize: '11px',
            color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.8)',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}>
            <div>💡 This creates a secure BEAP™ package. Recipient will appear in your Handshakes once accepted.</div>
            <div style={{ opacity: 0.8, fontSize: '10px' }}>ℹ️ {POLICY_NOTES.LOCAL_OVERRIDE}</div>
          </div>
        </div>
        
        {/* Footer */}
        <div style={{ 
          padding: '12px 14px', 
          borderTop: `1px solid ${isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`, 
          display: 'flex', 
          gap: '10px', 
          justifyContent: 'flex-end' 
        }}>
          <button 
            onClick={() => setSubmode('command')}
            style={{ 
              padding: '8px 16px', 
              background: 'transparent', 
              border: `1px solid ${isProfessional ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)'}`, 
              borderRadius: '8px', 
              color: isProfessional ? '#6b7280' : 'white', 
              fontSize: '12px', 
              cursor: 'pointer' 
            }}
          >
            Cancel
          </button>
          <button 
            onClick={() => {
              if (handshakeDelivery === 'email' && !handshakeTo) {
                alert('Please enter a recipient email address')
                return
              }
              // TODO: Implement actual send/download logic
              alert(`Handshake request ${handshakeDelivery === 'download' ? 'downloaded' : 'sent'} successfully!`)
              setSubmode('command')
            }}
            style={{ 
              padding: '8px 20px', 
              background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)', 
              border: 'none', 
              borderRadius: '8px', 
              color: 'white', 
              fontSize: '12px', 
              fontWeight: 600, 
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {handshakeDelivery === 'email' ? '📧 Send' : handshakeDelivery === 'messenger' ? '💬 Insert' : '💾 Download'}
          </button>
        </div>
      </div>
    )
  }

  // Theme-based container styles
  const containerStyles: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflow: 'hidden'
  }

  const headerStyles: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    gap: '10px',
    borderBottom: theme === 'professional' 
      ? '1px solid #e2e8f0'
      : '1px solid rgba(255,255,255,0.15)',
    background: theme === 'professional'
      ? 'rgba(248,250,252,0.95)'
      : 'rgba(0,0,0,0.15)'
  }

  // Selectbox styles for visibility
  const selectboxStyle = theme === 'professional' 
    ? { background: 'rgba(15,23,42,0.08)', color: '#1f2937', arrowColor: '%231f2937' }
    : { background: 'rgba(255,255,255,0.15)', color: 'white', arrowColor: '%23ffffff' }

  return (
    <div style={containerStyles}>
      {/* Header with Mode Select and Submode */}
      <header style={headerStyles}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <ModeSelect theme={theme} compact />
          {/* Submode Selector - Only for WR Chat in commands mode */}
          {/* Submode selector - always show when in commands mode */}
          {mode === 'commands' && (
            <select
              value={submode}
              onChange={(e) => setSubmode(e.target.value as Submode)}
              style={{
                fontSize: '11px',
                fontWeight: 500,
                height: '26px',
                minWidth: '95px',
                background: selectboxStyle.background,
                border: 'none',
                color: selectboxStyle.color,
                borderRadius: '13px',
                padding: '0 16px 0 8px',
                cursor: 'pointer',
                outline: 'none',
                appearance: 'none',
                WebkitAppearance: 'none',
                textOverflow: 'ellipsis',
                overflow: 'hidden',
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6' viewBox='0 0 12 12'%3E%3Cpath fill='${selectboxStyle.arrowColor}' d='M3 4.5L6 7.5L9 4.5'/%3E%3C/svg%3E")`,
                backgroundRepeat: 'no-repeat',
                backgroundPosition: 'right 6px center'
              }}
            >
              <option value="command" style={{ background: theme === 'professional' ? 'white' : '#1f2937', color: theme === 'professional' ? '#1f2937' : 'white' }}>cmd</option>
              <option value="p2p-chat" style={{ background: theme === 'professional' ? 'white' : '#1f2937', color: theme === 'professional' ? '#1f2937' : 'white' }}>Direct Chat</option>
              <option value="p2p-stream" style={{ background: theme === 'professional' ? 'white' : '#1f2937', color: theme === 'professional' ? '#1f2937' : 'white' }}>Live Views</option>
              <option value="group-stream" style={{ background: theme === 'professional' ? 'white' : '#1f2937', color: theme === 'professional' ? '#1f2937' : 'white' }}>Group Sessions</option>
              <option value="handshake" style={{ background: theme === 'professional' ? 'white' : '#1f2937', color: theme === 'professional' ? '#1f2937' : 'white' }}>Handshake Request</option>
            </select>
          )}
        </div>
        <ModeHeaderBadge theme={theme} compact />
      </header>

      {/* Main Content */}
      <main style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {renderContent()}
      </main>

      {/* Footer: Role indicator (debug) */}
      {process.env.NODE_ENV === 'development' && (
        <footer style={{
          padding: '4px 12px',
          fontSize: '10px',
          opacity: 0.5,
          borderTop: '1px solid rgba(255,255,255,0.1)',
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <span>Role: {role}</span>
          <span>Ctrl+Shift+A to toggle admin</span>
        </footer>
      )}
    </div>
  )
}

// =============================================================================
// Mount React App
// =============================================================================

const container = document.getElementById('root')
if (container) {
  const root = createRoot(container)
  root.render(<PopupChatApp />)
}







