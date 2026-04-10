import type { ReactNode } from 'react'
import type { AnalysisDashboardSnapshot } from '../../../types/analysisDashboardSnapshot'
import { StatusToggle } from './StatusToggle'
import './IntelligenceDashboard.css'

export interface IntelligenceDashboardProps {
  snapshot: AnalysisDashboardSnapshot | null
  loading: boolean
  error: string | null
  onRetry: () => void

  // Status card — project selector
  projects?: Array<{ id: string; title: string }>
  activeProjectId?: string | null
  onSelectProject?: (projectId: string | null) => void

  // Status card — scheduled assistant runs toggle (same store flags as Project Assistant)
  autoOptimizationEnabled?: boolean
  onToggleAutoOptimization?: (enabled: boolean) => void

  // Status card — Auto-Sync toggle
  autoSyncEnabled?: boolean
  onToggleAutoSync?: (enabled: boolean) => void

  // Status card — read-only
  syncActive?: boolean
  accountCount?: number
  unopenedBeapCount?: number

  /** @deprecated Pass activeProjectId + projects instead; kept for backward compat. */
  activeProjectName?: string | null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDDMM(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    return `${dd}.${mm}`
  } catch {
    return '—'
  }
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    const hh = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${dd}.${mm}.${yyyy}, ${hh}:${min}`
  } catch {
    return '—'
  }
}

function getCatColor(cat: string): string {
  const k = cat.toLowerCase()
  if (k.includes('pending_review') || k === 'review') return 'rgba(37,99,235,0.7)'
  if (k.includes('spam'))       return 'rgba(220,38,38,0.7)'
  if (k.includes('urgent'))     return 'rgba(217,119,6,0.7)'
  if (k.includes('normal'))     return 'rgba(107,114,128,0.5)'
  if (k.includes('newsletter')) return 'rgba(5,150,105,0.6)'
  return 'rgba(155,155,150,0.4)'
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD 1 — Security
// ─────────────────────────────────────────────────────────────────────────────

function SecurityCard({ snapshot }: { snapshot: AnalysisDashboardSnapshot }) {
  const phishing    = snapshot.threatMetrics?.phishingDetected ?? 0
  const spam        = snapshot.threatMetrics?.suspiciousSenders ?? 0
  // TODO: wire to a dedicated suspicious/malicious category once model ships those labels
  const suspicious  = snapshot.threatMetrics?.maliciousAttachments ?? 0

  const maxThreat = Math.max(phishing, spam, suspicious, 1)

  // TODO: wire to real link-opened-off-band tracking when that feature ships
  const linksOffBand = 0
  // TODO: wire to real PDF-parsed-to-text count when that feature ships
  const pdfsParsed   = 0

  const session = snapshot.autosort?.latestSession
  const footerText = session
    ? `Last sort: ${formatDDMM(session.startedAt)} · ${session.totalMessages} msgs`
    : 'No sort sessions yet'

  const threatRows = [
    { label: 'Phishing',   count: phishing,   fill: 'rgba(220,38,38,0.8)',  countColor: '#DC2626' },
    { label: 'Spam',       count: spam,       fill: 'rgba(217,119,6,0.8)',  countColor: '#D97706' },
    { label: 'Suspicious', count: suspicious, fill: 'rgba(155,155,150,0.5)', countColor: '#1C1C1A' },
  ]

  const protectRows = [
    { label: 'Links opened off-band', count: linksOffBand, dot: 'rgba(37,99,235,0.7)' },
    { label: 'PDFs parsed to text',   count: pdfsParsed,   dot: 'rgba(124,58,237,0.7)' },
  ]

  return (
    <div className="intelligence-card">
      <p className="intelligence-card__label">SECURITY</p>

      <p className="ic-sec__sub-label ic-sec__sub-label--threats">THREATS</p>
      <div className="ic-sec__threat-rows">
        {threatRows.map(({ label, count, fill, countColor }) => (
          <div key={label} className="ic-sec__threat-row">
            <span className="ic-sec__threat-label">{label}</span>
            <div className="ic-sec__bar-track">
              <div
                className="ic-sec__bar-fill"
                style={{ width: `${(count / maxThreat) * 100}%`, background: fill }}
              />
            </div>
            <span className="ic-sec__threat-count" style={{ color: countColor }}>
              {count}
            </span>
          </div>
        ))}
      </div>

      <hr className="ic-sec__divider" />

      <p className="ic-sec__sub-label ic-sec__sub-label--protected">PROTECTED</p>
      <div className="ic-sec__protect-rows">
        {protectRows.map(({ label, count, dot }) => (
          <div key={label} className="ic-sec__protect-row">
            <span className="ic-sec__protect-dot" style={{ background: dot }} />
            <span className="ic-sec__protect-label">{label}</span>
            <span className="ic-sec__protect-count">{count}</span>
          </div>
        ))}
      </div>

      <hr className="ic-sec__footer" />
      <p className="ic-sec__footer-text">{footerText}</p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD 2 — Autosort
// ─────────────────────────────────────────────────────────────────────────────

function AutosortCard({ snapshot }: { snapshot: AnalysisDashboardSnapshot }) {
  const session = snapshot.autosort?.latestSession
  const totalMessages = session?.totalMessages ?? 0

  const rawCats: Array<{ category: string; count: number }> =
    (snapshot.top?.autosortCategoryCounts ?? []).filter(c => c.count > 0)
  const sorted = [...rawCats].sort((a, b) => b.count - a.count)
  const legendItems = sorted.slice(0, 6)

  const hasSession = Boolean(session)

  return (
    <div className="intelligence-card">
      <p className="intelligence-card__label">AUTOSORT</p>

      <div className="ic-auto__kpi-row">
        <span className="ic-auto__kpi-num">{totalMessages.toLocaleString()}</span>
        <span className="ic-auto__kpi-unit">messages sorted</span>
      </div>

      {hasSession && totalMessages > 0 && sorted.length > 0 ? (
        <>
          <div className="ic-auto__bar-wrap">
            {sorted.map(({ category, count }, i) => {
              const pct = (count / totalMessages) * 100
              const isFirst = i === 0
              const isLast  = i === sorted.length - 1
              const radius = isFirst && isLast
                ? '4px'
                : isFirst ? '4px 0 0 4px'
                : isLast  ? '0 4px 4px 0'
                : '0'
              return (
                <div
                  key={category}
                  className="ic-auto__bar-seg"
                  style={{
                    width: `${pct}%`,
                    background: getCatColor(category),
                    borderRadius: radius,
                  }}
                />
              )
            })}
          </div>

          <div className="ic-auto__legend">
            {legendItems.map(({ category, count }) => (
              <div key={category} className="ic-auto__legend-item">
                <span
                  className="ic-auto__legend-dot"
                  style={{ background: getCatColor(category) }}
                />
                <span className="ic-auto__legend-text">
                  {category} {count}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <hr className="ic-auto__divider" />

      {session ? (
        <div className="ic-auto__session-ref">
          <span className="ic-auto__session-id">
            {session.sessionId.length > 12
              ? `${session.sessionId.slice(0, 12)}…`
              : session.sessionId}
          </span>
          <span className="ic-auto__session-date">
            {formatDateTime(session.startedAt)}
          </span>
        </div>
      ) : (
        <span className="ic-auto__no-session">No sort sessions</span>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD 3 — Transport
// ─────────────────────────────────────────────────────────────────────────────

const RING_R  = 18
const RING_C  = 2 * Math.PI * RING_R   // ≈ 113.097

function TransportCard({ snapshot }: { snapshot: AnalysisDashboardSnapshot }) {
  const nativeBeap    = snapshot.transportRatio?.nativeBeap    ?? 0
  const depackaged    = snapshot.transportRatio?.depackaged    ?? 0
  const nativePercent = snapshot.transportRatio?.nativePercent ?? 0

  const dash = (nativePercent / 100) * RING_C
  const gap  = RING_C - dash

  const inboxTabs = snapshot.top?.inboxTabs
  const urgent        = inboxTabs?.urgent         ?? 0
  const pendingReview = inboxTabs?.pending_review ?? 0
  const pendingDelete = inboxTabs?.pending_delete ?? 0

  const queueRows = [
    { label: 'Urgent',         count: urgent,        color: '#DC2626' },
    { label: 'Pending review', count: pendingReview, color: '#D97706' },
    { label: 'Pending delete', count: pendingDelete, color: '#6B7280' },
  ]

  return (
    <div className="intelligence-card">
      <p className="intelligence-card__label">TRANSPORT</p>

      <div className="ic-tp__top">
        <div className="ic-tp__ring-wrap">
          <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
            <circle
              cx="28" cy="28" r={RING_R}
              fill="none"
              stroke="#E8E8E6"
              strokeWidth="2.5"
            />
            <circle
              cx="28" cy="28" r={RING_R}
              fill="none"
              stroke="#059669"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={`${dash} ${gap}`}
              transform="rotate(-90 28 28)"
            />
            <text
              x="28" y="28"
              fontSize="11"
              fontWeight="600"
              fill="#1C1C1A"
              textAnchor="middle"
              dominantBaseline="central"
              fontFamily="'Inter', system-ui, sans-serif"
              style={{ fontFeatureSettings: '"tnum"' }}
            >
              {nativePercent}%
            </text>
          </svg>
          <span className="ic-tp__ring-sub">native</span>
        </div>

        <div className="ic-tp__counts">
          <div className="ic-tp__count-block">
            <span className="ic-tp__count-num">{nativeBeap.toLocaleString()}</span>
            <span className="ic-tp__count-lbl">BEAP</span>
          </div>
          <div className="ic-tp__count-block">
            <span className="ic-tp__count-num">{depackaged.toLocaleString()}</span>
            <span className="ic-tp__count-lbl">Depackaged</span>
          </div>
        </div>
      </div>

      <hr className="ic-tp__divider" />

      <p className="ic-tp__queue-label">QUEUE</p>
      <div className="ic-tp__queue-rows">
        {queueRows.map(({ label, count, color }) => (
          <div key={label} className="ic-tp__queue-row">
            <div className="ic-tp__queue-left">
              <div className="ic-tp__queue-bar" style={{ background: color }} />
              <span className="ic-tp__queue-row-label">{label}</span>
            </div>
            <span className="ic-tp__queue-count" style={{ color }}>
              {count ?? 0}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// CARD 4 — Status
// ─────────────────────────────────────────────────────────────────────────────

function StatusCard({
  autoOptimizationEnabled  = false,
  onToggleAutoOptimization,
  autoSyncEnabled          = false,
  onToggleAutoSync,
  syncActive               = false,
  accountCount             = 0,
  unopenedBeapCount        = 0,
  projects                 = [],
  activeProjectId          = null,
  onSelectProject,
}: {
  autoOptimizationEnabled?: boolean
  onToggleAutoOptimization?: (enabled: boolean) => void
  autoSyncEnabled?: boolean
  onToggleAutoSync?: (enabled: boolean) => void
  syncActive?: boolean
  accountCount?: number
  unopenedBeapCount?: number
  projects?: Array<{ id: string; title: string }>
  activeProjectId?: string | null
  onSelectProject?: (projectId: string | null) => void
}) {
  const autoOptDisabled  = !activeProjectId
  const autoSyncDisabled = accountCount === 0

  const beapColor = unopenedBeapCount > 0 ? '#D97706' : '#9B9B96'

  const accountLabel = accountCount === 0
    ? 'No accounts'
    : accountCount === 1
      ? '1 account connected'
      : `${accountCount} accounts connected`

  return (
    <div className="intelligence-card">
      <p className="intelligence-card__label">STATUS</p>

      <div className="ic-st__status-rows">

        {/* Row 1: Repeat assistant on linked WR Chat — same store as Project Assistant panel */}
        <div className="ic-st__status-row">
          <div className="ic-st__status-left">
            <div
              className="ic-st__status-dot"
              style={{
                background: autoOptimizationEnabled ? '#059669' : 'rgba(220,38,38,0.5)',
                opacity: autoOptDisabled ? 0.45 : 1,
              }}
            />
            <span
              className="ic-st__status-label"
              style={{ opacity: autoOptDisabled ? 0.45 : 1 }}
            >
              Repeat linked session
            </span>
          </div>
          <StatusToggle
            enabled={autoOptimizationEnabled}
            onToggle={(v) => onToggleAutoOptimization?.(v)}
            disabled={autoOptDisabled}
            label={
              autoOptDisabled
                ? 'Repeat linked session (select a project first)'
                : 'Repeat linked WR Chat session'
            }
          />
        </div>
        {autoOptDisabled && (
          <div style={{ textAlign: 'right', fontSize: 8, color: '#D97706', marginTop: -2, marginBottom: 2 }}>
            Select a project first
          </div>
        )}

        {/* Row 2: Auto-Sync — interactive toggle */}
        <div className="ic-st__status-row">
          <div className="ic-st__status-left">
            <div
              className="ic-st__status-dot"
              style={{
                background: autoSyncEnabled ? '#059669' : 'rgba(220,38,38,0.5)',
                opacity: autoSyncDisabled ? 0.45 : 1,
              }}
            />
            <span
              className="ic-st__status-label"
              style={{ opacity: autoSyncDisabled ? 0.45 : 1 }}
            >
              Auto-Sync
            </span>
          </div>
          <StatusToggle
            enabled={autoSyncEnabled}
            onToggle={(v) => onToggleAutoSync?.(v)}
            disabled={autoSyncDisabled}
            label={
              autoSyncDisabled
                ? 'Auto-Sync (add an account first)'
                : 'Auto-Sync'
            }
          />
        </div>
        {autoSyncDisabled && (
          <div style={{ textAlign: 'right', fontSize: 8, color: '#D97706', marginTop: -2, marginBottom: 2 }}>
            Add an account first
          </div>
        )}

        {/* Row 3: Sync — read-only status indicator */}
        <div className="ic-st__status-row">
          <div className="ic-st__status-left">
            <div
              className="ic-st__status-dot"
              style={{ background: syncActive ? '#2563EB' : '#9B9B96' }}
            />
            <span className="ic-st__status-label">Sync</span>
          </div>
          <span
            className="ic-st__status-state"
            style={{ color: syncActive ? '#2563EB' : '#9B9B96' }}
          >
            {syncActive ? 'ACTIVE' : 'IDLE'}
          </span>
        </div>

      </div>

      <hr className="ic-st__divider" />

      <div className="ic-st__beap-row">
        <div className="ic-st__beap-left">
          <div className="ic-st__beap-bar" />
          <span className="ic-st__beap-label">Unopened BEAP</span>
        </div>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: beapColor,
            fontFeatureSettings: '"tnum"',
            fontFamily: 'var(--dash-font-family, "Inter", system-ui, sans-serif)',
          }}
        >
          {unopenedBeapCount}
        </span>
      </div>

      <div className="ic-st__account-row">
        <div className="ic-st__account-dot" />
        <span className="ic-st__account-text">{accountLabel}</span>
      </div>

      <hr className="ic-st__divider-sm" />

      {/* Project selector — replaces the static project name text */}
      <select
        value={activeProjectId ?? ''}
        onChange={(e) => onSelectProject?.(e.target.value || null)}
        className="ic-st__project-select"
        aria-label="Active project"
      >
        <option value="">— No project —</option>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.title}</option>
        ))}
      </select>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Loading skeleton
// ─────────────────────────────────────────────────────────────────────────────

function SkeletonCard({
  delay,
  children,
}: {
  delay: number
  children: ReactNode
}) {
  return (
    <div className="intelligence-card" style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  )
}

function LoadingSkeletons() {
  const S = ({ w, h, circle }: { w: number | string; h: number; circle?: boolean }) => (
    <div
      className={`dash-skeleton${circle ? ' ic-skel__circle' : ''}`}
      style={{
        width: typeof w === 'number' ? w : w,
        height: h,
        borderRadius: circle ? '50%' : undefined,
        flexShrink: 0,
      }}
    />
  )

  return (
    <div className="intelligence-dashboard">
      {/* Card 1 */}
      <SkeletonCard delay={0}>
        <S w={60}  h={10} />
        <div style={{ height: 8 }} />
        <S w={40}  h={10} />
        <div style={{ height: 6 }} />
        {[1, 2, 3].map(i => (
          <div key={i} className="ic-skel__row" style={{ marginBottom: 2 }}>
            <S w={50} h={8} /><S w="100%" h={8} /><S w={20} h={8} />
          </div>
        ))}
        <div style={{ height: 10 }} />
        <S w={50} h={10} />
        <div style={{ height: 6 }} />
        {[1, 2].map(i => (
          <div key={i} className="ic-skel__row" style={{ marginBottom: 2 }}>
            <S w={6} h={6} circle /><S w={100} h={10} /><S w={20} h={12} />
          </div>
        ))}
      </SkeletonCard>

      {/* Card 2 */}
      <SkeletonCard delay={80}>
        <S w={60} h={10} />
        <div style={{ height: 8 }} />
        <S w={80} h={24} />
        <div style={{ height: 14 }} />
        <S w="100%" h={12} />
        <div style={{ height: 10 }} />
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="ic-skel__row" style={{ marginBottom: 4 }}>
            <S w={6} h={6} circle /><S w={80} h={8} />
          </div>
        ))}
        <div style={{ height: 10 }} />
        <S w={90} h={10} />
        <div style={{ height: 4 }} />
        <S w={90} h={10} />
      </SkeletonCard>

      {/* Card 3 */}
      <SkeletonCard delay={160}>
        <S w={60} h={10} />
        <div style={{ height: 8 }} />
        <div className="ic-skel__row" style={{ alignItems: 'flex-start' }}>
          <S w={36} h={36} circle />
          <div style={{ marginLeft: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <S w={30} h={15} /><S w={30} h={15} />
          </div>
        </div>
        <div style={{ height: 10 }} />
        {[1, 2, 3].map(i => (
          <div key={i} className="ic-skel__row" style={{ marginBottom: 1 }}>
            <S w={3} h={14} /><S w={80} h={10} /><S w={20} h={10} />
          </div>
        ))}
      </SkeletonCard>

      {/* Card 4 */}
      <SkeletonCard delay={240}>
        <S w={60} h={10} />
        <div style={{ height: 8 }} />
        {[1, 2, 3].map(i => (
          <div key={i} className="ic-skel__row" style={{ marginBottom: 1 }}>
            <S w={8} h={8} circle /><S w={90} h={10} /><S w={20} h={10} />
          </div>
        ))}
        <div style={{ height: 10 }} />
        <div className="ic-skel__row">
          <S w={3} h={14} /><S w={80} h={10} /><S w={20} h={12} />
        </div>
        <div style={{ height: 4 }} />
        <S w={100} h={10} />
      </SkeletonCard>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export function IntelligenceDashboard({
  snapshot,
  loading,
  error,
  onRetry,
  projects                 = [],
  activeProjectId          = null,
  onSelectProject,
  autoOptimizationEnabled  = false,
  onToggleAutoOptimization,
  autoSyncEnabled          = false,
  onToggleAutoSync,
  syncActive               = false,
  accountCount             = 0,
  unopenedBeapCount        = 0,
}: IntelligenceDashboardProps) {
  if (error) {
    return (
      <div className="intelligence-dashboard intelligence-dashboard--error">
        <div className="ic-error-card">
          <p className="ic-error-text">Unable to load dashboard</p>
          <button className="ic-error-btn" onClick={onRetry}>Retry</button>
        </div>
      </div>
    )
  }

  if (!snapshot || loading && !snapshot) {
    return <LoadingSkeletons />
  }

  return (
    <div className="intelligence-dashboard">
      <SecurityCard  snapshot={snapshot} />
      <AutosortCard  snapshot={snapshot} />
      <TransportCard snapshot={snapshot} />
      <StatusCard
        autoOptimizationEnabled={autoOptimizationEnabled}
        onToggleAutoOptimization={onToggleAutoOptimization}
        autoSyncEnabled={autoSyncEnabled}
        onToggleAutoSync={onToggleAutoSync}
        syncActive={syncActive}
        accountCount={accountCount}
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={onSelectProject}
        unopenedBeapCount={unopenedBeapCount}
      />
    </div>
  )
}
