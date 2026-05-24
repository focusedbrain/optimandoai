import type { DashboardFallbackPolicy } from './types.js'
import { FALLBACK_POLICY_COPY } from './globalActionsCopy.js'

export interface FallbackPolicySettingsProps {
  policy: DashboardFallbackPolicy
  onChange: (policy: DashboardFallbackPolicy) => void
  disabled?: boolean
}

export function FallbackPolicySettings({ policy, onChange, disabled }: FallbackPolicySettingsProps) {
  return (
    <div data-testid="edge-fallback-policy-settings">
      <h3 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 600 }}>Fallback policy</h3>
      <p style={{ margin: '0 0 12px', color: 'var(--text-secondary)', fontSize: 12 }}>
        Applies when all edge replicas are unreachable during ingest.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {(['reject', 'downgrade_with_badge'] as const).map((value) => (
          <label
            key={value}
            data-testid={`fallback-policy-${value}`}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: 10,
              borderRadius: 8,
              border: `1px solid ${policy === value ? '#6366f1' : 'var(--border)'}`,
              background: policy === value ? '#eef2ff' : 'transparent',
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1,
            }}
          >
            <input
              type="radio"
              name="fallback-policy"
              value={value}
              checked={policy === value}
              disabled={disabled}
              onChange={() => onChange(value)}
              style={{ marginTop: 3 }}
            />
            <span>
              <strong style={{ display: 'block', fontSize: 13 }}>{FALLBACK_POLICY_COPY[value].label}</strong>
              <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {FALLBACK_POLICY_COPY[value].description}
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
