/**
 * IntelligenceDashboard — Premium 3-column intelligence zone for WR Desk™.
 *
 * Drop-in replacement for DashboardTopCardsRow with identical props interface.
 * Do NOT swap it into AnalysisCanvas.tsx until Prompt 5.
 *
 * Layout:
 *   Col 1 — Threat Detection   (sort-category bar chart, threat KPI)
 *   Col 2 — Automation         (sort-composition donut, msgs-sorted KPI)
 *   Col 3 — Transport & Queue  (BEAP ratio bar, workflow queue rows)
 *
 * Data contract: all fields read from AnalysisDashboardSnapshot only.
 * No invented data — null/empty states are rendered explicitly.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BarChart, Bar, Cell, ResponsiveContainer, Tooltip,
  XAxis, YAxis, PieChart, Pie,
} from 'recharts'
import type { AnalysisDashboardSnapshot } from '../../../types/analysisDashboardSnapshot'
import '../../../styles/dashboard-tokens.css'
import '../../../styles/dashboard-base.css'
import '../../../styles/dashboard-charts.css'
import './IntelligenceDashboard.css'

// ── Props (identical to DashboardTopCardsRow) ─────────────────────────────────

type Props = {
  snapshot: AnalysisDashboardSnapshot | null
  loading: boolean
  error: string | null
  onRetry: () => void
}

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * 6-colour palette drawn from dashboard-tokens.css `--ds-chart-*` values.
 * Kept as plain hex so they work inside Recharts SVG `fill` props.
 */
const CHART_COLORS: readonly string[] = [
  '#2dd4bf', // teal
  '#60a5fa', // blue
  '#fbbf24', // amber
  '#f87171', // red
  '#a3e635', // lime
  '#c084fc', // violet
]

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a number or null as a locale string; returns '—' when null/undefined. */
function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n.toLocaleString()
}

/**
 * Animates a numeric KPI from 0 → target on first mount, then from the
 * previous value on updates. Uses rAF timestamps for frame-perfect easing.
 * Returns '—' while target is null; returns the animated locale string otherwise.
 */
function useCountUp(target: number | null, duration = 750): string {
  const [current, setCurrent] = useState<number>(0)
  const rafRef = useRef<number>(0)

  useEffect(() => {
    if (target === null) { setCurrent(0); return }

    const end = target
    let startTs: number | null = null

    function step(ts: number) {
      if (startTs === null) startTs = ts
      const elapsed = ts - startTs
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic — fast start, controlled deceleration
      const eased = 1 - Math.pow(1 - progress, 3)
      setCurrent(Math.round(end * eased))
      if (progress < 1) rafRef.current = requestAnimationFrame(step)
    }

    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])

  if (target === null) return '—'
  return current.toLocaleString()
}

/** Humanise a snake_case sort_category string for display. */
function humanize(cat: string): string {
  return cat.trim().replace(/_/g, ' ')
}

/** Abbreviate long sort-category labels for the compact Y-axis. */
const ABBREV: Readonly<Record<string, string>> = {
  'pending review': 'Review',
  'pending delete': 'Delete',
  'newsletter':     'News.',
  'important':      'Impt.',
  'normal':         'Normal',
  'urgent':         'Urgent',
  'spam':           'Spam',
  'archive':        'Archive',
  'archived':       'Archive',
}

function abbrevCat(cat: string): string {
  const key = cat.trim().toLowerCase().replace(/_/g, ' ')
  return ABBREV[key] ?? cat.replace(/_/g, ' ')
}

/**
 * Colour-code a sort_category for the threat bar chart.
 *
 * V1 sort model categories and their semantic colours:
 *   spam          → red    (junk/delete-worthy mail — the "threat" proxy today)
 *   urgent        → amber  (high-priority, not necessarily a security threat)
 *   pending_review / important / action_required → blue
 *   newsletter / archive → slate-gray
 *   normal / other → muted
 */
function getCategoryColor(category: string): string {
  const c = category.trim().toLowerCase()
  if (c.includes('spam') || c.includes('phish') || c.includes('malicious') || c.includes('virus')) {
    return '#f87171' // red  — threat-adjacent
  }
  if (c.includes('urgent')) {
    return '#fbbf24' // amber — high-priority
  }
  if (c.includes('review') || c.includes('important') || c.includes('action')) {
    return '#60a5fa' // blue  — needs attention
  }
  if (c.includes('newsletter') || c.includes('archive')) {
    return '#64748b' // slate — low-signal mail
  }
  return '#2e4a60' // muted navy — unsorted / normal
}

// ── Custom Recharts tooltip ───────────────────────────────────────────────────

// Typed loosely to avoid importing recharts internal types, while still
// being fully safe at the call sites (Recharts injects these props).
interface TooltipPayloadEntry {
  name?: string | number
  value?: number | string
  color?: string
  fill?: string
  payload?: Record<string, unknown>
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: string | number
}) {
  if (!active || !payload?.length) return null
  const item = payload[0]
  // Prefer the `fullName` stored in the recharts data object over the
  // abbreviated axis name, so the tooltip reads clearly.
  const name =
    typeof item.payload?.fullName === 'string'
      ? item.payload.fullName
      : (item.name ?? label ?? '')
  return (
    <div className="ds-tooltip">
      <p className="ds-tooltip__label">{humanize(String(name))}</p>
      {payload.map((p, i) => (
        <p
          key={i}
          className="ds-tooltip__item"
          style={{ color: p.fill ?? p.color ?? 'var(--ds-text-primary)' }}
        >
          {fmt(typeof p.value === 'number' ? p.value : null)}
        </p>
      ))}
    </div>
  )
}

// ── Loading skeleton ──────────────────────────────────────────────────────────

function CardSkeleton() {
  return (
    <div className="dash-card dash-card--elevated intdash__skeleton-card">
      <span className="dash-skeleton" style={{ height: '10px', width: '40%' }} />
      <span className="dash-skeleton dash-skeleton--metric" />
      <span className="dash-skeleton" style={{ height: '10px', width: '25%' }} />
      <span className="dash-skeleton" style={{ height: '110px', borderRadius: '6px' }} />
    </div>
  )
}

// ── Column 1: Threat Detection ────────────────────────────────────────────────

function ThreatCard({ snapshot }: { snapshot: AnalysisDashboardSnapshot }) {
  const { threatMetrics } = snapshot
  const cats = snapshot.top?.autosortCategoryCounts ?? null

  /**
   * Bar chart data: ALL sort categories from the latest session, colour-coded
   * by threat proximity. This gives real data from day 1 even when
   * phishing/malicious categories don't yet exist in the V1 sort model.
   */
  const barData = useMemo(() => {
    if (!cats || cats.length === 0) return []
    return [...cats]
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map((c) => ({
        name:     abbrevCat(c.category),
        fullName: humanize(c.category),
        value:    c.count,
        fill:     getCategoryColor(c.category),
      }))
  }, [cats])

  const totalThreats = threatMetrics?.totalThreats ?? null
  const isThreatPositive = totalThreats !== null && totalThreats > 0
  // Show the model-limitations note only when we have real data but the
  // granular phishing/malicious labels are absent.
  const showModelNote =
    threatMetrics !== null &&
    threatMetrics.phishingDetected === 0 &&
    threatMetrics.maliciousAttachments === 0

  const threatDisplay = useCountUp(totalThreats)

  return (
    <article
      className={`dash-card dash-card--elevated intdash__card${isThreatPositive ? ' dash-card--accent-threat' : ''}`}
      aria-label="Threat detection"
    >
      <div className="intdash__card-header">
        <h3 className="intdash__card-title">Threat Detection</h3>
      </div>

      <div className="intdash__kpi">
        <span className={`intdash__kpi-value${isThreatPositive ? ' intdash__kpi-value--threat' : ''}`}>
          {threatDisplay}
        </span>
        <span className="intdash__kpi-label">
          {totalThreats === 1 ? 'threat flagged' : 'threats flagged'}
        </span>
      </div>

      {barData.length > 0 ? (
        <div className="intdash__chart intdash__chart--threat ds-chart-root">
          <ResponsiveContainer width="100%" height={120}>
            <BarChart
              layout="vertical"
              data={barData}
              margin={{ top: 2, right: 22, bottom: 2, left: 0 }}
              barCategoryGap="22%"
            >
              <XAxis type="number" hide domain={[0, 'dataMax']} />
              <YAxis
                type="category"
                dataKey="name"
                width={50}
                tick={{
                  fontSize:   10,
                  fill:       'var(--ds-text-muted)',
                  fontFamily: 'var(--ds-font-sans)',
                }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                content={<ChartTooltip />}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
              />
              <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive animationDuration={600} animationEasing="ease-out">
                {barData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>

          {showModelNote && (
            <p className="intdash__chart-note">
              Phishing &amp; malicious detail available after model update
            </p>
          )}
        </div>
      ) : (
        <p className="intdash__empty">No sort session data</p>
      )}
    </article>
  )
}

// ── Column 2: Automation Performance ─────────────────────────────────────────

function AutomationCard({ snapshot }: { snapshot: AnalysisDashboardSnapshot }) {
  const { automationMetrics } = snapshot
  const cats = snapshot.top?.autosortCategoryCounts ?? null

  /** Donut segments from the same sort-category counts as the bar chart. */
  const donutData = useMemo(() => {
    if (!cats || cats.length === 0) return []
    const total = cats.reduce((s, c) => s + c.count, 0)
    if (total === 0) return []
    return [...cats]
      .sort((a, b) => b.count - a.count)
      .slice(0, 6)
      .map((c, i) => ({
        name:  humanize(c.category),
        value: c.count,
        color: CHART_COLORS[i % CHART_COLORS.length] as string,
      }))
  }, [cats])

  const totalSorted = automationMetrics?.totalAutoSorted ?? null
  const timeSaved   = automationMetrics?.timeSavedMinutes ?? null
  const sortedDisplay = useCountUp(totalSorted)

  return (
    <article className="dash-card dash-card--elevated intdash__card" aria-label="Automation performance">
      <div className="intdash__card-header">
        <h3 className="intdash__card-title">Automation</h3>
      </div>

      <div className="intdash__kpi">
        <span className="intdash__kpi-value intdash__kpi-value--secure">
          {sortedDisplay}
        </span>
        <span className="intdash__kpi-label">
          {totalSorted === 1 ? 'msg sorted' : 'msgs sorted'}
        </span>
      </div>

      {timeSaved !== null && (
        <p className="intdash__kpi-secondary">
          <strong>~{timeSaved} min</strong> est. time saved
        </p>
      )}

      {donutData.length > 0 ? (
        <div className="intdash__chart intdash__chart--donut ds-chart-root">
          {/* Responsive donut — uses percentage center so it scales with card width */}
          <ResponsiveContainer width="100%" height={128}>
            <PieChart>
              <Pie
                data={donutData}
                cx="50%"
                cy="50%"
                innerRadius={34}
                outerRadius={52}
                dataKey="value"
                stroke="var(--ds-surface-03)"
                strokeWidth={2}
                isAnimationActive
                animationBegin={80}
                animationDuration={700}
                animationEasing="ease-out"
              >
                {donutData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
          </ResponsiveContainer>

          {/* Compact inline legend below the donut */}
          <div className="intdash__donut-legend">
            {donutData.slice(0, 5).map((d, i) => (
              <div key={i} className="intdash__donut-legend-row">
                <span
                  className="intdash__donut-legend-dot"
                  style={{ backgroundColor: d.color }}
                />
                <span className="intdash__donut-legend-name">{d.name}</span>
                <span className="intdash__donut-legend-count">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="intdash__empty">
          {automationMetrics === null ? 'No completed sort session' : 'No category data'}
        </p>
      )}
    </article>
  )
}

// ── Column 3: Transport & Queue ───────────────────────────────────────────────

function TransportQueueCard({ snapshot }: { snapshot: AnalysisDashboardSnapshot }) {
  const { transportRatio } = snapshot

  // Use inbox tab counts directly (most reliable — always present when top !== null)
  const tabs   = snapshot.top?.inboxTabs
  const urgent = tabs?.urgent
  const review = tabs?.pending_review
  const del    = tabs?.pending_delete

  const pct     = transportRatio?.nativePercent ?? 0
  const depPct  = transportRatio !== null ? 100 - pct : 0

  return (
    <article className="dash-card dash-card--elevated intdash__card" aria-label="Transport and queue">
      {/* ── Transport section ─────────────────────────────────────────────── */}
      <div className="intdash__card-header">
        <h3 className="intdash__card-title">Transport</h3>
      </div>

      {transportRatio !== null ? (
        <div className="intdash__transport">
          {/* Stacked ratio bar */}
          <div className="intdash__transport-bar" role="img" aria-label="BEAP transport ratio">
            <div
              className="intdash__transport-bar-fill intdash__transport-bar-fill--beap"
              style={{ width: `${pct}%` }}
            />
            <div
              className="intdash__transport-bar-fill intdash__transport-bar-fill--dep"
              style={{ width: `${depPct}%` }}
            />
          </div>

          {/* Metric blocks */}
          <div className="intdash__transport-metrics">
            <div className="intdash__transport-metric">
              <span className="intdash__transport-metric-value intdash__transport-metric-value--beap">
                {fmt(transportRatio.nativeBeap)}
              </span>
              <span className="intdash__transport-metric-label">Native BEAP</span>
            </div>
            <div className="intdash__transport-metric intdash__transport-metric--right">
              <span className="intdash__transport-metric-value">
                {fmt(transportRatio.depackaged)}
              </span>
              <span className="intdash__transport-metric-label">Depackaged</span>
            </div>
          </div>

          {transportRatio.total > 0 && (
            <p className="intdash__transport-pct">
              {pct.toFixed(1)}% native · {fmt(transportRatio.total)} total
            </p>
          )}
        </div>
      ) : (
        <p className="intdash__empty" style={{ padding: 'var(--ds-space-md) 0' }}>
          Transport data unavailable
        </p>
      )}

      <div className="intdash__inner-divider" />

      {/* ── Workflow queue section ────────────────────────────────────────── */}
      <p className="intdash__queue-title">Workflow queue</p>
      <div className="intdash__queue-rows">
        <div className="intdash__queue-row intdash__queue-row--urgent">
          <span className="intdash__queue-row-label">Urgent</span>
          <span className="intdash__queue-row-count">{fmt(urgent)}</span>
        </div>
        <div className="intdash__queue-row intdash__queue-row--review">
          <span className="intdash__queue-row-label">Pending review</span>
          <span className="intdash__queue-row-count">{fmt(review)}</span>
        </div>
        <div className="intdash__queue-row intdash__queue-row--delete">
          <span className="intdash__queue-row-label">Pending delete</span>
          <span className="intdash__queue-row-count">{fmt(del)}</span>
        </div>
      </div>
    </article>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * IntelligenceDashboard
 *
 * Drop-in replacement for DashboardTopCardsRow.
 * Same props contract; do NOT swap into AnalysisCanvas.tsx until Prompt 5.
 */
export function IntelligenceDashboard({ snapshot, loading, error, onRetry }: Props) {
  // ── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="intdash">
        <div className="intdash__grid">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    )
  }

  // ── Error (inline, non-blocking) ─────────────────────────────────────────
  if (error !== null || snapshot === null) {
    return (
      <div className="intdash">
        <div className="intdash__error" role="alert">
          <span>{error ?? 'Dashboard data unavailable'}</span>
          <button
            type="button"
            className="dash-btn-ghost dash-btn-sm"
            onClick={() => void onRetry()}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  // ── Loaded ────────────────────────────────────────────────────────────────
  return (
    <div className="intdash">
      <div className="intdash__grid">
        <ThreatCard snapshot={snapshot} />
        <AutomationCard snapshot={snapshot} />
        <TransportQueueCard snapshot={snapshot} />
      </div>
    </div>
  )
}
