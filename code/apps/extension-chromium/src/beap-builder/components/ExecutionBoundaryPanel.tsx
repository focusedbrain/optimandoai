/**
 * ExecutionBoundaryPanel
 * 
 * UI for declaring ingress & egress execution boundaries.
 * Lives inside the BEAP Builder as a dedicated section.
 * 
 * INVARIANTS:
 * - Egress is ALWAYS explicitly declared
 * - Ingress is ALWAYS explicitly declared
 * - Any change triggers automatic envelope regeneration
 * - No policy editing - only boundary declaration
 * 
 * @version 1.0.0
 */

import React, { useState } from 'react'
import { useEnvelopeGenerator } from '../useEnvelopeGenerator'
import {
  EGRESS_PRESET_CONFIG,
  INGRESS_PRESET_CONFIG,
  EGRESS_DESTINATION_TYPES,
  INGRESS_SOURCE_TYPES,
  type EgressPreset,
  type IngressPreset,
  type EgressDestinationType,
  type IngressSourceType
} from '../boundary-types'

interface ExecutionBoundaryPanelProps {
  theme: 'default' | 'dark' | 'professional'
  availableSessions?: { id: string; name: string }[]
}

export const ExecutionBoundaryPanel: React.FC<ExecutionBoundaryPanelProps> = ({
  theme,
  availableSessions = []
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.7)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const sectionBg = isProfessional ? '#f1f5f9' : 'rgba(255,255,255,0.03)'
  const cardBg = isProfessional ? '#ffffff' : 'rgba(255,255,255,0.05)'
  const inputBg = isProfessional ? '#ffffff' : 'rgba(255,255,255,0.08)'
  const inputBorder = isProfessional ? 'rgba(15,23,42,0.15)' : 'rgba(255,255,255,0.15)'
  const accentColor = '#8b5cf6'
  
  const {
    boundary,
    setEgressPreset,
    addEgressDestination,
    removeEgressDestination,
    setIngressPreset,
    addIngressSource,
    removeIngressSource,
    setSessionRefs,
    generationCount
  } = useEnvelopeGenerator()
  
  // Local state for new entries
  const [newEgressDest, setNewEgressDest] = useState('')
  const [newEgressType, setNewEgressType] = useState<EgressDestinationType>('web')
  const [newIngressSource, setNewIngressSource] = useState('')
  const [newIngressType, setNewIngressType] = useState<IngressSourceType>('api')
  
  // =========================================================================
  // Egress Destination Handlers
  // =========================================================================
  
  const handleAddEgressDestination = () => {
    if (!newEgressDest.trim()) return
    
    addEgressDestination({
      destination: newEgressDest.trim(),
      type: newEgressType
    })
    
    setNewEgressDest('')
  }
  
  // =========================================================================
  // Ingress Source Handlers
  // =========================================================================
  
  const handleAddIngressSource = () => {
    if (!newIngressSource.trim()) return
    
    addIngressSource({
      source: newIngressSource.trim(),
      type: newIngressType
    })
    
    setNewIngressSource('')
  }
  
  // =========================================================================
  // Session Selection Handler
  // =========================================================================
  
  const handleSessionToggle = (sessionId: string) => {
    const currentRefs = boundary.ingress.sessionRefs
    const newRefs = currentRefs.includes(sessionId)
      ? currentRefs.filter(id => id !== sessionId)
      : [...currentRefs, sessionId]
    
    setSessionRefs(newRefs)
  }
  
  // =========================================================================
  // Render
  // =========================================================================
  
  return (
    <div style={{
      background: sectionBg,
      borderRadius: '10px',
      border: `1px solid ${borderColor}`,
      overflow: 'hidden'
    }}>
      {/* Section Header */}
      <div style={{
        padding: '14px 16px',
        borderBottom: `1px solid ${borderColor}`,
        background: cardBg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '18px' }}>🛡️</span>
          <div>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700, color: textColor }}>
              Execution Boundary (Envelope)
            </h3>
            <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: mutedColor }}>
              Declares what this capsule can access during execution
            </p>
          </div>
        </div>
        
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '10px',
          color: mutedColor
        }}>
          <span style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: '#22c55e',
            animation: 'pulse 2s infinite'
          }} />
          <span>Gen #{generationCount}</span>
        </div>
      </div>
      
      <div style={{ padding: '16px' }}>
        {/* EGRESS SECTION */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '12px'
          }}>
            <span style={{ fontSize: '14px' }}>📤</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: textColor }}>
              Egress Declaration
            </span>
            <span style={{
              fontSize: '10px',
              color: '#ef4444',
              fontWeight: 500
            }}>
              (required)
            </span>
          </div>
          
          {/* Egress Presets */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginBottom: '12px'
          }}>
            {(Object.entries(EGRESS_PRESET_CONFIG) as [EgressPreset, typeof EGRESS_PRESET_CONFIG[EgressPreset]][]).map(([preset, config]) => (
              <label
                key={preset}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '10px 12px',
                  background: boundary.egress.preset === preset ? (isProfessional ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.15)') : cardBg,
                  border: `1px solid ${boundary.egress.preset === preset ? accentColor : borderColor}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <input
                  type="radio"
                  name="egress-preset"
                  checked={boundary.egress.preset === preset}
                  onChange={() => setEgressPreset(preset)}
                  style={{ marginTop: '2px', accentColor }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <span style={{ fontSize: '14px' }}>{config.icon}</span>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: textColor }}>
                      {config.label}
                    </span>
                    {config.isAdvanced && (
                      <span style={{
                        fontSize: '9px',
                        color: '#f59e0b',
                        background: 'rgba(245,158,11,0.1)',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontWeight: 600
                      }}>
                        ADVANCED
                      </span>
                    )}
                  </div>
                  <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: mutedColor }}>
                    {config.description}
                  </p>
                </div>
              </label>
            ))}
          </div>
          
          {/* Egress Allowlist Editor */}
          {boundary.egress.preset === 'allowlisted' && (
            <div style={{
              background: cardBg,
              border: `1px solid ${borderColor}`,
              borderRadius: '8px',
              padding: '12px'
            }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '10px' }}>
                Allowed Destinations
              </div>
              
              {/* Existing Destinations */}
              {boundary.egress.allowlist.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
                  {boundary.egress.allowlist.map(dest => {
                    const typeConfig = EGRESS_DESTINATION_TYPES.find(t => t.value === dest.type)
                    return (
                      <div
                        key={dest.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          background: isProfessional ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.03)',
                          borderRadius: '6px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px' }}>{typeConfig?.icon || '📎'}</span>
                          <span style={{ fontSize: '12px', fontFamily: 'monospace', color: textColor }}>
                            {dest.destination}
                          </span>
                          {dest.type && (
                            <span style={{
                              fontSize: '9px',
                              color: mutedColor,
                              background: isProfessional ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.08)',
                              padding: '2px 5px',
                              borderRadius: '3px'
                            }}>
                              {dest.type}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => removeEgressDestination(dest.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            fontSize: '14px',
                            cursor: 'pointer',
                            padding: '0 4px'
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
              
              {/* Add New Destination */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={newEgressDest}
                  onChange={(e) => setNewEgressDest(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddEgressDestination()}
                  placeholder="e.g., api.stripe.com"
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    fontSize: '12px',
                    background: inputBg,
                    border: `1px solid ${inputBorder}`,
                    borderRadius: '6px',
                    color: textColor,
                    outline: 'none'
                  }}
                />
                <select
                  value={newEgressType}
                  onChange={(e) => setNewEgressType(e.target.value as EgressDestinationType)}
                  style={{
                    padding: '8px 10px',
                    fontSize: '12px',
                    background: inputBg,
                    border: `1px solid ${inputBorder}`,
                    borderRadius: '6px',
                    color: textColor,
                    outline: 'none'
                  }}
                >
                  {EGRESS_DESTINATION_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                  ))}
                </select>
                <button
                  onClick={handleAddEgressDestination}
                  disabled={!newEgressDest.trim()}
                  style={{
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: 500,
                    background: accentColor,
                    border: 'none',
                    borderRadius: '6px',
                    color: 'white',
                    cursor: newEgressDest.trim() ? 'pointer' : 'not-allowed',
                    opacity: newEgressDest.trim() ? 1 : 0.5
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
        
        {/* INGRESS SECTION */}
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginBottom: '12px'
          }}>
            <span style={{ fontSize: '14px' }}>📥</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: textColor }}>
              Ingress Declaration
            </span>
            <span style={{
              fontSize: '10px',
              color: '#ef4444',
              fontWeight: 500
            }}>
              (required)
            </span>
          </div>
          
          {/* Ingress Presets */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            marginBottom: '12px'
          }}>
            {(Object.entries(INGRESS_PRESET_CONFIG) as [IngressPreset, typeof INGRESS_PRESET_CONFIG[IngressPreset]][]).map(([preset, config]) => (
              <label
                key={preset}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '10px',
                  padding: '10px 12px',
                  background: boundary.ingress.preset === preset ? (isProfessional ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.15)') : cardBg,
                  border: `1px solid ${boundary.ingress.preset === preset ? accentColor : borderColor}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <input
                  type="radio"
                  name="ingress-preset"
                  checked={boundary.ingress.preset === preset}
                  onChange={() => setIngressPreset(preset)}
                  style={{ marginTop: '2px', accentColor }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}>
                    <span style={{ fontSize: '14px' }}>{config.icon}</span>
                    <span style={{ fontSize: '13px', fontWeight: 500, color: textColor }}>
                      {config.label}
                    </span>
                  </div>
                  <p style={{ margin: '4px 0 0 0', fontSize: '11px', color: mutedColor }}>
                    {config.description}
                  </p>
                </div>
              </label>
            ))}
          </div>
          
          {/* Session Selector (for session_derived) */}
          {boundary.ingress.preset === 'session_derived' && (
            <div style={{
              background: cardBg,
              border: `1px solid ${borderColor}`,
              borderRadius: '8px',
              padding: '12px'
            }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '10px' }}>
                Select Sessions
              </div>
              
              {availableSessions.length === 0 ? (
                <p style={{ fontSize: '12px', color: mutedColor, margin: 0 }}>
                  No automation sessions available.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {availableSessions.map(session => (
                    <label
                      key={session.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '8px 10px',
                        background: boundary.ingress.sessionRefs.includes(session.id)
                          ? (isProfessional ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.15)')
                          : (isProfessional ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.03)'),
                        borderRadius: '6px',
                        cursor: 'pointer'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={boundary.ingress.sessionRefs.includes(session.id)}
                        onChange={() => handleSessionToggle(session.id)}
                        style={{ accentColor }}
                      />
                      <span style={{ fontSize: '12px', color: textColor }}>{session.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          
          {/* Ingress Allowlist Editor */}
          {boundary.ingress.preset === 'allowlisted' && (
            <div style={{
              background: cardBg,
              border: `1px solid ${borderColor}`,
              borderRadius: '8px',
              padding: '12px'
            }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '10px' }}>
                Allowed Input Sources
              </div>
              
              {/* Existing Sources */}
              {boundary.ingress.allowlist.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
                  {boundary.ingress.allowlist.map(src => {
                    const typeConfig = INGRESS_SOURCE_TYPES.find(t => t.value === src.type)
                    return (
                      <div
                        key={src.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          background: isProfessional ? 'rgba(15,23,42,0.03)' : 'rgba(255,255,255,0.03)',
                          borderRadius: '6px'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ fontSize: '12px' }}>{typeConfig?.icon || '📎'}</span>
                          <span style={{ fontSize: '12px', fontFamily: 'monospace', color: textColor }}>
                            {src.source}
                          </span>
                          <span style={{
                            fontSize: '9px',
                            color: mutedColor,
                            background: isProfessional ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.08)',
                            padding: '2px 5px',
                            borderRadius: '3px'
                          }}>
                            {src.type}
                          </span>
                        </div>
                        <button
                          onClick={() => removeIngressSource(src.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: '#ef4444',
                            fontSize: '14px',
                            cursor: 'pointer',
                            padding: '0 4px'
                          }}
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
              
              {/* Add New Source */}
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={newIngressSource}
                  onChange={(e) => setNewIngressSource(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddIngressSource()}
                  placeholder="e.g., api.example.com"
                  style={{
                    flex: 1,
                    padding: '8px 10px',
                    fontSize: '12px',
                    background: inputBg,
                    border: `1px solid ${inputBorder}`,
                    borderRadius: '6px',
                    color: textColor,
                    outline: 'none'
                  }}
                />
                <select
                  value={newIngressType}
                  onChange={(e) => setNewIngressType(e.target.value as IngressSourceType)}
                  style={{
                    padding: '8px 10px',
                    fontSize: '12px',
                    background: inputBg,
                    border: `1px solid ${inputBorder}`,
                    borderRadius: '6px',
                    color: textColor,
                    outline: 'none'
                  }}
                >
                  {INGRESS_SOURCE_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.icon} {t.label}</option>
                  ))}
                </select>
                <button
                  onClick={handleAddIngressSource}
                  disabled={!newIngressSource.trim()}
                  style={{
                    padding: '8px 12px',
                    fontSize: '12px',
                    fontWeight: 500,
                    background: accentColor,
                    border: 'none',
                    borderRadius: '6px',
                    color: 'white',
                    cursor: newIngressSource.trim() ? 'pointer' : 'not-allowed',
                    opacity: newIngressSource.trim() ? 1 : 0.5
                  }}
                >
                  Add
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

