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
  | 'sandbox_receiving'
  | 'sandbox_degraded'
  | 'sandbox_needs_consent'

function deriveScenario(
  status: IngestionTopologyStatus,
  hasAccounts: boolean,
): ExplainerScenario | null {
  const { code } = status

  // Single-machine: never show dual-setup wording
  if (code === 'OK_SINGLE_MACHINE') return null

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

  // ── #3: Host, delegation steady-state, account connected ─────────────────
  if (scenario === 'host_delegated_with_accounts') {
    return (
      <div style={infoStyle} aria-label="Dual-device email setup status">
        <span style={{ color: textColor, fontWeight: 600 }}>🖥 Host device (sends mail)</span>
        <span>
          You&apos;re using a paired sandbox device: this machine sends your mail; your sandbox
          receives it. To receive mail, a read-only connection must be completed on the sandbox
          device.
        </span>
        <span
          style={{
            ...chipStyle,
            background: isLight ? 'rgba(234,179,8,0.13)' : 'rgba(234,179,8,0.16)',
            color: isLight ? '#854d0e' : '#fbbf24',
          }}
        >
          ⏳ Sandbox inbox: pending setup on sandbox device
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
          Receiving is handled separately on the sandbox device (read-only).
        </span>
      </div>
    )
  }

  // ── #5: Sandbox, receiving OK (or degraded but still fetching) ────────────
  if (scenario === 'sandbox_receiving') {
    return (
      <div style={infoStyle} aria-label="Sandbox inbox receiver status">
        <span style={{ color: textColor, fontWeight: 600 }}>📥 Sandbox device (receives mail)</span>
        <span>
          This device receives mail for your workspace (read-only — it cannot send). Sending
          happens on your host device.
        </span>
        <span
          style={{
            ...chipStyle,
            background: isLight ? 'rgba(34,197,94,0.1)' : 'rgba(34,197,94,0.15)',
            color: isLight ? '#166534' : '#4ade80',
          }}
        >
          ✓ Inbox: receiving
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
        aria-label="Sandbox inbox degraded"
      >
        <span style={{ color: textColor, fontWeight: 600 }}>📥 Sandbox device (receives mail)</span>
        <span>
          This device is the inbox reader but is currently unable to fetch mail. Check your
          connection and account credentials on this device.
        </span>
      </div>
    )
  }

  // ── #6: Sandbox, no read consent set up ───────────────────────────────────
  if (scenario === 'sandbox_needs_consent') {
    return (
      <div style={actionStyle} aria-label="Sandbox read consent needed">
        <span style={{ color: textColor, fontWeight: 600 }}>📥 Sandbox device (receives mail)</span>
        <span>
          Connect a read-only email account on this device to receive mail. Sending stays on
          your host device.
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
