/**
 * PoaeArtifactsPanel — premium PoAE™ artifact registry for WR Desk™.
 *
 * Drop-in replacement for PoaeArchiveSection with identical props.
 * Same logic (copyArtifactRefs, formatArtifactChannel, participantLines, etc.)
 * with premium styling: channel-coded left borders, protocol badges, row hover.
 *
 * DO NOT modify PoaeArchiveSection.tsx — this is a parallel component.
 * Swap into AnalysisCanvas in Prompt 5.
 */

import type {
  AnalysisDashboardPoAEHistoryRow,
  AnalysisDashboardPoAESection,
} from '../../../types/analysisDashboardSnapshot'
import type { OpenInboxMessagePayload } from './UrgentAutosortSessionSection'
import '../../../styles/dashboard-tokens.css'
import '../../../styles/dashboard-base.css'
import './PoaeArtifactsPanel.css'

// ── Props (identical to PoaeArchiveSection) ───────────────────────────────────

export interface PoaeArtifactsPanelProps {
  poae: AnalysisDashboardPoAESection | null | undefined
  loading?: boolean
  onOpenInbox?: () => void
  onOpenInboxMessage?: (payload: OpenInboxMessagePayload) => void
}

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_POAE: AnalysisDashboardPoAESection = {
  mode:      'v1_package_history',
  title:     'PoAE™ artifact registry',
  lead:      '',
  rows:      [],
  rowLimit:  25,
  truncated: false,
}

// ── Helpers (same logic as PoaeArchiveSection) ────────────────────────────────

function formatArtifactChannel(sourceType: string | null): string {
  const s = (sourceType ?? '').trim().toLowerCase()
  if (s === 'direct_beap') return 'Direct BEAP'
  if (s === 'depackaged' || s === 'depackaged_email') return 'Depackaged'
  if (s === 'email_plain' || s === '') return 'Plain email'
  return sourceType?.trim() || 'Inbox'
}

/**
 * Maps source type to a CSS row modifier that controls left border accent colour.
 */
function channelMod(sourceType: string | null): 'direct' | 'depackaged' | 'plain' | 'other' {
  const s = (sourceType ?? '').trim().toLowerCase()
  if (s === 'direct_beap') return 'direct'
  if (s === 'depackaged' || s === 'depackaged_email') return 'depackaged'
  if (s === 'email_plain' || s === '') return 'plain'
  return 'other'
}

function formatTimeCompact(iso: string | null): string {
  if (iso == null || String(iso).trim() === '') return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function participantLines(r: AnalysisDashboardPoAEHistoryRow): { primary: string; full: string } {
  const name = (r.fromName ?? '').trim()
  const addr = (r.fromAddress ?? '').trim()
  const full    = name && addr ? `${name} · ${addr}` : name || addr || 'Unknown sender'
  const primary = name || addr || 'Unknown sender'
  return { primary, full }
}

function idHint(id: string): string {
  return id.length <= 10 ? id : `${id.slice(0, 8)}…`
}

async function copyArtifactRefs(r: AnalysisDashboardPoAEHistoryRow): Promise<void> {
  const lines = r.handshakeId?.trim()
    ? `message_id\t${r.messageId}\nhandshake_id\t${r.handshakeId}`
    : `message_id\t${r.messageId}`
  try {
    await navigator.clipboard.writeText(lines)
  } catch {
    /* clipboard unavailable or denied */
  }
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function SkeletonRows({ count = 3 }: { count?: number }) {
  return (
    <div className="pap__skeleton-list">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="pap__skeleton-row">
          <span className="dash-skeleton" style={{ height: '10px', width: '35%' }} />
          <span className="dash-skeleton" style={{ height: '11px', width: '65%' }} />
          <span className="dash-skeleton" style={{ height: '11px', width: '80%' }} />
          <span className="dash-skeleton" style={{ height: '10px', width: '45%' }} />
        </div>
      ))}
    </div>
  )
}

// ── Artifact row ──────────────────────────────────────────────────────────────

function ArtifactRow({
  r,
  onOpenInbox,
  onOpenInboxMessage,
}: {
  r: AnalysisDashboardPoAEHistoryRow
  onOpenInbox?: () => void
  onOpenInboxMessage?: (payload: OpenInboxMessagePayload) => void
}) {
  const channel  = formatArtifactChannel(r.sourceType)
  const mod      = channelMod(r.sourceType)
  const { primary: senderLine, full: senderFull } = participantLines(r)
  const subject  = (r.subject ?? '').trim()
  const summary  = subject || '(No subject)'
  const refParts = [`Msg ${idHint(r.messageId)}`]
  if (r.handshakeId?.trim()) refParts.push(`HS ${idHint(r.handshakeId)}`)
  const refs = refParts.join(' · ')

  return (
    <li className={`pap__row pap__row--${mod}`}>
      <div className="pap__main">
        <div className="pap__row1">
          <span
            className="pap__protocol"
            title={`BEAP package · ${channel}`}
          >
            <span className="pap__protocol-beap">BEAP</span>
            <span className="pap__protocol-sep" aria-hidden>·</span>
            <span className="pap__protocol-ch">{channel}</span>
          </span>
          <time
            className="pap__when"
            dateTime={r.receivedAt ?? undefined}
          >
            {formatTimeCompact(r.receivedAt)}
          </time>
        </div>
        <span className="pap__sender" title={senderFull}>{senderLine}</span>
        <p className="pap__summary" title={summary}>{summary}</p>
        <p
          className="pap__refs"
          title={`Message ${r.messageId}${r.handshakeId ? ` · Handshake ${r.handshakeId}` : ''}`}
        >
          {refs}
        </p>
      </div>
      <div className="pap__actions">
        <button
          type="button"
          className="pap__action-btn pap__action-btn--copy"
          title="Copy message and handshake IDs for support or audit"
          onClick={() => void copyArtifactRefs(r)}
        >
          Copy
        </button>
        {onOpenInboxMessage ? (
          <button
            type="button"
            className="pap__action-btn pap__action-btn--open"
            title="Open in Inbox"
            onClick={() => onOpenInboxMessage({ messageId: r.messageId, workflowTab: 'all' })}
          >
            Open
          </button>
        ) : onOpenInbox ? (
          <button
            type="button"
            className="pap__action-btn pap__action-btn--open"
            onClick={onOpenInbox}
          >
            Inbox
          </button>
        ) : null}
      </div>
    </li>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────

export function PoaeArtifactsPanel({
  poae,
  loading = false,
  onOpenInbox,
  onOpenInboxMessage,
}: PoaeArtifactsPanelProps) {
  const section = poae ?? EMPTY_POAE
  const rows    = section.rows ?? []

  const badgeLabel =
    rows.length === 0
      ? '0'
      : section.truncated
        ? `${rows.length}+`
        : `${rows.length}`

  return (
    <section className="pap" aria-labelledby="pap-heading">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="pap__head">
        <div className="pap__head-left">
          <h2 id="pap-heading" className="pap__title">PoAE™ Registry</h2>
          <span
            className={`pap__badge${rows.length === 0 ? ' pap__badge--empty' : ''}`}
            aria-live="polite"
          >
            {loading && rows.length === 0 ? '…' : badgeLabel}
          </span>
        </div>
        {onOpenInbox && (
          <button
            type="button"
            className="dash-btn-ghost dash-btn-sm"
            onClick={onOpenInbox}
          >
            Inbox
          </button>
        )}
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {loading && rows.length === 0 ? (
        <SkeletonRows count={3} />
      ) : rows.length === 0 ? (
        <div className="pap__empty">
          <span className="pap__empty-icon" aria-hidden>📦</span>
          <p className="pap__empty-text">No PoAE packages on file</p>
        </div>
      ) : (
        <>
          <ul className="pap__list" aria-label="PoAE artifact packages">
            {rows.map((r) => (
              <ArtifactRow
                key={r.messageId}
                r={r}
                onOpenInbox={onOpenInbox}
                onOpenInboxMessage={onOpenInboxMessage}
              />
            ))}
          </ul>
          {section.truncated && (
            <p className="pap__truncated">
              Showing {rows.length} — more packages available in Inbox
            </p>
          )}
        </>
      )}
    </section>
  )
}
