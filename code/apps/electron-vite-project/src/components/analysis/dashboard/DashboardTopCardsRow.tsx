/**
 * Operational summary cards — session-backed counts and labels only (no charts).
 * Data: `inbox:dashboardSnapshot` / assembled `AnalysisDashboardSnapshot`.
 */

import type { AnalysisDashboardSnapshot } from '../../../types/analysisDashboardSnapshot'
import './DashboardTopCardsRow.css'

type Props = {
  snapshot: AnalysisDashboardSnapshot | null
  loading: boolean
  error: string | null
  onRetry: () => void
}

function formatShortDate(iso: string | null | undefined): string {
  if (iso == null || String(iso).trim() === '') return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function humanizeCategory(cat: string): string {
  const t = cat.trim()
  if (!t) return 'uncategorized'
  return t.replace(/_/g, ' ')
}

/** Readable composition from latest completed sort session only (same cohort as prior pie). */
function formatSortComposition(
  rows: Array<{ category: string; count: number }> | null,
): { line: string; title: string } {
  if (rows == null) {
    return {
      line: '—',
      title: 'Latest session category counts not loaded.',
    }
  }
  if (rows.length === 0) {
    return {
      line: '—',
      title: 'No categories on session rows.',
    }
  }
  const sorted = [...rows].sort((a, b) => b.count - a.count)
  const maxShow = 5
  const head = sorted.slice(0, maxShow)
  const parts = head.map((r) => `${humanizeCategory(r.category)} ${r.count}`)
  const extraCats = sorted.length - maxShow
  const suffix = extraCats > 0 ? ` · +${extraCats} more` : ''
  return {
    line: parts.join(' · ') + suffix,
    title: 'Latest completed Auto-Sort session only.',
  }
}

function showCount(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return String(n)
}

export function DashboardTopCardsRow({ snapshot, loading, error, onRetry }: Props) {
  const top = snapshot?.top ?? null
  const latest = snapshot?.autosort?.latestSession ?? null
  const composition = formatSortComposition(top?.autosortCategoryCounts ?? null)

  const u = top?.inboxTabs?.urgent
  const pr = top?.inboxTabs?.pending_review
  const pd = top?.inboxTabs?.pending_delete
  const native = top?.messageKind?.nativeBeap
  const dep = top?.messageKind?.depackagedEmail

  if (loading) {
    return <div className="dash-op-summary dash-op-summary--loading">Loading…</div>
  }

  if (error) {
    return (
      <div className="dash-op-summary dash-op-summary--error">
        <span>{error}</span>
        <button type="button" className="dash-op-summary__retry" onClick={() => void onRetry()}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="dash-op-summary" aria-label="Operational summary">
      <article className="dash-op-card">
        <h3 className="dash-op-card__title">Workflow queue</h3>
        <dl className="dash-op-card__metrics dash-op-card__metrics--tight-top">
          <div className="dash-op-card__row">
            <dt>Urgent</dt>
            <dd title="Messages in the Urgent workflow tab">{showCount(u)}</dd>
          </div>
          <div className="dash-op-card__row">
            <dt>Pending review</dt>
            <dd title="Messages in Pending review">{showCount(pr)}</dd>
          </div>
          <div className="dash-op-card__row">
            <dt>Pending delete</dt>
            <dd title="Messages in Pending delete">{showCount(pd)}</dd>
          </div>
        </dl>
      </article>

      <article className="dash-op-card">
        <h3 className="dash-op-card__title">Latest AI sort</h3>
        <p className="dash-op-card__lead">
          {latest?.completedAt ? (
            <>
              <strong>{formatShortDate(latest.completedAt)}</strong>
              {typeof latest.totalMessages === 'number' ? ` · ${latest.totalMessages} msg` : null}
            </>
          ) : (
            <span className="dash-op-card__muted">No completed run</span>
          )}
        </p>
        <div className="dash-op-card__block">
          <span className="dash-op-card__block-label">Run composition</span>
          <p className="dash-op-card__composition" title={composition.title}>
            {composition.line}
          </p>
        </div>
      </article>

      <article className="dash-op-card">
        <h3 className="dash-op-card__title">Transport</h3>
        <p className="dash-op-card__cohort dash-op-card__cohort--inline" title="All tab · independent counts">
          All tab
        </p>
        <dl className="dash-op-card__metrics">
          <div className="dash-op-card__row">
            <dt>Native BEAP</dt>
            <dd title="All tab total">{showCount(native)}</dd>
          </div>
          <div className="dash-op-card__row">
            <dt>Depackaged</dt>
            <dd title="All tab total">{showCount(dep)}</dd>
          </div>
        </dl>
      </article>
    </div>
  )
}
