/**
 * EnvelopeSection Component
 * 
 * Read-only display of the BEAP envelope.
 * Shows fingerprint, handshake, attestation, and declared capabilities.
 * 
 * PURPOSE: Make the consent boundary explicit.
 * This section is NEVER editable - it shows what the capsule is allowed to do.
 * 
 * @version 1.0.0
 */

import React from 'react'
import type { EnvelopeSummary, CapabilityClass } from '../canonical-types'

interface EnvelopeSectionProps {
  summary: EnvelopeSummary | null
  pendingCapabilities: CapabilityClass[]
  requiresRegeneration: boolean
  theme: 'default' | 'dark' | 'professional'
}

export const EnvelopeSection: React.FC<EnvelopeSectionProps> = ({
  summary,
  pendingCapabilities,
  requiresRegeneration,
  theme
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isProfessional ? 'white' : 'rgba(255,255,255,0.05)'
  const accentBg = isProfessional ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.15)'
  
  // Capability labels for display
  const capabilityLabels: Record<CapabilityClass, { label: string; icon: string }> = {
    critical_automation: { label: 'Critical Automation', icon: '⚡' },
    monetary: { label: 'Monetary', icon: '💰' },
    ui_actions: { label: 'UI Actions', icon: '🖥️' },
    data_access: { label: 'Data Access', icon: '📊' },
    session_control: { label: 'Sessions', icon: '🔄' },
    network_egress: { label: 'Network Egress', icon: '📤' },
    network_ingress: { label: 'Network Ingress', icon: '📥' }
  }
  
  if (!summary) {
    return (
      <div style={{
        padding: '16px',
        background: cardBg,
        borderRadius: '8px',
        border: `1px solid ${borderColor}`
      }}>
        <div style={{ color: mutedColor, fontSize: '12px', fontStyle: 'italic' }}>
          Envelope not yet generated
        </div>
      </div>
    )
  }
  
  return (
    <div style={{
      background: cardBg,
      borderRadius: '8px',
      border: `1px solid ${borderColor}`,
      overflow: 'hidden'
    }}>
      {/* Section Header */}
      <div style={{
        padding: '12px 14px',
        background: accentBg,
        borderBottom: `1px solid ${borderColor}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '14px' }}>📜</span>
          <span style={{ fontSize: '12px', fontWeight: 600, color: textColor }}>
            Envelope (Read-Only)
          </span>
        </div>
        {requiresRegeneration && (
          <span style={{
            fontSize: '10px',
            padding: '2px 8px',
            borderRadius: '4px',
            background: 'rgba(245,158,11,0.2)',
            color: '#f59e0b',
            fontWeight: 500
          }}>
            ⚠ Pending Regeneration
          </span>
        )}
      </div>
      
      {/* Envelope Details */}
      <div style={{ padding: '14px' }}>
        {/* Fingerprint */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: mutedColor, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Fingerprint
          </div>
          <code 
            title={summary.senderFull}
            style={{ 
              fontSize: '11px', 
              fontFamily: 'monospace',
              padding: '4px 8px',
              background: isProfessional ? 'rgba(59,130,246,0.1)' : 'rgba(59,130,246,0.2)',
              borderRadius: '4px',
              color: isProfessional ? '#3b82f6' : '#93c5fd',
              display: 'inline-block'
            }}
          >
            {summary.senderShort}
          </code>
        </div>
        
        {/* Handshake */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: mutedColor, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Handshake
          </div>
          <span style={{ fontSize: '12px', color: textColor }}>
            {summary.handshakeName || '—'}
          </span>
        </div>
        
        {/* Hardware Attestation */}
        <div style={{ marginBottom: '12px' }}>
          <div style={{ fontSize: '10px', fontWeight: 600, color: mutedColor, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Hardware Attestation
          </div>
          <span style={{ fontSize: '12px', color: textColor }}>
            {summary.attestationStatus}
          </span>
        </div>
        
        {/* Declared Capabilities */}
        <div>
          <div style={{ fontSize: '10px', fontWeight: 600, color: mutedColor, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Declared Capabilities
          </div>
          <div style={{ fontSize: '12px', color: textColor }}>
            {summary.capabilitySummary === 'None declared' ? (
              <span style={{ color: mutedColor, fontStyle: 'italic' }}>None declared</span>
            ) : (
              summary.capabilitySummary
            )}
          </div>
          
          {/* Pending capabilities to be added */}
          {pendingCapabilities.length > 0 && (
            <div style={{ marginTop: '8px' }}>
              <div style={{ fontSize: '10px', color: '#f59e0b', marginBottom: '4px' }}>
                + Pending capabilities:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {pendingCapabilities.map(cap => (
                  <span
                    key={cap}
                    style={{
                      fontSize: '10px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      background: 'rgba(245,158,11,0.15)',
                      color: '#f59e0b',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px'
                    }}
                  >
                    {capabilityLabels[cap].icon} {capabilityLabels[cap].label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      
      {/* Info Footer */}
      <div style={{
        padding: '10px 14px',
        background: isProfessional ? 'rgba(0,0,0,0.02)' : 'rgba(0,0,0,0.2)',
        borderTop: `1px solid ${borderColor}`,
        fontSize: '10px',
        color: mutedColor,
        fontStyle: 'italic'
      }}>
        The envelope defines the consent boundary. Capsule content cannot exceed these capabilities.
      </div>
    </div>
  )
}

export default EnvelopeSection

