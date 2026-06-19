/**
 * IngestionTopologyExplainer — UX-2b Deliverable 1
 *
 * Compact, always-visible explainer rendered inside the "Connected Email Accounts"
 * section wherever EmailProvidersSection is mounted.  It surfaces the host=send /
 * sandbox=read split so users understand the dual-setup model in EVERY state, not
 * only when something is broken.
 *
 * Driven ONLY by email:getIngestionStatus + account presence.  No parallel
 * topology logic; the explainer is surfacing-only and NEVER mutates state.
 *
 * Visibility rules (per spec, single-machine suppression preserved):
 *   - null status (suppressed / loading / IPC unavailable) → render nothing.
 *   - OK_SINGLE_MACHINE → render nothing (single-machine, no dual-setup wording).
 *   - All other codes → render the scenario-appropriate message below.
 *
 * Scenario → message matrix
 * ─────────────────────────────────────────────────────────────────────────────
 * PAUSED_HOST_DELEGATED + hasAccounts  (#3) host migration steady-state
 * PAUSED_HOST_DELEGATED + !hasAccounts (#4) host, no account yet
 * OK_SANDBOX_FETCHING / DEGRADED       (#5) sandbox, receiving
 * ACTION_NEEDED_READ_CONSENT           (#6) sandbox, no read consent
 * PAUSED_SANDBOX_UNREACHABLE           (degraded sandbox, informational)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Dismissal: NOT allowed.  This is orientation copy, not a notice.
 * Visual style: compact info strip — visually distinct from IngestionStatusBanner
 * (which handles problem states with stronger colours).
 */

import React from 'react'

// ── Shared subset type ────────────────────────────────────────────────────────
// Duck-typed subset of IngestionStatusResult from
// electron-vite-project/electron/main/email/ingestionStatus.ts.
// All fields required by this component.  The full type structurally satisfies
// this interface so Electron callers can pass IngestionStatusResult directly.
export interface IngestionTopologyStatus {
  code:
    | 'OK_SINGLE_MACHINE'
    | 'OK_SANDBOX_FETCHING'
    | 'ACTION_NEEDED_READ_CONSENT'
    | 'PAUSED_SANDBOX_UNREACHABLE'
    | 'PAUSED_HOST_DELEGATED'
    | 'DEGRADED_HELD_MESSAGES'
  thisNodeRole: 'host' | 'sandbox'
  owner: 'host' | 'sandbox'
}

// ── Scenario derivation ───────────────────────────────────────────────────────

type ExplainerScenario =
  | 'host_delegated_with_accounts'
  | 'host_delegated_no_accounts'
  | 'host_sandbox_unreachable'
  | 'host_sandbox_needs_read'
  | 'sandbox_receiving'
  | 'sandbox_degraded'
  | 'sandbox_needs_consent'

function deriveScenario(
  status: IngestionTopologyStatus,
  hasAccounts: boolean,
): ExplainerScenario | null {
  const { code, thisNodeRole } = status

  // Single-machine: never show dual-setup wording
  if (code === 'OK_SINGLE_MACHINE') return null

  if (code === 'PAUSED_SANDBOX_UNREACHABLE' && thisNodeRole === 'host') {
    return 'host_sandbox_unreachable'
  }

  if (code === 'ACTION_NEEDED_READ_CONSENT' && thisNodeRole === 'host') {
    return 'host_sandbox_needs_read'
  }

  if (code === 'PAUSED_HOST_DELEGATED') {
    return hasAccounts ? 'host_delegated_with_accounts' : 'host_delegated_no_accounts'
  }

  if (code === 'OK_SANDBOX_FETCHING' || code === 'DEGRADED_HELD_MESSAGES') {
    return 'sandbox_receiving'
  }

  if (code === 'ACTION_NEEDED_READ_CONSENT') {
    return 'sandbox_needs_consent'
  }

  if (code === 'PAUSED_SANDBOX_UNREACHABLE') {
    return 'sandbox_degraded'
  }

  return null
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface IngestionTopologyExplainerProps {
  /** From email:getIngestionStatus. null = suppressed/loading/single-machine. */
  status: IngestionTopologyStatus | null
  hasAccounts: boolean
  /** Scenario 6 CTA: open the shared connect-email wizard. */
  onConnectEmail?: () => void
  /** Visual theme. */
  theme?: string
}

export const IngestionTopologyExplainer: React.FC<IngestionTopologyExplainerProps> = ({
  status,
  hasAccounts,
  onConnectEmail,
  theme,
}) => {
  if (!status) return null

  const scenario = deriveScenario(status, hasAccounts)
  if (!scenario) return null

  const isLight = theme === 'professional' || theme === 'standard'
  const textColor = isLight
    ? 'var(--text-primary, #0f172a)'
    : 'var(--text-primary, rgba(255,255,255,0.92))'
  const mutedColor = isLight
    ? 'var(--text-secondary, #475569)'
    : 'var(--text-secondary, rgba(255,255,255,0.65))'

  const containerStyle: React.CSSProperties = {
    marginTop: 10,
    padding: '9px 11px',
    borderRadius: 8,
    fontSize: 11,
    lineHeight: 1.5,
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  }

  const infoStyle: React.CSSProperties = {
    ...containerStyle,
    background: isLight ? 'rgba(59,130,246,0.05)' : 'rgba(99,179,237,0.07)',
    borderLeft: '3px solid rgba(59,130,246,0.35)',
    color: mutedColor,
  }

  const actionStyle: React.CSSProperties = {
    ...containerStyle,
    background: isLight ? 'rgba(234,179,8,0.07)' : 'rgba(234,179,8,0.09)',
    borderLeft: '3px solid rgba(234,179,8,0.45)',
    color: mutedColor,
  }

  const errorStyle: React.CSSProperties = {
    ...containerStyle,
    background: isLight ? 'rgba(239,68,68,0.08)' : 'rgba(248,113,113,0.1)',
    borderLeft: '3px solid rgba(239,68,68,0.45)',
    color: mutedColor,
  }

  const chipStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 7px',
    borderRadius: 10,
    letterSpacing: 0.2,
    marginTop: 3,
    alignSelf: 'flex-start',
  }

  const ctaButtonStyle: React.CSSProperties = {
    marginTop: 5,
    alignSelf: 'flex-start',
    padding: '5px 10px',
    fontSize: 11,
    fontWeight: 600,
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    background: isLight ? '#3b82f6' : 'rgba(99,179,237,0.25)',
    color: isLight ? '#fff' : 'rgba(147,210,255,1)',
  }

  // ── Host: sandbox unreachable after trigger (loud — not "pending read account") ─
  if (scenario === 'host_sandbox_unreachable') {
    return (
      <div style={errorStyle} aria-label="Sandbox unreachable on host sync" role="alert">
        <span style={{ color: textColor, fontWeight: 600 }}>🖥 Host device (sends mail)</span>
        <span>
          Sandbox device unreachable — mail was not synced. Check the sandbox is on, logged in, and connected,
          then try Sync again.
        </span>
        <span
          style={{
            ...chipStyle,
            background: isLight ? 'rgba(239,68,68,0.12)' : 'rgba(248,113,113,0.16)',
            color: isLight ? '#991b1b' : '#fca5a5',
          }}
        >
          ✕ Sandbox unreachable — mail not synced
        </span>
      </div>
    )
  }

  // ── Host: sandbox reached but no read account configured ───────────────────
  if (scenario === 'host_sandbox_needs_read') {
    return (
      <div style={actionStyle} aria-label="Sandbox read account needed on host">
        <span style={{ color: textColor, fontWeight: 600 }}>🖥 Host device (sends mail)</span>
        <span>
          The sandbox has no read account configured. Set up a read-only email account on the sandbox device
          so it can depackage inbound mail when you Sync from this host.
        </span>
        <span
          style={{
            ...chipStyle,
            background: isLight ? 'rgba(234,179,8,0.13)' : 'rgba(234,179,8,0.16)',
            color: isLight ? '#854d0e' : '#fbbf24',
          }}
        >
          ⚠ Sandbox read account needed
        </span>
      </div>
    )
  }

  // ── #3: Host, delegation steady-state, account connected ─────────────────
  if (scenario === 'host_delegated_with_accounts') {
    return (
      <div style={infoStyle} aria-label="Dual-device email setup status">
        <span style={{ color: textColor, fontWeight: 600 }}>🖥 Host device (sends mail)</span>
        <span>
          You&apos;re using a paired sandbox device: this machine sends your mail; your sandbox
          depackages inbound mail headlessly and delivers it to this host inbox. The sandbox Inbox
          Clone shows only BEAP messages cloned there — connect a read-only account on the sandbox
          to enable headless depackaging.
        </span>
        <span
          style={{
            ...chipStyle,
            background: isLight ? 'rgba(234,179,8,0.13)' : 'rgba(234,179,8,0.16)',
            color: isLight ? '#854d0e' : '#fbbf24',
          }}
        >
          ⏳ Sandbox headless ingestion: pending read account on sandbox device
        </span>
      </div>
    )
  }

  // ── #4: Host, delegation active, no account yet ────────────────────────────
  if (scenario === 'host_delegated_no_accounts') {
    return (
      <div style={actionStyle} aria-label="Host email setup needed">
        <span style={{ color: textColor, fontWeight: 600 }}>🖥 Host device (sends mail)</span>
        <span>
          You&apos;re using a paired sandbox device: connect your email here for sending.
          Inbound mail is depackaged headlessly on the sandbox and delivered to this host inbox.
        </span>
      </div>
    )
  }

  // ── #5: Sandbox, headless ingestion OK (or degraded but still polling) ───
  if (scenario === 'sandbox_receiving') {
    return (
      <div style={infoStyle} aria-label="Sandbox headless ingestion status">
        <span style={{ color: textColor, fontWeight: 600 }}>📥 Sandbox device (headless ingestion)</span>
        <span>
          This device depackages inbound mail headlessly when the host syncs and delivers results to
          your host inbox. Inbox Clone here lists only BEAP messages cloned from the host. Smart Sync
          runs on your host device.
        </span>
        <span
          style={{
            ...chipStyle,
            background: isLight ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.15)',
            color: isLight ? '#166534' : '#4ade80',
          }}
        >
          ✓ Headless ingestion active (delivered to host; clones only here)
        </span>
      </div>
    )
  }

  // ── #5b: Sandbox, unreachable / fetch failing ─────────────────────────────
  if (scenario === 'sandbox_degraded') {
    return (
      <div
        style={{
          ...infoStyle,
          background: isLight ? 'rgba(239,68,68,0.06)' : 'rgba(248,113,113,0.08)',
          borderLeft: '3px solid rgba(239,68,68,0.35)',
        }}
        aria-label="Sandbox headless ingestion degraded"
      >
        <span style={{ color: textColor, fontWeight: 600 }}>📥 Sandbox device (headless ingestion)</span>
        <span>
          Headless depackaging is unavailable on this device. Check your connection and read-account
          credentials here. Results are delivered to the host inbox when working; Inbox Clone here
          shows only cloned BEAP messages.
        </span>
      </div>
    )
  }

  // ── #6: Sandbox, no read consent set up ───────────────────────────────────
  if (scenario === 'sandbox_needs_consent') {
    return (
      <div style={actionStyle} aria-label="Sandbox read consent needed">
        <span style={{ color: textColor, fontWeight: 600 }}>📥 Sandbox device (headless ingestion)</span>
        <span>
          Connect a read-only email account on this device to enable headless depackaging when the
          host syncs. Delivered mail goes to the host inbox; Inbox Clone here shows only BEAP
          messages cloned from the host.
        </span>
        {onConnectEmail && (
          <button type="button" onClick={onConnectEmail} style={ctaButtonStyle}>
            Connect email account →
          </button>
        )}
      </div>
    )
  }

  return null
}
