/**
 * PackageHeaderMeta Component
 * 
 * Display handshake/fingerprint info on packages:
 * "Handshake: <name> — fp: <short> — <status>"
 */

import React from 'react'
import type { PackageHandshakeMapping } from '../types'
import { BADGE_TEXT } from '../microcopy'

interface PackageHeaderMetaProps {
  mapping: PackageHandshakeMapping
  theme?: 'default' | 'dark' | 'professional'
  compact?: boolean
}

export const PackageHeaderMeta: React.FC<PackageHeaderMetaProps> = ({
  mapping,
  theme = 'default',
  compact = false,
}) => {
  const isProfessional = theme === 'professional'
  
  // No handshake mapping - show unknown sender
  if (!mapping.handshake_id) {
    return (
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: compact ? '10px' : '11px',
        color: isProfessional ? '#9ca3af' : 'rgba(255,255,255,0.5)',
        padding: compact ? '3px 8px' : '4px 10px',
        background: isProfessional ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
        borderRadius: '6px',
      }}>
        <span>👤</span>
        <span>Unknown Sender</span>
      </div>
    )
  }
  
  const containerStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: compact ? '6px' : '8px',
    fontSize: compact ? '10px' : '11px',
    color: isProfessional ? '#6b7280' : 'rgba(255,255,255,0.7)',
    padding: compact ? '3px 8px' : '4px 10px',
    background: isProfessional ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.05)',
    borderRadius: '6px',
    flexWrap: 'wrap',
  }
  
  const nameStyle: React.CSSProperties = {
    fontWeight: 600,
    color: isProfessional ? '#1f2937' : 'white',
  }
  
  const fingerprintStyle: React.CSSProperties = {
    fontFamily: 'monospace',
    fontSize: compact ? '9px' : '10px',
    color: isProfessional ? '#9ca3af' : 'rgba(255,255,255,0.5)',
    background: isProfessional ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)',
    padding: '1px 4px',
    borderRadius: '3px',
  }
  
  const statusStyle: React.CSSProperties = {
    fontSize: compact ? '8px' : '9px',
    fontWeight: 600,
    padding: '1px 5px',
    borderRadius: '3px',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
    background: mapping.handshake_status === 'VERIFIED_WR' 
      ? 'rgba(34, 197, 94, 0.1)' 
      : 'transparent',
    color: mapping.handshake_status === 'VERIFIED_WR'
      ? '#22c55e'
      : (isProfessional ? '#9ca3af' : 'rgba(255,255,255,0.4)'),
  }
  
  return (
    <div style={containerStyle}>
      <span>🤝</span>
      <span>Handshake:</span>
      <span style={nameStyle}>{mapping.handshake_name}</span>
      
      {!compact && <span style={{ opacity: 0.5 }}>—</span>}
      
      <span>fp:</span>
      <span style={fingerprintStyle}>{mapping.fingerprint_short}</span>
      
      {!compact && (
        <>
          <span style={{ opacity: 0.5 }}>—</span>
          <span style={statusStyle}>
            {mapping.handshake_status === 'VERIFIED_WR' 
              ? BADGE_TEXT.VERIFIED 
              : BADGE_TEXT.LOCAL}
          </span>
        </>
      )}
    </div>
  )
}

export default PackageHeaderMeta


