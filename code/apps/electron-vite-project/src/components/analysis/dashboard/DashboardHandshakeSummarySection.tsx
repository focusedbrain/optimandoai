/**
 * Compact read-only handshake totals from `listHandshakes()` (via dashboard snapshot).
 * Omitted when `counts === null` (vault unavailable) — no placeholder metrics.
 */

import type {
  AnalysisDashboardHandshakeState,
  AnalysisDashboardSnapshot,
} from '../../../types/analysisDashboardSnapshot'
import './DashboardHandshakeSummarySection.css'

const STATE_ORDER: AnalysisDashboardHandshakeState[] = [
  'PENDING_ACCEPT',
  'PENDING_REVIEW',
  'ACCEPTED',
  'ACTIVE',
  'REVOKED',
]

const STATE_LABELS: Record<AnalysisDashboardHandshakeState, string> = {
  PENDING_ACCEPT: 'Pending accept',
  PENDING_REVIEW: 'Pending review',
  ACCEPTED: 'Accepted',
  ACTIVE: 'Active',
  REVOKED: 'Revoked',
  EXPIRED: 'Expired',
}

export interface DashboardHandshakeSummarySectionProps {
  snapshot: AnalysisDashboardSnapshot | null
  /** Omit section until snapshot attempt finished (avoids duplicate loading chrome). */
  loading: boolean
}

export function DashboardHandshakeSummarySection({ snapshot, loading }: DashboardHandshakeSummarySectionProps) {
  if (loading) return null

  const counts = snapshot?.handshakes?.counts
  if (counts == null) {
    return null
  }

  return (
    <section className="dashboard-handshake-summary" aria-labelledby="dashboard-handshake-summary-title">
      <h2 id="dashboard-handshake-summary-title" className="dashboard-handshake-summary__title">
        Handshakes
      </h2>
      <p className="dashboard-handshake-summary__def">
        Read-only counts from your local vault. Open <strong>Handshakes</strong> for full detail and actions.
        {counts.total === 0 ? ' Totals are zero until records exist.' : ''}
      </p>
      <div className="dashboard-handshake-summary__total">
        <span className="dashboard-handshake-summary__total-label">Total</span>
        <span className="dashboard-handshake-summary__total-value">{counts.total}</span>
      </div>
      <ul className="dashboard-handshake-summary__states" aria-label="Handshakes by state">
        {STATE_ORDER.map((st) => {
          const n = counts.byState[st] ?? 0
          return (
            <li key={st} className="dashboard-handshake-summary__state">
              <span className="dashboard-handshake-summary__state-label">{STATE_LABELS[st]}</span>
              <span className="dashboard-handshake-summary__state-count">{n}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
