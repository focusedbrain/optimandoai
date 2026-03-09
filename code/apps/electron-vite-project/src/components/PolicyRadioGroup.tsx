/**
 * PolicyRadioGroup — Exclusive AI policy selection
 *
 * Replaces the previous two-checkbox model with a single exclusive choice.
 * No contradictory states (e.g. "internal only" + "cloud allowed") are possible.
 */

import type { AiProcessingMode } from '../../../../packages/shared/src/handshake/types'

export interface PolicySelection {
  ai_processing_mode: AiProcessingMode
}

export const DEFAULT_AI_POLICY: PolicySelection = {
  ai_processing_mode: 'local_only',
}

const OPTIONS: { value: AiProcessingMode; label: string; description: string }[] = [
  { value: 'none', label: 'No AI processing', description: 'Handshake data must not be processed by any AI system' },
  { value: 'local_only', label: 'Internal AI only', description: 'Restrict AI processing to on-premise or organization-controlled systems' },
  { value: 'internal_and_cloud', label: 'Allow Internal + Cloud AI', description: 'Allow handshake data to be processed by internal AI systems and external cloud AI services' },
]

interface PolicyRadioGroupProps {
  value: PolicySelection
  onChange: (value: PolicySelection) => void
  readOnly: boolean
  variant?: 'light' | 'dark'
}

export default function PolicyRadioGroup({ value, onChange, readOnly, variant = 'dark' }: PolicyRadioGroupProps) {
  const headingColor = variant === 'light' ? '#6b7280' : '#aaa'
  const labelColor = variant === 'light' ? '#374151' : '#d0d0d0'
  const descColor = variant === 'light' ? '#6b7280' : '#777'
  const mode = value.ai_processing_mode ?? 'local_only'

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
        Default policy for newly attached context
      </h5>
      <p style={{ margin: '0 0 8px', fontSize: '11px', color: descColor }}>
        Starting template for new context items. Individual items can override.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {OPTIONS.map((opt) => (
          <label
            key={opt.value}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: '8px',
              padding: '8px 10px',
              borderRadius: '6px',
              background: mode === opt.value ? 'rgba(139,92,246,0.08)' : 'transparent',
              border: `1px solid ${mode === opt.value ? 'rgba(139,92,246,0.3)' : 'transparent'}`,
              cursor: readOnly ? 'default' : 'pointer',
            }}
          >
            <input
              type="radio"
              name="ai-policy"
              checked={mode === opt.value}
              disabled={readOnly}
              onChange={() => onChange({ ai_processing_mode: opt.value })}
              style={{ marginTop: '3px', accentColor: '#8b5cf6' }}
            />
            <div>
              <span style={{ fontSize: '12px', fontWeight: 600, color: labelColor }}>{opt.label}</span>
              <p style={{ margin: '2px 0 0', fontSize: '11px', color: descColor }}>{opt.description}</p>
            </div>
          </label>
        ))}
      </div>
    </div>
  )
}
