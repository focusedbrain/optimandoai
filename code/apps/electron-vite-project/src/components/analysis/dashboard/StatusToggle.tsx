import './StatusToggle.css'

interface StatusToggleProps {
  enabled: boolean
  onToggle: (enabled: boolean) => void
  disabled?: boolean
  /** Accessible label for screen readers */
  label?: string
}

/**
 * Mini 32×16 toggle switch with animated On/Off text labels inside the track.
 * Used by IntelligenceDashboard StatusCard and ProjectOptimizationPanel.
 */
export function StatusToggle({
  enabled,
  onToggle,
  disabled = false,
  label = '',
}: StatusToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      className={[
        'status-toggle',
        enabled  ? 'status-toggle--active'   : '',
        disabled ? 'status-toggle--disabled' : '',
      ].filter(Boolean).join(' ')}
      onClick={() => onToggle(!enabled)}
    >
      <span className="status-toggle__label status-toggle__label--on">On</span>
      <span className="status-toggle__label status-toggle__label--off">Off</span>
      <span className="status-toggle__knob" />
    </button>
  )
}
