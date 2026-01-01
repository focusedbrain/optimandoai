/**
 * Audit Trail Panel
 * 
 * Read-only display of audit events with export controls.
 * Shows chronological event list with type, timestamp, and hash previews.
 * 
 * @version 1.0.0
 */

import React, { useState, useCallback, useEffect } from 'react'
import { useAuditStore } from '../useAuditStore'
import { downloadAuditLog, downloadProofBundle } from '../exportService'
import type { AuditEvent, AuditEventType } from '../types'

interface AuditTrailPanelProps {
  messageId: string
  theme: 'default' | 'dark' | 'professional'
  canExportProof?: boolean
}

// =============================================================================
// Event Type Config
// =============================================================================

const EVENT_TYPE_CONFIG: Record<AuditEventType, { icon: string; label: string; color: string }> = {
  'imported': { icon: '📥', label: 'Imported', color: '#3b82f6' },
  'verified.accepted': { icon: '✅', label: 'Verified (Accepted)', color: '#22c55e' },
  'verified.rejected': { icon: '❌', label: 'Verified (Rejected)', color: '#ef4444' },
  'envelope.generated': { icon: '📧', label: 'Envelope Generated', color: '#8b5cf6' },
  'builder.applied': { icon: '🔧', label: 'Builder Applied', color: '#8b5cf6' },
  'dispatched': { icon: '📤', label: 'Dispatched', color: '#f59e0b' },
  'delivery.confirmed': { icon: '✓', label: 'Delivery Confirmed', color: '#22c55e' },
  'delivery.failed': { icon: '⚠️', label: 'Delivery Failed', color: '#ef4444' },
  'reconstructed.started': { icon: '🔄', label: 'Reconstruction Started', color: '#8b5cf6' },
  'reconstructed.completed': { icon: '📄', label: 'Reconstruction Complete', color: '#22c55e' },
  'reconstructed.failed': { icon: '⚠️', label: 'Reconstruction Failed', color: '#ef4444' },
  'archived': { icon: '📁', label: 'Archived', color: '#64748b' },
  'exported.audit': { icon: '📋', label: 'Audit Exported', color: '#3b82f6' },
  'exported.proof': { icon: '📦', label: 'Proof Exported', color: '#3b82f6' }
}

export const AuditTrailPanel: React.FC<AuditTrailPanelProps> = ({
  messageId,
  theme,
  canExportProof = true
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isProfessional ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.05)'
  
  // State
  const [isExporting, setIsExporting] = useState<'audit' | 'proof' | null>(null)
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null)
  const [chainVerified, setChainVerified] = useState<boolean | null>(null)
  
  // Get events
  const events = useAuditStore(state => state.getEvents(messageId))
  const verifyChainIntegrity = useAuditStore(state => state.verifyChainIntegrity)
  
  // Verify chain on mount
  useEffect(() => {
    verifyChainIntegrity(messageId).then(setChainVerified)
  }, [messageId, verifyChainIntegrity, events.length])
  
  // Export handlers
  const handleExportAudit = useCallback(async () => {
    setIsExporting('audit')
    try {
      await downloadAuditLog(messageId)
    } finally {
      setIsExporting(null)
    }
  }, [messageId])
  
  const handleExportProof = useCallback(async () => {
    setIsExporting('proof')
    try {
      await downloadProofBundle(messageId)
    } finally {
      setIsExporting(null)
    }
  }, [messageId])
  
  // Format timestamp
  const formatTimestamp = (ts: number): string => {
    const date = new Date(ts)
    return date.toLocaleString()
  }
  
  // Format relative time
  const formatRelativeTime = (ts: number): string => {
    const now = Date.now()
    const diff = now - ts
    const mins = Math.floor(diff / 60000)
    const hours = Math.floor(diff / 3600000)
    const days = Math.floor(diff / 86400000)
    
    if (mins < 1) return 'Just now'
    if (mins < 60) return `${mins}m ago`
    if (hours < 24) return `${hours}h ago`
    return `${days}d ago`
  }
  
  // Render event row
  const renderEvent = (event: AuditEvent, index: number) => {
    const config = EVENT_TYPE_CONFIG[event.type] || { icon: '•', label: event.type, color: mutedColor }
    const isExpanded = expandedEvent === event.eventId
    const isFirst = index === 0
    const isLast = index === events.length - 1
    
    return (
      <div
        key={event.eventId}
        style={{
          position: 'relative',
          paddingLeft: '32px',
          paddingBottom: isLast ? '0' : '16px'
        }}
      >
        {/* Timeline line */}
        {!isLast && (
          <div style={{
            position: 'absolute',
            left: '11px',
            top: '24px',
            bottom: '0',
            width: '2px',
            background: borderColor
          }} />
        )}
        
        {/* Timeline dot */}
        <div style={{
          position: 'absolute',
          left: '4px',
          top: '4px',
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          background: config.color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '10px'
        }}>
          {config.icon}
        </div>
        
        {/* Event content */}
        <div
          onClick={() => setExpandedEvent(isExpanded ? null : event.eventId)}
          style={{
            background: cardBg,
            borderRadius: '8px',
            padding: '12px',
            cursor: 'pointer',
            border: `1px solid ${borderColor}`
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '4px'
          }}>
            <div style={{
              fontSize: '12px',
              fontWeight: 600,
              color: config.color
            }}>
              {config.label}
            </div>
            <div style={{
              fontSize: '10px',
              color: mutedColor
            }}>
              {formatRelativeTime(event.timestamp)}
            </div>
          </div>
          
          {/* Summary */}
          <div style={{
            fontSize: '11px',
            color: textColor,
            marginBottom: isExpanded ? '10px' : '0'
          }}>
            {event.summary}
          </div>
          
          {/* Expanded details */}
          {isExpanded && (
            <div style={{
              borderTop: `1px solid ${borderColor}`,
              paddingTop: '10px',
              marginTop: '10px'
            }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: '8px',
                fontSize: '10px',
                fontFamily: 'monospace'
              }}>
                <div>
                  <span style={{ color: mutedColor }}>Event ID:</span><br />
                  <span style={{ color: textColor }}>{event.eventId}</span>
                </div>
                <div>
                  <span style={{ color: mutedColor }}>Actor:</span><br />
                  <span style={{ color: textColor }}>{event.actor}</span>
                </div>
                <div>
                  <span style={{ color: mutedColor }}>Timestamp:</span><br />
                  <span style={{ color: textColor }}>{formatTimestamp(event.timestamp)}</span>
                </div>
                <div>
                  <span style={{ color: mutedColor }}>Event Hash:</span><br />
                  <span style={{ color: textColor }}>{event.eventHash.substring(0, 16)}...</span>
                </div>
                {event.prevEventHash && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span style={{ color: mutedColor }}>Prev Hash:</span><br />
                    <span style={{ color: textColor }}>{event.prevEventHash.substring(0, 16)}...</span>
                  </div>
                )}
                {Object.keys(event.refs).length > 0 && (
                  <div style={{ gridColumn: '1 / -1' }}>
                    <span style={{ color: mutedColor }}>References:</span><br />
                    <span style={{ color: textColor }}>
                      {Object.entries(event.refs)
                        .filter(([_, v]) => v !== undefined)
                        .map(([k, v]) => `${k}: ${typeof v === 'string' ? v.substring(0, 12) + '...' : JSON.stringify(v)}`)
                        .join(' | ')}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }
  
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            fontSize: '14px',
            fontWeight: 700,
            color: textColor,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <span>📋</span>
            Audit Trail
          </div>
          
          {/* Chain verification badge */}
          {chainVerified !== null && (
            <div style={{
              fontSize: '10px',
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: '4px',
              color: chainVerified ? '#22c55e' : '#ef4444',
              background: chainVerified ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'
            }}>
              {chainVerified ? '✓ Chain Verified' : '⚠️ Chain Broken'}
            </div>
          )}
        </div>
        
        {/* Event count */}
        <div style={{
          fontSize: '11px',
          color: mutedColor
        }}>
          {events.length} event{events.length !== 1 ? 's' : ''}
        </div>
      </div>
      
      {/* Events list */}
      {events.length === 0 ? (
        <div style={{
          padding: '30px',
          textAlign: 'center',
          color: mutedColor,
          background: cardBg,
          borderRadius: '10px',
          border: `1px solid ${borderColor}`
        }}>
          <div style={{ fontSize: '24px', marginBottom: '8px' }}>📋</div>
          <div style={{ fontSize: '13px' }}>No audit events yet</div>
        </div>
      ) : (
        <div style={{
          padding: '16px',
          background: cardBg,
          borderRadius: '10px',
          border: `1px solid ${borderColor}`
        }}>
          {events.map((event, index) => renderEvent(event, index))}
        </div>
      )}
      
      {/* Export controls */}
      <div style={{
        padding: '14px 16px',
        background: cardBg,
        borderRadius: '10px',
        border: `1px solid ${borderColor}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{
          fontSize: '12px',
          fontWeight: 600,
          color: textColor
        }}>
          Export Options
        </div>
        
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={handleExportAudit}
            disabled={isExporting !== null || events.length === 0}
            style={{
              padding: '8px 14px',
              borderRadius: '6px',
              border: `1px solid ${borderColor}`,
              background: isProfessional ? 'white' : 'rgba(255,255,255,0.1)',
              color: textColor,
              fontSize: '12px',
              fontWeight: 500,
              cursor: isExporting !== null || events.length === 0 ? 'not-allowed' : 'pointer',
              opacity: isExporting !== null || events.length === 0 ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {isExporting === 'audit' ? '⏳' : '📋'}
            {isExporting === 'audit' ? 'Exporting...' : 'Export Audit Log'}
          </button>
          
          {canExportProof && (
            <button
              onClick={handleExportProof}
              disabled={isExporting !== null || events.length === 0}
              style={{
                padding: '8px 14px',
                borderRadius: '6px',
                border: 'none',
                background: isExporting !== null || events.length === 0
                  ? mutedColor
                  : 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
                color: 'white',
                fontSize: '12px',
                fontWeight: 600,
                cursor: isExporting !== null || events.length === 0 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {isExporting === 'proof' ? '⏳' : '📦'}
              {isExporting === 'proof' ? 'Exporting...' : 'Export Proof Bundle'}
            </button>
          )}
        </div>
      </div>
      
      {/* Disclaimer */}
      <div style={{
        fontSize: '10px',
        color: mutedColor,
        fontStyle: 'italic',
        textAlign: 'center'
      }}>
        Audit trail is append-only. Events cannot be modified or deleted.
      </div>
    </div>
  )
}

