/**
 * Urgency meter for inbox AI analysis — score reflects how action-worthy / urgent
 * the message is (not “quality”). Numeric score + bar + tier label + accessible name.
 */
import { useMemo } from 'react'

export type UrgencyTierLabel = 'Low' | 'Mild' | 'Moderate' | 'High' | 'Critical'

export type InboxUrgencyVisuals = {
  /** Clamped integer 0–10 */
  score: number
  tierLabel: UrgencyTierLabel
  /** Fill color for the bar (and tier text accent) */
  accentColor: string
  fillPercent: number
  /** For aria-label / screen readers */
  ariaDescription: string
}

/**
 * Map 0–10 urgency to tier, color, and copy. Bands: 0–2 low … 9–10 critical.
 */
export function getInboxUrgencyVisuals(rawScore: number | undefined | null): InboxUrgencyVisuals {
  const n = Number(rawScore)
  const score = Math.max(0, Math.min(10, Math.round(Number.isFinite(n) ? n : 5)))

  let tierLabel: UrgencyTierLabel
  let accentColor: string
  if (score <= 2) {
    tierLabel = 'Low'
    accentColor = '#64748b' /* slate — low priority, not “bad” */
  } else if (score <= 4) {
    tierLabel = 'Mild'
    accentColor = '#2563eb'
  } else if (score <= 6) {
    tierLabel = 'Moderate'
    accentColor = '#d97706'
  } else if (score <= 8) {
    tierLabel = 'High'
    accentColor = '#ea580c'
  } else {
    tierLabel = 'Critical'
    accentColor = '#dc2626'
  }

  const fillPercent = (score / 10) * 100
  const ariaDescription = `Urgency score ${score} out of 10, ${tierLabel.toLowerCase()} urgency`

  return { score, tierLabel, accentColor, fillPercent, ariaDescription }
}

type InboxUrgencyMeterProps = {
  score: number
  /** Header strip in bulk card vs full row in analysis panel */
  variant: 'compact' | 'panel'
  /** Shown under the bar in panel variant only */
  reason?: string | null
  className?: string
}

export function InboxUrgencyMeter({ score, variant, reason, className }: InboxUrgencyMeterProps) {
  const v = useMemo(() => getInboxUrgencyVisuals(score), [score])

  return (
    <div
      className={`inbox-urgency-meter inbox-urgency-meter--${variant}${className ? ` ${className}` : ''}`}
      aria-label={v.ariaDescription}
    >
      <div className="inbox-urgency-meter__top">
        <span className="inbox-urgency-meter__score">{v.score}/10</span>
        <span className="inbox-urgency-meter__tier" style={{ color: v.accentColor }}>
          {v.tierLabel}
        </span>
      </div>
      <div className="inbox-urgency-meter__track" role="presentation">
        <div
          className="inbox-urgency-meter__fill"
          style={{
            width: `${v.fillPercent}%`,
            backgroundColor: v.accentColor,
          }}
        />
      </div>
      {variant === 'panel' && reason != null && reason.trim() !== '' ? (
        <span className="inbox-urgency-meter__reason">{reason}</span>
      ) : null}
    </div>
  )
}
