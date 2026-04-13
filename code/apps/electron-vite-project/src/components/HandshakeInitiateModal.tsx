/**
 * HandshakeInitiateModal — wraps SendHandshakeDelivery with vault status
 * and policy selection. Vault hint only shown when action requires vault (e.g. vault profiles).
 */

import { useState, useEffect } from 'react'
import { SendHandshakeDelivery } from '@ext/handshake/components/SendHandshakeDelivery'
import { initiateHandshake } from '@ext/handshake/handshakeRpc'
import { buildInitiateContextOptions } from '@ext/handshake/buildInitiateContextOptions'
import VaultStatusIndicator from './VaultStatusIndicator'
import PolicyRadioGroup, { DEFAULT_AI_POLICY, type PolicySelection } from './PolicyRadioGroup'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function prefillRecipientEmailAsync(setEmail: (v: string) => void): Promise<void> {
  const auth = (window as unknown as { auth?: { getStatus?: () => Promise<{ email?: string } | null | undefined> } }).auth
  if (typeof auth?.getStatus === 'function') {
    try {
      const st = await auth.getStatus()
      if (st?.email && typeof st.email === 'string') {
        setEmail(st.email)
        return
      }
    } catch {
      /* fall through to extension */
    }
  }
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage({ type: 'AUTH_STATUS' }, (response) => {
      if (chrome.runtime.lastError) return
      if (response?.email) setEmail(response.email as string)
    })
  }
}

function prefillRecipientEmail(setEmail: (v: string) => void): void {
  void prefillRecipientEmailAsync(setEmail)
}

interface Props {
  onClose: () => void
  onSuccess?: () => void
  onSubmit?: (data: { recipientEmail: string; deliveryMode: string }) => void
  /** When true, opens in internal (same-account) handshake mode. */
  presetInternal?: boolean
}

export default function HandshakeInitiateModal({ onClose, onSuccess, presetInternal = false }: Props) {
  const [vaultStatus, setVaultStatus] = useState<{ isUnlocked: boolean; name: string | null }>({ isUnlocked: false, name: null })
  const [canUseHsContextProfiles, setCanUseHsContextProfiles] = useState(false)
  const [policies, setPolicies] = useState<PolicySelection>(DEFAULT_AI_POLICY)
  const [requiresVault, setRequiresVault] = useState(false)

  const [isInternal, setIsInternal] = useState(!!presetInternal)
  const [deviceRole, setDeviceRole] = useState<'host' | 'sandbox'>('sandbox')
  const [deviceName, setDeviceName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [internalSubmitting, setInternalSubmitting] = useState(false)
  const [internalError, setInternalError] = useState<string | null>(null)

  useEffect(() => {
    const check = async () => {
      try {
        const s = await window.handshakeView?.getVaultStatus?.()
        setVaultStatus({ isUnlocked: s?.isUnlocked ?? false, name: s?.name ?? null })
        setCanUseHsContextProfiles(s?.canUseHsContextProfiles ?? false)
      } catch {
        setVaultStatus({ isUnlocked: false, name: null })
        setCanUseHsContextProfiles(false)
      }
    }
    check()
    const h = () => check()
    window.addEventListener('vault-status-changed', h)
    return () => window.removeEventListener('vault-status-changed', h)
  }, [])

  useEffect(() => {
    if (presetInternal) setIsInternal(true)
  }, [presetInternal])

  useEffect(() => {
    if (!isInternal) return
    prefillRecipientEmail(setRecipientEmail)
    try {
      const stored = JSON.parse(localStorage.getItem('optimando-orchestrator-mode') || '{}') as { deviceName?: string }
      setDeviceName(typeof stored.deviceName === 'string' ? stored.deviceName : '')
    } catch {
      setDeviceName('')
    }
  }, [isInternal])

  const handleSuccess = (result?: { handshake_id?: string }) => {
    onSuccess?.()
    onClose()
  }

  const handleInternalSubmit = async () => {
    if (!recipientEmail.trim()) {
      setInternalError('Please enter a recipient email address')
      return
    }
    if (!EMAIL_PATTERN.test(recipientEmail.trim())) {
      setInternalError('Please enter a valid email address')
      return
    }
    setInternalSubmitting(true)
    setInternalError(null)
    try {
      const opts = await buildInitiateContextOptions({
        skipVaultContext: !canUseHsContextProfiles,
        policySelections: policies,
        selectedProfileItems: [],
        messageText: '',
        contextGraphText: '',
        contextGraphType: 'text',
        adhocBlockPolicy: { policy_mode: 'inherit' },
      })
      await initiateHandshake(
        recipientEmail.trim().toLowerCase(),
        recipientEmail.trim(),
        '',
        {
          ...opts,
          handshake_type: 'internal',
          device_name: deviceName.trim() || undefined,
          device_role: deviceRole,
        } as any,
      )
      handleSuccess()
    } catch (e) {
      setInternalError(e instanceof Error ? e.message : 'Failed to initiate handshake')
    } finally {
      setInternalSubmitting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.4)',
        backdropFilter: 'blur(3px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: '16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: '520px',
          background: '#ffffff',
          borderRadius: '12px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.18)',
          overflow: 'hidden',
          maxHeight: 'calc(100vh - 60px)',
          overflowY: 'auto',
        }}
      >
        <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid rgba(147,51,234,0.14)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px', lineHeight: 1 }} aria-hidden>{'\u{1F91D}'}</span>
          <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#1f2937' }}>Handshake Request</h2>
        </div>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(147,51,234,0.14)' }}>
          <VaultStatusIndicator
            vaultName={vaultStatus.name}
            isUnlocked={vaultStatus.isUnlocked}
            warningEscalated={false}
            requiresVault={requiresVault}
          />
        </div>
        <div style={{ padding: '16px 16px 0', borderBottom: '1px solid rgba(147,51,234,0.14)' }}>
          <PolicyRadioGroup value={policies} onChange={setPolicies} readOnly={false} variant="light" />
        </div>

        {isInternal ? (
          <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {presetInternal ? (
              <p style={{ margin: 0, fontSize: '12px', color: '#6b7280' }}>Internal handshake — connect your own devices on this account.</p>
            ) : (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', color: '#1f2937' }}>
                <input
                  type="checkbox"
                  checked={isInternal}
                  disabled={internalSubmitting}
                  onChange={(e) => {
                    const next = e.target.checked
                    setIsInternal(next)
                    setInternalError(null)
                    if (next) {
                      prefillRecipientEmail(setRecipientEmail)
                    } else {
                      setRecipientEmail('')
                    }
                  }}
                />
                Internal handshake (connect my own devices)
              </label>
            )}

            <div>
              <label style={{ fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', marginBottom: '6px' }}>To</label>
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => {
                  if (!isInternal) setRecipientEmail(e.target.value)
                }}
                readOnly={isInternal}
                placeholder={isInternal ? 'Your SSO email (auto-filled)' : 'recipient@example.com'}
                disabled={internalSubmitting}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  border: '1px solid rgba(147,51,234,0.18)',
                  fontSize: '13px',
                  boxSizing: 'border-box',
                  opacity: isInternal ? 0.7 : 1,
                  cursor: isInternal ? 'not-allowed' : 'text',
                  backgroundColor: isInternal ? '#f0f0f0' : '#fff',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: '12px', color: '#6b7280', marginBottom: '4px', display: 'block' }}>This device is:</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  onClick={() => setDeviceRole('host')}
                  disabled={internalSubmitting}
                  style={{
                    flex: 1, padding: '6px', borderRadius: '6px', fontSize: '12px', cursor: internalSubmitting ? 'not-allowed' : 'pointer',
                    background: deviceRole === 'host' ? '#534AB7' : 'transparent',
                    color: deviceRole === 'host' ? '#fff' : '#6b7280',
                    border: deviceRole === 'host' ? 'none' : '1px solid #ddd',
                  }}
                >Host</button>
                <button
                  type="button"
                  onClick={() => setDeviceRole('sandbox')}
                  disabled={internalSubmitting}
                  style={{
                    flex: 1, padding: '6px', borderRadius: '6px', fontSize: '12px', cursor: internalSubmitting ? 'not-allowed' : 'pointer',
                    background: deviceRole === 'sandbox' ? '#534AB7' : 'transparent',
                    color: deviceRole === 'sandbox' ? '#fff' : '#6b7280',
                    border: deviceRole === 'sandbox' ? 'none' : '1px solid #ddd',
                  }}
                >Sandbox</button>
              </div>
            </div>

            {internalError && (
              <div style={{ padding: '10px', background: 'rgba(239,68,68,0.1)', borderRadius: '8px', fontSize: '12px', color: '#b91c1c' }}>{internalError}</div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #ddd', background: '#fff', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
              <button
                type="button"
                onClick={() => void handleInternalSubmit()}
                disabled={internalSubmitting}
                style={{ padding: '8px 14px', borderRadius: '8px', border: 'none', background: 'linear-gradient(135deg,#8b5cf6,#7c3aed)', color: 'white', cursor: internalSubmitting ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 600 }}
              >
                {internalSubmitting ? 'Sending…' : 'Create handshake'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {!presetInternal && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px 0', fontSize: '13px', cursor: 'pointer', color: '#1f2937' }}>
                <input
                  type="checkbox"
                  checked={false}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setIsInternal(true)
                      setInternalError(null)
                      prefillRecipientEmail(setRecipientEmail)
                    }
                  }}
                />
                Internal handshake (connect my own devices)
              </label>
            )}
            <SendHandshakeDelivery
              theme="standard"
              onBack={onClose}
              fromAccountId=""
              emailAccounts={[]}
              onSuccess={handleSuccess}
              policySelections={policies}
              onRequiresVaultChange={setRequiresVault}
              isVaultUnlocked={vaultStatus.isUnlocked}
              canUseHsContextProfiles={canUseHsContextProfiles}
            />
          </>
        )}
      </div>
    </div>
  )
}
