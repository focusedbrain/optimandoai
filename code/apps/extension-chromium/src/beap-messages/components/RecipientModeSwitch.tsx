/**
 * RecipientModeSwitch Component
 * 
 * Toggle between PRIVATE (qBEAP) and PUBLIC (pBEAP) distribution modes.
 * 
 * PRIVATE (qBEAP): Handshake-derived, receiver identity bound
 * PUBLIC (pBEAP): No handshake required, publicly distributable, auditable
 */

import React from 'react'

export type RecipientMode = 'private' | 'public'

// Re-export SelectedRecipient from RecipientHandshakeSelect for convenience
export type { SelectedRecipient } from './RecipientHandshakeSelect'

export interface RecipientModeSwitchProps {
  mode: RecipientMode
  onModeChange: (mode: RecipientMode) => void
  theme: 'standard' | 'hacker' | 'pro'
  disabled?: boolean
}

export const RecipientModeSwitch: React.FC<RecipientModeSwitchProps> = ({
  mode,
  onModeChange,
  theme,
  disabled = false
}) => {
  const isStandard = theme === 'standard'
  const textColor = isStandard ? '#0f172a' : 'white'
  const mutedColor = isStandard ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isStandard ? 'rgba(147, 51, 234, 0.2)' : 'rgba(255,255,255,0.2)'
  
  const privateActive = mode === 'private'
  const publicActive = mode === 'public'

  const buttonStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '10px 16px',
    border: 'none',
    borderRadius: active ? '6px' : '6px',
    background: active 
      ? (isStandard 
          ? 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)' 
          : 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)')
      : 'transparent',
    color: active ? 'white' : mutedColor,
    fontSize: '12px',
    fontWeight: active ? 600 : 500,
    cursor: disabled ? 'not-allowed' : 'pointer',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '4px',
    transition: 'all 0.2s ease',
    opacity: disabled ? 0.5 : 1
  })

  return (
    <div style={{ marginBottom: '12px' }}>
      <label style={{
        fontSize: '11px',
        fontWeight: 600,
        marginBottom: '8px',
        display: 'block',
        color: mutedColor,
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
      }}>
        Distribution Mode
      </label>
      
      <div style={{
        display: 'flex',
        gap: '4px',
        padding: '4px',
        background: isStandard ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.05)',
        borderRadius: '8px',
        border: `1px solid ${borderColor}`
      }}>
        {/* PRIVATE / qBEAP Mode */}
        <button
          onClick={() => !disabled && onModeChange('private')}
          style={buttonStyle(privateActive)}
          disabled={disabled}
          title="Private distribution with handshake-verified recipient (qBEAP)"
        >
          <span style={{ fontSize: '16px' }}>🔐</span>
          <span>PRIVATE</span>
          <span style={{ 
            fontSize: '9px', 
            opacity: 0.8,
            fontWeight: 400 
          }}>
            qBEAP · Handshake Required
          </span>
        </button>

        {/* PUBLIC / pBEAP Mode */}
        <button
          onClick={() => !disabled && onModeChange('public')}
          style={buttonStyle(publicActive)}
          disabled={disabled}
          title="Public distribution without recipient binding (pBEAP)"
        >
          <span style={{ fontSize: '16px' }}>🌐</span>
          <span>PUBLIC</span>
          <span style={{ 
            fontSize: '9px', 
            opacity: 0.8,
            fontWeight: 400 
          }}>
            pBEAP · Auditable
          </span>
        </button>
      </div>

      {/* Mode Description */}
      <div style={{
        marginTop: '8px',
        padding: '8px 10px',
        background: isStandard 
          ? (privateActive ? 'rgba(59,130,246,0.08)' : 'rgba(34,197,94,0.08)')
          : (privateActive ? 'rgba(139,92,246,0.15)' : 'rgba(34,197,94,0.15)'),
        borderRadius: '6px',
        fontSize: '11px',
        color: isStandard ? '#475569' : 'rgba(255,255,255,0.8)',
        lineHeight: '1.4'
      }}>
        {privateActive ? (
          <>
            <strong style={{ color: isStandard ? '#3b82f6' : '#a78bfa' }}>🔐 Private Mode:</strong>{' '}
            Message is encrypted for a specific verified handshake recipient. 
            Receiver identity is cryptographically bound.
          </>
        ) : (
          <>
            <strong style={{ color: isStandard ? '#22c55e' : '#86efac' }}>🌐 Public Mode:</strong>{' '}
            Message is publicly distributable without recipient binding. 
            No encryption, fully auditable package.
          </>
        )}
      </div>
    </div>
  )
}

export default RecipientModeSwitch

