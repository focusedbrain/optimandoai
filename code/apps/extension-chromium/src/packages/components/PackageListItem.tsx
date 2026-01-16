/**
 * PackageListItem Component
 * 
 * Displays a single BEAP package in a list view.
 * Shows status, sender, subject, and timestamps.
 */

import React from 'react'
import type { BeapPackage, PackageStatus } from '../types'

interface PackageListItemProps {
  package: BeapPackage
  theme?: 'default' | 'dark' | 'professional'
  onClick?: (packageId: string) => void
  onAccept?: (packageId: string) => void
  onReject?: (packageId: string) => void
  showActions?: boolean
}

const STATUS_ICONS: Record<PackageStatus, string> = {
  pending: '⏳',
  registered: '✅',
  draft: '📝',
  outbox: '📤',
  executed: '✓',
  rejected: '🚫'
}

const STATUS_COLORS: Record<PackageStatus, string> = {
  pending: '#f59e0b',
  registered: '#22c55e',
  draft: '#3b82f6',
  outbox: '#8b5cf6',
  executed: '#10b981',
  rejected: '#ef4444'
}

export const PackageListItem: React.FC<PackageListItemProps> = ({
  package: pkg,
  theme = 'default',
  onClick,
  onAccept,
  onReject,
  showActions = false
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const hoverBg = isProfessional ? 'rgba(139,92,246,0.05)' : 'rgba(139,92,246,0.1)'
  
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const isToday = date.toDateString() === now.toDateString()
    
    if (isToday) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  
  return (
    <div
      onClick={() => onClick?.(pkg.package_id)}
      style={{
        padding: '12px 14px',
        borderBottom: `1px solid ${borderColor}`,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.15s ease',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px'
      }}
      onMouseEnter={(e) => {
        if (onClick) e.currentTarget.style.background = hoverBg
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      {/* Top row: Status, Sender, Time */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span 
          title={pkg.status}
          style={{ 
            fontSize: '12px',
            color: STATUS_COLORS[pkg.status]
          }}
        >
          {STATUS_ICONS[pkg.status]}
        </span>
        <span style={{ 
          flex: 1, 
          fontSize: '13px', 
          fontWeight: 600, 
          color: textColor,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {pkg.sender_name || pkg.sender_fingerprint || 'Unknown Sender'}
        </span>
        <span style={{ 
          fontSize: '11px', 
          color: mutedColor,
          flexShrink: 0
        }}>
          {formatTime(pkg.updated_at)}
        </span>
      </div>
      
      {/* Subject */}
      <div style={{ 
        fontSize: '12px', 
        fontWeight: 500, 
        color: textColor,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}>
        {pkg.subject}
      </div>
      
      {/* Preview */}
      {pkg.preview && (
        <div style={{ 
          fontSize: '11px', 
          color: mutedColor,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {pkg.preview}
        </div>
      )}
      
      {/* Actions for pending packages */}
      {showActions && pkg.status === 'pending' && (
        <div style={{ 
          display: 'flex', 
          gap: '8px', 
          marginTop: '4px',
          justifyContent: 'flex-end'
        }}>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onReject?.(pkg.package_id)
            }}
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              background: 'transparent',
              border: `1px solid ${isProfessional ? 'rgba(239,68,68,0.3)' : 'rgba(239,68,68,0.5)'}`,
              color: '#ef4444',
              borderRadius: '4px',
              cursor: 'pointer'
            }}
          >
            Reject
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onAccept?.(pkg.package_id)
            }}
            style={{
              padding: '4px 10px',
              fontSize: '11px',
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              border: 'none',
              color: 'white',
              borderRadius: '4px',
              cursor: 'pointer',
              fontWeight: 500
            }}
          >
            Accept
          </button>
        </div>
      )}
      
      {/* Fingerprint badge */}
      {pkg.sender_fingerprint && (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '4px',
          marginTop: '2px'
        }}>
          <span style={{ fontSize: '10px', color: mutedColor }}>🔐</span>
          <span style={{ 
            fontSize: '10px', 
            fontFamily: 'monospace', 
            color: mutedColor,
            letterSpacing: '0.5px'
          }}>
            {pkg.sender_fingerprint.slice(0, 8)}…{pkg.sender_fingerprint.slice(-4)}
          </span>
          {pkg.auto_registered && (
            <span 
              title="Auto-registered (trusted sender)"
              style={{ 
                fontSize: '10px', 
                color: '#22c55e',
                marginLeft: '4px'
              }}
            >
              ✓ Auto
            </span>
          )}
        </div>
      )}
    </div>
  )
}

export default PackageListItem



