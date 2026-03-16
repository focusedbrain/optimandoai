/**
 * EmailConnectModal — Provider selection for connecting email in Electron dashboard.
 * Gmail and Outlook use window.emailAccounts (preload IPC). IMAP shows a notice.
 */

import { useState } from 'react'

interface EmailConnectModalProps {
  onClose: () => void
  onConnected: () => void
  onNotify: (msg: string, type: 'success' | 'error' | 'info') => void
}

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

  const borderColor = 'rgba(15,23,42,0.12)'
  const mutedColor = '#64748b'
  const textColor = '#0f172a'

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        style={{
          background: 'white',
          borderRadius: '12px',
          padding: '24px',
          maxWidth: '360px',
          width: '90%',
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          border: `1px solid ${borderColor}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <span style={{ fontSize: '16px', fontWeight: 700, color: textColor }}>Connect Email Account</span>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              fontSize: '18px',
              cursor: 'pointer',
              color: mutedColor,
              padding: '0 4px',
            }}
          >
            ×
          </button>
        </div>

        {(!hasConnectGmail && !hasConnectOutlook) && (
          <div style={{ padding: '12px', background: '#fef3c7', borderRadius: '8px', marginBottom: '16px', fontSize: '12px', color: '#92400e' }}>
            Email connection requires the desktop app. Ensure WR Desk™ is running.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <button
            onClick={handleConnectGmail}
            disabled={!hasConnectGmail || connecting !== null}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px 16px',
              background: hasConnectGmail && !connecting ? 'white' : '#f8fafc',
              border: `1px solid ${borderColor}`,
              borderRadius: '8px',
              cursor: hasConnectGmail && !connecting ? 'pointer' : 'not-allowed',
              fontSize: '14px',
              fontWeight: 600,
              color: textColor,
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: '20px' }}>📧</span>
            <span>Gmail</span>
            {connecting === 'gmail' && <span style={{ marginLeft: 'auto', fontSize: '12px', color: mutedColor }}>Connecting…</span>}
          </button>

          <button
            onClick={handleConnectOutlook}
            disabled={!hasConnectOutlook || connecting !== null}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px 16px',
              background: hasConnectOutlook && !connecting ? 'white' : '#f8fafc',
              border: `1px solid ${borderColor}`,
              borderRadius: '8px',
              cursor: hasConnectOutlook && !connecting ? 'pointer' : 'not-allowed',
              fontSize: '14px',
              fontWeight: 600,
              color: textColor,
              textAlign: 'left',
            }}
          >
            <span style={{ fontSize: '20px' }}>📨</span>
            <span>Outlook</span>
            {connecting === 'outlook' && <span style={{ marginLeft: 'auto', fontSize: '12px', color: mutedColor }}>Connecting…</span>}
          </button>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px 16px',
              background: '#f8fafc',
              border: `1px solid ${borderColor}`,
              borderRadius: '8px',
              fontSize: '13px',
              color: mutedColor,
            }}
          >
            <span style={{ fontSize: '20px' }}>✉️</span>
            <div>
              <div style={{ fontWeight: 600, color: textColor }}>IMAP (manual)</div>
              <div style={{ fontSize: '11px', marginTop: 2 }}>Configure IMAP accounts via the WR Chat extension.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
