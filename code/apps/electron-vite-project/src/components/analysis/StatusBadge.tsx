/**
 * Status Badge Component
 * 
 * Displays verification status based on flags.
 * NEVER claims verification unless flags permit.
 * 
 * @version 1.0.0
 */

import { VerificationFlags, getStatusBadgeText, getStatusBadgeVariant, canClaimVerified } from './canvasState'
import './StatusBadge.css'

interface StatusBadgeProps {
  /** Verification flags to check */
  flags: VerificationFlags
  /** Optional override text */
  text?: string
  /** Size variant */
  size?: 'small' | 'medium'
  /** Show warning icon for unverified */
  showWarning?: boolean
}

/**
 * Status Badge - displays verification status
 * 
 * RULES:
 * - NEVER claims verification unless canClaimVerified returns true
 * - Always shows appropriate warning for mock/demo/unverified data
 * - Styling indicates trust level
 */
export function StatusBadge({ flags, text, size = 'small', showWarning = true }: StatusBadgeProps) {
  const variant = getStatusBadgeVariant(flags)
  const displayText = text ?? getStatusBadgeText(flags)
  const isVerified = canClaimVerified(flags)
  
  return (
    <span 
      className={`analysis-status-badge analysis-status-badge--${variant} analysis-status-badge--${size}`}
      title={isVerified ? 'Data is verified' : 'Data is NOT verified - for demonstration only'}
    >
      {showWarning && !isVerified && <span className="analysis-status-badge__icon">⚠</span>}
      {isVerified && <span className="analysis-status-badge__icon">✓</span>}
      <span className="analysis-status-badge__text">{displayText}</span>
    </span>
  )
}

/**
 * Mock Data Badge - specifically for mock data
 */
export function MockDataBadge({ size = 'small' }: { size?: 'small' | 'medium' }) {
  return (
    <span className={`analysis-status-badge analysis-status-badge--demo analysis-status-badge--${size}`}>
      <span className="analysis-status-badge__text">Mock Data</span>
    </span>
  )
}

/**
 * Simulated Badge - for simulated events
 */
export function SimulatedBadge({ size = 'small' }: { size?: 'small' | 'medium' }) {
  return (
    <span className={`analysis-status-badge analysis-status-badge--demo analysis-status-badge--${size}`}>
      <span className="analysis-status-badge__text">Simulated</span>
    </span>
  )
}

/**
 * PoAE Demo Badge - specifically for PoAE placeholder
 */
export function PoAEDemoBadge({ size = 'small' }: { size?: 'small' | 'medium' }) {
  return (
    <span className={`analysis-status-badge analysis-status-badge--poae-demo analysis-status-badge--${size}`}>
      <span className="analysis-status-badge__icon">⚠</span>
      <span className="analysis-status-badge__text">PoAE Demo</span>
    </span>
  )
}

/**
 * Recorded Badge - for recorded but unverified data
 */
export function RecordedBadge({ size = 'small' }: { size?: 'small' | 'medium' }) {
  return (
    <span className={`analysis-status-badge analysis-status-badge--recorded analysis-status-badge--${size}`}>
      <span className="analysis-status-badge__text">Recorded</span>
    </span>
  )
}

export default StatusBadge




