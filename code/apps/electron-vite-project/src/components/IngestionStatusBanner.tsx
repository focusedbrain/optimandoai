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
 *   PAUSED_HOST_DELEGATED       → normal delegated waiting; silent except when
 *                                 PROMPT 4 dedicated host learns missing read
 *                                 provider / unreachable from trigger ack
 *
 * Suppression: do NOT render this component when the caller has determined that
 * the topology is single-machine (useIngestionStatus returns null).
 *
 * Does NOT extend SyncFailureBanner (auth/IMAP-specific) — new component.
 * ui-readability: every surface sets both background + explicit color.
 */

import type { IngestionStatusResult } from '../../electron/main/email/ingestionStatus'
import type { IngestionStatusCode } from '../../electron/main/email/ingestionStatus'
import {
  HOST_SANDBOX_POLL_UNREACHABLE_HINT,
  HOST_SANDBOX_READ_ACCOUNT_MISSING_HINT,
  SANDBOX_READ_ACCOUNT_SETUP_CTA,
  SANDBOX_READ_ACCOUNT_SETUP_DETAIL,
  SANDBOX_READ_ACCOUNT_SETUP_TITLE,
} from '../lib/dedicatedSandboxMissingReadProviderCopy'

// ── Copy ─────────────────────────────────────────────────────────────────────

const COPY: Partial<Record<IngestionStatusCode, { title: string; detail: string; level: 'warn' | 'degraded' }>> = {
  ACTION_NEEDED_READ_CONSENT: {
    title: 'Headless ingestion paused',
    detail:
      'Connect a read-only email account on this sandbox device so it can depackage mail headlessly and deliver to the host inbox.',
    level: 'warn',
  },
  PAUSED_SANDBOX_UNREACHABLE: {
    title: 'Headless ingestion paused',
    detail: 'Your sandbox device is unreachable. Check that it is online and the handshake is active.',
    level: 'warn',
  },
  DEGRADED_HELD_MESSAGES: {
    title: 'Some messages were held',
    detail:
      'Some messages were held during headless depackaging on your sandbox. Check the sandbox device for details.',
    level: 'degraded',
  },
}

function copyForStatus(status: IngestionStatusResult): { title: string; detail: string; level: 'warn' | 'degraded' } | null {
  const base = COPY[status.code]
  if (!base) return null

  if (status.code === 'ACTION_NEEDED_READ_CONSENT') {
    if (status.sandboxTopologyKind === 'dedicated' && status.thisNodeRole === 'host') {
      return {
        ...base,
        title: 'Sandbox read account needed',
        detail: HOST_SANDBOX_READ_ACCOUNT_MISSING_HINT,
      }
    }
    if (status.sandboxTopologyKind === 'dedicated' && status.thisNodeRole === 'sandbox') {
      return {
        ...base,
        title: SANDBOX_READ_ACCOUNT_SETUP_TITLE,
        detail: SANDBOX_READ_ACCOUNT_SETUP_DETAIL,
      }
    }
  }

  if (
    status.code === 'PAUSED_SANDBOX_UNREACHABLE' &&
    status.sandboxTopologyKind === 'dedicated' &&
    status.thisNodeRole === 'host'
  ) {
    return {
      ...base,
      detail: HOST_SANDBOX_POLL_UNREACHABLE_HINT,
    }
  }

  return base
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
  /**
   * UX-1 D5: optional CTA to open the sandbox read-consent wizard.
   * Shown only on ACTION_NEEDED_READ_CONSENT when status.thisNodeRole === 'sandbox'.
   */
  onConnectReadAccount?: () => void
}

/**
 * Render the ingestion topology banner for the given status snapshot.
 * Returns null for all OK states and when status is null (suppressed /
 * loading).
 */
export function IngestionStatusBanner({ status, onConnectReadAccount }: Props) {
  if (!status) return null

  const copy = copyForStatus(status)
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
      {/* UX-1 D5: "Connect now" CTA — only on sandbox for ACTION_NEEDED_READ_CONSENT */}
      {status.code === 'ACTION_NEEDED_READ_CONSENT' &&
        status.thisNodeRole === 'sandbox' &&
        onConnectReadAccount && (
          <button
            type="button"
            data-testid="ingestion-banner-connect-cta"
            onClick={onConnectReadAccount}
            style={{
              marginTop: 8,
              padding: '5px 14px',
              fontSize: 11,
              fontWeight: 600,
              background: 'rgba(251,191,36,0.22)',
              color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
              border: '1px solid rgba(251,191,36,0.5)',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            {status.sandboxTopologyKind === 'dedicated'
              ? SANDBOX_READ_ACCOUNT_SETUP_CTA
              : 'Connect now'}
          </button>
        )}
    </div>
  )
}
