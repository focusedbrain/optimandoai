/**
 * UX-3 D1 — RevocationNoticeBanner
 *
 * 24h-dismissible banner shown on the host after a handshake is revoked and
 * removeTopologyForHandshake fires. Explains what changed to the user.
 *
 * Two copy variants driven by `notice.hasAccounts` (from main.ts via status IPC):
 *
 *   hasAccounts=true (happy path):
 *     "Sandbox unlinked. Inbound mail is fetched on this device again using your
 *      existing account. No extra setup needed if your connection is still active."
 *
 *   hasAccounts=false (edge — sandbox-first user with no host account):
 *     "Sandbox unlinked. To receive inbound mail on this device, connect an email
 *      account here."
 *
 * Toast behaviour: the banner renders with a slightly elevated shadow on first
 * appearance (same pattern as the IngestionStatusBanner; no external animation lib).
 *
 * ui-readability: bg + explicit color set together on every surface.
 */

import type { RevokeNoticeRecord } from '../hooks/useRevocationBanner'

// ── Copy ─────────────────────────────────────────────────────────────────────

const COPY = {
  hasAccounts: {
    title: 'Sandbox unlinked.',
    detail:
      'Inbound mail is fetched on this device again using your existing account. No extra setup needed if your connection is still active.',
  },
  noAccounts: {
    title: 'Sandbox unlinked.',
    detail:
      'To receive inbound mail on this device, connect an email account here.',
  },
  dismiss: '✕',
} as const

// ── Styles ────────────────────────────────────────────────────────────────────

const bannerStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 12,
  background: 'rgba(99,102,241,0.09)',
  borderBottom: '1px solid rgba(99,102,241,0.22)',
  color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
}

const contentStyle: React.CSSProperties = {
  flex: 1,
}

const titleStyle: React.CSSProperties = {
  fontWeight: 700,
  marginBottom: 3,
  color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
}

const detailStyle: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1.45,
  color: 'var(--text-secondary, var(--text-secondary-prof, #374151))',
}

const dismissBtnStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1,
  padding: '2px 4px',
  color: 'var(--text-secondary, var(--text-secondary-prof, #6b7280))',
  flexShrink: 0,
}

// ── Component ─────────────────────────────────────────────────────────────────

type Props = {
  notice: RevokeNoticeRecord | null
  onDismiss: () => void
}

export function RevocationNoticeBanner({ notice, onDismiss }: Props) {
  if (!notice) return null

  const copy = notice.hasAccounts ? COPY.hasAccounts : COPY.noAccounts

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="revocation-notice-banner"
      data-has-accounts={notice.hasAccounts}
      style={bannerStyle}
    >
      <div style={contentStyle}>
        <div style={titleStyle}>{copy.title}</div>
        <div style={detailStyle}>{copy.detail}</div>
      </div>
      <button
        type="button"
        style={dismissBtnStyle}
        onClick={onDismiss}
        aria-label="Dismiss"
        data-testid="revocation-notice-dismiss"
      >
        {COPY.dismiss}
      </button>
    </div>
  )
}
