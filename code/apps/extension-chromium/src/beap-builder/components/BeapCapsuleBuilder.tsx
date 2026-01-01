/**
 * BeapCapsuleBuilder Component
 * 
 * Shared BEAP™ Capsule Builder modal/panel.
 * Used by WR Chat (Direct & Group) and BEAP Messages (Drafts).
 * 
 * DESIGN:
 * - Envelope Summary: Read-only, shows current envelope state
 * - Capsule section: Editable, message content
 * - Execution Boundary: Ingress/egress declaration with presets (triggers envelope regen)
 * 
 * INVARIANTS (v2.1):
 * - Egress MUST always be explicitly declared
 * - Ingress MUST always be explicitly declared
 * - Any change triggers automatic envelope regeneration
 * - No policy editing - only boundary declaration
 * 
 * @version 2.1.0
 */

import React, { useEffect } from 'react'
import { useCapsuleBuilder } from '../useCapsuleBuilder'
import { useEnvelopeGenerator } from '../useEnvelopeGenerator'
import { CapsuleSection } from './CapsuleSection'
import { ExecutionBoundaryPanel } from './ExecutionBoundaryPanel'
import { EnvelopeSummaryPanel, EnvelopeBadge } from './EnvelopeSummaryPanel'
import type { CapsuleSessionRef, NetworkConstraints } from '../canonical-types'

interface BeapCapsuleBuilderProps {
  theme: 'default' | 'dark' | 'professional'
  /** Available sessions for selection */
  availableSessions?: CapsuleSessionRef[]
  /** Callback when Apply is clicked */
  onApply?: (result: { envelopeRequiresRegeneration: boolean }) => void
  /** Callback when Cancel is clicked */
  onCancel?: () => void
}

export const BeapCapsuleBuilder: React.FC<BeapCapsuleBuilderProps> = ({
  theme,
  availableSessions = [],
  onApply,
  onCancel
}) => {
  const isProfessional = theme === 'professional'
  const textColor = isProfessional ? '#0f172a' : 'white'
  const mutedColor = isProfessional ? '#64748b' : 'rgba(255,255,255,0.6)'
  const borderColor = isProfessional ? 'rgba(15,23,42,0.1)' : 'rgba(255,255,255,0.1)'
  const bgColor = isProfessional ? '#f1f5f9' : 'rgba(0,0,0,0.95)'
  const headerBg = isProfessional ? 'white' : 'rgba(255,255,255,0.05)'
  
  // Capsule Builder store state
  const isOpen = useCapsuleBuilder(state => state.isOpen)
  const context = useCapsuleBuilder(state => state.context)
  const capsule = useCapsuleBuilder(state => state.capsule)
  const isBuilding = useCapsuleBuilder(state => state.isBuilding)
  const validationErrors = useCapsuleBuilder(state => state.validationErrors)
  
  // Capsule Builder store actions
  const closeBuilder = useCapsuleBuilder(state => state.closeBuilder)
  const setText = useCapsuleBuilder(state => state.setText)
  const addAttachment = useCapsuleBuilder(state => state.addAttachment)
  const removeAttachment = useCapsuleBuilder(state => state.removeAttachment)
  const selectSession = useCapsuleBuilder(state => state.selectSession)
  const deselectSession = useCapsuleBuilder(state => state.deselectSession)
  const setDataRequest = useCapsuleBuilder(state => state.setDataRequest)
  const hasCapability = useCapsuleBuilder(state => state.hasCapability)
  const apply = useCapsuleBuilder(state => state.apply)
  
  // Envelope Generator store state
  const generatedEnvelope = useEnvelopeGenerator(state => state.envelope)
  const envelopeSummary = useEnvelopeGenerator(state => state.summary)
  const generationCount = useEnvelopeGenerator(state => state.generationCount)
  const isRegenerating = useEnvelopeGenerator(state => state.isRegenerating)
  const boundary = useEnvelopeGenerator(state => state.boundary)
  
  // Envelope Generator store actions
  const regenerateEnvelope = useEnvelopeGenerator(state => state.regenerateEnvelope)
  const resetBoundary = useEnvelopeGenerator(state => state.reset)
  
  // Regenerate envelope when builder opens (if not already generated)
  useEffect(() => {
    if (isOpen && !generatedEnvelope) {
      regenerateEnvelope()
    }
  }, [isOpen, generatedEnvelope, regenerateEnvelope])
  
  if (!isOpen) return null
  
  // Get source label
  const getSourceLabel = () => {
    switch (context?.source) {
      case 'wr-chat-direct': return 'WR Chat — Direct'
      case 'wr-chat-group': return 'WR Chat — Group Session'
      case 'beap-drafts': return 'BEAP Messages — Draft'
      case 'content-script': return 'Content Script'
      default: return 'BEAP Builder'
    }
  }
  
  // Handle apply
  const handleApply = () => {
    // Ensure envelope is current
    if (!generatedEnvelope) {
      regenerateEnvelope()
    }
    
    const result = apply()
    if (result.success) {
      onApply?.({ envelopeRequiresRegeneration: result.envelopeRequiresRegeneration })
    }
  }
  
  // Handle cancel
  const handleCancel = () => {
    closeBuilder()
    onCancel?.()
  }
  
  // Get available sessions for selection
  const availableSessionsForBoundary = availableSessions.map(s => ({
    id: s.sessionId,
    name: s.sessionName
  }))
  
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 10000,
      padding: '20px'
    }}>
      <div style={{
        background: bgColor,
        borderRadius: '12px',
        width: '100%',
        maxWidth: '600px',
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: `1px solid ${borderColor}`
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px',
          borderBottom: `1px solid ${borderColor}`,
          background: headerBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>📦</span>
              <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: textColor }}>
                BEAP™ Capsule Builder
              </h2>
            </div>
            <div style={{ fontSize: '11px', color: mutedColor, marginTop: '4px', marginLeft: '30px' }}>
              {getSourceLabel()}
            </div>
          </div>
          <button
            onClick={handleCancel}
            style={{
              background: 'transparent',
              border: 'none',
              color: mutedColor,
              fontSize: '20px',
              cursor: 'pointer',
              padding: '4px 8px'
            }}
          >
            ×
          </button>
        </div>
        
        {/* Validation Errors */}
        {validationErrors.length > 0 && (
          <div style={{
            padding: '10px 18px',
            background: 'rgba(239,68,68,0.1)',
            borderBottom: `1px solid rgba(239,68,68,0.2)`
          }}>
            {validationErrors.map((error, idx) => (
              <div key={idx} style={{ fontSize: '12px', color: '#ef4444' }}>
                ⚠ {error}
              </div>
            ))}
          </div>
        )}
        
        {/* Content */}
        <div style={{ 
          flex: 1, 
          overflowY: 'auto', 
          padding: '16px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}>
          {/* Envelope Summary (Read-Only) */}
          <EnvelopeSummaryPanel theme={theme} />
          
          {/* Capsule Section (Editable) */}
          <CapsuleSection
            capsule={capsule}
            availableSessions={availableSessions}
            onTextChange={setText}
            onAddAttachment={addAttachment}
            onRemoveAttachment={removeAttachment}
            onSelectSession={selectSession}
            onDeselectSession={deselectSession}
            onDataRequestChange={setDataRequest}
            hasCapability={hasCapability}
            theme={theme}
          />
          
          {/* Execution Boundary Panel (Envelope-bound) */}
          <ExecutionBoundaryPanel
            theme={theme}
            availableSessions={availableSessionsForBoundary}
          />
        </div>
        
        {/* Footer Actions */}
        <div style={{
          padding: '14px 18px',
          borderTop: `1px solid ${borderColor}`,
          background: headerBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <EnvelopeBadge theme={theme} />
            {isRegenerating && (
              <span style={{ fontSize: '10px', color: '#f59e0b' }}>
                Regenerating...
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              onClick={handleCancel}
              style={{
                padding: '8px 16px',
                fontSize: '13px',
                fontWeight: 500,
                background: 'transparent',
                border: `1px solid ${borderColor}`,
                color: textColor,
                borderRadius: '6px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={isBuilding}
              style={{
                padding: '8px 20px',
                fontSize: '13px',
                fontWeight: 600,
                background: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
                border: 'none',
                color: 'white',
                borderRadius: '6px',
                cursor: isBuilding ? 'wait' : 'pointer',
                opacity: isBuilding ? 0.7 : 1
              }}
            >
              {isBuilding ? 'Applying...' : 'Apply'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BeapCapsuleBuilder

