/**
 * PolicyCheckboxes — Advanced policy selection for handshake context
 */

export interface PolicySelection {
  cloud_ai: boolean
  internal_ai: boolean
  min_diff: boolean
}

export const DEFAULT_POLICIES: PolicySelection = {
  cloud_ai: false,
  internal_ai: false,
  min_diff: false,
}

const POLICY_OPTIONS = [
  {
    key: 'cloud_ai' as const,
    label: 'Cloud AI Processing',
    description: 'Allow handshake data to be processed by external cloud AI services',
  },
  {
    key: 'internal_ai' as const,
    label: 'Internal AI Only',
    description: 'Restrict AI processing to on-premise or organization-controlled systems',
  },
  {
    key: 'min_diff' as const,
    label: 'Minimal Data Disclosure',
    description: 'Enforce minimum necessary data sharing between handshake parties',
  },
]

interface PolicyCheckboxesProps {
  policies: PolicySelection
  onChange: (policies: PolicySelection) => void
  readOnly: boolean
  variant?: 'light' | 'dark'
}

export default function PolicyCheckboxes({ policies, onChange, readOnly, variant = 'dark' }: PolicyCheckboxesProps) {
  const headingColor = variant === 'light' ? '#6b7280' : '#aaa'
  const labelColor = variant === 'light' ? '#374151' : '#d0d0d0'
  const descColor = variant === 'light' ? '#6b7280' : '#777'
  return (
    <div style={{ marginTop: '14px' }}>
      <h5
        style={{
          margin: '0 0 8px',
          fontSize: '12px',
          fontWeight: 600,
          color: headingColor,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        Advanced Policies
      </h5>
      {POLICY_OPTIONS.map((opt) => (
        <label
          key={opt.key}
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '8px',
            marginBottom: '8px',
            cursor: readOnly ? 'default' : 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={policies[opt.key]}
            disabled={readOnly}
            onChange={() => onChange({ ...policies, [opt.key]: !policies[opt.key] })}
            style={{ marginTop: '2px' }}
          />
          <div>
            <span style={{ fontSize: '12px', color: labelColor }}>{opt.label}</span>
            <p style={{ margin: '2px 0 0', fontSize: '11px', color: descColor }}>{opt.description}</p>
          </div>
        </label>
      ))}
    </div>
  )
}
