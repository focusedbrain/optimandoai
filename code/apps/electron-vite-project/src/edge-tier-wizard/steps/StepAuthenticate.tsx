/**
 * Step 1 — Re-authenticate and paid-tier gate.
 */

import { btnPrimary } from '../styles.js'
import { StepErrorActions, StepLoading } from './StepCommon.js'

export interface StepAuthenticateProps {
  loading: boolean
  error: string | null
  plan?: string
  sub?: string
  onAuthenticate: () => void
  onCancelWizard: () => void
}

export function StepAuthenticate({
  loading,
  error,
  plan,
  sub,
  onAuthenticate,
  onCancelWizard,
}: StepAuthenticateProps) {
  return (
    <div data-testid="wizard-step-authenticate">
      <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Sign in to continue</h2>
      <p style={{ color: '#94a3b8', marginTop: 0 }}>
        Edge tier deployment requires a paid subscription. We will refresh your session and verify
        your plan before proceeding.
      </p>
      {plan && sub && (
        <div style={{ marginBottom: 12, color: '#cbd5e1' }}>
          Signed in as <strong>{sub}</strong> (plan: {plan})
        </div>
      )}
      <StepErrorActions error={error} onRetry={onAuthenticate} onCancelWizard={onCancelWizard} />
      {loading && <StepLoading message="Refreshing session…" />}
      {!loading && !plan && (
        <button type="button" style={btnPrimary} onClick={onAuthenticate}>
          Refresh session &amp; verify plan
        </button>
      )}
    </div>
  )
}
