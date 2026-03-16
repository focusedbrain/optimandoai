/**
 * EmailConnectWizard — THE ONE shared email connect UI for the entire codebase.
 * Used in: BeapInboxDashboard, BeapBulkInboxDashboard, sidepanel, popup-chat,
 * EmailProvidersSection parents, WRGuardWorkspace, HandshakeRequestForm.
 *
 * Platform-aware: works in Electron (window.emailAccounts) and Chrome extension
 * (chrome.runtime.sendMessage). Same flow everywhere.
 */

import React, { useState, useEffect, useCallback } from 'react'

const OAUTH_CALLBACK_PORT = 51249
const CREDENTIALS_NEEDED_GMAIL = 'credentials not configured'
const CREDENTIALS_NEEDED_OUTLOOK = 'oauth client credentials not configured'

export interface EmailConnectWizardProps {
  isOpen: boolean
  onClose: () => void
  onConnected: (account: { provider: string; email: string }) => void
  theme?: 'professional' | 'default'
}

type Step = 'provider' | 'credentials' | 'connecting' | 'result'
type Provider = 'gmail' | 'outlook'
type ResultType = 'success' | 'failure'

declare global {
  interface Window {
    emailAccounts?: {
      connectGmail?: (displayName?: string) => Promise<{ ok: boolean; data?: { id: string; email: string; provider: string }; error?: string }>
      connectOutlook?: (displayName?: string) => Promise<{ ok: boolean; data?: { id: string; email: string; provider: string }; error?: string }>
      setGmailCredentials?: (clientId: string, clientSecret: string) => Promise<{ ok: boolean; error?: string }>
      setOutlookCredentials?: (clientId: string, clientSecret?: string, tenantId?: string) => Promise<{ ok: boolean; error?: string }>
      checkGmailCredentials?: () => Promise<{ ok: boolean; data?: { configured: boolean; clientId?: string }; error?: string }>
      checkOutlookCredentials?: () => Promise<{ ok: boolean; data?: { configured: boolean; clientId?: string }; error?: string }>
      listAccounts?: () => Promise<{ ok: boolean; data?: unknown[] }>
    }
  }
}

const isElectron = (): boolean =>
  typeof window !== 'undefined' && typeof (window as any).emailAccounts?.connectGmail === 'function'

const isExtension = (): boolean =>
  typeof chrome !== 'undefined' && !!chrome?.runtime?.sendMessage

export function EmailConnectWizard({
  isOpen,
  onClose,
  onConnected,
  theme = 'default',
}: EmailConnectWizardProps) {
  const [step, setStep] = useState<Step>('provider')
  const [provider, setProvider] = useState<Provider | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [result, setResult] = useState<ResultType | null>(null)
  const [resultEmail, setResultEmail] = useState<string>('')
  const [resultError, setResultError] = useState<string>('')
  const [connectingElapsed, setConnectingElapsed] = useState(0)
  const [connectingTimedOut, setConnectingTimedOut] = useState(false)

  const [gmailCreds, setGmailCreds] = useState({ clientId: '', clientSecret: '' })
  const [outlookCreds, setOutlookCreds] = useState({ clientId: '', clientSecret: '', tenantId: 'organizations' })
  const [existingGmail, setExistingGmail] = useState<{ clientId: string; clientSecret?: string; hasSecret: boolean; source: 'vault' | 'vault-migrated' | 'temporary' } | null>(null)
  const [existingOutlook, setExistingOutlook] = useState<{ clientId: string; clientSecret?: string; tenantId?: string; hasSecret: boolean; source: 'vault' | 'vault-migrated' | 'temporary' } | null>(null)
  const [credError, setCredError] = useState<string | null>(null)
  const [showSecret, setShowSecret] = useState(false)
  const [vaultUnlocked, setVaultUnlocked] = useState<boolean | undefined>(undefined)

  const isPro = theme === 'professional'
  const textColor = isPro ? '#0f172a' : 'white'
  const mutedColor = isPro ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isPro ? '#e2e8f0' : 'rgba(255,255,255,0.15)'
  const inputBg = isPro ? '#fff' : 'rgba(255,255,255,0.08)'

  const reset = useCallback(() => {
    setStep('provider')
    setProvider(null)
    setConnecting(false)
    setResult(null)
    setResultEmail('')
    setResultError('')
    setConnectingElapsed(0)
    setConnectingTimedOut(false)
    setCredError(null)
    setGmailCreds({ clientId: '', clientSecret: '' })
    setOutlookCreds({ clientId: '', clientSecret: '', tenantId: 'organizations' })
    setExistingGmail(null)
    setExistingOutlook(null)
    setVaultUnlocked(undefined)
  }, [])

  useEffect(() => {
    if (!isOpen) reset()
  }, [isOpen, reset])

  // Fetch vault status when on credentials step (platform-aware)
  useEffect(() => {
    if (!isOpen || step !== 'credentials') return
    let cancelled = false
    const fetchVaultStatus = async () => {
      try {
        if (isElectron()) {
          const status = await (window as any).handshakeView?.getVaultStatus?.()
          if (!cancelled) setVaultUnlocked(status?.isUnlocked ?? false)
        } else if (isExtension()) {
          const { getVaultStatus } = await import('../../vault/api')
          const status = await getVaultStatus()
          if (!cancelled) setVaultUnlocked(status?.isUnlocked === true || (status && status.locked === false))
        } else {
          if (!cancelled) setVaultUnlocked(undefined)
        }
      } catch {
        if (!cancelled) setVaultUnlocked(undefined)
      }
    }
    fetchVaultStatus()
    return () => { cancelled = true }
  }, [isOpen, step])

  // Platform API helpers — returns honest source (vault / vault-migrated / temporary / none)
  const checkGmailCreds = useCallback(async (): Promise<{
    configured: boolean
    clientId?: string
    clientSecret?: string
    source?: 'vault' | 'vault-migrated' | 'temporary' | 'none'
    hasSecret?: boolean
  }> => {
    if (isElectron()) {
      const res = await (window as any).emailAccounts?.checkGmailCredentials?.()
      if (!res?.ok) return { configured: false }
      const d = res.data
      return {
        configured: !!d?.configured,
        clientId: d?.clientId,
        clientSecret: (d?.credentials as any)?.clientSecret,
        source: d?.source || (d?.configured ? 'temporary' : 'none'),
        hasSecret: d?.hasSecret ?? false,
      }
    }
    if (isExtension()) {
      const res = await chrome.runtime.sendMessage({ type: 'EMAIL_CHECK_GMAIL_CREDENTIALS' })
      if (!res?.ok) return { configured: false }
      const d = res.data
      return {
        configured: !!d?.configured,
        clientId: d?.clientId,
        clientSecret: (d?.credentials as any)?.clientSecret,
        source: d?.source || (d?.configured ? 'temporary' : 'none'),
        hasSecret: d?.hasSecret ?? false,
      }
    }
    return { configured: false }
  }, [])

  const checkOutlookCreds = useCallback(async (): Promise<{
    configured: boolean
    clientId?: string
    clientSecret?: string
    tenantId?: string
    source?: 'vault' | 'vault-migrated' | 'temporary' | 'none'
    hasSecret?: boolean
  }> => {
    if (isElectron()) {
      const res = await (window as any).emailAccounts?.checkOutlookCredentials?.()
      if (!res?.ok) return { configured: false }
      const d = res.data
      return {
        configured: !!d?.configured,
        clientId: d?.clientId,
        clientSecret: (d?.credentials as any)?.clientSecret,
        tenantId: (d?.credentials as any)?.tenantId,
        source: d?.source || (d?.configured ? 'temporary' : 'none'),
        hasSecret: d?.hasSecret ?? false,
      }
    }
    if (isExtension()) {
      const res = await chrome.runtime.sendMessage({ type: 'EMAIL_CHECK_OUTLOOK_CREDENTIALS' })
      if (!res?.ok) return { configured: false }
      const d = res.data
      return {
        configured: !!d?.configured,
        clientId: d?.clientId,
        clientSecret: (d?.credentials as any)?.clientSecret,
        tenantId: (d?.credentials as any)?.tenantId,
        source: d?.source || (d?.configured ? 'temporary' : 'none'),
        hasSecret: d?.hasSecret ?? false,
      }
    }
    return { configured: false }
  }, [])

  const saveGmailCreds = useCallback(async (clientId: string, clientSecret: string): Promise<boolean> => {
    if (isElectron()) {
      const res = await (window as any).emailAccounts?.setGmailCredentials?.(clientId, clientSecret)
      return !!res?.ok
    }
    if (isExtension()) {
      const res = await chrome.runtime.sendMessage({ type: 'EMAIL_SAVE_GMAIL_CREDENTIALS', clientId, clientSecret })
      return !!res?.ok
    }
    return false
  }, [])

  const saveOutlookCreds = useCallback(
    async (clientId: string, clientSecret?: string, tenantId?: string): Promise<boolean> => {
      if (isElectron()) {
        const res = await (window as any).emailAccounts?.setOutlookCredentials?.(clientId, clientSecret, tenantId)
        return !!res?.ok
      }
      if (isExtension()) {
        const res = await chrome.runtime.sendMessage({
          type: 'EMAIL_SAVE_OUTLOOK_CREDENTIALS',
          clientId,
          clientSecret,
          tenantId,
        })
        return !!res?.ok
      }
      return false
    },
    [],
  )

  const connectGmail = useCallback(async (): Promise<{ ok: boolean; email?: string; error?: string }> => {
    if (isElectron()) {
      const res = await (window as any).emailAccounts?.connectGmail?.('Gmail Account')
      return { ok: !!res?.ok, email: res?.data?.email, error: res?.error }
    }
    if (isExtension()) {
      const res = await chrome.runtime.sendMessage({ type: 'EMAIL_CONNECT_GMAIL' })
      return { ok: !!res?.ok, email: res?.data?.email, error: res?.error }
    }
    return { ok: false, error: 'Email connection requires the desktop app or extension.' }
  }, [])

  const connectOutlook = useCallback(async (): Promise<{ ok: boolean; email?: string; error?: string }> => {
    if (isElectron()) {
      const res = await (window as any).emailAccounts?.connectOutlook?.('Outlook Account')
      return { ok: !!res?.ok, email: res?.data?.email, error: res?.error }
    }
    if (isExtension()) {
      const res = await chrome.runtime.sendMessage({ type: 'EMAIL_CONNECT_OUTLOOK' })
      return { ok: !!res?.ok, email: res?.data?.email, error: res?.error }
    }
    return { ok: false, error: 'Email connection requires the desktop app or extension.' }
  }, [])

  const handleSelectProvider = useCallback(
    async (p: Provider) => {
      setProvider(p)
      setCredError(null)
      setStep('credentials')
      if (p === 'gmail') {
        try {
          const check = await checkGmailCreds()
          const src = check.source as 'vault' | 'vault-migrated' | 'temporary' | undefined
          if (check.configured && src) {
            setExistingGmail({
              clientId: check.clientId || '',
              clientSecret: check.clientSecret,
              hasSecret: check.hasSecret ?? true,
              source: src,
            })
            setGmailCreds({
              clientId: check.clientId || '',
              clientSecret: check.clientSecret || '',
            })
          } else {
            setExistingGmail(null)
            setGmailCreds({ clientId: '', clientSecret: '' })
          }
        } catch {
          setExistingGmail(null)
        }
      } else {
        try {
          const check = await checkOutlookCreds()
          const src = check.source as 'vault' | 'vault-migrated' | 'temporary' | undefined
          if (check.configured && src) {
            setExistingOutlook({
              clientId: check.clientId || '',
              clientSecret: check.clientSecret,
              tenantId: check.tenantId,
              hasSecret: check.hasSecret ?? true,
              source: src,
            })
            setOutlookCreds({
              clientId: check.clientId || '',
              clientSecret: check.clientSecret || '',
              tenantId: check.tenantId || 'organizations',
            })
          } else {
            setExistingOutlook(null)
            setOutlookCreds({ clientId: '', clientSecret: '', tenantId: 'organizations' })
          }
        } catch {
          setExistingOutlook(null)
        }
      }
    },
    [checkGmailCreds, checkOutlookCreds],
  )

  const handleSaveAndConnect = useCallback(async () => {
    if (!provider) return
    setCredError(null)
    if (provider === 'gmail') {
      const c = existingGmail ? { clientId: existingGmail.clientId, clientSecret: gmailCreds.clientSecret } : gmailCreds
      if (!c.clientId?.trim() || !c.clientSecret?.trim()) {
        setCredError('Please enter both Client ID and Client Secret')
        return
      }
      const ok = await saveGmailCreds(c.clientId.trim(), c.clientSecret.trim())
      if (!ok) {
        setCredError('Failed to save credentials')
        return
      }
    } else {
      const c = existingOutlook
        ? { clientId: existingOutlook.clientId, clientSecret: outlookCreds.clientSecret, tenantId: outlookCreds.tenantId }
        : outlookCreds
      if (!c.clientId?.trim()) {
        setCredError('Please enter the Application (Client) ID')
        return
      }
      const ok = await saveOutlookCreds(c.clientId.trim(), c.clientSecret?.trim() || undefined, c.tenantId?.trim() || undefined)
      if (!ok) {
        setCredError('Failed to save credentials')
        return
      }
    }
    setStep('connecting')
    setConnecting(true)
    setConnectingElapsed(0)
    setConnectingTimedOut(false)
  }, [provider, existingGmail, existingOutlook, gmailCreds, outlookCreds, saveGmailCreds, saveOutlookCreds])

  const handleConnectWithExisting = useCallback(() => {
    setCredError(null)
    setStep('connecting')
    setConnecting(true)
    setConnectingElapsed(0)
    setConnectingTimedOut(false)
  }, [])

  useEffect(() => {
    if (step !== 'connecting' || !connecting) return
    const connect = async () => {
      const doConnect = provider === 'gmail' ? connectGmail : connectOutlook
      try {
        const res = await doConnect()
        setConnecting(false)
        setStep('result')
        if (res.ok) {
          setResult('success')
          setResultEmail(res.email || '')
          setTimeout(() => {
            onConnected({ provider: provider!, email: res.email || '' })
            onClose()
          }, 3000)
        } else {
          setResult('failure')
          setResultError(res.error || 'Connection failed')
        }
      } catch (e: any) {
        setConnecting(false)
        setStep('result')
        setResult('failure')
        setResultError(e?.message || 'Connection failed')
      }
    }
    connect()
  }, [step, connecting, provider, connectGmail, connectOutlook, onConnected, onClose])

  useEffect(() => {
    if (step !== 'connecting' || !connecting) return
    const iv = setInterval(() => {
      setConnectingElapsed((s) => {
        const next = s + 1
        if (next >= 90) setConnectingTimedOut(true)
        return next
      })
    }, 1000)
    return () => clearInterval(iv)
  }, [step, connecting])

  const handleBackToProvider = useCallback(() => {
    setStep('provider')
    setProvider(null)
    setCredError(null)
    setExistingGmail(null)
    setExistingOutlook(null)
  }, [])

  const handleBackToCredentials = useCallback(() => {
    setStep('credentials')
    setConnecting(false)
    setConnectingTimedOut(false)
    setConnectingElapsed(0)
  }, [])

  const handleTryAgain = useCallback(() => {
    setResult(null)
    setResultError('')
    setStep('connecting')
    setConnecting(true)
    setConnectingElapsed(0)
    setConnectingTimedOut(false)
  }, [])

  const handleDone = useCallback(() => {
    if (result === 'success' && resultEmail) {
      onConnected({ provider: provider!, email: resultEmail })
    }
    onClose()
  }, [result, resultEmail, provider, onConnected, onClose])

  if (!isOpen) return null

  const hasElectron = isElectron()
  const hasExtension = isExtension()
  const canConnect = hasElectron || hasExtension

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
          width: '400px',
          maxHeight: '90vh',
          background: isPro ? '#ffffff' : 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
          borderRadius: '16px',
          border: `1px solid ${borderColor}`,
          boxShadow: '0 25px 50px rgba(0,0,0,0.4)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
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

        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          {/* Step 1: Provider */}
          {step === 'provider' && (
            <>
              <div style={{ fontSize: '13px', color: mutedColor, marginBottom: '16px' }}>
                Choose your email provider to connect:
              </div>
              {!canConnect && (
                <div
                  style={{
                    padding: '12px',
                    background: isPro ? '#fef3c7' : 'rgba(245,158,11,0.2)',
                    borderRadius: '8px',
                    marginBottom: '16px',
                    fontSize: '12px',
                    color: isPro ? '#92400e' : 'rgba(255,255,255,0.9)',
                  }}
                >
                  Email connection requires the desktop app. Ensure WR Desk™ is running.
                </div>
              )}
              <button
                onClick={() => canConnect && handleSelectProvider('gmail')}
                disabled={!canConnect}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  background: inputBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '10px',
                  cursor: canConnect ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '10px',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: '24px' }}>📧</span>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: textColor }}>Gmail</div>
                  <div style={{ fontSize: '11px', color: mutedColor }}>Connect via Google OAuth</div>
                </div>
                <span style={{ marginLeft: 'auto', fontSize: '14px', color: mutedColor }}>→</span>
              </button>
              <button
                onClick={() => canConnect && handleSelectProvider('outlook')}
                disabled={!canConnect}
                style={{
                  width: '100%',
                  padding: '14px 16px',
                  background: inputBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '10px',
                  cursor: canConnect ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  marginBottom: '10px',
                  textAlign: 'left',
                }}
              >
                <span style={{ fontSize: '24px' }}>📨</span>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: textColor }}>Microsoft 365 / Outlook</div>
                  <div style={{ fontSize: '11px', color: mutedColor }}>Connect via Microsoft OAuth</div>
                </div>
                <span style={{ marginLeft: 'auto', fontSize: '14px', color: mutedColor }}>→</span>
              </button>
              <div style={{ marginTop: '16px', padding: '12px', background: isPro ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.15)', borderRadius: '8px', border: '1px solid rgba(59,130,246,0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                  <span style={{ fontSize: '14px' }}>🔒</span>
                  <div style={{ fontSize: '11px', color: isPro ? '#1e40af' : 'rgba(255,255,255,0.8)', lineHeight: '1.5' }}>
                    <strong>Security:</strong> Your emails are never rendered with scripts or tracking.
                  </div>
                </div>
                <div style={{ fontSize: '11px', color: isPro ? '#1e40af' : 'rgba(255,255,255,0.8)', lineHeight: '1.5', marginTop: '4px' }}>
                  🔐 Credentials are stored encrypted in your local vault.
                </div>
              </div>
            </>
          )}

          {/* Step 2: Credentials */}
          {step === 'credentials' && provider && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                onClick={handleBackToProvider}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'none',
                  border: 'none',
                  color: isPro ? '#3b82f6' : '#60a5fa',
                  fontSize: '13px',
                  cursor: 'pointer',
                  padding: 0,
                  marginBottom: '8px',
                }}
              >
                ← Back to provider selection
              </button>
              <div style={{ fontSize: '14px', fontWeight: '600', color: textColor, marginBottom: '8px' }}>
                Set up {provider === 'gmail' ? 'Gmail' : 'Outlook'} OAuth
              </div>

              {/* Vault status (for new saves) — only when no existing creds or source is none */}
              {!existingGmail && !existingOutlook && vaultUnlocked === true && (
                <div style={{ padding: '10px 12px', background: isPro ? '#ecfdf5' : 'rgba(34,197,94,0.15)', borderRadius: '8px', marginBottom: '12px', fontSize: '12px', color: isPro ? '#166534' : 'rgba(34,197,94,0.95)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🔐</span>
                  <span>Credentials will be stored encrypted in your vault.</span>
                </div>
              )}
              {!existingGmail && !existingOutlook && vaultUnlocked === false && (
                <div style={{ padding: '10px 12px', background: isPro ? '#fef3c7' : 'rgba(245,158,11,0.2)', borderRadius: '8px', marginBottom: '12px', fontSize: '12px', color: isPro ? '#92400e' : 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>⚠️</span>
                  <span>Vault is locked. Your credentials will be stored temporarily. Unlock your vault for permanent encrypted storage.</span>
                </div>
              )}

              {provider === 'gmail' && (
                <>
                  {existingGmail ? (
                    <>
                      {existingGmail.source === 'vault' && (
                        <div style={{ fontSize: '12px', color: '#22c55e', marginBottom: '8px' }}>🔐 Credentials stored securely in your vault</div>
                      )}
                      {existingGmail.source === 'vault-migrated' && (
                        <div style={{ fontSize: '12px', color: '#22c55e', marginBottom: '8px' }}>🔐 Credentials migrated to vault from temporary storage</div>
                      )}
                      {existingGmail.source === 'temporary' && (
                        <div style={{ fontSize: '12px', color: isPro ? '#92400e' : 'rgba(245,158,11,0.95)', marginBottom: '8px' }}>
                          ⚠️ Credentials found in temporary storage (not vault-protected). Unlock your vault to secure them.
                        </div>
                      )}
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Client ID</label>
                        <input
                          type="text"
                          value={existingGmail.clientId || gmailCreds.clientId}
                          onChange={(e) => setGmailCreds((p) => ({ ...p, clientId: e.target.value }))}
                          placeholder="xxxxxxxxx.apps.googleusercontent.com"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Client Secret</label>
                        <input
                          type={showSecret ? 'text' : 'password'}
                          value={gmailCreds.clientSecret}
                          onChange={(e) => setGmailCreds((p) => ({ ...p, clientSecret: e.target.value }))}
                          placeholder="••••••••"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowSecret((s) => !s)}
                          style={{ marginTop: '4px', fontSize: '11px', background: 'none', border: 'none', color: isPro ? '#3b82f6' : '#60a5fa', cursor: 'pointer' }}
                        >
                          {showSecret ? 'Hide' : 'Reveal'} and edit
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                        <button
                          onClick={handleConnectWithExisting}
                          style={{
                            flex: 1,
                            padding: '12px',
                            background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                            border: 'none',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          Connect with existing credentials
                        </button>
                        <button
                          onClick={handleSaveAndConnect}
                          style={{
                            flex: 1,
                            padding: '12px',
                            background: isPro ? '#e2e8f0' : 'rgba(255,255,255,0.15)',
                            border: `1px solid ${borderColor}`,
                            borderRadius: '8px',
                            color: textColor,
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          Update credentials
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ padding: '12px', background: isPro ? 'rgba(234,179,8,0.1)' : 'rgba(234,179,8,0.15)', borderRadius: '8px', border: '1px solid rgba(234,179,8,0.3)', marginBottom: '8px', fontSize: '11px', color: isPro ? '#854d0e' : 'rgba(255,255,255,0.9)', lineHeight: '1.6' }}>
                        <strong>For Gmail:</strong>
                        <ol style={{ margin: '8px 0 0 16px', padding: 0 }}>
                          <li>Go to <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" style={{ color: isPro ? '#3b82f6' : '#60a5fa' }}>Google Cloud Console</a></li>
                          <li>Create a project or select an existing one</li>
                          <li>Enable the Gmail API</li>
                          <li>Credentials → Create OAuth 2.0 Client ID</li>
                          <li>Application type: Web application</li>
                          <li>Add redirect URI: http://localhost:{OAUTH_CALLBACK_PORT}/callback</li>
                          <li>Copy Client ID and Client Secret below</li>
                        </ol>
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Client ID *</label>
                        <input
                          type="text"
                          value={gmailCreds.clientId}
                          onChange={(e) => setGmailCreds((p) => ({ ...p, clientId: e.target.value }))}
                          placeholder="xxxxxxxxx.apps.googleusercontent.com"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Client Secret *</label>
                        <input
                          type="password"
                          value={gmailCreds.clientSecret}
                          onChange={(e) => setGmailCreds((p) => ({ ...p, clientSecret: e.target.value }))}
                          placeholder="GOCSPX-xxxxxxxxx"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                      </div>
                      {credError && <div style={{ fontSize: '12px', color: '#dc2626' }}>{credError}</div>}
                      <button
                        onClick={handleSaveAndConnect}
                        style={{
                          width: '100%',
                          padding: '12px',
                          background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                          border: 'none',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          marginTop: '8px',
                        }}
                      >
                        Save & Connect
                      </button>
                    </>
                  )}
                </>
              )}

              {provider === 'outlook' && (
                <>
                  {existingOutlook ? (
                    <>
                      {existingOutlook.source === 'vault' && (
                        <div style={{ fontSize: '12px', color: '#22c55e', marginBottom: '8px' }}>🔐 Credentials stored securely in your vault</div>
                      )}
                      {existingOutlook.source === 'vault-migrated' && (
                        <div style={{ fontSize: '12px', color: '#22c55e', marginBottom: '8px' }}>🔐 Credentials migrated to vault from temporary storage</div>
                      )}
                      {existingOutlook.source === 'temporary' && (
                        <div style={{ fontSize: '12px', color: isPro ? '#92400e' : 'rgba(245,158,11,0.95)', marginBottom: '8px' }}>
                          ⚠️ Credentials found in temporary storage (not vault-protected). Unlock your vault to secure them.
                        </div>
                      )}
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Application (Client) ID</label>
                        <input
                          type="text"
                          value={existingOutlook.clientId || outlookCreds.clientId}
                          onChange={(e) => setOutlookCreds((p) => ({ ...p, clientId: e.target.value }))}
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Client Secret</label>
                        <input
                          type={showSecret ? 'text' : 'password'}
                          value={outlookCreds.clientSecret}
                          onChange={(e) => setOutlookCreds((p) => ({ ...p, clientSecret: e.target.value }))}
                          placeholder="••••••••"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                        <button
                          type="button"
                          onClick={() => setShowSecret((s) => !s)}
                          style={{ marginTop: '4px', fontSize: '11px', background: 'none', border: 'none', color: isPro ? '#3b82f6' : '#60a5fa', cursor: 'pointer' }}
                        >
                          {showSecret ? 'Hide' : 'Reveal'} and edit
                        </button>
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Tenant ID (Directory ID) *</label>
                        <input
                          type="text"
                          value={outlookCreds.tenantId || existingOutlook.tenantId || ''}
                          onChange={(e) => setOutlookCreds((p) => ({ ...p, tenantId: e.target.value }))}
                          placeholder="e.g., 12345678-abcd-... or organizations"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                        <div style={{ fontSize: '11px', color: mutedColor, marginTop: '4px' }}>Azure Portal → App Registration → Overview → Verzeichnis-ID (Mandanten-ID)</div>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                        <button
                          onClick={handleConnectWithExisting}
                          style={{
                            flex: 1,
                            padding: '12px',
                            background: 'linear-gradient(135deg, #0078d4 0%, #004578 100%)',
                            border: 'none',
                            borderRadius: '8px',
                            color: 'white',
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          Connect with existing credentials
                        </button>
                        <button
                          onClick={handleSaveAndConnect}
                          style={{
                            flex: 1,
                            padding: '12px',
                            background: isPro ? '#e2e8f0' : 'rgba(255,255,255,0.15)',
                            border: `1px solid ${borderColor}`,
                            borderRadius: '8px',
                            color: textColor,
                            fontSize: '14px',
                            fontWeight: '600',
                            cursor: 'pointer',
                          }}
                        >
                          Update credentials
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ padding: '12px', background: isPro ? 'rgba(234,179,8,0.1)' : 'rgba(234,179,8,0.15)', borderRadius: '8px', border: '1px solid rgba(234,179,8,0.3)', marginBottom: '8px', fontSize: '11px', color: isPro ? '#854d0e' : 'rgba(255,255,255,0.9)', lineHeight: '1.6' }}>
                        <strong>For Outlook:</strong>
                        <ol style={{ margin: '8px 0 0 16px', padding: 0 }}>
                          <li>Go to <a href="https://portal.azure.com" target="_blank" rel="noopener noreferrer" style={{ color: isPro ? '#3b82f6' : '#60a5fa' }}>Azure Portal</a></li>
                          <li>Register an application in Azure Active Directory</li>
                          <li>Add redirect URI: http://localhost:{OAUTH_CALLBACK_PORT}/callback</li>
                          <li>Create a client secret</li>
                          <li>Copy Application (client) ID, Client Secret, and Tenant ID below</li>
                        </ol>
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Application (Client) ID *</label>
                        <input
                          type="text"
                          value={outlookCreds.clientId}
                          onChange={(e) => setOutlookCreds((p) => ({ ...p, clientId: e.target.value }))}
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Client Secret *</label>
                        <input
                          type="password"
                          value={outlookCreds.clientSecret}
                          onChange={(e) => setOutlookCreds((p) => ({ ...p, clientSecret: e.target.value }))}
                          placeholder="Optional for public clients"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: '12px', fontWeight: '600', color: mutedColor, marginBottom: '4px', display: 'block' }}>Tenant ID (Directory ID) *</label>
                        <input
                          type="text"
                          value={outlookCreds.tenantId}
                          onChange={(e) => setOutlookCreds((p) => ({ ...p, tenantId: e.target.value }))}
                          placeholder="e.g., 12345678-abcd-... or organizations"
                          style={{ width: '100%', padding: '10px 12px', background: inputBg, border: `1px solid ${borderColor}`, borderRadius: '8px', fontSize: '13px', color: textColor }}
                        />
                        <div style={{ fontSize: '11px', color: mutedColor, marginTop: '4px' }}>Azure Portal → App Registration → Overview → Verzeichnis-ID (Mandanten-ID)</div>
                      </div>
                      {credError && <div style={{ fontSize: '12px', color: '#dc2626' }}>{credError}</div>}
                      <button
                        onClick={handleSaveAndConnect}
                        style={{
                          width: '100%',
                          padding: '12px',
                          background: 'linear-gradient(135deg, #0078d4 0%, #004578 100%)',
                          border: 'none',
                          borderRadius: '8px',
                          color: 'white',
                          fontSize: '14px',
                          fontWeight: '600',
                          cursor: 'pointer',
                          marginTop: '8px',
                        }}
                      >
                        Save & Connect
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step 3: Connecting */}
          {step === 'connecting' && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <div style={{ fontSize: '36px', marginBottom: '16px', animation: 'spin 1s linear infinite' }}>⏳</div>
              <div style={{ fontSize: '14px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>
                Connecting to {provider === 'gmail' ? 'Gmail' : 'Outlook'}...
              </div>
              <div style={{ fontSize: '12px', color: mutedColor, marginBottom: '16px' }}>
                Please complete the authorization in your browser window.
              </div>
              {connectingElapsed >= 30 && connectingElapsed < 90 && (
                <div style={{ fontSize: '12px', color: '#f59e0b', marginBottom: '12px' }}>
                  Still waiting... Make sure you completed the sign-in in your browser.
                </div>
              )}
              {connectingTimedOut && (
                <div style={{ marginTop: '16px', display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <div style={{ fontSize: '12px', color: '#dc2626', width: '100%', marginBottom: '8px' }}>Connection timed out.</div>
                  <button
                    onClick={handleTryAgain}
                    style={{ padding: '8px 16px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
                  >
                    Try Again
                  </button>
                  <button
                    onClick={handleBackToCredentials}
                    style={{ padding: '8px 16px', background: 'transparent', color: textColor, border: `1px solid ${borderColor}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
                  >
                    Back to Credentials
                  </button>
                </div>
              )}
              <button
                onClick={onClose}
                style={{ marginTop: '20px', padding: '8px 16px', background: 'transparent', color: mutedColor, border: `1px solid ${borderColor}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
              >
                Cancel
              </button>
            </div>
          )}

          {/* Step 4: Result */}
          {step === 'result' && result && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              {result === 'success' ? (
                <>
                  <div style={{ fontSize: '48px', marginBottom: '16px', color: '#22c55e' }}>✓</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>
                    Connected as {resultEmail || 'your account'}
                  </div>
                  <div style={{ fontSize: '12px', color: mutedColor, marginBottom: '20px' }}>Closing in 3 seconds...</div>
                  <button
                    onClick={handleDone}
                    style={{
                      padding: '12px 24px',
                      background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                      border: 'none',
                      borderRadius: '8px',
                      color: 'white',
                      fontSize: '14px',
                      fontWeight: '600',
                      cursor: 'pointer',
                    }}
                  >
                    Done
                  </button>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '48px', marginBottom: '16px', color: '#dc2626' }}>✗</div>
                  <div style={{ fontSize: '16px', fontWeight: 600, color: textColor, marginBottom: '8px' }}>Connection failed</div>
                  <div style={{ fontSize: '12px', color: mutedColor, marginBottom: '20px', maxHeight: '80px', overflowY: 'auto' }}>{resultError}</div>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
                    <button
                      onClick={handleTryAgain}
                      style={{ padding: '10px 20px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
                    >
                      Try Again
                    </button>
                    <button
                      onClick={handleBackToCredentials}
                      style={{ padding: '10px 20px', background: 'transparent', color: textColor, border: `1px solid ${borderColor}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
                    >
                      Back to Credentials
                    </button>
                    <button
                      onClick={onClose}
                      style={{ padding: '10px 20px', background: 'transparent', color: mutedColor, border: `1px solid ${borderColor}`, borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}
                    >
                      Close
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}

export default EmailConnectWizard
