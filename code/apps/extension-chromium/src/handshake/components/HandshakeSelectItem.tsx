/**
 * HandshakeSelectItem Component
 * 
 * Compact display for handshake in selectbox/list:
 * - Name
 * - Short fingerprint
 * - Status badge (Local/Verified)
 * - Automation mode indicator
 */

import React from 'react'
import type { Handshake, AutomationMode } from '../types'
import { BADGE_TEXT, AUTOMATION_LABELS } from '../microcopy'

interface HandshakeSelectItemProps {
  handshake: Handshake
  theme?: 'default' | 'dark' | 'professional'
  compact?: boolean
  selected?: boolean
  onClick?: () => void
}

// Automation mode icons
const AUTOMATION_ICONS: Record<AutomationMode, string> = {
  DENY: '🚫',
  REVIEW: '👁️',
  ALLOW: '✓',
}

// Automation mode colors
const AUTOMATION_COLORS: Record<AutomationMode, string> = {
  DENY: '#ef4444',
  REVIEW: '#f59e0b',
  ALLOW: '#22c55e',
}

export const HandshakeSelectItem: React.FC<HandshakeSelectItemProps> = ({
  handshake,
  theme = 'default',
  compact = false,
  selected = false,
  onClick,
}) => {
  const isProfessional = theme === 'professional'
  
  const containerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: compact ? '8px' : '12px',
    padding: compact ? '6px 10px' : '10px 14px',
    borderRadius: '8px',
    cursor: onClick ? 'pointer' : 'default',
    background: selected 
      ? (isProfessional ? 'rgba(139, 92, 246, 0.1)' : 'rgba(139, 92, 246, 0.2)')
      : 'transparent',
    border: selected 
      ? `1px solid ${isProfessional ? 'rgba(139, 92, 246, 0.3)' : 'rgba(139, 92, 246, 0.4)'}`
      : '1px solid transparent',
    transition: 'all 0.15s ease',
  }
  
  const nameStyle: React.CSSProperties = {
    fontSize: compact ? '12px' : '13px',
    fontWeight: 600,
    color: isProfessional ? '#1f2937' : 'white',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  }
  
  const fingerprintStyle: React.CSSProperties = {
    fontSize: compact ? '10px' : '11px',
    fontFamily: 'monospace',
    color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)',
    background: isProfessional ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.1)',
    padding: '2px 6px',
    borderRadius: '4px',
  }
  
  const badgeStyle: React.CSSProperties = {
    fontSize: '9px',
    fontWeight: 600,
    padding: '2px 6px',
    borderRadius: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    background: handshake.status === 'VERIFIED_WR' 
      ? (isProfessional ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.2)')
      : (isProfessional ? 'rgba(107, 114, 128, 0.1)' : 'rgba(255, 255, 255, 0.1)'),
    color: handshake.status === 'VERIFIED_WR'
      ? '#22c55e'
      : (isProfessional ? '#6b7280' : 'rgba(255,255,255,0.6)'),
    border: `1px solid ${handshake.status === 'VERIFIED_WR' ? 'rgba(34, 197, 94, 0.3)' : 'transparent'}`,
  }
  
  const automationStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    fontSize: '10px',
    color: AUTOMATION_COLORS[handshake.automation_mode],
  }
  
  return (
    <div 
      style={containerStyle}
      onClick={onClick}
      onMouseEnter={(e) => {
        if (onClick && !selected) {
          e.currentTarget.style.background = isProfessional 
            ? 'rgba(0,0,0,0.03)' 
            : 'rgba(255,255,255,0.05)'
        }
      }}
      onMouseLeave={(e) => {
        if (onClick && !selected) {
          e.currentTarget.style.background = 'transparent'
        }
      }}
    >
      {/* Name */}
      <span style={nameStyle}>{handshake.displayName}</span>
      
      {/* Fingerprint (short) */}
      <span style={fingerprintStyle} title={`Fingerprint: ${handshake.fingerprint_full}`}>
        {handshake.fingerprint_short}
      </span>
      
      {/* Status Badge */}
      {!compact && (
        <span style={badgeStyle}>
          {handshake.status === 'VERIFIED_WR' ? BADGE_TEXT.VERIFIED : BADGE_TEXT.LOCAL}
        </span>
      )}
      
      {/* Automation Mode */}
      <span style={automationStyle} title={`Automation: ${AUTOMATION_LABELS[handshake.automation_mode]}`}>
        <span>{AUTOMATION_ICONS[handshake.automation_mode]}</span>
        {!compact && <span>{AUTOMATION_LABELS[handshake.automation_mode]}</span>}
      </span>
    </div>
  )
}

export default HandshakeSelectItem


