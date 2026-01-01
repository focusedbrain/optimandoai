/**
 * BeapMessageRow Component
 * 
 * Renders a single BEAP message in a list view.
 * Shows title, fingerprint, delivery method, direction, timestamp, and status.
 * 
 * @version 1.0.0
 */

import React from 'react'
import type { BeapMessageUI } from '../types'
import { STATUS_CONFIG, DELIVERY_METHOD_CONFIG } from '../types'

interface BeapMessageRowProps {
  message: BeapMessageUI
  isSelected: boolean
  theme: 'default' | 'dark' | 'professional'
  onClick: (id: string) => void
}

export const BeapMessageRow: React.FC<BeapMessageRowProps> = ({
  message,
  isSelected,
  theme,
  onClick
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.08)' : 'rgba(255,255,255,0.08)'
  const selectedBg = isProfessional ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.15)'
  const hoverBg = isProfessional ? 'rgba(139,92,246,0.04)' : 'rgba(139,92,246,0.08)'
  
  const statusConfig = STATUS_CONFIG[message.status]
  const deliveryConfig = DELIVERY_METHOD_CONFIG[message.deliveryMethod]
  
  // Format relative time
  const formatRelativeTime = (timestamp: number): string => {
    const now = Date.now()
    const diff = now - timestamp
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    if (days < 7) return `${days}d ago`
    return new Date(timestamp).toLocaleDateString()
  }
  
  const formatFullDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleString()
  }
  
  return (
    <div
      onClick={() => onClick(message.id)}
      style={{
        padding: '12px 14px',
        borderBottom: `1px solid ${borderColor}`,
        cursor: 'pointer',
        background: isSelected ? selectedBg : 'transparent',
        transition: 'background 0.15s ease'
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = hoverBg
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = 'transparent'
      }}
    >
      {/* Row 1: Title + Timestamp */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', marginBottom: '6px' }}>
        <div style={{ 
          flex: 1, 
          fontSize: '13px', 
          fontWeight: 600, 
          color: textColor,
          lineHeight: '1.3',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {message.title || '(No subject)'}
        </div>
        <span 
          title={formatFullDate(message.timestamp)}
          style={{ 
            fontSize: '10px', 
            color: mutedColor,
            flexShrink: 0,
            marginTop: '2px'
          }}
        >
          {formatRelativeTime(message.timestamp)}
        </span>
      </div>
      
      {/* Row 2: Fingerprint + Sender */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <code style={{ 
          fontSize: '10px', 
          fontFamily: 'monospace',
          padding: '2px 6px',
          background: isProfessional ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.2)',
          borderRadius: '4px',
          color: isProfessional ? '#3b82f6' : '#93c5fd',
          letterSpacing: '0.5px'
        }}>
          {message.fingerprint}
        </code>
        {message.senderName && (
          <span style={{ fontSize: '11px', color: mutedColor }}>
            {message.senderName}
          </span>
        )}
      </div>
      
      {/* Row 3: Badges (Delivery Method, Direction, Status) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        {/* Delivery Method Badge */}
        <span style={{
          fontSize: '10px',
          padding: '2px 6px',
          borderRadius: '4px',
          background: isProfessional ? 'rgba(100,116,139,0.1)' : 'rgba(255,255,255,0.1)',
          color: mutedColor,
          display: 'flex',
          alignItems: 'center',
          gap: '3px'
        }}>
          {deliveryConfig.icon} {deliveryConfig.label}
        </span>
        
        {/* Direction Badge */}
        <span style={{
          fontSize: '10px',
          padding: '2px 6px',
          borderRadius: '4px',
          background: message.direction === 'inbound' 
            ? (isProfessional ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.2)')
            : (isProfessional ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.2)'),
          color: message.direction === 'inbound' ? '#22c55e' : '#a855f7'
        }}>
          {message.direction === 'inbound' ? '↓ Inbound' : '↑ Outbound'}
        </span>
        
        {/* Status Chip */}
        <span style={{
          fontSize: '10px',
          padding: '2px 6px',
          borderRadius: '4px',
          background: statusConfig.bgColor,
          color: statusConfig.color,
          fontWeight: 500
        }}>
          {statusConfig.label}
        </span>
        
        {/* Attachments count */}
        {message.attachments.length > 0 && (
          <span style={{
            fontSize: '10px',
            padding: '2px 6px',
            borderRadius: '4px',
            background: isProfessional ? 'rgba(100,116,139,0.1)' : 'rgba(255,255,255,0.1)',
            color: mutedColor
          }}>
            📎 {message.attachments.length}
          </span>
        )}
      </div>
    </div>
  )
}

export default BeapMessageRow

