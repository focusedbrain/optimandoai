/**
 * EmailConnectModal — EXACT same modal as capsule builder (sidepanel/popup-chat).
 * Blue header, explainer, provider list, security notice.
 * INLINE OAuth credential setup: when credentials not configured, shows Client ID/Secret
 * form in the same modal (no popup).
 */

import { useState } from 'react'

interface EmailConnectModalProps {
  onClose: () => void
  onConnected: () => void
  onNotify: (msg: string, type: 'success' | 'error' | 'info') => void
}

type Step = 'provider' | 'gmail-credentials' | 'outlook-credentials' | 'connecting'

const CREDENTIALS_NEEDED_GMAIL = 'credentials not configured'
const CREDENTIALS_NEEDED_OUTLOOK = 'OAuth client credentials not configured'

const theme = 'standard' as const

export default function EmailConnectModal({
  onClose,
  onConnected,
  onNotify,
}: EmailConnectModalProps) {
  const [step, setStep] = useState<Step>('provider')
  const [connecting, setConnecting] = useState<'gmail' | 'outlook' | null>(null)
  const [gmailCreds, setGmailCreds] = useState({ clientId: '', clientSecret: '' })
  const [outlookCreds, setOutlookCreds] = useState({ clientId: '', clientSecret: '', tenantId: 'organizations' })
  const [credError, setCredError] = useState<string | null>(null)

  const emailApi = (window as any).emailAccounts
  const hasConnectGmail = typeof emailApi?.connectGmail === 'function'
  const hasConnectOutlook = typeof emailApi?.connectOutlook === 'function'
  const hasSetGmail = typeof emailApi?.setGmailCredentials === 'function'
  const hasSetOutlook = typeof emailApi?.setOutlookCredentials === 'function'

  const handleConnectGmail = async () => {
    if (!hasConnectGmail) {
      onNotify('Email connection requires the desktop app to be running.', 'error')
      return
    }
    setConnecting('gmail')
    setCredError(null)
    try {
      const res = await emailApi.connectGmail('Gmail Account')
      if (res?.ok) {
        onNotify('✓ Gmail connected', 'success')
        onConnected()
        onClose()
      } else {
        const err = res?.error || 'Unknown error'
        if (err.toLowerCase().includes(CREDENTIALS_NEEDED_GMAIL)) {
          setStep('gmail-credentials')
        } else {
          onNotify(`✗ Gmail connection failed: ${err}`, 'error')
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed'
      if (msg.toLowerCase().includes(CREDENTIALS_NEEDED_GMAIL)) {
        setStep('gmail-credentials')
      } else {
        onNotify(`✗ Gmail connection failed: ${msg}`, 'error')
      }
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
    setCredError(null)
    try {
      const res = await emailApi.connectOutlook('Outlook Account')
      if (res?.ok) {
        onNotify('✓ Outlook connected', 'success')
        onConnected()
        onClose()
      } else {
        const err = res?.error || 'Unknown error'
        if (err.toLowerCase().includes(CREDENTIALS_NEEDED_OUTLOOK.toLowerCase())) {
          setStep('outlook-credentials')
        } else {
          onNotify(`✗ Outlook connection failed: ${err}`, 'error')
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed'
      if (msg.toLowerCase().includes(CREDENTIALS_NEEDED_OUTLOOK.toLowerCase())) {
        setStep('outlook-credentials')
      } else {
        onNotify(`✗ Outlook connection failed: ${msg}`, 'error')
      }
    } finally {
      setConnecting(null)
    }
  }

  const handleSaveAndConnectGmail = async () => {
    if (!gmailCreds.clientId.trim() || !gmailCreds.clientSecret.trim()) {
      setCredError('Please enter both Client ID and Client Secret')
      return
    }
    if (!hasSetGmail || !hasConnectGmail) {
      onNotify('Email connection requires the desktop app to be running.', 'error')
      return
    }
    setCredError(null)
    setConnecting('gmail')
    try {
      const res = await emailApi.setGmailCredentials(gmailCreds.clientId.trim(), gmailCreds.clientSecret.trim())
      if (!res?.ok) {
        throw new Error(res?.error || 'Failed to save credentials')
      }
      const connectRes = await emailApi.connectGmail('Gmail Account')
      if (connectRes?.ok) {
        onNotify('✓ Gmail connected', 'success')
        onConnected()
        onClose()
      } else {
        setCredError(connectRes?.error || 'Connection failed')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed'
      setCredError(msg)
    } finally {
      setConnecting(null)
    }
  }

  const handleSaveAndConnectOutlook = async () => {
    if (!outlookCreds.clientId.trim()) {
      setCredError('Please enter the Application (Client) ID')
      return
    }
    if (!hasSetOutlook || !hasConnectOutlook) {
      onNotify('Email connection requires the desktop app to be running.', 'error')
      return
    }
    setCredError(null)
    setConnecting('outlook')
    try {
      const res = await emailApi.setOutlookCredentials(
        outlookCreds.clientId.trim(),
        outlookCreds.clientSecret.trim() || undefined,
        outlookCreds.tenantId.trim() || undefined,
      )
      if (!res?.ok) {
        throw new Error(res?.error || 'Failed to save credentials')
      }
      const connectRes = await emailApi.connectOutlook('Outlook Account')
      if (connectRes?.ok) {
        onNotify('✓ Outlook connected', 'success')
        onConnected()
        onClose()
      } else {
        setCredError(connectRes?.error || 'Connection failed')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed'
      setCredError(msg)
    } finally {
      setConnecting(null)
    }
  }

  const isConnecting = connecting !== null

  const renderContent = () => {
    if (step === 'connecting' || isConnecting) {
      return (
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: '36px', marginBottom: '16px' }}>⏳</div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: theme === 'standard' ? '#0f172a' : 'white', marginBottom: '8px' }}>
            Connecting...
          </div>
          <div style={{ fontSize: '12px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)' }}>
            Please complete the OAuth flow in the browser window.
          </div>
        </div>
      )
    }

    if (step === 'gmail-credentials') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button
            onClick={() => { setStep('provider'); setCredError(null); setGmailCreds({ clientId: '', clientSecret: '' }) }}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'none', border: 'none',
              color: theme === 'standard' ? '#3b82f6' : '#60a5fa',
              fontSize: '13px', cursor: 'pointer', padding: '0', marginBottom: '8px',
            }}
          >
            ← Back to providers
          </button>
          <div style={{
            padding: '12px',
            background: theme === 'standard' ? 'rgba(234,179,8,0.1)' : 'rgba(234,179,8,0.15)',
            borderRadius: '8px', border: '1px solid rgba(234,179,8,0.3)', marginBottom: '8px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <span>⚙️</span>
              <div style={{ fontSize: '11px', color: theme === 'standard' ? '#854d0e' : 'rgba(255,255,255,0.9)', lineHeight: '1.5' }}>
                <strong>One-time setup:</strong> You need a Google Cloud OAuth Client ID.{' '}
                <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer"
                   style={{ color: theme === 'standard' ? '#3b82f6' : '#60a5fa', marginLeft: '4px' }}>
                  Get it here →
                </a>
              </div>
            </div>
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: '600', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px', display: 'block' }}>
              Client ID *
            </label>
            <input
              type="text"
              placeholder="xxxxxxxxx.apps.googleusercontent.com"
              value={gmailCreds.clientId}
              onChange={(e) => setGmailCreds((prev) => ({ ...prev, clientId: e.target.value }))}
              style={{
                width: '100%', padding: '10px 12px',
                background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                borderRadius: '8px', fontSize: '13px', color: theme === 'standard' ? '#0f172a' : 'white',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: '600', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px', display: 'block' }}>
              Client Secret *
            </label>
            <input
              type="password"
              placeholder="GOCSPX-xxxxxxxxx"
              value={gmailCreds.clientSecret}
              onChange={(e) => setGmailCreds((prev) => ({ ...prev, clientSecret: e.target.value }))}
              style={{
                width: '100%', padding: '10px 12px',
                background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                borderRadius: '8px', fontSize: '13px', color: theme === 'standard' ? '#0f172a' : 'white',
              }}
            />
          </div>
          {credError && (
            <div style={{ fontSize: '12px', color: '#dc2626' }}>{credError}</div>
          )}
          <button
            onClick={handleSaveAndConnectGmail}
            disabled={isConnecting}
            style={{
              width: '100%', padding: '12px',
              background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
              border: 'none', borderRadius: '8px',
              color: 'white', fontSize: '14px', fontWeight: '600',
              cursor: isConnecting ? 'not-allowed' : 'pointer', marginTop: '8px',
            }}
          >
            Save & Connect Gmail
          </button>
        </div>
      )
    }

    if (step === 'outlook-credentials') {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <button
            onClick={() => { setStep('provider'); setCredError(null); setOutlookCreds({ clientId: '', clientSecret: '', tenantId: 'organizations' }) }}
            style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              background: 'none', border: 'none',
              color: theme === 'standard' ? '#3b82f6' : '#60a5fa',
              fontSize: '13px', cursor: 'pointer', padding: '0', marginBottom: '8px',
            }}
          >
            ← Back to providers
          </button>
          <div style={{
            padding: '12px',
            background: theme === 'standard' ? 'rgba(234,179,8,0.1)' : 'rgba(234,179,8,0.15)',
            borderRadius: '8px', border: '1px solid rgba(234,179,8,0.3)', marginBottom: '8px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
              <span>⚙️</span>
              <div style={{ fontSize: '11px', color: theme === 'standard' ? '#854d0e' : 'rgba(255,255,255,0.9)', lineHeight: '1.5' }}>
                <strong>One-time setup:</strong> You need an Azure AD App Registration.{' '}
                <a href="https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer"
                   style={{ color: theme === 'standard' ? '#3b82f6' : '#60a5fa', marginLeft: '4px' }}>
                  Get it here →
                </a>
              </div>
            </div>
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: '600', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px', display: 'block' }}>
              Application (Client) ID *
            </label>
            <input
              type="text"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={outlookCreds.clientId}
              onChange={(e) => setOutlookCreds((prev) => ({ ...prev, clientId: e.target.value }))}
              style={{
                width: '100%', padding: '10px 12px',
                background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                borderRadius: '8px', fontSize: '13px', color: theme === 'standard' ? '#0f172a' : 'white',
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: '600', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '4px', display: 'block' }}>
              Client Secret (optional for public clients)
            </label>
            <input
              type="password"
              placeholder="Leave empty for public client apps"
              value={outlookCreds.clientSecret}
              onChange={(e) => setOutlookCreds((prev) => ({ ...prev, clientSecret: e.target.value }))}
              style={{
                width: '100%', padding: '10px 12px',
                background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
                border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
                borderRadius: '8px', fontSize: '13px', color: theme === 'standard' ? '#0f172a' : 'white',
              }}
            />
          </div>
          {credError && (
            <div style={{ fontSize: '12px', color: '#dc2626' }}>{credError}</div>
          )}
          <button
            onClick={handleSaveAndConnectOutlook}
            disabled={isConnecting}
            style={{
              width: '100%', padding: '12px',
              background: 'linear-gradient(135deg, #0078d4 0%, #004578 100%)',
              border: 'none', borderRadius: '8px',
              color: 'white', fontSize: '14px', fontWeight: '600',
              cursor: isConnecting ? 'not-allowed' : 'pointer', marginTop: '8px',
            }}
          >
            Save & Connect Outlook
          </button>
        </div>
      )
    }

    // Step: provider
    return (
      <>
        <div style={{ fontSize: '13px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.7)', marginBottom: '16px' }}>
          Choose your email provider to connect securely:
        </div>

        {!hasConnectGmail && !hasConnectOutlook && (
          <div style={{
            padding: '12px',
            background: theme === 'standard' ? '#fef3c7' : 'rgba(245,158,11,0.2)',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '12px',
            color: theme === 'standard' ? '#92400e' : 'rgba(255,255,255,0.9)',
          }}>
            Email connection requires the desktop app. Ensure WR Desk™ is running.
          </div>
        )}

        <button
          onClick={handleConnectGmail}
          disabled={!hasConnectGmail || isConnecting}
          style={{
            width: '100%', padding: '14px 16px',
            background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
            border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
            borderRadius: '10px',
            cursor: hasConnectGmail && !isConnecting ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', gap: '12px',
            marginBottom: '10px', textAlign: 'left',
            transition: 'all 0.15s', opacity: isConnecting ? 0.6 : 1,
          }}
        >
          <span style={{ fontSize: '24px' }}>📧</span>
          <div>
            <div style={{ fontSize: '14px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white' }}>Gmail</div>
            <div style={{ fontSize: '11px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>Connect via Google OAuth</div>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: '14px', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.4)' }}>→</span>
        </button>

        <button
          onClick={handleConnectOutlook}
          disabled={!hasConnectOutlook || isConnecting}
          style={{
            width: '100%', padding: '14px 16px',
            background: theme === 'standard' ? '#fff' : 'rgba(255,255,255,0.08)',
            border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.15)',
            borderRadius: '10px',
            cursor: hasConnectOutlook && !isConnecting ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', gap: '12px',
            marginBottom: '10px', textAlign: 'left',
            transition: 'all 0.15s', opacity: isConnecting ? 0.6 : 1,
          }}
        >
          <span style={{ fontSize: '24px' }}>📨</span>
          <div>
            <div style={{ fontSize: '14px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white' }}>Microsoft 365 / Outlook</div>
            <div style={{ fontSize: '11px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>Connect via Microsoft OAuth</div>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: '14px', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.4)' }}>→</span>
        </button>

        <div style={{
          width: '100%', padding: '14px 16px',
          background: theme === 'standard' ? '#f8fafc' : 'rgba(255,255,255,0.05)',
          border: theme === 'standard' ? '1px solid #e2e8f0' : '1px solid rgba(255,255,255,0.1)',
          borderRadius: '10px',
          display: 'flex', alignItems: 'center', gap: '12px',
          marginBottom: '10px', textAlign: 'left',
        }}>
          <span style={{ fontSize: '24px' }}>✉️</span>
          <div>
            <div style={{ fontSize: '14px', fontWeight: '600', color: theme === 'standard' ? '#0f172a' : 'white' }}>Other (IMAP)</div>
            <div style={{ fontSize: '11px', color: theme === 'standard' ? '#64748b' : 'rgba(255,255,255,0.6)' }}>
              Configure IMAP accounts via the WR Chat extension.
            </div>
          </div>
          <span style={{ marginLeft: 'auto', fontSize: '12px', color: theme === 'standard' ? '#94a3b8' : 'rgba(255,255,255,0.4)' }}>→</span>
        </div>

        <div style={{
          marginTop: '16px', padding: '12px',
          background: theme === 'standard' ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.15)',
          borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>🔒</span>
            <div style={{ fontSize: '11px', color: theme === 'standard' ? '#1e40af' : 'rgba(255,255,255,0.8)', lineHeight: '1.5' }}>
              <strong>Security:</strong> Your emails are never rendered with scripts or tracking.
              All content is sanitized locally before display.
            </div>
          </div>
        </div>
      </>
    )
  }

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
            onClick={() => { setStep('provider'); setCredError(null); onClose() }}
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

        <div style={{ padding: '20px', overflowY: 'auto', maxHeight: 'calc(85vh - 80px)' }}>
          {renderContent()}
        </div>
      </div>
    </div>
  )
}
