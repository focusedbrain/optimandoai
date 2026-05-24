/**
 * Step 4 — Replica count (1 / 2 / 3).
 */

import { STEP4_REPLICA_HELP, STEP4_REPLICA_MULTI_NOTE } from '../copy.js'
import { btnPrimary, helpBox } from '../styles.js'
import { StepErrorActions } from './StepCommon.js'

export interface StepReplicaCountProps {
  value: number
  error: string | null
  loading: boolean
  onChange: (count: number) => void
  onSubmit: () => void
  onCancelWizard: () => void
}

export function StepReplicaCount({
  value,
  error,
  loading,
  onChange,
  onSubmit,
  onCancelWizard,
}: StepReplicaCountProps) {
  return (
    <div data-testid="wizard-step-replica-count">
      <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>How many edge replicas?</h2>
      <p style={helpBox} data-testid="wizard-step4-help">
        {STEP4_REPLICA_HELP}
      </p>
      <p style={{ color: '#94a3b8', fontSize: 12 }} data-testid="wizard-step4-multi-note">
        {STEP4_REPLICA_MULTI_NOTE}
      </p>
      <StepErrorActions error={error} onRetry={onSubmit} onCancelWizard={onCancelWizard} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {[1, 2, 3].map((n) => (
          <label
            key={n}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 10px',
              borderRadius: 6,
              border: value === n ? '1px solid #6366f1' : '1px solid #334155',
              cursor: 'pointer',
            }}
          >
            <input
              type="radio"
              name="replica-count"
              data-testid={`wizard-replica-${n}`}
              checked={value === n}
              onChange={() => onChange(n)}
            />
            <span>
              {n} replica{n > 1 ? 's' : ''}
            </span>
          </label>
        ))}
      </div>
      <button type="button" style={btnPrimary} disabled={loading} onClick={onSubmit}>
        {loading ? 'Saving…' : 'Continue to deploy'}
      </button>
    </div>
  )
}
