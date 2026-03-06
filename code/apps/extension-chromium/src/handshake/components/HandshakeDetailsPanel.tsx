/**
 * HandshakeDetailsPanel Component
 *
 * Shows detailed handshake info from the backend HandshakeRecord.
 * Groups handshakes by state (Active / Pending / Revoked).
 * Actions per state:
 *   - PENDING_ACCEPT (acceptor): Accept / Decline
 *   - ACTIVE: Send Message / Revoke
 *   - REVOKED/EXPIRED: View only + Delete
 */

import React from 'react'
import type { HandshakeRecord, HandshakeState } from '../rpcTypes'

interface HandshakeDetailsPanelProps {
  handshake: HandshakeRecord
  theme?: 'default' | 'dark' | 'professional'
  onSendMessage?: (handshakeId: string) => void
  onAccept?: (handshakeId: string) => void
  onRevoke?: (handshakeId: string) => void
  onDelete?: (handshakeId: string) => void
  onClose?: () => void
}

const STATE_CONFIG: Record<HandshakeState, { label: string; color: string; bg: string }> = {
  PENDING_ACCEPT: { label: 'Pending', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  ACTIVE: { label: 'Active', color: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  REVOKED: { label: 'Revoked', color: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
  EXPIRED: { label: 'Expired', color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
}

export const HandshakeDetailsPanel: React.FC<HandshakeDetailsPanelProps> = ({
  handshake,
  theme = 'default',
  onSendMessage,
  onAccept,
  onRevoke,
  onClose,
}) => {
  const isProfessional = theme === 'professional'
  const stateInfo = STATE_CONFIG[handshake.state] ?? STATE_CONFIG.EXPIRED

  const panelStyle: React.CSSProperties = {
    background: isProfessional ? '#ffffff' : 'rgba(30, 30, 40, 0.95)',
    borderRadius: '12px',
    border: `1px solid ${isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`,
    overflow: 'hidden',
  }

  const headerStyle: React.CSSProperties = {
    padding: '16px',
    borderBottom: `1px solid ${isProfessional ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  }

  const sectionStyle: React.CSSProperties = {
    padding: '16px',
    borderBottom: `1px solid ${isProfessional ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)'}`,
  }

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 600,
    color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
    marginBottom: '8px',
  }

  const buttonStyle: React.CSSProperties = {
    padding: '8px 14px',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: 500,
    cursor: 'pointer',
    border: 'none',
    transition: 'all 0.15s ease',
  }

  const isAcceptor = handshake.local_role === 'acceptor'

  return (
    <div style={panelStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div>
          <div style={{ fontSize: '16px', fontWeight: 600, color: isProfessional ? '#1f2937' : 'white' }}>
            {handshake.counterparty_email}
          </div>
          <div style={{ fontSize: '12px', color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)', marginTop: '2px' }}>
            {handshake.local_role === 'initiator' ? 'You initiated' : 'They initiated'}
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            style={{ ...buttonStyle, background: 'transparent', color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.5)', padding: '4px 8px' }}
          >
            ✕
          </button>
        )}
      </div>

      {/* State */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Status</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '11px',
              fontWeight: 600,
              padding: '6px 12px',
              borderRadius: '6px',
              background: stateInfo.bg,
              color: stateInfo.color,
              border: `1px solid ${stateInfo.color}33`,
            }}
          >
            {handshake.state === 'ACTIVE' ? '✓' : '○'} {stateInfo.label}
          </span>
          {handshake.activated_at && (
            <span style={{ fontSize: '11px', color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.5)' }}>
              {new Date(handshake.activated_at).toLocaleDateString()}
            </span>
          )}
        </div>
      </div>

      {/* Details */}
      <div style={sectionStyle}>
        <div style={labelStyle}>Details</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <DetailRow label="Handshake ID" value={handshake.handshake_id.slice(0, 16) + '...'} isPro={isProfessional} />
          <DetailRow label="Relationship" value={handshake.relationship_id.slice(0, 16) + '...'} isPro={isProfessional} />
          <DetailRow label="Role" value={handshake.local_role} isPro={isProfessional} />
          {handshake.sharing_mode && (
            <DetailRow
              label="Sharing Mode"
              value={handshake.sharing_mode === 'reciprocal' ? 'Reciprocal' : 'Receive-only'}
              isPro={isProfessional}
            />
          )}
          <DetailRow label="Created" value={new Date(handshake.created_at).toLocaleString()} isPro={isProfessional} />
        </div>
      </div>

      {/* Actions */}
      <div style={{ padding: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {handshake.state === 'PENDING_ACCEPT' && isAcceptor && onAccept && (
          <button
            onClick={() => onAccept(handshake.handshake_id)}
            style={{ ...buttonStyle, background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', color: 'white' }}
          >
            ✓ Accept
          </button>
        )}
        {handshake.state === 'ACTIVE' && onSendMessage && (
          <button
            onClick={() => onSendMessage(handshake.handshake_id)}
            style={{ ...buttonStyle, background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', color: 'white' }}
          >
            📤 Send Message
          </button>
        )}
        {handshake.state === 'ACTIVE' && onRevoke && (
          <button
            onClick={() => onRevoke(handshake.handshake_id)}
            style={{ ...buttonStyle, background: 'transparent', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}
          >
            Revoke
          </button>
        )}
        {(handshake.state === 'REVOKED' || handshake.state === 'EXPIRED') && onDelete && (
          <button
            onClick={() => onDelete(handshake.handshake_id)}
            style={{ ...buttonStyle, background: 'transparent', border: '1px solid rgba(107,114,128,0.3)', color: '#94a3b8' }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

const DetailRow: React.FC<{ label: string; value: string; isPro: boolean }> = ({ label, value, isPro }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <span style={{ fontSize: '11px', color: isPro ? '#9ca3af' : 'rgba(255,255,255,0.4)' }}>{label}</span>
    <span
      style={{
        fontSize: '12px',
        color: isPro ? '#1f2937' : 'white',
        fontFamily: 'monospace',
        background: isPro ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
        padding: '2px 6px',
        borderRadius: '4px',
      }}
    >
      {value}
    </span>
  </div>
)

export default HandshakeDetailsPanel
