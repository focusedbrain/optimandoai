/**
 * InitiateHandshakeDialog Component
 *
 * Dialog for initiating a new handshake with a recipient.
 * Calls handshake.initiate RPC — the backend handles capsule building
 * and email transport.
 */

import React, { useState } from 'react'
import { initiateHandshake } from '../handshakeRpc'
import { HandshakeContextProfilePicker } from './HandshakeContextProfilePicker'
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

interface InitiateHandshakeDialogProps {
  fromAccountId: string
  theme?: 'default' | 'dark' | 'professional'
  onInitiated?: (handshakeId: string) => void
  onClose?: () => void
  /** Whether the current user has Publisher/Enterprise tier. */
  canUseHsContextProfiles?: boolean
}

export const InitiateHandshakeDialog: React.FC<InitiateHandshakeDialogProps> = ({
  fromAccountId,
  theme = 'default',
  onInitiated,
  onClose,
  canUseHsContextProfiles = false,
}) => {
  const [recipientEmail, setRecipientEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Contextual Handshakes — enabled by default
  const [contextualHandshakes, setContextualHandshakes] = useState(true)

  // Context Graph (optional — attached to handshake.initiate RPC)
  const [showContextGraph, setShowContextGraph] = useState(false)
  const [contextGraphTab, setContextGraphTab] = useState<'vault' | 'adhoc'>('vault')
  const [contextGraphText, setContextGraphText] = useState('')
  const [contextGraphType, setContextGraphType] = useState<'text' | 'json'>('text')

  // HS Context Profiles (publisher+ only)
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([])

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
      const result = await initiateHandshake(
        receiverUserId,
        recipientEmail.trim(),
        fromAccountId,
        { skipVaultContext: !contextualHandshakes },
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
            <div>
              <label style={themeLabelStyle(t)}>Recipient Email</label>
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => { setRecipientEmail(e.target.value); setError(null); }}
                placeholder="recipient@example.com"
                disabled={isSubmitting}
                style={{
                  ...themeInputStyle(t),
                  border: `1px solid ${error ? 'rgba(239,68,68,0.5)' : t.inputBorder}`,
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); }}
              />
            </div>

            {error && !(contextualHandshakes && error.toLowerCase().includes('vault')) && (
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

            {/* Contextual Handshakes toggle */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 14px',
              background: contextualHandshakes ? 'rgba(129,140,248,0.08)' : 'transparent',
              border: `1px solid ${contextualHandshakes ? 'rgba(129,140,248,0.30)' : t.border}`,
              borderRadius: '10px',
              transition: 'all 0.18s',
            }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: 700, color: t.text }}>🧠 Contextual Handshakes</div>
                <div style={{ fontSize: '11px', color: t.textMuted, marginTop: '2px' }}>
                  {contextualHandshakes ? 'Includes secured business data from your Vault.' : 'Basic mode — no Vault data required.'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setContextualHandshakes(v => !v)}
                aria-pressed={contextualHandshakes}
                aria-label="Toggle Contextual Handshakes"
                style={{ width: '40px', height: '22px', borderRadius: '11px', border: 'none', background: contextualHandshakes ? '#818cf8' : 'rgba(255,255,255,0.2)', cursor: 'pointer', position: 'relative', flexShrink: 0, transition: 'background 0.2s', padding: 0 }}
              >
                <span style={{ position: 'absolute', top: '3px', left: contextualHandshakes ? '21px' : '3px', width: '16px', height: '16px', borderRadius: '50%', background: 'white', transition: 'left 0.18s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
              </button>
            </div>

            {/* Vault Access Required banner — only when contextual ON + vault locked (RPC will fail) */}
            {contextualHandshakes && error && error.toLowerCase().includes('vault') && (
              <div style={{ padding: '12px 14px', background: 'rgba(239,68,68,0.12)', border: '2px solid rgba(239,68,68,0.4)', borderRadius: '8px', display: 'flex', gap: '10px', alignItems: 'flex-start' }}>
                <span style={{ fontSize: '18px', flexShrink: 0 }}>🔒</span>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: '#ef4444', marginBottom: '4px' }}>Vault Access Required for Contextual Handshakes.</div>
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
                          selectedIds={selectedProfileIds}
                          onChange={setSelectedProfileIds}
                          theme={theme === 'professional' ? 'standard' : 'dark'}
                          disabled={isSubmitting}
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
                    </div>
                  )}
                </div>
              )}
            </div>

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
  )
}

export default InitiateHandshakeDialog
