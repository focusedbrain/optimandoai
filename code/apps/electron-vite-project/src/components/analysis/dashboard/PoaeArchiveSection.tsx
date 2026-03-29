/**
 * PoAE™ — compact artifact registry: inbox rows with BEAP package JSON (dashboard snapshot).
 */

import type { AnalysisDashboardPoAEHistoryRow, AnalysisDashboardPoAESection } from '../../../types/analysisDashboardSnapshot'
import type { OpenInboxMessagePayload } from './UrgentAutosortSessionSection'
import './PoaeArchiveSection.css'

const EMPTY_POAE: AnalysisDashboardPoAESection = {
  mode: 'v1_package_history',
  title: 'PoAE™ artifact registry',
  lead: '',
  rows: [],
  rowLimit: 25,
  truncated: false,
}

function formatArtifactChannel(sourceType: string | null): string {
  const s = (sourceType ?? '').trim().toLowerCase()
  if (s === 'direct_beap') return 'Direct BEAP'
  if (s === 'depackaged' || s === 'depackaged_email') return 'Depackaged'
  if (s === 'email_plain' || s === '') return 'Plain email'
  return sourceType?.trim() || 'Inbox'
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
  const full = name && addr ? `${name} · ${addr}` : name || addr || 'Unknown sender'
  const primary = name || addr || 'Unknown sender'
  return { primary, full }
}

function idHint(id: string): string {
  if (id.length <= 10) return id
  return `${id.slice(0, 8)}…`
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

export interface PoaeArchiveSectionProps {
  poae: AnalysisDashboardPoAESection | null | undefined
  loading?: boolean
  onOpenInbox?: () => void
  onOpenInboxMessage?: (payload: OpenInboxMessagePayload) => void
}

export function PoaeArchiveSection({
  poae,
  loading = false,
  onOpenInbox,
  onOpenInboxMessage,
}: PoaeArchiveSectionProps) {
  const section = poae ?? EMPTY_POAE
  const rows = section.rows ?? []

  const countLabel =
    rows.length === 0
      ? null
      : section.truncated
        ? `${rows.length} shown · more in Inbox`
        : `${rows.length} package${rows.length === 1 ? '' : 's'}`

  return (
    <section
      className="poae-artifact-registry"
      aria-labelledby="poae-artifact-registry-title"
    >
      <header className="poae-artifact-registry__head">
        <div className="poae-artifact-registry__brand">
          <h2 id="poae-artifact-registry-title" className="poae-artifact-registry__title">
            PoAE™
          </h2>
          <p className="poae-artifact-registry__subtitle">Registry</p>
        </div>
        <div className="poae-artifact-registry__toolbar">
          {onOpenInbox ? (
            <button type="button" className="poae-artifact-registry__btn poae-artifact-registry__btn--inbox" onClick={onOpenInbox}>
              Inbox
            </button>
          ) : null}
          {countLabel ? (
            <span className="poae-artifact-registry__count" aria-live="polite">
              {countLabel}
            </span>
          ) : loading ? (
            <span className="poae-artifact-registry__count">Loading…</span>
          ) : null}
        </div>
      </header>

      <div className="poae-artifact-registry__body" role="region" aria-label="PoAE packages">
        {loading && rows.length === 0 ? (
          <p className="poae-artifact-registry__state">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="poae-artifact-registry__state">No packages on file.</p>
        ) : (
          <ul className="poae-artifact-registry__list">
            {rows.map((r) => {
              const channel = formatArtifactChannel(r.sourceType)
              const { primary: who, full: whoFull } = participantLines(r)
              const subj = (r.subject ?? '').trim()
              const summary = subj || '(No subject)'
              const receivedIso = r.receivedAt ?? undefined
              const refParts = [`Msg ${idHint(r.messageId)}`]
              if (r.handshakeId?.trim()) refParts.push(`HS ${idHint(r.handshakeId)}`)
              const refs = refParts.join(' · ')

              return (
                <li key={r.messageId} className="poae-artifact-registry__row">
                  <div className="poae-artifact-registry__main">
                    <div className="poae-artifact-registry__row1">
                      <span className="poae-artifact-registry__label" title={`BEAP package · ${channel}`}>
                        <span className="poae-artifact-registry__label-type">BEAP</span>
                        <span className="poae-artifact-registry__label-sep" aria-hidden>
                          ·
                        </span>
                        <span className="poae-artifact-registry__label-ch">{channel}</span>
                      </span>
                      <time className="poae-artifact-registry__when" dateTime={receivedIso}>
                        {formatTimeCompact(r.receivedAt)}
                      </time>
                    </div>
                    <span className="poae-artifact-registry__who" title={whoFull}>
                      {who}
                    </span>
                    <p className="poae-artifact-registry__summary" title={summary}>
                      {summary}
                    </p>
                    <p className="poae-artifact-registry__refs" title={`Message ${r.messageId}${r.handshakeId ? ` · Handshake ${r.handshakeId}` : ''}`}>
                      {refs}
                    </p>
                  </div>
                  <div className="poae-artifact-registry__actions">
                    <button
                      type="button"
                      className="poae-artifact-registry__btn poae-artifact-registry__btn--ghost"
                      title="Copy message and handshake IDs for support or audit"
                      onClick={() => void copyArtifactRefs(r)}
                    >
                      Copy
                    </button>
                    {onOpenInboxMessage ? (
                      <button
                        type="button"
                        className="poae-artifact-registry__btn poae-artifact-registry__btn--open"
                        title="Open in Inbox"
                        onClick={() => onOpenInboxMessage({ messageId: r.messageId, workflowTab: 'all' })}
                      >
                        Open
                      </button>
                    ) : onOpenInbox ? (
                      <button type="button" className="poae-artifact-registry__btn poae-artifact-registry__btn--open" onClick={onOpenInbox}>
                        Inbox
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
