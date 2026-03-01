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
import {
  getThemeTokens,
  overlayStyle,
  panelStyle,
  headerStyle,
  headerTitleStyle,
  headerMainTitleStyle,
  headerSubtitleStyle,
  closeButtonStyle,
  bodyStyle,
  cardStyle,
  inputStyle,
  labelStyle,
  primaryButtonStyle,
  secondaryButtonStyle,
  notificationStyle,
} from '../../shared/ui/lightboxTheme'

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

  const t = getThemeTokens(theme)
  
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
  
  const buildDisabled = isBuilding || !draft.target || !draft.subject

  return (
    <div style={overlayStyle(t)}>
      <div style={panelStyle(t)}>
        {/* Header */}
        <div style={headerStyle(t)}>
          <div style={headerTitleStyle()}>
            <span style={{ fontSize: '22px', flexShrink: 0 }}>📦</span>
            <div>
              <p style={headerMainTitleStyle()}>BEAP™ Builder</p>
              <p style={headerSubtitleStyle()}>Configure package permissions and automation</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            style={closeButtonStyle(t)}
            onMouseEnter={(e) => { e.currentTarget.style.background = t.closeHoverBg; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = t.closeBg; }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={bodyStyle(t)}>
          <div style={{ maxWidth: '700px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Context Badge */}
            {context && (
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 12px',
                background: t.cardBg,
                border: `1px solid ${t.border}`,
                borderRadius: '20px',
                fontSize: '11px',
                color: t.textMuted,
                alignSelf: 'flex-start',
              }}>
                <span>From:</span>
                <span style={{ fontWeight: 600, color: t.text }}>
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
                ...cardStyle(t),
                background: 'rgba(34,197,94,0.09)',
                border: '1px solid rgba(34,197,94,0.25)',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}>
                <span style={{ fontSize: '16px' }}>🤝</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: t.text }}>{selectedHandshake.displayName}</div>
                  <div style={{ fontSize: '11px', color: t.textMuted, fontFamily: 'monospace' }}>{selectedHandshake.fingerprint_short}</div>
                </div>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  color: selectedHandshake.automation_mode === 'ALLOW' ? t.success : t.warning,
                  background: selectedHandshake.automation_mode === 'ALLOW' ? 'rgba(34,197,94,0.2)' : 'rgba(245,158,11,0.2)',
                  padding: '3px 8px',
                  borderRadius: '10px',
                }}>
                  {selectedHandshake.automation_mode}
                </span>
              </div>
            )}

            {/* Explicit Mode Reasons */}
            {modeAnalysis.explicitReasons.length > 0 && (
              <div style={{
                padding: '12px 14px',
                background: 'rgba(251,146,60,0.10)',
                border: '1px solid rgba(251,146,60,0.3)',
                borderRadius: '10px',
              }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: t.warning, marginBottom: '8px' }}>
                  ⚡ Explicit Mode Required
                </div>
                <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '11px', color: t.textMuted }}>
                  {modeAnalysis.explicitReasons.map(reason => (
                    <li key={reason} style={{ marginBottom: '2px' }}>{REASON_LABELS[reason]}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Recipient */}
            <div>
              <label style={labelStyle(t)}>Recipient</label>
              <input type="text" value={draft.target} onChange={(e) => updateDraft({ target: e.target.value })}
                placeholder="Email or identifier..." style={inputStyle(t)} />
            </div>

            {/* Subject */}
            <div>
              <label style={labelStyle(t)}>Subject</label>
              <input type="text" value={draft.subject} onChange={(e) => updateDraft({ subject: e.target.value })}
                placeholder="Package subject..." style={inputStyle(t)} />
            </div>

            {/* Body */}
            <div>
              <label style={labelStyle(t)}>Content</label>
              <textarea
                value={draft.body}
                onChange={(e) => updateDraft({ body: e.target.value })}
                placeholder="Package content..."
                rows={5}
                style={{ ...inputStyle(t), resize: 'vertical', fontFamily: 'inherit', minHeight: '100px' }}
              />
            </div>

            {/* Attachments */}
            <div>
              <label style={labelStyle(t)}>Attachments</label>
              {draft.attachments.length > 0 && (
                <div style={{ marginBottom: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {draft.attachments.map(att => (
                    <div key={att.id} style={{
                      ...cardStyle(t),
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px' }}>{att.isMedia ? '🖼️' : '📎'}</span>
                        <span style={{ fontSize: '12px', color: t.text }}>{att.name}</span>
                        <span style={{ fontSize: '10px', color: t.textMuted }}>({(att.size / 1024).toFixed(1)} KB)</span>
                      </div>
                      <button onClick={() => removeAttachment(att.id)} style={{ background: 'none', border: 'none', color: t.error, fontSize: '16px', cursor: 'pointer' }}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <label style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                background: t.cardBg,
                border: `1px dashed ${t.border}`,
                borderRadius: '8px',
                fontSize: '12px',
                color: t.textMuted,
                cursor: 'pointer',
              }}>
                <input type="file" multiple onChange={handleFileSelect} style={{ display: 'none' }} />
                <span>📎</span>
                <span>Add files</span>
              </label>
            </div>

            {/* Automation Toggle */}
            <div style={cardStyle(t)}>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: t.text }}>🤖 Enable Automation</div>
                  <div style={{ fontSize: '11px', color: t.textMuted, marginTop: '2px' }}>Allow package to execute automated actions</div>
                </div>
                <input
                  type="checkbox"
                  checked={automationConfig.enabled}
                  onChange={(e) => setAutomationConfig({ enabled: e.target.checked })}
                  style={{ width: '17px', height: '17px', cursor: 'pointer', accentColor: t.accentColor }}
                />
              </label>
              {automationConfig.enabled && !selectedHandshake && (
                <div style={{ ...notificationStyle('error'), marginTop: '10px', fontSize: '11px' }}>
                  ⚠️ No handshake selected. Automation requires explicit consent from recipient.
                </div>
              )}
            </div>

            {/* Validation Errors */}
            {validationErrors.length > 0 && (
              <div style={notificationStyle('error')}>
                {validationErrors.map((error, i) => (
                  <div key={i} style={{ fontSize: '12px' }}>⚠️ {error}</div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '16px 20px',
          borderTop: `1px solid ${t.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: '10px',
          background: t.cardBg,
          flexShrink: 0,
        }}>
          <button onClick={handleClose} style={secondaryButtonStyle(t)}>Cancel</button>
          <button
            onClick={handleBuild}
            disabled={buildDisabled}
            style={{ ...primaryButtonStyle(t, buildDisabled), display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            {isBuilding ? '⏳ Building...' : '📦 Build Package'}
          </button>
        </div>
      </div>
    </div>
  )
}



