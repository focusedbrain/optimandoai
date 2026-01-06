/**
 * Hero KPI Components
 * 
 * Reusable components for displaying prominent KPIs and status heroes
 * across all analysis dashboard tabs.
 */

import './HeroKPI.css'

// =============================================================================
// Types
// =============================================================================

export type KPIStatus = 'success' | 'warning' | 'danger' | 'info' | 'neutral'

export interface KPIData {
  label: string
  value: string | number
  status?: KPIStatus
  subtext?: string
  icon?: string
}

export interface StatusHeroData {
  status: KPIStatus
  title: string
  subtitle: string
  metrics?: Array<{ label: string; value: string | number }>
}

export interface QuickAction {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
}

// =============================================================================
// KPI Card Component
// =============================================================================

interface KPICardProps extends KPIData {
  size?: 'small' | 'medium' | 'large'
}

export function KPICard({ 
  label, 
  value, 
  status = 'neutral', 
  subtext, 
  icon,
  size = 'medium' 
}: KPICardProps) {
  return (
    <div className={`hero-kpi-card hero-kpi-card--${size} hero-kpi-card--${status}`}>
      {icon && <span className="hero-kpi-card__icon">{icon}</span>}
      <div className="hero-kpi-card__content">
        <span className="hero-kpi-card__label">{label}</span>
        <span className={`hero-kpi-card__value hero-kpi-card__value--${status}`}>
          {value}
        </span>
        {subtext && <span className="hero-kpi-card__subtext">{subtext}</span>}
      </div>
    </div>
  )
}

// =============================================================================
// Hero KPI Strip Component
// =============================================================================

interface HeroKPIStripProps {
  kpis: KPIData[]
  title?: string
}

export function HeroKPIStrip({ kpis, title }: HeroKPIStripProps) {
  return (
    <div className="hero-kpi-strip">
      {title && <h3 className="hero-kpi-strip__title">{title}</h3>}
      <div className="hero-kpi-strip__cards">
        {kpis.map((kpi, index) => (
          <KPICard key={index} {...kpi} />
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// Status Hero Component
// =============================================================================

interface StatusHeroProps extends StatusHeroData {
  icon?: string
  action?: QuickAction
}

export function StatusHero({ 
  status, 
  title, 
  subtitle, 
  metrics,
  icon,
  action 
}: StatusHeroProps) {
  const statusIcon = icon || getDefaultStatusIcon(status)
  
  return (
    <div className={`hero-status hero-status--${status}`}>
      <div className="hero-status__indicator">
        <span className="hero-status__icon">{statusIcon}</span>
      </div>
      <div className="hero-status__content">
        <h2 className="hero-status__title">{title}</h2>
        <p className="hero-status__subtitle">{subtitle}</p>
        {metrics && metrics.length > 0 && (
          <div className="hero-status__metrics">
            {metrics.map((metric, index) => (
              <div key={index} className="hero-status__metric">
                <span className="hero-status__metric-value">{metric.value}</span>
                <span className="hero-status__metric-label">{metric.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {action && (
        <div className="hero-status__action">
          <button 
            className={`hero-btn hero-btn--${action.variant || 'primary'}`}
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        </div>
      )}
    </div>
  )
}

function getDefaultStatusIcon(status: KPIStatus): string {
  switch (status) {
    case 'success': return '✓'
    case 'warning': return '⚠'
    case 'danger': return '✕'
    case 'info': return 'ℹ'
    default: return '•'
  }
}

// =============================================================================
// Quick Action Bar Component
// =============================================================================

interface QuickActionBarProps {
  actions: QuickAction[]
  title?: string
}

export function QuickActionBar({ actions, title }: QuickActionBarProps) {
  if (actions.length === 0) return null
  
  return (
    <div className="hero-action-bar">
      {title && <span className="hero-action-bar__title">{title}</span>}
      <div className="hero-action-bar__buttons">
        {actions.map((action, index) => (
          <button
            key={index}
            className={`hero-btn hero-btn--${action.variant || 'secondary'}`}
            onClick={action.onClick}
            disabled={action.disabled}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// Readiness Gauge Component (for Pre-Execution)
// =============================================================================

interface ReadinessGaugeProps {
  score: number // 0-100
  status: 'ready' | 'warnings' | 'blocked'
  blockingCount: number
  warningCount: number
  onViewDetails?: () => void
}

export function ReadinessGauge({ 
  score, 
  status, 
  blockingCount, 
  warningCount,
  onViewDetails 
}: ReadinessGaugeProps) {
  const statusLabels = {
    ready: 'Ready to Execute',
    warnings: 'Review Recommended',
    blocked: 'Review Required'
  }
  
  const statusClass = status === 'ready' ? 'success' : status === 'warnings' ? 'info' : 'info'
  
  return (
    <div className={`hero-readiness hero-readiness--${statusClass}`}>
      <div className="hero-readiness__gauge">
        <div className="hero-readiness__circle">
          <svg viewBox="0 0 100 100" className="hero-readiness__svg">
            <circle
              className="hero-readiness__track"
              cx="50"
              cy="50"
              r="45"
              fill="none"
              strokeWidth="8"
            />
            <circle
              className={`hero-readiness__progress hero-readiness__progress--${statusClass}`}
              cx="50"
              cy="50"
              r="45"
              fill="none"
              strokeWidth="8"
              strokeDasharray={`${score * 2.83} 283`}
              strokeLinecap="round"
              transform="rotate(-90 50 50)"
            />
          </svg>
          <div className="hero-readiness__score">
            <span className="hero-readiness__score-value">{score}</span>
            <span className="hero-readiness__score-label">%</span>
          </div>
        </div>
      </div>
      <div className="hero-readiness__info">
        <h2 className={`hero-readiness__status hero-readiness__status--${statusClass}`}>
          {statusLabels[status]}
        </h2>
        <div className="hero-readiness__counts">
          {blockingCount > 0 && (
            <span className="hero-readiness__count hero-readiness__count--info">
              {blockingCount} Pending Review{blockingCount !== 1 ? 's' : ''}
            </span>
          )}
          {warningCount > 0 && (
            <span className="hero-readiness__count hero-readiness__count--info">
              {warningCount} Annotation{warningCount !== 1 ? 's' : ''}
            </span>
          )}
          {blockingCount === 0 && warningCount === 0 && (
            <span className="hero-readiness__count hero-readiness__count--success">
              All checks passed
            </span>
          )}
        </div>
        {onViewDetails && (
          <button className="hero-btn hero-btn--secondary" onClick={onViewDetails}>
            View Details
          </button>
        )}
      </div>
    </div>
  )
}

// =============================================================================
// Execution Status Hero (for Live Execution)
// =============================================================================

interface ExecutionStatusHeroProps {
  status: 'executing' | 'paused' | 'idle'
  eventCount: number
  duration?: string
  riskCounts: { critical: number; high: number; medium: number }
  onViewTimeline?: () => void
}

export function ExecutionStatusHero({
  status,
  eventCount,
  duration,
  riskCounts,
  onViewTimeline
}: ExecutionStatusHeroProps) {
  const statusLabels = {
    executing: 'Processing',
    paused: 'Awaiting Approval',
    idle: 'Ready'
  }
  
  const statusClass = status === 'executing' ? 'success' : status === 'paused' ? 'info' : 'success'
  const totalRisks = riskCounts.critical + riskCounts.high + riskCounts.medium
  
  return (
    <div className={`hero-execution hero-execution--${statusClass}`}>
      <div className="hero-execution__status">
        <div className={`hero-execution__indicator hero-execution__indicator--${statusClass}`}>
          {status === 'executing' && <span className="hero-execution__pulse" />}
          <span className="hero-execution__icon">
            {status === 'executing' ? '▶' : status === 'paused' ? '⏸' : '○'}
          </span>
        </div>
        <div className="hero-execution__label">
          <h2 className="hero-execution__title">{statusLabels[status]}</h2>
          {duration && <span className="hero-execution__duration">{duration}</span>}
        </div>
      </div>
      
      <div className="hero-execution__metrics">
        <div className="hero-execution__metric">
          <span className="hero-execution__metric-value">{eventCount}</span>
          <span className="hero-execution__metric-label">Events</span>
        </div>
        <div className="hero-execution__metric">
          <span className="hero-execution__metric-value">
            {totalRisks}
          </span>
          <span className="hero-execution__metric-label">Flagged</span>
        </div>
        <div className="hero-execution__metric">
          <span className="hero-execution__metric-value hero-execution__metric-value--success">✓</span>
          <span className="hero-execution__metric-label">Guardrails</span>
        </div>
      </div>
      
      {onViewTimeline && (
        <button className="hero-btn hero-btn--secondary" onClick={onViewTimeline}>
          View Timeline
        </button>
      )}
    </div>
  )
}

// =============================================================================
// Verification Status Hero (for Post-Execution)
// =============================================================================

interface VerificationStatusHeroProps {
  status: 'verified' | 'recorded' | 'pending'
  executionTime: string
  duration: string
  evidenceCount: number
  poaeReady: boolean
  onExportEvidence?: () => void
}

export function VerificationStatusHero({
  status,
  executionTime,
  duration,
  evidenceCount,
  poaeReady,
  onExportEvidence
}: VerificationStatusHeroProps) {
  const statusLabels = {
    verified: 'Verified',
    recorded: 'Recorded (Unverified)',
    pending: 'Pending Review'
  }
  
  const statusClass = status === 'verified' ? 'success' : status === 'recorded' ? 'info' : 'warning'
  
  return (
    <div className={`hero-verification hero-verification--${statusClass}`}>
      <div className="hero-verification__badge">
        <span className={`hero-verification__icon hero-verification__icon--${statusClass}`}>
          {status === 'verified' ? '✓' : status === 'recorded' ? '◉' : '⏳'}
        </span>
        <div className="hero-verification__status">
          <h2 className="hero-verification__title">{statusLabels[status]}</h2>
          <span className="hero-verification__time">{executionTime}</span>
        </div>
      </div>
      
      <div className="hero-verification__metrics">
        <div className="hero-verification__metric">
          <span className="hero-verification__metric-value">{duration}</span>
          <span className="hero-verification__metric-label">Duration</span>
        </div>
        <div className="hero-verification__metric">
          <span className="hero-verification__metric-value">{evidenceCount}</span>
          <span className="hero-verification__metric-label">Evidence Items</span>
        </div>
        <div className="hero-verification__metric">
          <span className={`hero-verification__metric-value ${poaeReady ? 'hero-verification__metric-value--success' : ''}`}>
            {poaeReady ? 'Ready' : 'N/A'}
          </span>
          <span className="hero-verification__metric-label">PoAE™</span>
        </div>
      </div>
      
      {onExportEvidence && (
        <button className="hero-btn hero-btn--primary" onClick={onExportEvidence}>
          Export Evidence
        </button>
      )}
    </div>
  )
}

