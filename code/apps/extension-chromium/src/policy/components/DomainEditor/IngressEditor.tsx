/**
 * Ingress Domain Editor
 * 
 * Visual editor for ingress policy settings.
 */

import type { IngressPolicy, ArtefactType, ParsingConstraint } from '../../schema'

interface IngressEditorProps {
  policy: IngressPolicy
  onChange: (updated: IngressPolicy) => void
  theme?: 'default' | 'dark' | 'professional'
}

const ARTEFACT_TYPES: { value: ArtefactType; label: string; description: string; risk: 'low' | 'medium' | 'high' }[] = [
  { value: 'text', label: 'Plain Text', description: 'Raw text content', risk: 'low' },
  { value: 'markdown', label: 'Markdown', description: 'Formatted markdown', risk: 'low' },
  { value: 'html_sanitized', label: 'HTML (Sanitized)', description: 'HTML with scripts stripped', risk: 'medium' },
  { value: 'pdf_text', label: 'PDF Text', description: 'Extracted text from PDFs', risk: 'medium' },
  { value: 'image_ocr', label: 'Image OCR', description: 'Text extracted from images', risk: 'medium' },
  { value: 'structured_data', label: 'Structured Data', description: 'JSON/CSV formats', risk: 'medium' },
  { value: 'attachment_metadata', label: 'Attachment Metadata', description: 'File info only', risk: 'low' },
  { value: 'code_snippet', label: 'Code Snippets', description: 'Source code with syntax', risk: 'medium' },
]

export function IngressEditor({ policy, onChange, theme = 'default' }: IngressEditorProps) {
  const isDark = theme === 'default' || theme === 'dark'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'
  const inputBg = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.03)'

  const toggleArtefactType = (type: ArtefactType) => {
    const current = policy.allowedArtefactTypes || []
    const updated = current.includes(type)
      ? current.filter(t => t !== type)
      : [...current, type]
    onChange({ ...policy, allowedArtefactTypes: updated })
  }

  const toggleBoolean = (key: keyof IngressPolicy) => {
    onChange({ ...policy, [key]: !policy[key] })
  }

  const updateNumber = (key: keyof IngressPolicy, value: number) => {
    onChange({ ...policy, [key]: value })
  }

  const updateParsingConstraint = (value: ParsingConstraint) => {
    onChange({ ...policy, parsingConstraint: value })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Artefact Types */}
      <section>
        <h4 style={{ margin: '0 0 12px', color: textColor, fontSize: '14px', fontWeight: 600 }}>
          Allowed Artefact Types
        </h4>
        <p style={{ margin: '0 0 12px', color: mutedColor, fontSize: '13px' }}>
          Select which content types can be processed
        </p>
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: '8px',
        }}>
          {ARTEFACT_TYPES.map(type => {
            const isChecked = policy.allowedArtefactTypes?.includes(type.value)
            return (
              <label
                key={type.value}
                style={{
                  display: 'flex',
                  alignItems: 'start',
                  gap: '10px',
                  padding: '12px',
                  background: isChecked ? `${getRiskColor(type.risk)}15` : inputBg,
                  border: `1px solid ${isChecked ? getRiskColor(type.risk) : borderColor}`,
                  borderRadius: '8px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={() => toggleArtefactType(type.value)}
                  style={{ marginTop: '2px', accentColor: getRiskColor(type.risk) }}
                />
                <div>
                  <div style={{ fontWeight: 500, color: textColor, fontSize: '13px' }}>
                    {type.label}
                  </div>
                  <div style={{ fontSize: '11px', color: mutedColor }}>
                    {type.description}
                  </div>
                </div>
                <span style={{
                  marginLeft: 'auto',
                  padding: '2px 6px',
                  fontSize: '10px',
                  fontWeight: 600,
                  borderRadius: '4px',
                  background: `${getRiskColor(type.risk)}20`,
                  color: getRiskColor(type.risk),
                  textTransform: 'uppercase',
                }}>
                  {type.risk}
                </span>
              </label>
            )
          })}
        </div>
      </section>

      {/* Size Limits */}
      <section>
        <h4 style={{ margin: '0 0 12px', color: textColor, fontSize: '14px', fontWeight: 600 }}>
          Size Limits
        </h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', color: mutedColor, fontSize: '12px' }}>
              Max Size per Artefact
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="number"
                value={Math.round(policy.maxSizeBytes / 1_000_000)}
                onChange={(e) => updateNumber('maxSizeBytes', parseInt(e.target.value) * 1_000_000 || 0)}
                min={1}
                max={100}
                style={{
                  width: '80px',
                  padding: '8px',
                  background: inputBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '6px',
                  color: textColor,
                  fontSize: '14px',
                }}
              />
              <span style={{ color: mutedColor, fontSize: '13px' }}>MB</span>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', color: mutedColor, fontSize: '12px' }}>
              Max Total Size
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="number"
                value={Math.round(policy.maxTotalSizeBytes / 1_000_000)}
                onChange={(e) => updateNumber('maxTotalSizeBytes', parseInt(e.target.value) * 1_000_000 || 0)}
                min={1}
                max={500}
                style={{
                  width: '80px',
                  padding: '8px',
                  background: inputBg,
                  border: `1px solid ${borderColor}`,
                  borderRadius: '6px',
                  color: textColor,
                  fontSize: '14px',
                }}
              />
              <span style={{ color: mutedColor, fontSize: '13px' }}>MB</span>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', color: mutedColor, fontSize: '12px' }}>
              Max Attachments
            </label>
            <input
              type="number"
              value={policy.maxAttachments}
              onChange={(e) => updateNumber('maxAttachments', parseInt(e.target.value) || 0)}
              min={0}
              max={100}
              style={{
                width: '80px',
                padding: '8px',
                background: inputBg,
                border: `1px solid ${borderColor}`,
                borderRadius: '6px',
                color: textColor,
                fontSize: '14px',
              }}
            />
          </div>
        </div>
      </section>

      {/* Security Settings */}
      <section>
        <h4 style={{ margin: '0 0 12px', color: textColor, fontSize: '14px', fontWeight: 600 }}>
          Security Settings
        </h4>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <ToggleRow
            label="Allow Dynamic Content"
            description="Scripts, macros, and executable content (HIGH RISK)"
            checked={policy.allowDynamicContent}
            onChange={() => toggleBoolean('allowDynamicContent')}
            risk="high"
            theme={theme}
          />
          <ToggleRow
            label="Allow Reconstruction"
            description="Reconstruct original artefacts from processed versions"
            checked={policy.allowReconstruction}
            onChange={() => toggleBoolean('allowReconstruction')}
            risk="medium"
            theme={theme}
          />
          <ToggleRow
            label="Allow External Resources"
            description="Load external images, fonts, and resources"
            checked={policy.allowExternalResources}
            onChange={() => toggleBoolean('allowExternalResources')}
            risk="medium"
            theme={theme}
          />
          <ToggleRow
            label="Require Source Verification"
            description="Verify cryptographic signatures from sources"
            checked={policy.requireSourceVerification}
            onChange={() => toggleBoolean('requireSourceVerification')}
            risk="low"
            inverted
            theme={theme}
          />
        </div>
      </section>

      {/* Parsing Constraint */}
      <section>
        <h4 style={{ margin: '0 0 12px', color: textColor, fontSize: '14px', fontWeight: 600 }}>
          Parsing Constraint
        </h4>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['strict', 'permissive', 'custom'] as ParsingConstraint[]).map(c => (
            <button
              key={c}
              onClick={() => updateParsingConstraint(c)}
              style={{
                padding: '10px 16px',
                background: policy.parsingConstraint === c ? '#8b5cf620' : inputBg,
                border: `1px solid ${policy.parsingConstraint === c ? '#8b5cf6' : borderColor}`,
                borderRadius: '8px',
                color: policy.parsingConstraint === c ? '#8b5cf6' : textColor,
                fontWeight: policy.parsingConstraint === c ? 600 : 400,
                fontSize: '13px',
                cursor: 'pointer',
              }}
            >
              {c === 'strict' ? '🔒 Strict' : c === 'permissive' ? '🔓 Permissive' : '⚙️ Custom'}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

// Helper components
function ToggleRow({ 
  label, 
  description, 
  checked, 
  onChange, 
  risk, 
  inverted = false,
  theme = 'default',
}: { 
  label: string
  description: string
  checked: boolean
  onChange: () => void
  risk: 'low' | 'medium' | 'high'
  inverted?: boolean
  theme?: 'default' | 'dark' | 'professional'
}) {
  const isDark = theme === 'default' || theme === 'dark'
  const textColor = isDark ? '#e5e5e5' : '#1f2937'
  const mutedColor = isDark ? '#9ca3af' : '#6b7280'
  const borderColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)'

  // For inverted toggles (like "require verification"), ON is good, OFF is risky
  const isRisky = inverted ? !checked : checked
  const displayRisk = isRisky && risk !== 'low' ? risk : 'low'

  return (
    <label style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '12px 16px',
      background: isRisky && risk !== 'low' ? `${getRiskColor(risk)}10` : 'transparent',
      border: `1px solid ${isRisky && risk !== 'low' ? getRiskColor(risk) : borderColor}`,
      borderRadius: '8px',
      cursor: 'pointer',
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, color: textColor, fontSize: '13px' }}>{label}</div>
        <div style={{ fontSize: '12px', color: mutedColor }}>{description}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {isRisky && risk !== 'low' && (
          <span style={{
            padding: '2px 6px',
            fontSize: '10px',
            fontWeight: 600,
            borderRadius: '4px',
            background: `${getRiskColor(risk)}20`,
            color: getRiskColor(risk),
            textTransform: 'uppercase',
          }}>
            {displayRisk}
          </span>
        )}
        <div
          onClick={(e) => { e.preventDefault(); onChange(); }}
          style={{
            width: '40px',
            height: '22px',
            borderRadius: '11px',
            background: checked ? '#8b5cf6' : isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.2)',
            position: 'relative',
            transition: 'background 0.2s ease',
          }}
        >
          <div style={{
            position: 'absolute',
            top: '2px',
            left: checked ? '20px' : '2px',
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            background: 'white',
            transition: 'left 0.2s ease',
            boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
          }} />
        </div>
      </div>
    </label>
  )
}

function getRiskColor(risk: 'low' | 'medium' | 'high'): string {
  switch (risk) {
    case 'low': return '#22c55e'
    case 'medium': return '#eab308'
    case 'high': return '#ef4444'
  }
}



