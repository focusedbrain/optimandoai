/**
 * BeapMessagePreview Component
 * 
 * Read-only preview/details panel for a selected BEAP message.
 * Shows fingerprint, handshake info, attestation, body, and attachments.
 * 
 * @version 1.0.0
 */

import React from 'react'
import type { BeapMessageUI, BeapFolder } from '../types'
import { DELIVERY_METHOD_CONFIG, STATUS_CONFIG } from '../types'

interface BeapMessagePreviewProps {
  message: BeapMessageUI | null
  folder: BeapFolder
  theme: 'default' | 'dark' | 'professional'
  onOpen?: (id: string) => void
  onAccept?: (id: string) => void
  onReject?: (id: string) => void
  onRetry?: (id: string) => void
  onArchive?: (id: string) => void
  onViewReason?: (id: string) => void
}

export const BeapMessagePreview: React.FC<BeapMessagePreviewProps> = ({
  message,
  folder,
  theme,
  onOpen,
  onAccept,
  onReject,
  onRetry,
  onArchive,
  onViewReason
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const bgColor = isProfessional ? '#f8fafc' : 'rgba(255,255,255,0.02)'
  const cardBg = isProfessional ? 'white' : 'rgba(255,255,255,0.05)'
  
  // Empty state when no message selected
  if (!message) {
    return (
      <div style={{ 
        flex: 1, 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        background: bgColor,
        padding: '20px'
      }}>
        <div style={{ textAlign: 'center', color: mutedColor }}>
          <span style={{ fontSize: '32px', display: 'block', marginBottom: '12px' }}>📦</span>
          <div style={{ fontSize: '13px' }}>Select a message to view details</div>
        </div>
      </div>
    )
  }
  
  const deliveryConfig = DELIVERY_METHOD_CONFIG[message.deliveryMethod]
  const statusConfig = STATUS_CONFIG[message.status]
  
  // Format file size
  const formatSize = (bytes?: number): string => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
  
  // Render action buttons based on folder
  const renderActions = () => {
    const buttonStyle = (primary = false, danger = false) => ({
      padding: '8px 16px',
      fontSize: '12px',
      fontWeight: 500,
      borderRadius: '6px',
      cursor: 'pointer',
      border: 'none',
      background: primary 
        ? 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)'
        : danger 
          ? 'transparent'
          : (isProfessional ? '#e2e8f0' : 'rgba(255,255,255,0.1)'),
      color: primary 
        ? 'white' 
        : danger 
          ? '#ef4444'
          : textColor,
      ...(danger && { border: `1px solid rgba(239,68,68,0.3)` })
    })
    
    switch (folder) {
      case 'inbox':
        return (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button 
              style={buttonStyle(true)} 
              onClick={() => onOpen?.(message.id)}
              disabled={!onOpen}
            >
              📂 Open
            </button>
            <button 
              style={buttonStyle()} 
              onClick={() => onAccept?.(message.id)}
              disabled={!onAccept}
            >
              ✓ Accept/Register
            </button>
            <button 
              style={buttonStyle(false, true)} 
              onClick={() => onReject?.(message.id)}
              disabled={!onReject}
            >
              ✕ Reject
            </button>
          </div>
        )
      
      case 'outbox':
        return (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button 
              style={buttonStyle(true)} 
              onClick={() => onOpen?.(message.id)}
              disabled={!onOpen}
            >
              📂 Open
            </button>
            <button 
              style={buttonStyle()} 
              onClick={() => onRetry?.(message.id)}
              disabled={!onRetry}
            >
              🔄 Retry
            </button>
            <button 
              style={buttonStyle()} 
              onClick={() => onArchive?.(message.id)}
              disabled={!onArchive}
            >
              📁 Mark as archived
            </button>
          </div>
        )
      
      case 'archived':
        return (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              style={buttonStyle(true)} 
              onClick={() => onOpen?.(message.id)}
              disabled={!onOpen}
            >
              📂 Open
            </button>
          </div>
        )
      
      case 'rejected':
        return (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button 
              style={buttonStyle(true)} 
              onClick={() => onOpen?.(message.id)}
              disabled={!onOpen}
            >
              📂 Open
            </button>
            <button 
              style={buttonStyle()} 
              onClick={() => onViewReason?.(message.id)}
              disabled={!onViewReason}
            >
              ❓ View reason
            </button>
          </div>
        )
      
      default:
        return null
    }
  }
  
  return (
    <div style={{ 
      flex: 1, 
      display: 'flex', 
      flexDirection: 'column',
      background: bgColor,
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{ 
        padding: '14px 16px', 
        borderBottom: `1px solid ${borderColor}`,
        background: cardBg
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
          <span style={{ fontSize: '18px' }}>📦</span>
          <span style={{ fontSize: '14px', fontWeight: 600, color: textColor }}>
            BEAP™ Message
          </span>
          <span style={{
            fontSize: '10px',
            padding: '2px 8px',
            borderRadius: '4px',
            background: statusConfig.bgColor,
            color: statusConfig.color,
            fontWeight: 500
          }}>
            {statusConfig.label}
          </span>
        </div>
        <div style={{ fontSize: '15px', fontWeight: 600, color: textColor }}>
          {message.title || '(No subject)'}
        </div>
      </div>
      
      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {/* Metadata Section */}
        <div style={{ 
          background: cardBg, 
          borderRadius: '8px', 
          padding: '14px',
          marginBottom: '14px',
          border: `1px solid ${borderColor}`
        }}>
          {/* Fingerprint */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: mutedColor, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Fingerprint
            </div>
            <code style={{ 
              fontSize: '11px', 
              fontFamily: 'monospace',
              color: isProfessional ? '#3b82f6' : '#93c5fd',
              wordBreak: 'break-all',
              display: 'block'
            }}>
              {message.fingerprintFull || message.fingerprint}
            </code>
          </div>
          
          {/* Handshake */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: mutedColor, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Handshake
            </div>
            <span style={{ fontSize: '12px', color: textColor }}>
              {message.handshakeId || '—'}
            </span>
          </div>
          
          {/* Hardware Attestation */}
          <div style={{ marginBottom: '12px' }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: mutedColor, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Hardware Attestation
            </div>
            <span style={{ 
              fontSize: '12px', 
              color: message.hardwareAttestation === 'verified' ? '#22c55e' 
                : message.hardwareAttestation === 'pending' ? '#f59e0b' 
                : mutedColor
            }}>
              {message.hardwareAttestation === 'verified' ? '✓ Verified' 
                : message.hardwareAttestation === 'pending' ? '⏳ Pending' 
                : '—'}
            </span>
          </div>
          
          {/* Delivery Method + Channel */}
          <div>
            <div style={{ fontSize: '10px', fontWeight: 600, color: mutedColor, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Delivery Method / Channel
            </div>
            <span style={{ fontSize: '12px', color: textColor }}>
              {deliveryConfig.icon} {deliveryConfig.label}
              {message.channelSite && ` — ${message.channelSite}`}
            </span>
          </div>
        </div>
        
        {/* Body Preview */}
        <div style={{ 
          background: cardBg, 
          borderRadius: '8px', 
          padding: '14px',
          marginBottom: '14px',
          border: `1px solid ${borderColor}`
        }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: mutedColor, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Message Body
          </div>
          <div style={{ 
            fontSize: '13px', 
            color: textColor, 
            lineHeight: '1.6',
            whiteSpace: 'pre-wrap'
          }}>
            {message.bodyText || '(empty)'}
          </div>
        </div>
        
        {/* Attachments */}
        <div style={{ 
          background: cardBg, 
          borderRadius: '8px', 
          padding: '14px',
          marginBottom: '14px',
          border: `1px solid ${borderColor}`
        }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: mutedColor, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Attachments
          </div>
          {message.attachments.length === 0 ? (
            <div style={{ fontSize: '12px', color: mutedColor, fontStyle: 'italic' }}>
              No attachments
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {message.attachments.map((att, idx) => (
                <div 
                  key={idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 10px',
                    background: isProfessional ? 'rgba(59,130,246,0.05)' : 'rgba(59,130,246,0.1)',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: textColor
                  }}
                >
                  <span>📎</span>
                  <span style={{ flex: 1 }}>{att.name}</span>
                  {att.size && (
                    <span style={{ fontSize: '10px', color: mutedColor }}>
                      {formatSize(att.size)}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Rejection Reason (for rejected folder) */}
        {folder === 'rejected' && message.rejectReason && (
          <div style={{ 
            background: 'rgba(239,68,68,0.1)', 
            borderRadius: '8px', 
            padding: '14px',
            marginBottom: '14px',
            border: '1px solid rgba(239,68,68,0.2)'
          }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: '#ef4444', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              Rejection Reason
            </div>
            <div style={{ fontSize: '12px', color: textColor, lineHeight: '1.5' }}>
              {message.rejectReason}
            </div>
          </div>
        )}
      </div>
      
      {/* Actions Footer */}
      <div style={{ 
        padding: '14px 16px', 
        borderTop: `1px solid ${borderColor}`,
        background: cardBg
      }}>
        {renderActions()}
      </div>
    </div>
  )
}

export default BeapMessagePreview

