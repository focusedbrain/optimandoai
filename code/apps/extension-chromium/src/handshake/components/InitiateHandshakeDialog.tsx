/**
 * InitiateHandshakeDialog Component
 *
 * Dialog for initiating a new handshake with a recipient.
 * Calls handshake.initiate RPC — the backend handles capsule building
 * and email transport.
 */

import React, { useState, useEffect } from 'react'
import { initiateHandshake } from '../handshakeRpc'
import { buildInitiateContextOptions } from '../buildInitiateContextOptions'
import { HandshakeContextProfilePicker } from './HandshakeContextProfilePicker'
import type { ProfileContextItem } from '@shared/handshake/types'
import {
  getThemeTokens,
  overlayStyle as themeOverlayStyle,
  panelStyle,
  headerStyle as themeHeaderStyle,
  headerTitleStyle,
  headerMainTitleStyle,
  headerSubtitleStyle,
  closeButtonStyle,
  bodyStyle,
  inputStyle as themeInputStyle,
  labelStyle as themeLabelStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  notificationStyle,
} from '../../shared/ui/lightboxTheme'
import { getVaultStatus } from '../../vault/api'

interface InitiateHandshakeDialogProps {
  fromAccountId: string
  theme?: 'default' | 'dark' | 'professional'
  onInitiated?: (handshakeId: string) => void
  onClose?: () => void
  /** Whether the current user has Publisher/Enterprise tier. */
  canUseHsContextProfiles?: boolean
  /** Opens with internal handshake mode pre-selected (same-account devices). */
  presetInternal?: boolean
}

export const InitiateHandshakeDialog: React.FC<InitiateHandshakeDialogProps> = ({
  fromAccountId,
  theme = 'default',
  onInitiated,
  onClose,
  canUseHsContextProfiles = false,
  presetInternal = false,
}) => {
  const [recipientEmail, setRecipientEmail] = useState('')
  const [isInternal, setIsInternal] = useState(!!presetInternal)
  const [deviceRole, setDeviceRole] = useState<'host' | 'sandbox'>('sandbox')
  const [deviceName, setDeviceName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Include Vault Profiles — enabled by default when profiles available
  const [includeVaultProfiles, setIncludeVaultProfiles] = useState(true)

  // Vault lock status — used to gate profile picker
  const [isVaultUnlocked, setIsVaultUnlocked] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    getVaultStatus()
      .then((s) => setIsVaultUnlocked(s?.isUnlocked === true || s?.locked === false))
      .catch(() => setIsVaultUnlocked(false))
  }, [])

  useEffect(() => {
    if (presetInternal) setIsInternal(true)
  }, [presetInternal])

  /** When internal mode is on, load SSO email into `recipientEmail` (value drives the input, not placeholder-only). */
  useEffect(() => {
    if (!isInternal) return
    let cancelled = false

    const loadEmail = (): Promise<string | null> =>
      new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({ type: 'AUTH_STATUS' }, (response) => {
            if (chrome.runtime.lastError) {
              resolve(null)
              return
            }
            const em = typeof (response as { email?: unknown })?.email === 'string'
              ? (response as { email: string }).email.trim()
              : ''
            resolve(em || null)
          })
          return
        }
        resolve(null)
      })

    const loadStoredAuthEmail = (): Promise<string | null> =>
      new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) {
          resolve(null)
          return
        }
        chrome.storage.local.get(['authEmail'], (r) => {
          const em = typeof r.authEmail === 'string' ? r.authEmail.trim() : ''
          resolve(em || null)
        })
      })

    void (async () => {
      let email = await loadEmail()
      if (!email) email = await loadStoredAuthEmail()
      if (!email && typeof window !== 'undefined') {
        const auth = (window as unknown as { auth?: { getStatus?: () => Promise<{ email?: string } | null | undefined> } }).auth
        try {
          const st = await auth?.getStatus?.()
          if (typeof st?.email === 'string' && st.email.trim()) email = st.email.trim()
        } catch {
          /* ignore */
        }
      }
      if (!cancelled && email) setRecipientEmail(email)

      try {
        const stored = JSON.parse(localStorage.getItem('optimando-orchestrator-mode') || '{}') as { deviceName?: string }
        if (!cancelled) setDeviceName(typeof stored.deviceName === 'string' ? stored.deviceName : '')
      } catch {
        if (!cancelled) setDeviceName('')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isInternal])

  // Context Graph (optional — attached to handshake.initiate RPC)
  const [showContextGraph, setShowContextGraph] = useState(false)
  const [contextGraphTab, setContextGraphTab] = useState<'vault' | 'adhoc'>('vault')
  const [contextGraphText, setContextGraphText] = useState('')
  const [contextGraphType, setContextGraphType] = useState<'text' | 'json'>('text')

  // HS Context Profiles (publisher+ only) — structured for per-item policy
  const [selectedProfileItems, setSelectedProfileItems] = useState<ProfileContextItem[]>([])
  const [adhocBlockPolicy, setAdhocBlockPolicy] = useState<{ policy_mode: 'inherit' | 'override'; policy?: { ai_processing_mode: 'none' | 'local_only' | 'internal_and_cloud' } }>({ policy_mode: 'inherit' })
  const defaultPolicy = { ai_processing_mode: 'local_only' as const }

  const t = getThemeTokens(theme)

  const handleSubmit = async () => {
    if (!recipientEmail.trim()) {
      setError('Please enter a recipient email address')
      return
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailPattern.test(recipientEmail.trim())) {
      setError('Please enter a valid email address')
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      const receiverUserId = recipientEmail.trim().toLowerCase()
      const opts = await buildInitiateContextOptions({
        skipVaultContext: !canUseHsContextProfiles || !includeVaultProfiles,
        policySelections: defaultPolicy,
        selectedProfileItems,
        contextGraphText,
        contextGraphType,
        adhocBlockPolicy,
      })
      const result = await initiateHandshake(
        receiverUserId,
        recipientEmail.trim(),
        fromAccountId,
        {
          ...opts,
          handshake_type: isInternal ? 'internal' : undefined,
          device_name: isInternal ? (deviceName.trim() || undefined) : undefined,
          device_role: isInternal ? deviceRole : undefined,
        },
      )
      setSuccess(true)
      onInitiated?.(result.handshake_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initiate handshake')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (success) {
    return (
      <div style={themeOverlayStyle(t)} onClick={onClose}>
        <div style={panelStyle(t)} onClick={(e) => e.stopPropagation()}>
          <div style={{ padding: '48px 32px', textAlign: 'center', color: t.text }}>
            <div style={{ fontSize: '52px', marginBottom: '16px' }}>✅</div>
            <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '8px' }}>Handshake Initiated</div>
            <div style={{ fontSize: '13px', color: t.textMuted, marginBottom: '24px', lineHeight: 1.5 }}>
              An email has been sent to <strong style={{ color: t.text }}>{recipientEmail}</strong>.<br />
              The handshake will be active once they accept.
            </div>
            <button onClick={onClose} style={primaryButtonStyle(t)}>Done</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={themeOverlayStyle(t)} onClick={onClose}>
      <div style={panelStyle(t)} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={themeHeaderStyle(t)}>
          <div style={headerTitleStyle()}>
            <span style={{ fontSize: '22px', flexShrink: 0 }}>🤝</span>
            <div>
              <p style={headerMainTitleStyle()}>Initiate Handshake</p>
              <p style={headerSubtitleStyle()}>Start a secure communication channel</p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              style={closeButtonStyle(t)}
              onMouseEnter={(e) => { e.currentTarget.style.background = t.closeHoverBg; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = t.closeBg; }}
            >
              ×
            </button>
          )}
        </div>

        {/* Form */}
        <div style={bodyStyle(t)}>
          <div style={{ maxWidth: '560px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0', fontSize: '13px', cursor: 'pointer', color: t.text }}>
              <input
                type="checkbox"
                checked={isInternal}
                disabled={isSubmitting}
                onChange={(e) => {
                  const checked = e.target.checked
                  setIsInternal(checked)
                  setError(null)
                  if (!checked) setRecipientEmail('')
                }}
              />
              Internal handshake (connect my own devices)
            </label>

            {isInternal && (
              <div style={{
                background: 'rgba(83, 74, 183, 0.06)',
                borderRadius: '8px',
                padding: '10px 12px',
                marginBottom: '12px',
                fontSize: '12px',
                lineHeight: '1.5',
                color: '#536471',
              }}>
                <div style={{ fontWeight: 500, color: '#333', marginBottom: '6px' }}>
                  Connect your own devices
                </div>
                <div style={{ marginBottom: '4px' }}>
                  Internal handshakes link two of your devices under the same SSO account.
                  Set one device as <strong>Host</strong> (runs the local LLM) and the other as <strong>Sandbox</strong> (processes documents locally, uses the Host for inference).
                </div>
                <div style={{ marginBottom: '4px' }}>
                  BEAP capsules flow securely between both devices. Only extracted text is sent for inference — files and images never leave the Sandbox.
                </div>
                <div style={{ fontSize: '11px', color: '#888' }}>
                  Both devices must be logged in with the same account. Accept the handshake on the other device to complete the connection.
                </div>
              </div>
            )}

            {isInternal && (
              <div style={{ marginBottom: '0' }}>
                <label style={{ fontSize: '12px', color: t.textMuted, marginBottom: '4px', display: 'block' }}>
                  This device is:
                </label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setDeviceRole('host')}
                    disabled={isSubmitting}
                    style={{
                      flex: 1, padding: '6px', borderRadius: '6px', fontSize: '12px', cursor: isSubmitting ? 'not-allowed' : 'pointer',
                      background: deviceRole === 'host' ? '#534AB7' : 'transparent',
                      color: deviceRole === 'host' ? '#fff' : t.textMuted,
                      border: deviceRole === 'host' ? 'none' : `1px solid ${t.inputBorder}`,
                    }}
                  >Host</button>
                  <button
                    type="button"
                    onClick={() => setDeviceRole('sandbox')}
                    disabled={isSubmitting}
                    style={{
                      flex: 1, padding: '6px', borderRadius: '6px', fontSize: '12px', cursor: isSubmitting ? 'not-allowed' : 'pointer',
                      background: deviceRole === 'sandbox' ? '#534AB7' : 'transparent',
                      color: deviceRole === 'sandbox' ? '#fff' : t.textMuted,
                      border: deviceRole === 'sandbox' ? 'none' : `1px solid ${t.inputBorder}`,
                    }}
                  >Sandbox</button>
                </div>
              </div>
            )}

            <div>
              <label style={themeLabelStyle(t)}>Recipient Email</label>
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => {
                  if (!isInternal) {
                    setRecipientEmail(e.target.value)
                    setError(null)
                  }
                }}
                readOnly={isInternal}
                placeholder={isInternal ? 'Your SSO email (auto-filled)' : 'recipient@example.com'}
                disabled={isSubmitting}
                style={{
                  ...themeInputStyle(t),
                  border: `1px solid ${error ? 'rgba(239,68,68,0.5)' : t.inputBorder}`,
                  opacity: isInternal ? 0.7 : 1,
                  cursor: isInternal ? 'not-allowed' : 'text',
                  backgroundColor: isInternal
                    ? (theme === 'dark' ? 'rgba(255,255,255,0.06)' : '#f0f0f0')
                    : undefined,
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              />
            </div>

            <div style={{
              padding: '10px 14px',
              background: 'rgba(59,130,246,0.08)',
              border: '1px solid rgba(59,130,246,0.22)',
              borderRadius: '8px',
              fontSize: '12px',
              color: t.textMuted,
              lineHeight: 1.5,
              display: 'flex',
              gap: '8px',
              alignItems: 'flex-start',
            }}>
              <span style={{ flexShrink: 0, fontSize: '14px' }}>ℹ️</span>
              <span>Use the exact SSO/account email of the intended recipient — not a personal email, alias, or forwarding address. Only the account with that email can accept this handshake.</span>
            </div>

            {error && !(includeVaultProfiles && error.toLowerCase().includes('vault')) && (
              <div style={notificationStyle('error')}>✕ {error}</div>
            )}

            <div style={{
              padding: '10px 14px',
              background: 'rgba(129,140,248,0.10)',
              border: '1px solid rgba(129,140,248,0.25)',
              borderRadius: '8px',
              fontSize: '12px',
              color: t.textMuted,
              lineHeight: 1.5,
            }}>
              ℹ️ The recipient will receive an email with a handshake capsule. Once they accept, you can exchange secure BEAP messages.
            </div>

            {/* Include Vault Profiles toggle — only when HS Context Profiles available */}
            {canUseHsContextProfiles && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px',
              background: includeVaultProfiles ? 'rgba(129,140,248,0.08)' : 'transparent',
              border: `1px solid ${includeVaultProfiles ? 'rgba(129,140,248,0.30)' : t.border}`,
              borderRadius: '10px',
              transition: 'all 0.18s',
            }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: t.text }}>Add a Context Graph</div>
                <div style={{ fontSize: '11px', color: t.textMuted, marginTop: '2px' }}>
                  {includeVaultProfiles ? 'Attach structured business context from your Vault to this handshake.' : 'No context graph will be attached.'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIncludeVaultProfiles(v => !v)}
                aria-pressed={includeVaultProfiles}
                aria-label="Toggle Context Graph"
                style={{ width: '40px', height: '22px', borderRadius: '11px', border: 'none', background: includeVaultProfiles ? '#818cf8' : 'rgba(255,255,255,0.2)', cursor: 'pointer', position: 'relative', flexShrink: 0, transition: 'background 0.2s', padding: 0 }}
              >
                <span style={{ position: 'absolute', top: '3px', left: includeVaultProfiles ? '21px' : '3px', width: '16px', height: '16px', borderRadius: '50%', background: 'white', transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
              </button>
            </div>
            )}

            {/* Vault Access Required banner — only when include profiles ON + vault error */}
            {includeVaultProfiles && error && error.toLowerCase().includes('vault') && (
              <div style={{ padding: '12px 14px', background: 'rgba(239,68,68,0.12)', border: '2px solid rgba(239,68,68,0.4)', borderRadius: '8px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '18px', flexShrink: 0 }}>🔒</span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#ef4444', marginBottom: '4px' }}>Vault access required to include Vault profiles.</div>
                  <div style={{ fontSize: '11px', color: '#ef4444', lineHeight: 1.5 }}>Contextual handshakes rely on secured business data stored in your Vault.</div>
                </div>
              </div>
            )}

            {/* Context Graph — collapsible, tabbed: Vault Profiles + Ad-hoc */}
            <div style={{
              border: `1px solid ${showContextGraph ? 'rgba(129,140,248,0.45)' : 'rgba(129,140,248,0.18)'}`,
              borderRadius: '10px',
              overflow: 'hidden',
              transition: 'border-color 0.15s',
            }}>
              {/* Header toggle */}
              <button
                type="button"
                onClick={() => setShowContextGraph(v => !v)}
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: showContextGraph ? 'rgba(129,140,248,0.12)' : 'rgba(129,140,248,0.05)',
                  border: 'none',
                  color: showContextGraph ? t.text : t.textMuted,
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.15s',
                }}
              >
                <span>🧠 Context Graph</span>
                <span style={{ fontSize: '10px', opacity: 0.7 }}>{showContextGraph ? '▲ Collapse' : '▼ Expand'}</span>
              </button>

              {showContextGraph && (
                <div style={{ borderTop: `1px solid ${t.border}` }}>
                  {/* Tabs */}
                  <div style={{ display: 'flex', borderBottom: `1px solid ${t.border}` }}>
                    {(['vault', 'adhoc'] as const).map((tab) => {
                      const active = contextGraphTab === tab
                      return (
                        <button
                          key={tab}
                          type="button"
                          onClick={() => setContextGraphTab(tab)}
                          style={{
                            flex: 1,
                            padding: '8px 10px',
                            fontSize: '11px',
                            fontWeight: active ? 700 : 500,
                            background: active ? 'rgba(129,140,248,0.12)' : 'transparent',
                            border: 'none',
                            borderBottom: active ? '2px solid #818cf8' : '2px solid transparent',
                            color: active ? t.text : t.textMuted,
                            cursor: 'pointer',
                            transition: 'all 0.12s',
                          }}
                        >
                          {tab === 'vault' ? '🗂 Vault Profiles' : '✏️ Ad-hoc Context'}
                        </button>
                      )
                    })}
                  </div>

                  {/* Tab: Vault Profiles */}
                  {contextGraphTab === 'vault' && (
                    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ padding: '9px 12px', background: 'rgba(129,140,248,0.08)', borderRadius: '8px', fontSize: '11px', color: t.textMuted, lineHeight: 1.5 }}>
                        🗂 Select reusable context profiles stored in your Vault. Their content is normalized to plain text and attached to this handshake.
                      </div>
                      {canUseHsContextProfiles ? (
                        <HandshakeContextProfilePicker
                          selectedItems={selectedProfileItems}
                          onChange={setSelectedProfileItems}
                          defaultPolicy={defaultPolicy}
                          theme={theme === 'professional' ? 'standard' : 'dark'}
                          disabled={isSubmitting}
                          isVaultUnlocked={isVaultUnlocked}
                        />
                      ) : (
                        <div style={{
                          padding: '16px', textAlign: 'center',
                          border: `1px dashed ${t.border}`, borderRadius: '8px',
                          display: 'flex', flexDirection: 'column', gap: '6px',
                        }}>
                          <div style={{ fontSize: '20px' }}>🔒</div>
                          <div style={{ fontSize: '12px', fontWeight: 600, color: t.text }}>Publisher / Enterprise feature</div>
                          <div style={{ fontSize: '11px', color: t.textMuted, lineHeight: 1.5 }}>
                            Upgrade to attach structured Vault Profiles to your handshakes — including business identity, custom fields, and confidential documents.
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tab: Ad-hoc Context */}
                  {contextGraphTab === 'adhoc' && (
                    <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      <div style={{ padding: '9px 12px', background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.18)', borderRadius: '8px', fontSize: '11px', color: t.textMuted, lineHeight: 1.5 }}>
                        ℹ️ Ad-hoc context is normalized to plain text before sending. JSON is rendered as Key: Value lines.
                      </div>
                      <div>
                        <label style={themeLabelStyle(t)}>Format</label>
                        <select
                          value={contextGraphType}
                          onChange={(e) => setContextGraphType(e.target.value as 'text' | 'json')}
                          disabled={isSubmitting}
                          style={themeInputStyle(t)}
                        >
                          <option value="text">📝 Plain Text</option>
                          <option value="json">📦 JSON / Structured Data</option>
                        </select>
                      </div>
                      <div>
                        <label style={themeLabelStyle(t)}>
                          {contextGraphType === 'json' ? 'JSON Payload' : 'Context Content'}
                        </label>
                        <textarea
                          value={contextGraphText}
                          onChange={(e) => setContextGraphText(e.target.value)}
                          disabled={isSubmitting}
                          placeholder={
                            contextGraphType === 'json'
                              ? '{"key": "value", ...}'
                              : 'Enter context information to share with the recipient...'
                          }
                          rows={4}
                          style={{
                            ...themeInputStyle(t),
                            resize: 'vertical',
                            lineHeight: 1.5,
                            fontFamily: contextGraphType === 'json' ? 'monospace' : 'inherit',
                          }}
                        />
                      </div>
                      <div style={{ padding: '8px 12px', background: 'rgba(139,92,246,0.06)', borderRadius: '8px', border: `1px solid ${t.border}` }}>
                        <div style={{ fontSize: '10px', fontWeight: 600, color: t.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          Policy for this ad-hoc context
                        </div>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '6px' }}>
                          <button
                            type="button"
                            onClick={() => setAdhocBlockPolicy({ policy_mode: 'inherit' })}
                            disabled={isSubmitting}
                            style={{
                              padding: '4px 10px',
                              fontSize: '11px',
                              background: adhocBlockPolicy.policy_mode === 'inherit' ? 'rgba(139,92,246,0.2)' : 'transparent',
                              border: `1px solid ${adhocBlockPolicy.policy_mode === 'inherit' ? '#8b5cf6' : t.border}`,
                              borderRadius: '6px',
                              color: adhocBlockPolicy.policy_mode === 'inherit' ? '#5b21b6' : t.textMuted,
                              cursor: isSubmitting ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Use default
                          </button>
                          <button
                            type="button"
                            onClick={() => setAdhocBlockPolicy({ policy_mode: 'override', policy: { ai_processing_mode: defaultPolicy.ai_processing_mode } })}
                            disabled={isSubmitting}
                            style={{
                              padding: '4px 10px',
                              fontSize: '11px',
                              background: adhocBlockPolicy.policy_mode === 'override' ? 'rgba(139,92,246,0.2)' : 'transparent',
                              border: `1px solid ${adhocBlockPolicy.policy_mode === 'override' ? '#8b5cf6' : t.border}`,
                              borderRadius: '6px',
                              color: adhocBlockPolicy.policy_mode === 'override' ? '#5b21b6' : t.textMuted,
                              cursor: isSubmitting ? 'not-allowed' : 'pointer',
                            }}
                          >
                            Override
                          </button>
                        </div>
                        {adhocBlockPolicy.policy_mode === 'override' && adhocBlockPolicy.policy && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {(['none', 'local_only', 'internal_and_cloud'] as const).map((m) => (
                              <label key={m} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', cursor: isSubmitting ? 'default' : 'pointer', color: t.text }}>
                                <input
                                  type="radio"
                                  name="adhoc-ai-policy-init"
                                  checked={(adhocBlockPolicy.policy.ai_processing_mode ?? 'local_only') === m}
                                  disabled={isSubmitting}
                                  onChange={() => setAdhocBlockPolicy({ ...adhocBlockPolicy, policy: { ai_processing_mode: m } })}
                                  style={{ accentColor: '#8b5cf6' }}
                                />
                                <span>{m === 'none' ? 'No AI processing' : m === 'local_only' ? 'Internal AI only' : 'Allow Internal + Cloud AI'}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', paddingTop: '4px' }}>
              <button onClick={onClose} disabled={isSubmitting} style={secondaryButtonStyle(t, isSubmitting)}>
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={isSubmitting}
                style={{
                  padding: '11px 20px',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  border: 'none',
                  borderRadius: '9px',
                  color: 'white',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: isSubmitting ? 'wait' : 'pointer',
                  opacity: isSubmitting ? 0.6 : 1,
                  transition: 'all 0.18s',
                  boxShadow: '0 4px 14px rgba(59,130,246,0.3)',
                }}
              >
                {isSubmitting ? 'Sending...' : '📧 Send Handshake Request'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}


export default InitiateHandshakeDialog
