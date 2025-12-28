/**
 * Derivations Domain Editor
 * 
 * Visual editor for post-verification derivation capabilities.
 * Controls WHAT CAN BE DERIVED from artefacts AFTER BEAP verification.
 * 
 * BEAP SECURITY:
 * - ALL derivations occur ONLY after BEAP verification completes
 * - Each derivation has a risk tier
 */

import type { DerivationsPolicy, DerivationCapability } from '../../schema'
import { getDerivationRisk, type DerivationRisk } from '../../schema/domains/derivations'

interface DerivationsEditorProps {
  policy: DerivationsPolicy
  onChange: (updated: DerivationsPolicy) => void
  theme?: 'default' | 'dark' | 'professional'
}

const DERIVATION_CAPABILITIES: {
  key: keyof DerivationsPolicy
  name: string
  description: string
  icon: string
}[] = [
  // Minimal risk
  { key: 'deriveMetadata', name: 'Metadata', description: 'Size, type, count, timestamps', icon: '📊' },
  // Low risk
  { key: 'derivePlainText', name: 'Plain Text', description: 'Extract text from text artefacts', icon: '📝' },
  { key: 'deriveStructuredData', name: 'Structured Data', description: 'JSON/CSV extraction', icon: '📋' },
  // Medium risk
  { key: 'derivePdfText', name: 'PDF Text', description: 'Extract text from PDFs', icon: '📄' },
  { key: 'deriveImageOcr', name: 'Image OCR', description: 'OCR text from images', icon: '🔍' },
  { key: 'deriveHtmlSanitized', name: 'HTML Sanitized', description: 'Strip scripts/styles', icon: '🧹' },
  { key: 'derivePreviewThumbnails', name: 'Thumbnails', description: 'Generate preview images', icon: '🖼️' },
  { key: 'deriveEmbeddings', name: 'Embeddings', description: 'Vector embeddings', icon: '🧮' },
  { key: 'deriveLlmSummary', name: 'LLM Summary', description: 'AI-generated summary', icon: '🤖' },
  { key: 'deriveCodeParsed', name: 'Code Parse', description: 'Syntax highlighting', icon: '💻' },
  // High risk
  { key: 'deriveAutomationExec', name: 'Automation Exec', description: 'Execute workflows', icon: '⚡' },
  { key: 'deriveSandboxedRender', name: 'Sandbox Render', description: 'Sandboxed preview', icon: '🔲' },
  { key: 'deriveExternalApiCall', name: 'External API', description: 'Call external APIs', icon: '🌐' },
  // Critical risk
  { key: 'deriveOriginalReconstruction', name: 'Original Reconstruction', description: 'Unseal original artefact', icon: '🔓' },
  { key: 'deriveExternalExport', name: 'External Export', description: 'Export to external storage', icon: '📤' },
  { key: 'deriveFullDecryption', name: 'Full Decryption', description: 'Decrypt all layers', icon: '🔑' },
]

const RISK_COLORS: Record<DerivationRisk, { bg: string; border: string; text: string }> = {
  minimal: { bg: 'rgba(34, 197, 94, 0.1)', border: '#22c55e', text: '#22c55e' },
  low: { bg: 'rgba(59, 130, 246, 0.1)', border: '#3b82f6', text: '#3b82f6' },
  medium: { bg: 'rgba(245, 158, 11, 0.1)', border: '#f59e0b', text: '#f59e0b' },
  high: { bg: 'rgba(249, 115, 22, 0.1)', border: '#f97316', text: '#f97316' },
  critical: { bg: 'rgba(239, 68, 68, 0.1)', border: '#ef4444', text: '#ef4444' },
}

export function DerivationsEditor({ policy, onChange, theme = 'default' }: DerivationsEditorProps) {
  const isDark = theme === 'default' || theme === 'dark'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  const cardBg = isDark ? 'rgba(255, 255, 255, 0.03)' : 'rgba(0, 0, 0, 0.02)'
  const inputBg = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)'

  const updateCapability = (key: keyof DerivationsPolicy, updates: Partial<DerivationCapability>) => {
    const current = policy[key] as DerivationCapability
    onChange({
      ...policy,
      [key]: { ...current, ...updates },
    })
  }

  const toggleBoolean = (key: keyof DerivationsPolicy) => {
    onChange({ ...policy, [key]: !policy[key] })
  }

  const updateNumber = (key: keyof DerivationsPolicy, value: number) => {
    onChange({ ...policy, [key]: value })
  }

  // Group by risk tier
  const groupedCapabilities = {
    minimal: DERIVATION_CAPABILITIES.filter(c => getDerivationRisk(c.key) === 'minimal'),
    low: DERIVATION_CAPABILITIES.filter(c => getDerivationRisk(c.key) === 'low'),
    medium: DERIVATION_CAPABILITIES.filter(c => getDerivationRisk(c.key) === 'medium'),
    high: DERIVATION_CAPABILITIES.filter(c => getDerivationRisk(c.key) === 'high'),
    critical: DERIVATION_CAPABILITIES.filter(c => getDerivationRisk(c.key) === 'critical'),
  }

  const renderRiskGroup = (riskTier: DerivationRisk, capabilities: typeof DERIVATION_CAPABILITIES) => {
    if (capabilities.length === 0) return null
    const colors = RISK_COLORS[riskTier]
    
    return (
      <div key={riskTier} style={{
        padding: '16px',
        background: colors.bg,
        border: `1px solid ${colors.border}40`,
        borderRadius: '10px',
      }}>
        <h4 style={{
          margin: '0 0 16px',
          color: colors.text,
          fontSize: '13px',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span style={{
            padding: '2px 8px',
            background: colors.border,
            borderRadius: '4px',
            color: 'white',
            fontSize: '10px',
          }}>
            {riskTier.toUpperCase()}
          </span>
          Risk Derivations
        </h4>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
          {capabilities.map(cap => {
            const config = policy[cap.key] as DerivationCapability
            if (!config) return null
            
            return (
              <div
                key={cap.key}
                style={{
                  padding: '12px',
                  background: cardBg,
                  border: `1px solid ${config.enabled ? colors.border : borderColor}`,
                  borderRadius: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '16px' }}>{cap.icon}</span>
                    <div>
                      <div style={{ color: textColor, fontWeight: 500, fontSize: '13px' }}>{cap.name}</div>
                      <div style={{ color: mutedColor, fontSize: '11px' }}>{cap.description}</div>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={config.enabled}
                    onChange={() => updateCapability(cap.key, { enabled: !config.enabled })}
                    style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                  />
                </div>
                
                {config.enabled && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '10px', paddingTop: '10px', borderTop: `1px solid ${borderColor}` }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={config.requireApproval}
                        onChange={() => updateCapability(cap.key, { requireApproval: !config.requireApproval })}
                        style={{ width: '14px', height: '14px' }}
                      />
                      <span style={{ color: mutedColor, fontSize: '11px' }}>Approval</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={config.auditUsage}
                        onChange={() => updateCapability(cap.key, { auditUsage: !config.auditUsage })}
                        style={{ width: '14px', height: '14px' }}
                      />
                      <span style={{ color: mutedColor, fontSize: '11px' }}>Audit</span>
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ color: mutedColor, fontSize: '11px' }}>Max:</span>
                      <input
                        type="number"
                        value={config.maxUsesPerPackage}
                        onChange={(e) => updateCapability(cap.key, { maxUsesPerPackage: parseInt(e.target.value) || 0 })}
                        min={0}
                        style={{
                          width: '50px',
                          padding: '2px 4px',
                          background: inputBg,
                          border: `1px solid ${borderColor}`,
                          borderRadius: '4px',
                          color: textColor,
                          fontSize: '11px',
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Security Notice */}
      <div style={{
        padding: '14px 16px',
        background: isDark ? 'rgba(34, 197, 94, 0.1)' : 'rgba(34, 197, 94, 0.1)',
        border: `1px solid ${isDark ? 'rgba(34, 197, 94, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
        borderRadius: '8px',
        display: 'flex',
        alignItems: 'start',
        gap: '12px',
      }}>
        <span style={{ fontSize: '18px' }}>✅</span>
        <div>
          <div style={{ color: textColor, fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>
            Post-Verification Derivations
          </div>
          <div style={{ color: mutedColor, fontSize: '12px', lineHeight: '1.5' }}>
            These capabilities are only available AFTER BEAP verification completes. Original artefacts
            remain sealed. Derivations are one-way transformations grouped by risk tier.
          </div>
        </div>
      </div>

      {/* Global Settings */}
      <div style={{ padding: '16px', background: cardBg, border: `1px solid ${borderColor}`, borderRadius: '10px' }}>
        <h4 style={{ margin: '0 0 12px', color: textColor, fontSize: '14px', fontWeight: 600 }}>
          Global Derivation Settings
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={policy.requireWrguardActive}
              onChange={() => toggleBoolean('requireWrguardActive')}
              style={{ width: '16px', height: '16px' }}
            />
            <div>
              <span style={{ color: textColor, fontSize: '13px', fontWeight: 500 }}>Require WRGuard Active</span>
              <span style={{ color: mutedColor, fontSize: '12px', marginLeft: '8px' }}>
                Security invariant
              </span>
            </div>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={policy.auditAllDerivations}
              onChange={() => toggleBoolean('auditAllDerivations')}
              style={{ width: '16px', height: '16px' }}
            />
            <span style={{ color: textColor, fontSize: '13px' }}>Audit All Derivations</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={policy.cacheDerivations}
              onChange={() => toggleBoolean('cacheDerivations')}
              style={{ width: '16px', height: '16px' }}
            />
            <span style={{ color: textColor, fontSize: '13px' }}>Cache Derivations</span>
          </label>
          <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
            <div>
              <label style={{ display: 'block', color: mutedColor, fontSize: '11px', marginBottom: '4px' }}>
                Max Total/Package
              </label>
              <input
                type="number"
                value={policy.maxTotalDerivationsPerPackage}
                onChange={(e) => updateNumber('maxTotalDerivationsPerPackage', parseInt(e.target.value) || 1)}
                min={1}
                style={{
                  width: '100px',
                  padding: '6px 8px',
                  background: inputBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '6px',
                  color: textColor,
                  fontSize: '13px',
                }}
              />
            </div>
            <div>
              <label style={{ display: 'block', color: mutedColor, fontSize: '11px', marginBottom: '4px' }}>
                Cache TTL (sec)
              </label>
              <input
                type="number"
                value={policy.cacheTtlSeconds}
                onChange={(e) => updateNumber('cacheTtlSeconds', parseInt(e.target.value) || 60)}
                min={60}
                style={{
                  width: '100px',
                  padding: '6px 8px',
                  background: inputBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '6px',
                  color: textColor,
                  fontSize: '13px',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Risk Groups */}
      {renderRiskGroup('minimal', groupedCapabilities.minimal)}
      {renderRiskGroup('low', groupedCapabilities.low)}
      {renderRiskGroup('medium', groupedCapabilities.medium)}
      {renderRiskGroup('high', groupedCapabilities.high)}
      {renderRiskGroup('critical', groupedCapabilities.critical)}
    </div>
  )
}

