/**
 * Shared step chrome — error + retry + cancel wizard.
 */

import { btnDanger, btnPrimary, btnSecondary, errorBox } from '../styles.js'

export interface StepErrorActionsProps {
  error: string | null
  onRetry?: () => void
  onCancelWizard: () => void
  retryLabel?: string
}

export function StepErrorActions({
  error,
  onRetry,
  onCancelWizard,
  retryLabel = 'Retry',
}: StepErrorActionsProps) {
  if (!error) return null
  return (
    <div data-testid="wizard-step-error">
      <div style={errorBox}>{error}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {onRetry && (
          <button type="button" style={btnPrimary} onClick={onRetry}>
            {retryLabel}
          </button>
        )}
        <button type="button" style={btnDanger} onClick={onCancelWizard}>
          Cancel wizard
        </button>
      </div>
    </div>
  )
}

export function StepLoading({ message }: { message: string }) {
  return (
    <div data-testid="wizard-step-loading" style={{ color: '#94a3b8', marginTop: 8 }}>
      {message}
    </div>
  )
}
