/**
 * UX-1 D3 — IngestionStatusBanner
 *
 * Persistent (non-modal) banner shown above the message list when the email
 * ingestion topology requires user attention. Driven by email:getIngestionStatus
 * (Deliverable 1) via the useIngestionStatus hook.
 *
 * Shown states (all others render null):
 *   ACTION_NEEDED_READ_CONSENT  → amber "paused" warning
 *   PAUSED_SANDBOX_UNREACHABLE  → amber "paused" warning
 *   DEGRADED_HELD_MESSAGES      → softer amber "degraded" notice
 *
 * Silent states (no banner):
 *   OK_SINGLE_MACHINE           → healthy single-machine, no topology info needed
 *   OK_SANDBOX_FETCHING         → sandbox working, no user action needed
 *   PAUSED_HOST_DELEGATED       → transient waiting state; shown only when
 *                                 sandbox hasn't confirmed fetching yet — silent
 *                                 because the action ("connect sandbox account") is
 *                                 only possible on the sandbox device, not here.
 *
 * Suppression: do NOT render this component when the caller has determined that
 * the topology is single-machine (useIngestionStatus returns null).
 *
 * Does NOT extend SyncFailureBanner (auth/IMAP-specific) — new component.
 * ui-readability: every surface sets both background + explicit color.
 */

import type { IngestionStatusResult } from '../../electron/main/email/ingestionStatus'
import type { IngestionStatusCode } from '../../electron/main/email/ingestionStatus'

// ── Copy ─────────────────────────────────────────────────────────────────────

const COPY: Partial<Record<IngestionStatusCode, { title: string; detail: string; level: 'warn' | 'degraded' }>> = {
  ACTION_NEEDED_READ_CONSENT: {
    title: 'Inbound mail is paused',
    detail: 'Connect a read-only mail account on your sandbox device to resume receiving mail.',
    level: 'warn',
  },
  PAUSED_SANDBOX_UNREACHABLE: {
    title: 'Inbound mail is paused',
    detail: 'Your sandbox device is unreachable. Check that it is online and the handshake is active.',
    level: 'warn',
  },
  DEGRADED_HELD_MESSAGES: {
    title: 'Some messages were held',
    detail: 'Some messages were held for review on your sandbox. Check the sandbox device for details.',
    level: 'degraded',
  },
}

// ── Palette ───────────────────────────────────────────────────────────────────
// Use design-system tokens where available, with explicit fallbacks so the
// banner is readable in both Standard (light) and dark themes.

const WARN_BG = 'rgba(251,191,36,0.12)'
const WARN_BORDER = 'rgba(251,191,36,0.35)'
const WARN_TITLE_COLOR = 'var(--text-primary, var(--text-primary-prof, #0f172a))'
const WARN_DETAIL_COLOR = 'var(--text-secondary, var(--text-secondary-prof, #374151))'

const DEGRADED_BG = 'rgba(251,191,36,0.07)'
const DEGRADED_BORDER = 'rgba(251,191,36,0.2)'

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  /** Result from useIngestionStatus. Null → banner renders nothing. */
  status: IngestionStatusResult | null
}

/**
 * Render the ingestion topology banner for the given status snapshot.
 * Returns null for all OK states and when status is null (suppressed /
 * loading).
 */
export function IngestionStatusBanner({ status }: Props) {
  if (!status) return null

  const copy = COPY[status.code]
  if (!copy) return null  // OK states or unknown → no banner

  const isWarn = copy.level === 'warn'

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="ingestion-status-banner"
      data-ingestion-code={status.code}
      style={{
        padding: '10px 12px',
        fontSize: 12,
        background: isWarn ? WARN_BG : DEGRADED_BG,
        borderBottom: `1px solid ${isWarn ? WARN_BORDER : DEGRADED_BORDER}`,
        color: WARN_TITLE_COLOR,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          marginBottom: 4,
          color: WARN_TITLE_COLOR,
        }}
      >
        {copy.title}
      </div>
      <div
        style={{
          fontSize: 11,
          lineHeight: 1.45,
          color: WARN_DETAIL_COLOR,
        }}
      >
        {copy.detail}
      </div>
    </div>
  )
}
