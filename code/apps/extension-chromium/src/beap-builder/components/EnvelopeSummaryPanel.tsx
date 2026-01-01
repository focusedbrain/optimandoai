/**
 * EnvelopeSummaryPanel
 * 
 * Read-only display of the current envelope state.
 * Updates automatically when envelope is regenerated.
 * 
 * Displays:
 * - Envelope ID / short hash
 * - Fingerprint
 * - Handshake reference (if present)
 * - Ingress declaration (human-readable)
 * - Egress declaration (human-readable)
 * - Generation timestamp
 * 
 * @version 1.0.0
 */

import React from 'react'
import { useEnvelopeGenerator, useEnvelopeDisplaySummary, useGenerationCount } from '../useEnvelopeGenerator'

interface EnvelopeSummaryPanelProps {
  theme: 'default' | 'dark' | 'professional'
  compact?: boolean
}

export const EnvelopeSummaryPanel: React.FC<EnvelopeSummaryPanelProps> = ({
  theme,
  compact = false
}) => {
  const summary = useEnvelopeDisplaySummary()
  const generationCount = useGenerationCount()
  const isRegenerating = useEnvelopeGenerator(state => state.isRegenerating)
  
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isProfessional ? '#ffffff' : 'rgba(255,255,255,0.05)'
  const successColor = '#22c55e'
  const warningColor = '#f59e0b'
  
  // No envelope yet
  if (!summary) {
    return (
      <div style={{
        background: cardBg,
        borderRadius: '8px',
        border: `1px solid ${borderColor}`,
        padding: compact ? '10px 12px' : '14px 16px'
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          color: mutedColor,
          fontSize: '12px'
        }}>
          <span style={{ fontSize: '16px' }}>📋</span>
          <span>Envelope will be generated when you declare execution boundaries.</span>
        </div>
      </div>
    )
  }
  
  // Compact view (for inline display)
  if (compact) {
    return (
      <div style={{
        background: cardBg,
        borderRadius: '8px',
        border: `1px solid ${borderColor}`,
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '16px' }}>✉️</span>
          <div>
            <div style={{ fontSize: '11px', color: mutedColor }}>Envelope</div>
            <div style={{
              fontSize: '12px',
              fontFamily: 'monospace',
              fontWeight: 600,
              color: textColor
            }}>
              {summary.envelopeHashShort}
            </div>
          </div>
        </div>
        
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '10px',
          color: isRegenerating ? warningColor : successColor
        }}>
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: isRegenerating ? warningColor : successColor
          }} />
          <span>{isRegenerating ? 'Regenerating...' : 'Current'}</span>
        </div>
      </div>
    )
  }
  
  // Full view
  return (
    <div style={{
      background: cardBg,
      borderRadius: '10px',
      border: `1px solid ${borderColor}`,
      overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${borderColor}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: isProfessional ? '#f8fafc' : 'rgba(255,255,255,0.03)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>✉️</span>
          <div>
            <h4 style={{ margin: 0, fontSize: '13px', fontWeight: 700, color: textColor }}>
              Envelope Summary
            </h4>
            <p style={{ margin: '2px 0 0 0', fontSize: '10px', color: mutedColor }}>
              Read-only • Auto-generated
            </p>
          </div>
        </div>
        
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          {/* Status Indicator */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '10px',
            padding: '4px 8px',
            borderRadius: '12px',
            background: isRegenerating
              ? 'rgba(245,158,11,0.1)'
              : 'rgba(34,197,94,0.1)',
            color: isRegenerating ? warningColor : successColor
          }}>
            <span style={{
              width: '6px',
              height: '6px',
              borderRadius: '50%',
              background: isRegenerating ? warningColor : successColor,
              animation: isRegenerating ? 'pulse 1s infinite' : 'none'
            }} />
            <span>{isRegenerating ? 'Regenerating' : 'Valid'}</span>
          </div>
          
          {/* Generation Count */}
          <span style={{
            fontSize: '9px',
            color: mutedColor,
            background: isProfessional ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.08)',
            padding: '3px 7px',
            borderRadius: '4px'
          }}>
            v{generationCount}
          </span>
        </div>
      </div>
      
      {/* Content */}
      <div style={{ padding: '14px 16px' }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          gap: '8px 14px',
          fontSize: '12px'
        }}>
          {/* Envelope ID */}
          <span style={{ color: mutedColor, fontWeight: 500 }}>Envelope ID:</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{
              fontFamily: 'monospace',
              fontSize: '11px',
              color: textColor,
              background: isProfessional ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.08)',
              padding: '3px 8px',
              borderRadius: '4px'
            }}>
              {summary.envelopeHashShort}
            </span>
            <button
              onClick={() => navigator.clipboard.writeText(summary.envelopeId)}
              style={{
                background: 'none',
                border: 'none',
                color: mutedColor,
                fontSize: '10px',
                cursor: 'pointer',
                padding: '2px 4px'
              }}
              title="Copy full ID"
            >
              📋
            </button>
          </div>
          
          {/* Fingerprint */}
          <span style={{ color: mutedColor, fontWeight: 500 }}>Fingerprint:</span>
          <span style={{
            fontFamily: 'monospace',
            fontSize: '11px',
            color: textColor
          }}>
            {summary.fingerprintShort}
          </span>
          
          {/* Handshake */}
          <span style={{ color: mutedColor, fontWeight: 500 }}>Handshake:</span>
          <span style={{ color: summary.handshakeName ? textColor : mutedColor }}>
            {summary.handshakeName || summary.handshakeRef || '—'}
          </span>
          
          {/* Attestation */}
          <span style={{ color: mutedColor, fontWeight: 500 }}>Attestation:</span>
          <span style={{
            color: summary.attestationStatus === 'verified' ? successColor
              : summary.attestationStatus === 'pending' ? warningColor
              : mutedColor
          }}>
            {summary.attestationStatus === 'verified' ? '✓ Verified'
              : summary.attestationStatus === 'pending' ? '⏳ Pending'
              : '— Unavailable'}
          </span>
          
          {/* Ingress */}
          <span style={{ color: mutedColor, fontWeight: 500 }}>Ingress:</span>
          <span style={{ color: textColor, fontSize: '11px' }}>
            📥 {summary.ingressSummary}
          </span>
          
          {/* Egress */}
          <span style={{ color: mutedColor, fontWeight: 500 }}>Egress:</span>
          <span style={{ color: textColor, fontSize: '11px' }}>
            📤 {summary.egressSummary}
          </span>
          
          {/* Generated At */}
          <span style={{ color: mutedColor, fontWeight: 500 }}>Generated:</span>
          <span style={{ color: mutedColor, fontSize: '11px' }}>
            {new Date(summary.generatedAt).toLocaleTimeString()}
          </span>
        </div>
      </div>
      
      {/* Footer Notice */}
      <div style={{
        padding: '10px 16px',
        borderTop: `1px solid ${borderColor}`,
        background: isProfessional ? '#f8fafc' : 'rgba(255,255,255,0.02)',
        fontSize: '10px',
        color: mutedColor,
        display: 'flex',
        alignItems: 'center',
        gap: '6px'
      }}>
        <span style={{ fontSize: '12px' }}>ℹ️</span>
        <span>
          Envelope is regenerated automatically when execution boundaries change. No manual action required.
        </span>
      </div>
    </div>
  )
}

/**
 * Inline envelope badge for compact display
 */
export const EnvelopeBadge: React.FC<{
  theme: 'default' | 'dark' | 'professional'
}> = ({ theme }) => {
  const summary = useEnvelopeDisplaySummary()
  const isRegenerating = useEnvelopeGenerator(state => state.isRegenerating)
  
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  
  if (!summary) {
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        fontSize: '10px',
        color: mutedColor,
        padding: '3px 8px',
        background: isProfessional ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.08)',
        borderRadius: '4px'
      }}>
        ✉️ No envelope
      </span>
    )
  }
  
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '10px',
        color: textColor,
        padding: '4px 10px',
        background: isProfessional ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.15)',
        border: `1px solid ${isProfessional ? 'rgba(139,92,246,0.2)' : 'rgba(139,92,246,0.3)'}`,
        borderRadius: '6px'
      }}
      title={`Envelope: ${summary.envelopeId}\nFingerprint: ${summary.fingerprintShort}`}
    >
      <span style={{ fontSize: '12px' }}>✉️</span>
      <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
        {summary.envelopeHashShort}
      </span>
      <span style={{
        width: '5px',
        height: '5px',
        borderRadius: '50%',
        background: isRegenerating ? '#f59e0b' : '#22c55e'
      }} />
    </span>
  )
}

