/**
 * BEAP Builder Modal
 * 
 * The unified BEAP Builder UI component.
 * Used in Explicit Mode when user needs to configure package permissions,
 * attachments, or automation settings.
 * 
 * DESIGN:
 * - Context-aware: prefills based on source (WR Chat, Drafts, etc.)
 * - Shows handshake if available
 * - Displays current mode triggers
 * - Allows policy customization
 * 
 * @version 1.0.0
 */

import React, { useMemo } from 'react'
import { useBeapBuilder, analyzeModeTriggers } from '../useBeapBuilder'
import { usePolicyStore } from '../../policy/store/usePolicyStore'
import type { BuilderAttachment, ExplicitModeReason } from '../types'

interface BeapBuilderModalProps {
  theme?: 'default' | 'dark' | 'professional'
  onClose?: () => void
  onBuild?: (packageId: string) => void
}

// Readable labels for explicit mode reasons
const REASON_LABELS: Record<ExplicitModeReason, string> = {
  'user_invoked_builder': 'You opened the BEAP Builder',
  'has_attachments': 'Package contains attachments',
  'has_media': 'Package contains media files',
  'automation_requested': 'Automation permissions requested',
  'ingress_deviation': 'Custom ingress settings',
  'egress_deviation': 'Custom egress settings',
  'policy_deviation': 'Custom policy differs from baseline',
  'session_context': 'Package is part of automation session'
}

export function BeapBuilderModal({ theme = 'default', onClose, onBuild }: BeapBuilderModalProps) {
  const {
    isOpen,
    context,
    draft,
    selectedHandshake,
    customPolicy,
    automationConfig,
    validationErrors,
    isBuilding,
    updateDraft,
    addAttachment,
    removeAttachment,
    setHandshake,
    setAutomationConfig,
    buildExplicit,
    closeBuilder
  } = useBeapBuilder()
  
  const baselinePolicy = usePolicyStore(state => state.localPolicy)
  
  // Analyze current mode triggers
  const modeAnalysis = useMemo(() => {
    return analyzeModeTriggers(
      draft.body,
      draft.attachments,
      automationConfig.enabled,
      automationConfig.sessionId !== null,
      true, // User invoked builder
      customPolicy,
      baselinePolicy
    )
  }, [draft, automationConfig, customPolicy, baselinePolicy])
  
  if (!isOpen) return null
  
  const isDark = theme === 'default' || theme === 'dark'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  const bgColor = isDark ? '#1e293b' : '#ffffff'
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  const cardBg = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.02)'
  
  const handleBuild = async () => {
    const result = await buildExplicit({
      content: draft.body,
      contentType: 'text',
      target: draft.target,
      subject: draft.subject,
      attachments: draft.attachments,
      automation: automationConfig.enabled ? automationConfig : undefined,
      handshakeId: selectedHandshake?.id
    })
    
    if (result.success && result.packageId) {
      onBuild?.(result.packageId)
      closeBuilder()
    }
  }
  
  const handleClose = () => {
    closeBuilder()
    onClose?.()
  }
  
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files) return
    
    Array.from(files).forEach(file => {
      const attachment: BuilderAttachment = {
        id: crypto.randomUUID(),
        name: file.name,
        type: file.type,
        size: file.size,
        dataRef: URL.createObjectURL(file),
        isMedia: file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/')
      }
      addAttachment(attachment)
    })
    
    // Reset input
    event.target.value = ''
  }
  
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 10000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0, 0, 0, 0.6)',
      backdropFilter: 'blur(4px)'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '560px',
        maxHeight: '80vh',
        background: bgColor,
        borderRadius: '16px',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: `1px solid ${borderColor}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: isDark ? 'rgba(139, 92, 246, 0.1)' : 'rgba(139, 92, 246, 0.05)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '20px' }}>📦</span>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: textColor }}>
                BEAP™ Builder
              </h3>
              <p style={{ margin: 0, fontSize: '11px', color: mutedColor }}>
                Configure package permissions and automation
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            style={{
              background: 'none',
              border: 'none',
              color: mutedColor,
              fontSize: '20px',
              cursor: 'pointer',
              padding: '4px',
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>
        
        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
          {/* Context Badge */}
          {context && (
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              background: cardBg,
              borderRadius: '20px',
              fontSize: '11px',
              color: mutedColor,
              marginBottom: '16px'
            }}>
              <span>From:</span>
              <span style={{ fontWeight: 600, color: textColor }}>
                {context.source === 'wr-chat' && '💬 WR Chat'}
                {context.source === 'drafts' && '📝 Drafts'}
                {context.source === 'inbox' && '📥 Inbox'}
                {context.source === 'content-script' && '🌐 Page'}
              </span>
            </div>
          )}
          
          {/* Handshake Info */}
          {selectedHandshake && (
            <div style={{
              padding: '12px 14px',
              background: isDark ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.05)',
              border: `1px solid ${isDark ? 'rgba(34, 197, 94, 0.3)' : 'rgba(34, 197, 94, 0.2)'}`,
              borderRadius: '10px',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}>
              <span style={{ fontSize: '16px' }}>🤝</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '13px', fontWeight: 600, color: textColor }}>
                  {selectedHandshake.displayName}
                </div>
                <div style={{ fontSize: '11px', color: mutedColor, fontFamily: 'monospace' }}>
                  {selectedHandshake.fingerprint_short}
                </div>
              </div>
              <span style={{
                fontSize: '10px',
                fontWeight: 600,
                color: selectedHandshake.automation_mode === 'ALLOW' ? '#22c55e' : '#f59e0b',
                background: selectedHandshake.automation_mode === 'ALLOW' ? 'rgba(34, 197, 94, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                padding: '3px 8px',
                borderRadius: '10px'
              }}>
                {selectedHandshake.automation_mode}
              </span>
            </div>
          )}
          
          {/* Mode Triggers (why explicit mode) */}
          {modeAnalysis.explicitReasons.length > 0 && (
            <div style={{
              padding: '12px 14px',
              background: isDark ? 'rgba(251, 146, 60, 0.1)' : 'rgba(251, 146, 60, 0.05)',
              border: `1px solid ${isDark ? 'rgba(251, 146, 60, 0.3)' : 'rgba(251, 146, 60, 0.2)'}`,
              borderRadius: '10px',
              marginBottom: '16px'
            }}>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#fb923c', marginBottom: '8px' }}>
                ⚡ Explicit Mode Required
              </div>
              <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '11px', color: mutedColor }}>
                {modeAnalysis.explicitReasons.map(reason => (
                  <li key={reason} style={{ marginBottom: '2px' }}>
                    {REASON_LABELS[reason]}
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          {/* Target */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '6px' }}>
              Recipient
            </label>
            <input
              type="text"
              value={draft.target}
              onChange={(e) => updateDraft({ target: e.target.value })}
              placeholder="Email or identifier..."
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '13px',
                background: cardBg,
                border: `1px solid ${borderColor}`,
                borderRadius: '8px',
                color: textColor,
                outline: 'none'
              }}
            />
          </div>
          
          {/* Subject */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '6px' }}>
              Subject
            </label>
            <input
              type="text"
              value={draft.subject}
              onChange={(e) => updateDraft({ subject: e.target.value })}
              placeholder="Package subject..."
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '13px',
                background: cardBg,
                border: `1px solid ${borderColor}`,
                borderRadius: '8px',
                color: textColor,
                outline: 'none'
              }}
            />
          </div>
          
          {/* Body */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '6px' }}>
              Content
            </label>
            <textarea
              value={draft.body}
              onChange={(e) => updateDraft({ body: e.target.value })}
              placeholder="Package content..."
              rows={4}
              style={{
                width: '100%',
                padding: '10px 12px',
                fontSize: '13px',
                background: cardBg,
                border: `1px solid ${borderColor}`,
                borderRadius: '8px',
                color: textColor,
                outline: 'none',
                resize: 'vertical',
                fontFamily: 'inherit'
              }}
            />
          </div>
          
          {/* Attachments */}
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: textColor, marginBottom: '6px' }}>
              Attachments
            </label>
            
            {draft.attachments.length > 0 && (
              <div style={{ marginBottom: '10px' }}>
                {draft.attachments.map(att => (
                  <div
                    key={att.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 10px',
                      background: cardBg,
                      border: `1px solid ${borderColor}`,
                      borderRadius: '6px',
                      marginBottom: '6px'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '14px' }}>
                        {att.isMedia ? '🖼️' : '📎'}
                      </span>
                      <span style={{ fontSize: '12px', color: textColor }}>{att.name}</span>
                      <span style={{ fontSize: '10px', color: mutedColor }}>
                        ({(att.size / 1024).toFixed(1)} KB)
                      </span>
                    </div>
                    <button
                      onClick={() => removeAttachment(att.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#ef4444',
                        fontSize: '14px',
                        cursor: 'pointer'
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <label style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px 14px',
              background: cardBg,
              border: `1px dashed ${borderColor}`,
              borderRadius: '8px',
              fontSize: '12px',
              color: mutedColor,
              cursor: 'pointer'
            }}>
              <input
                type="file"
                multiple
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <span>📎</span>
              <span>Add files</span>
            </label>
          </div>
          
          {/* Automation Toggle */}
          <div style={{
            padding: '12px 14px',
            background: cardBg,
            border: `1px solid ${borderColor}`,
            borderRadius: '10px',
            marginBottom: '16px'
          }}>
            <label style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer'
            }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 600, color: textColor }}>
                  🤖 Enable Automation
                </div>
                <div style={{ fontSize: '11px', color: mutedColor, marginTop: '2px' }}>
                  Allow package to execute automated actions
                </div>
              </div>
              <input
                type="checkbox"
                checked={automationConfig.enabled}
                onChange={(e) => setAutomationConfig({ enabled: e.target.checked })}
                style={{ width: '18px', height: '18px', cursor: 'pointer' }}
              />
            </label>
            
            {automationConfig.enabled && !selectedHandshake && (
              <div style={{
                marginTop: '10px',
                padding: '8px 10px',
                background: isDark ? 'rgba(239, 68, 68, 0.1)' : 'rgba(239, 68, 68, 0.05)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#ef4444'
              }}>
                ⚠️ No handshake selected. Automation requires explicit consent from recipient.
              </div>
            )}
          </div>
          
          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <div style={{
              padding: '12px 14px',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '10px',
              marginBottom: '16px'
            }}>
              {validationErrors.map((error, i) => (
                <div key={i} style={{ fontSize: '12px', color: '#ef4444' }}>
                  ⚠️ {error}
                </div>
              ))}
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div style={{
          padding: '16px 20px',
          borderTop: `1px solid ${borderColor}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '10px',
          background: cardBg
        }}>
          <button
            onClick={handleClose}
            style={{
              padding: '10px 16px',
              fontSize: '13px',
              fontWeight: 500,
              background: 'transparent',
              border: `1px solid ${borderColor}`,
              borderRadius: '8px',
              color: textColor,
              cursor: 'pointer'
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleBuild}
            disabled={isBuilding || !draft.target || !draft.subject}
            style={{
              padding: '10px 20px',
              fontSize: '13px',
              fontWeight: 600,
              background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
              border: 'none',
              borderRadius: '8px',
              color: 'white',
              cursor: isBuilding ? 'wait' : 'pointer',
              opacity: isBuilding || !draft.target || !draft.subject ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            {isBuilding ? (
              <>⏳ Building...</>
            ) : (
              <>📦 Build Package</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}



