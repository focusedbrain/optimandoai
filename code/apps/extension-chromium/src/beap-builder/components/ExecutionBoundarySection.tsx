/**
 * ExecutionBoundarySection Component
 * 
 * Ingress/Egress constraint editor for the envelope.
 * Changes here trigger automatic envelope regeneration.
 * 
 * @version 1.0.0
 */

import React, { useState } from 'react'
import type { NetworkConstraints } from '../canonical-types'

interface ExecutionBoundarySectionProps {
  currentConstraints: NetworkConstraints
  pendingConstraints: Partial<NetworkConstraints> | null
  onIngressChange: (sources: string[]) => void
  onEgressChange: (destinations: string[]) => void
  onOfflineOnlyChange: (offlineOnly: boolean) => void
  requiresRegeneration: boolean
  theme: 'default' | 'dark' | 'professional'
}

export const ExecutionBoundarySection: React.FC<ExecutionBoundarySectionProps> = ({
  currentConstraints,
  pendingConstraints,
  onIngressChange,
  onEgressChange,
  onOfflineOnlyChange,
  requiresRegeneration,
  theme
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const cardBg = isProfessional ? 'white' : 'rgba(255,255,255,0.05)'
  const inputBg = isProfessional ? '#ffffff' : 'rgba(255,255,255,0.08)'
  const inputBorder = isProfessional ? 'rgba(15,23,42,0.15)' : 'rgba(255,255,255,0.15)'
  const warningBg = isProfessional ? 'rgba(245,158,11,0.1)' : 'rgba(245,158,11,0.15)'
  
  // Merge current with pending for display
  const effectiveConstraints: NetworkConstraints = {
    ...currentConstraints,
    ...(pendingConstraints || {})
  }
  
  const [ingressInput, setIngressInput] = useState('')
  const [egressInput, setEgressInput] = useState('')
  
  // Add ingress source
  const handleAddIngress = () => {
    if (ingressInput.trim()) {
      onIngressChange([...effectiveConstraints.allowedIngress, ingressInput.trim()])
      setIngressInput('')
    }
  }
  
  // Remove ingress source
  const handleRemoveIngress = (source: string) => {
    onIngressChange(effectiveConstraints.allowedIngress.filter(s => s !== source))
  }
  
  // Add egress destination
  const handleAddEgress = () => {
    if (egressInput.trim()) {
      onEgressChange([...effectiveConstraints.allowedEgress, egressInput.trim()])
      setEgressInput('')
    }
  }
  
  // Remove egress destination
  const handleRemoveEgress = (dest: string) => {
    onEgressChange(effectiveConstraints.allowedEgress.filter(d => d !== dest))
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
        borderBottom: `1px solid ${borderColor}`,
        background: warningBg
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '14px' }}>🛡️</span>
            <span style={{ fontSize: '12px', fontWeight: 600, color: textColor }}>
              Execution Boundary (Envelope)
            </span>
          </div>
          {requiresRegeneration && (
            <span style={{
              fontSize: '10px',
              padding: '2px 8px',
              borderRadius: '4px',
              background: 'rgba(245,158,11,0.3)',
              color: '#f59e0b',
              fontWeight: 500
            }}>
              🔄 Auto-regenerates envelope
            </span>
          )}
        </div>
        <div style={{ fontSize: '10px', color: mutedColor, marginTop: '4px' }}>
          Changes here regenerate the envelope automatically. Ingress/egress must be explicitly declared.
        </div>
      </div>
      
      {/* Content */}
      <div style={{ padding: '14px' }}>
        {/* Offline Only Toggle */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ 
            display: 'flex', 
            alignItems: 'center', 
            gap: '10px',
            cursor: 'pointer'
          }}>
            <div style={{
              width: '36px',
              height: '20px',
              borderRadius: '10px',
              background: effectiveConstraints.offlineOnly 
                ? '#a855f7' 
                : (isProfessional ? '#e2e8f0' : 'rgba(255,255,255,0.2)'),
              position: 'relative',
              transition: 'background 0.2s'
            }}
              onClick={() => onOfflineOnlyChange(!effectiveConstraints.offlineOnly)}
            >
              <div style={{
                width: '16px',
                height: '16px',
                borderRadius: '8px',
                background: 'white',
                position: 'absolute',
                top: '2px',
                left: effectiveConstraints.offlineOnly ? '18px' : '2px',
                transition: 'left 0.2s',
                boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
              }} />
            </div>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 500, color: textColor }}>
                Offline Only Execution
              </div>
              <div style={{ fontSize: '10px', color: mutedColor }}>
                Capsule can only be processed without network access
              </div>
            </div>
          </label>
        </div>
        
        {/* Ingress Constraints */}
        <div style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: mutedColor, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            📥 Allowed Ingress Sources
          </div>
          
          {/* Add input */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
            <input
              type="text"
              value={ingressInput}
              onChange={(e) => setIngressInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddIngress()}
              placeholder="e.g., api.example.com"
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: '12px',
                color: textColor,
                background: inputBg,
                border: `1px solid ${inputBorder}`,
                borderRadius: '4px',
                outline: 'none'
              }}
            />
            <button
              onClick={handleAddIngress}
              style={{
                padding: '6px 12px',
                fontSize: '11px',
                background: isProfessional ? '#e2e8f0' : 'rgba(255,255,255,0.1)',
                border: `1px solid ${inputBorder}`,
                color: textColor,
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Add
            </button>
          </div>
          
          {/* List */}
          {effectiveConstraints.allowedIngress.length === 0 ? (
            <div style={{ fontSize: '11px', color: mutedColor, fontStyle: 'italic' }}>
              No ingress sources declared (default: none allowed)
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {effectiveConstraints.allowedIngress.map(source => (
                <span
                  key={source}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    background: isProfessional ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.2)',
                    color: '#22c55e',
                    borderRadius: '4px'
                  }}
                >
                  {source}
                  <button
                    onClick={() => handleRemoveIngress(source)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#22c55e',
                      cursor: 'pointer',
                      padding: '0 2px',
                      fontSize: '12px'
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
        
        {/* Egress Constraints */}
        <div>
          <div style={{ fontSize: '11px', fontWeight: 600, color: mutedColor, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            📤 Allowed Egress Destinations
          </div>
          
          {/* Add input */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
            <input
              type="text"
              value={egressInput}
              onChange={(e) => setEgressInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddEgress()}
              placeholder="e.g., mail.example.com"
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: '12px',
                color: textColor,
                background: inputBg,
                border: `1px solid ${inputBorder}`,
                borderRadius: '4px',
                outline: 'none'
              }}
            />
            <button
              onClick={handleAddEgress}
              style={{
                padding: '6px 12px',
                fontSize: '11px',
                background: isProfessional ? '#e2e8f0' : 'rgba(255,255,255,0.1)',
                border: `1px solid ${inputBorder}`,
                color: textColor,
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              Add
            </button>
          </div>
          
          {/* List */}
          {effectiveConstraints.allowedEgress.length === 0 ? (
            <div style={{ fontSize: '11px', color: mutedColor, fontStyle: 'italic' }}>
              No egress destinations declared (default: none allowed)
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {effectiveConstraints.allowedEgress.map(dest => (
                <span
                  key={dest}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '3px 8px',
                    fontSize: '11px',
                    background: isProfessional ? 'rgba(139,92,246,0.1)' : 'rgba(139,92,246,0.2)',
                    color: '#a855f7',
                    borderRadius: '4px'
                  }}
                >
                  {dest}
                  <button
                    onClick={() => handleRemoveEgress(dest)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#a855f7',
                      cursor: 'pointer',
                      padding: '0 2px',
                      fontSize: '12px'
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
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
        color: mutedColor
      }}>
        Egress MUST be explicitly declared even if permissive. These constraints are envelope-bound.
      </div>
    </div>
  )
}

export default ExecutionBoundarySection

