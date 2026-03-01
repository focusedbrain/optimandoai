/**
 * HandshakeAcceptModal Component
 *
 * Modal for accepting an incoming handshake request.
 * Calls handshake.accept RPC — all crypto and capsule building
 * is handled by the backend pipeline.
 *
 * Sharing-mode selection:
 *   - receive-only: user receives context but does not share back
 *   - reciprocal:   both parties exchange context
 */

import React, { useState } from 'react'
import type { HandshakeRecord } from '../rpcTypes'
import { acceptHandshake, revokeHandshake } from '../handshakeRpc'

type SharingMode = 'receive-only' | 'reciprocal'

interface HandshakeAcceptModalProps {
  handshake: HandshakeRecord
  fromAccountId: string
  theme?: 'default' | 'dark' | 'professional'
  onAccepted?: (handshakeId: string) => void
  onDeclined?: (handshakeId: string) => void
  onClose?: () => void
}

export const HandshakeAcceptModal: React.FC<HandshakeAcceptModalProps> = ({
  handshake,
  fromAccountId,
  theme = 'default',
  onAccepted,
  onDeclined,
  onClose,
}) => {
  const [sharingMode, setSharingMode] = useState<SharingMode>('receive-only')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isProfessional = theme === 'professional'

  const handleAccept = async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      await acceptHandshake(handshake.handshake_id, sharingMode, fromAccountId)
      onAccepted?.(handshake.handshake_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Accept failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDecline = async () => {
    setIsSubmitting(true)
    setError(null)
    try {
      await revokeHandshake(handshake.handshake_id)
      onDeclined?.(handshake.handshake_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Decline failed')
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
    maxWidth: '480px',
    width: '100%',
    maxHeight: '90vh',
    overflow: 'auto',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
  }

  const headerStyle: React.CSSProperties = {
    padding: '20px 24px',
    borderBottom: `1px solid ${isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  }

  const sectionStyle: React.CSSProperties = {
    padding: '20px 24px',
    borderBottom: `1px solid ${isProfessional ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'}`,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '10px',
  }

  const buttonStyle: React.CSSProperties = {
    padding: '10px 18px',
    borderRadius: '8px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: isSubmitting ? 'wait' : 'pointer',
    border: 'none',
    transition: 'all 0.15s ease',
  }

  const sharingButtonStyle = (mode: SharingMode, isActive: boolean): React.CSSProperties => {
    const colors = {
      'receive-only': { bg: 'rgba(59,130,246,0.1)', border: 'rgba(59,130,246,0.3)', text: '#3b82f6' },
      reciprocal: { bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.3)', text: '#22c55e' },
    }
    const c = colors[mode]
    return {
      flex: 1,
      padding: '10px 12px',
      borderRadius: '8px',
      fontSize: '12px',
      cursor: 'pointer',
      background: isActive ? c.bg : 'transparent',
      border: `1px solid ${isActive ? c.border : (isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)')}`,
      color: isActive ? c.text : (isProfessional ? '#6b7280' : 'rgba(255,255,255,0.5)'),
      fontWeight: isActive ? 600 : 400,
      transition: 'all 0.15s ease',
    }
  }

  const SHARING_DESCRIPTIONS: Record<SharingMode, string> = {
    'receive-only': 'You receive context blocks from the counterparty but do not share back.',
    reciprocal: 'Both parties can exchange context blocks bidirectionally.',
  }

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <span style={{ fontSize: '28px' }}>🤝</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '18px', fontWeight: 600, color: isProfessional ? '#1f2937' : 'white' }}>
              Incoming Handshake Request
            </div>
            <div style={{ fontSize: '12px', color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)', marginTop: '2px' }}>
              from {handshake.counterparty_email}
            </div>
          </div>
        </div>

        {/* Sender Info */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Sender</div>
          <div style={{ fontSize: '14px', fontWeight: 600, color: isProfessional ? '#1f2937' : 'white' }}>
            {handshake.counterparty_email}
          </div>
          <div style={{ fontSize: '12px', color: isProfessional ? '#9ca3af' : 'rgba(255,255,255,0.4)', marginTop: '4px' }}>
            Handshake ID: {handshake.handshake_id.slice(0, 12)}...
          </div>
          <div style={{ fontSize: '12px', color: isProfessional ? '#9ca3af' : 'rgba(255,255,255,0.4)', marginTop: '2px' }}>
            Requested: {new Date(handshake.created_at).toLocaleDateString()}
          </div>
        </div>

        {/* Sharing Mode Selection */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Sharing Mode</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {(['receive-only', 'reciprocal'] as SharingMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setSharingMode(mode)}
                style={sharingButtonStyle(mode, sharingMode === mode)}
              >
                {mode === 'receive-only' ? 'Receive Only' : 'Reciprocal'}
              </button>
            ))}
          </div>
          <div
            style={{
              marginTop: '10px',
              fontSize: '11px',
              color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.5)',
              lineHeight: 1.5,
            }}
          >
            {SHARING_DESCRIPTIONS[sharingMode]}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: '12px 24px',
              background: 'rgba(239,68,68,0.1)',
              color: '#ef4444',
              fontSize: '12px',
            }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ padding: '20px 24px', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            onClick={handleDecline}
            disabled={isSubmitting}
            style={{
              ...buttonStyle,
              background: 'transparent',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#ef4444',
              opacity: isSubmitting ? 0.5 : 1,
            }}
          >
            Decline
          </button>
          <button
            onClick={handleAccept}
            disabled={isSubmitting}
            style={{
              ...buttonStyle,
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              color: 'white',
              opacity: isSubmitting ? 0.5 : 1,
            }}
          >
            {isSubmitting ? 'Processing...' : '✓ Accept Handshake'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default HandshakeAcceptModal
