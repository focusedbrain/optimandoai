/**
 * InitiateHandshakeDialog Component
 *
 * Dialog for initiating a new handshake with a recipient.
 * Calls handshake.initiate RPC — the backend handles capsule building
 * and email transport.
 */

import React, { useState } from 'react'
import { initiateHandshake } from '../handshakeRpc'

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

  const isProfessional = theme === 'professional'

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

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10000,
    padding: '20px',
  }

  const modalStyle: React.CSSProperties = {
    background: isProfessional ? '#ffffff' : 'rgba(30, 30, 40, 0.98)',
    borderRadius: '16px',
    border: `1px solid ${isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`,
    maxWidth: '440px',
    width: '100%',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  }

  const buttonStyle: React.CSSProperties = {
    padding: '10px 18px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: isSubmitting ? 'wait' : 'pointer',
    border: 'none',
    transition: 'all 0.15s ease',
    opacity: isSubmitting ? 0.5 : 1,
  }

  if (success) {
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
          <div style={{ padding: '32px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>✅</div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: isProfessional ? '#1f2937' : 'white', marginBottom: '8px' }}>
              Handshake Initiated
            </div>
            <div style={{ fontSize: '13px', color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)', marginBottom: '20px' }}>
              An email has been sent to <strong>{recipientEmail}</strong>. The handshake will be active once they accept.
            </div>
            <button onClick={onClose} style={{ ...buttonStyle, background: '#3b82f6', color: 'white' }}>
              Done
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div
          style={{
            padding: '20px 24px',
            borderBottom: `1px solid ${isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <span style={{ fontSize: '28px' }}>🤝</span>
          <div>
            <div style={{ fontSize: '18px', fontWeight: 600, color: isProfessional ? '#1f2937' : 'white' }}>
              Initiate Handshake
            </div>
            <div style={{ fontSize: '12px', color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)', marginTop: '2px' }}>
              Start a secure communication channel
            </div>
          </div>
        </div>

        {/* Form */}
        <div style={{ padding: '20px 24px' }}>
          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '8px',
                display: 'block',
              }}
            >
              Recipient Email
            </label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => {
                setRecipientEmail(e.target.value)
                setError(null)
              }}
              placeholder="recipient@example.com"
              disabled={isSubmitting}
              style={{
                width: '100%',
                padding: '10px 12px',
                background: isProfessional ? 'white' : 'rgba(255,255,255,0.08)',
                border: `1px solid ${error ? 'rgba(239,68,68,0.5)' : (isProfessional ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)')}`,
                borderRadius: '8px',
                fontSize: '13px',
                color: isProfessional ? '#1f2937' : 'white',
                boxSizing: 'border-box',
                outline: 'none',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit()
              }}
            />
          </div>

          {error && (
            <div
              style={{
                padding: '10px 12px',
                background: 'rgba(239,68,68,0.1)',
                borderRadius: '6px',
                color: '#ef4444',
                fontSize: '12px',
                marginBottom: '16px',
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              padding: '10px 12px',
              background: isProfessional ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.1)',
              borderRadius: '6px',
              fontSize: '11px',
              color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.7)',
              lineHeight: 1.5,
            }}
          >
            The recipient will receive an email with a handshake capsule. Once they accept, you can exchange secure BEAP messages.
          </div>
        </div>

        {/* Actions */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: `1px solid ${isProfessional ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'}`,
            display: 'flex',
            gap: '12px',
            justifyContent: 'flex-end',
          }}
        >
          <button
            onClick={onClose}
            disabled={isSubmitting}
            style={{
              ...buttonStyle,
              background: 'transparent',
              border: `1px solid ${isProfessional ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)'}`,
              color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            style={{
              ...buttonStyle,
              background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              color: 'white',
            }}
          >
            {isSubmitting ? 'Sending...' : '📧 Send Handshake Request'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default InitiateHandshakeDialog
