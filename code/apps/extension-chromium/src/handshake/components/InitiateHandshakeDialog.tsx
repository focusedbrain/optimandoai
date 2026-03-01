/**
 * InitiateHandshakeDialog Component
 *
 * Dialog for initiating a new handshake with a recipient.
 * Calls handshake.initiate RPC — the backend handles capsule building
 * and email transport.
 */

import React, { useState } from 'react'
import { initiateHandshake } from '../handshakeRpc'
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
}

export const InitiateHandshakeDialog: React.FC<InitiateHandshakeDialogProps> = ({
  fromAccountId,
  theme = 'default',
  onInitiated,
  onClose,
}) => {
  const [recipientEmail, setRecipientEmail] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

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
      const result = await initiateHandshake(receiverUserId, recipientEmail.trim(), fromAccountId)
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

            {error && (
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
