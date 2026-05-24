/**
 * Step 6 — Verify synthetic round-trip and enable edge tier.
 */

import type { CSSProperties } from 'react'
import { btnPrimary } from '../styles.js'
import { StepErrorActions, StepLoading } from './StepCommon.js'

export interface StepVerifyAndSwitchProps {
  loading: boolean
  error: string | null
  verified: boolean | null
  reason?: string
  confirmed: boolean
  onConfirmUnderstand: () => void
  onVerify: () => void
  onCancelWizard: () => void
}

export function StepVerifyAndSwitch({
  loading,
  error,
  verified,
  reason,
  confirmed,
  onConfirmUnderstand,
  onVerify,
  onCancelWizard,
}: StepVerifyAndSwitchProps) {
  return (
    <div data-testid="wizard-step-verify">
      <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Verify &amp; enable edge tier</h2>
      <p style={{ color: '#94a3b8', marginTop: 0 }}>
        We send a synthetic BEAP message through your new edge replica and verify the certificate
        locally. If verification succeeds, edge tier routing is enabled.
      </p>
      <StepErrorActions error={error} onRetry={onVerify} onCancelWizard={onCancelWizard} />
      {verified === true && (
        <div
          data-testid="wizard-verify-success"
          style={{
            padding: 10,
            borderRadius: 6,
            background: 'rgba(34,197,94,0.12)',
            border: '1px solid rgba(34,197,94,0.35)',
            color: '#bbf7d0',
            marginBottom: 12,
          }}
        >
          Verification succeeded. Edge tier routing is now enabled.
        </div>
      )}
      {verified === false && (
        <div style={{ ...errorBoxStyle, marginBottom: 12 }} data-testid="wizard-verify-failed">
          Verification failed{reason ? `: ${reason}` : '.'}
        </div>
      )}
      {!confirmed && verified !== true && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 12 }}>
          <input
            type="checkbox"
            data-testid="wizard-verify-confirm-checkbox"
            checked={confirmed}
            onChange={() => onConfirmUnderstand()}
          />
          <span style={{ fontSize: 12, color: '#cbd5e1' }}>
            I understand this will route BEAP validation through my edge replica when verification
            succeeds.
          </span>
        </label>
      )}
      {loading && <StepLoading message="Running verification…" />}
      {verified !== true && !loading && (
        <button
          type="button"
          style={btnPrimary}
          disabled={!confirmed}
          data-testid="wizard-verify-run"
          onClick={onVerify}
        >
          Verify and enable edge tier
        </button>
      )}
    </div>
  )
}

const errorBoxStyle: CSSProperties = {
  padding: 10,
  borderRadius: 6,
  background: 'rgba(239,68,68,0.12)',
  border: '1px solid rgba(239,68,68,0.35)',
  color: '#fecaca',
}
