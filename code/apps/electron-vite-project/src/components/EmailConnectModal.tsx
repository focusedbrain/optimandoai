/**
 * EmailConnectModal — EXACT same modal as capsule builder (sidepanel/popup-chat).
 * Blue header, explainer, provider list, security notice.
 * Wired to window.emailAccounts (Electron preload IPC) for Gmail/Outlook.
 */

import { useState } from 'react'

interface EmailConnectModalProps {
  onClose: () => void
  onConnected: () => void
  onNotify: (msg: string, type: 'success' | 'error' | 'info') => void
}

const theme = 'standard' as const

export default function EmailConnectModal({
  onClose,
  onConnected,
  onNotify,
}: EmailConnectModalProps) {
  const [connecting, setConnecting] = useState<'gmail' | 'outlook' | null>(null)

  const emailApi = (window as any).emailAccounts
  const hasConnectGmail = typeof emailApi?.connectGmail === 'function'
  const hasConnectOutlook = typeof emailApi?.connectOutlook === 'function'

  const handleConnectGmail = async () => {
    if (!hasConnectGmail) {
      onNotify('Email connection requires the desktop app to be running.', 'error')
      return
    }
    setConnecting('gmail')
    try {
      const res = await emailApi.connectGmail('Gmail Account')
      if (res?.ok) {
        onNotify('✓ Gmail connected', 'success')
        onConnected()
        onClose()
      } else {
        onNotify(`✗ Gmail connection failed: ${res?.error || 'Unknown error'}`, 'error')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed'
      onNotify(`✗ Gmail connection failed: ${msg}`, 'error')
    } finally {
      setConnecting(null)
    }
  }

  const handleConnectOutlook = async () => {
    if (!hasConnectOutlook) {
      onNotify('Email connection requires the desktop app to be running.', 'error')
      return
    }
    setConnecting('outlook')
    try {
      const res = await emailApi.connectOutlook('Outlook Account')
      if (res?.ok) {
        onNotify('✓ Outlook connected', 'success')
        onConnected()
        onClose()
      } else {
        onNotify(`✗ Outlook connection failed: ${res?.error || 'Unknown error'}`, 'error')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed'
      onNotify(`✗ Outlook connection failed: ${msg}`, 'error')
    } finally {
      setConnecting(null)
    }
  }

  const isConnecting = connecting !== null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 2147483651,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        style={{
          width: '380px',
          maxHeight: '85vh',
          background: theme === 'standard' ? '#ffffff' : 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          borderRadius: '16px',
          border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
          boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}
      >
        {/* Header — same as capsule builder */}
        <div
          style={{
            padding: '20px',
            background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
            color: 'white',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '24px' }}>📧</span>
            <div>
              <div style={{ fontSize: '16px', fontWeight: '600' }}>Connect Your Email</div>
              <div style={{ fontSize: '11px', opacity: 0.9 }}>Secure access via official API</div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: 'none',
              color: 'white',
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '16px',
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '20px', overflowY: 'auto', maxHeight: 'calc(85vh - 80px)' }}>
          {isConnecting ? (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: '36px', marginBottom: '16px' }}>⏳</div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  color: theme === 'standard' ? '#0f172a' : 'white',
                  marginBottom: '8px',
                }}
              >
                Connecting...
              </div>
              <div
                style={{
                  fontSize: '12px',
                  color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)',
                }}
              >
                Please complete the OAuth flow in the browser window.
              </div>
            </div>
          ) : (
            <>
          <div
            style={{
              fontSize: '13px',
              color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)',
              marginBottom: '16px',
            }}
          >
            Choose your email provider to connect securely:
          </div>

          {!hasConnectGmail && !hasConnectOutlook && (
            <div
              style={{
                padding: '12px',
                background: theme === 'standard' ? '#fef3c7' : 'rgba(245,158,11,0.2)',
                borderRadius: '8px',
                marginBottom: '16px',
                fontSize: '12px',
                color: theme === 'standard' ? '#92400e' : 'rgba(255,255,255,0.9)',
              }}
            >
              Email connection requires the desktop app. Ensure WR Desk™ is running.
            </div>
          )}

          {/* Gmail Option */}
          <button
            onClick={handleConnectGmail}
            disabled={!hasConnectGmail || isConnecting}
            style={{
              width: '100%',
              padding: '14px 16px',
              background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
              border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
              borderRadius: '10px',
              cursor: hasConnectGmail && !isConnecting ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '10px',
              textAlign: 'left',
              transition: 'all 0.15s',
              opacity: isConnecting ? 0.6 : 1,
            }}
          >
            <span style={{ fontSize: '24px' }}>📧</span>
            <div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: theme === 'standard' ? '#0f172a' : 'white',
                }}
              >
                Gmail
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)',
                }}
              >
                Connect via Google OAuth
              </div>
            </div>
            <span
              style={{
                marginLeft: 'auto',
                fontSize: '14px',
                color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.4)',
              }}
            >
              →
            </span>
          </button>

          {/* Microsoft 365 Option */}
          <button
            onClick={handleConnectOutlook}
            disabled={!hasConnectOutlook || isConnecting}
            style={{
              width: '100%',
              padding: '14px 16px',
              background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
              border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
              borderRadius: '10px',
              cursor: hasConnectOutlook && !isConnecting ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '10px',
              textAlign: 'left',
              transition: 'all 0.15s',
              opacity: isConnecting ? 0.6 : 1,
            }}
          >
            <span style={{ fontSize: '24px' }}>📨</span>
            <div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: theme === 'standard' ? '#0f172a' : 'white',
                }}
              >
                Microsoft 365 / Outlook
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)',
                }}
              >
                Connect via Microsoft OAuth
              </div>
            </div>
            <span
              style={{
                marginLeft: 'auto',
                fontSize: '14px',
                color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.4)',
              }}
            >
              →
            </span>
          </button>

          {/* Other (IMAP) — info only in desktop app */}
          <div
            style={{
              width: '100%',
              padding: '14px 16px',
              background: theme === 'standard' ? '#f8fafc' : 'rgba(255,255,255,0.05)',
              border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '10px',
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: '24px' }}>✉️</span>
            <div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: '600',
                  color: theme === 'standard' ? '#0f172a' : 'white',
                }}
              >
                Other (IMAP)
              </div>
              <div
                style={{
                  fontSize: '11px',
                  color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)',
                }}
              >
                Configure IMAP accounts via the WR Chat extension.
              </div>
            </div>
            <span
              style={{
                marginLeft: 'auto',
                fontSize: '12px',
                color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.4)',
              }}
            >
              →
            </span>
          </div>

          {/* Security note — same as capsule builder */}
          <div
            style={{
              marginTop: '16px',
              padding: '12px',
              background: theme === 'standard' ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.15)',
              borderRadius: '8px',
              border: '1px solid rgba(59,130,246,0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <span style={{ fontSize: '14px' }}>🔒</span>
              <div
                style={{
                  fontSize: '11px',
                  color: theme === 'standard' ? '#1e40af' : 'rgba(255,255,255,0.8)',
                  lineHeight: '1.5',
                }}
              >
                <strong>Security:</strong> Your emails are never rendered with scripts or tracking.
                All content is sanitized locally before display.
              </div>
            </div>
          </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
