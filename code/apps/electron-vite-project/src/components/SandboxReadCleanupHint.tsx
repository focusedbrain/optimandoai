/**
 * UX-3 D2 — SandboxReadCleanupHint
 *
 * One-time, dismissible hint shown on the sandbox after the handshake is revoked.
 * The user's read-only mail connection is now orphaned; this hint explains what
 * happened and gives them two independent actions (both optional — user choice):
 *
 *   1. [Remove from this device] — calls email:deleteReadToken IPC
 *      → deleteRoleScopedTokens(accountId, 'read'). Token-only per Prompt 2;
 *      gateway row intentionally kept (orphaned-poll stays DEFERRED per spec).
 *
 *   2. Provider security-page link — link text only, no auto-revoke:
 *      Gmail    → https://myaccount.google.com/permissions
 *      Outlook  → https://account.microsoft.com/privacy/app-access
 *
 * Dismissing the hint records dismissal in localStorage (one-time, no TTL).
 * Both actions imply dismissal after completion.
 *
 * ui-readability: bg + explicit color set together on every surface.
 */

import { useState } from 'react'
import type { SandboxReadCleanupHintState } from '../hooks/useSandboxReadCleanupHint'

// ── Provider security-page links (link text only, no auto-revoke) ─────────────

const PROVIDER_SECURITY_LINKS: Record<string, { label: string; url: string }> = {
  gmail: {
    label: 'Google Account security page',
    url: 'https://myaccount.google.com/permissions',
  },
  google: {
    label: 'Google Account security page',
    url: 'https://myaccount.google.com/permissions',
  },
  microsoft365: {
    label: 'Microsoft account security settings',
    url: 'https://account.microsoft.com/privacy/app-access',
  },
  outlook: {
    label: 'Microsoft account security settings',
    url: 'https://account.microsoft.com/privacy/app-access',
  },
}

function providerLink(provider: string): { label: string; url: string } | null {
  return PROVIDER_SECURITY_LINKS[provider.toLowerCase()] ?? null
}

// ── Styles ────────────────────────────────────────────────────────────────────

const bannerStyle: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 12,
  background: 'rgba(245,158,11,0.08)',
  borderBottom: '1px solid rgba(245,158,11,0.22)',
  color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
}

const rowStyle: React.CSSProperties = {
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
  lineHeight: 1.5,
  color: 'var(--text-secondary, var(--text-secondary-prof, #374151))',
  marginBottom: 6,
}

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  alignItems: 'center',
}

const removeBtnStyle: React.CSSProperties = {
  background: 'rgba(239,68,68,0.10)',
  border: '1px solid rgba(239,68,68,0.30)',
  borderRadius: 4,
  color: 'var(--text-primary, var(--text-primary-prof, #0f172a))',
  cursor: 'pointer',
  fontSize: 11,
  padding: '3px 8px',
}

const linkStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--color-link, #2563eb)',
  textDecoration: 'underline',
  cursor: 'pointer',
  background: 'none',
  border: 'none',
  padding: 0,
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

// ── Per-account sub-component ─────────────────────────────────────────────────

type AccountHintProps = {
  accountId: string
  email: string
  provider: string
  onDone: () => void
}

function AccountHint({ accountId, email, provider, onDone }: AccountHintProps) {
  const [removing, setRemoving] = useState(false)
  const [removed, setRemoved] = useState(false)

  async function handleRemove() {
    if (removing || removed) return
    setRemoving(true)
    try {
      const result = await (window as any).emailAccounts?.deleteReadToken?.(accountId)
      if (result?.ok !== false) setRemoved(true)
    } catch {
      /* best-effort — user can still revoke manually via provider */
    } finally {
      setRemoving(false)
      // Dismiss the whole hint after removal (token is gone)
      onDone()
    }
  }

  const link = providerLink(provider)

  return (
    <div style={{ marginBottom: 4 }}>
      <div style={detailStyle}>
        {email ? (
          <>Your read-only connection for <strong>{email}</strong> is no longer used.</>
        ) : (
          <>Your read-only mail connection is no longer used.</>
        )}{' '}
        Not removing it is fine — it cannot send mail. You can remove it from this device
        and revoke access in your provider's account settings.
      </div>
      <div style={actionsStyle}>
        {!removed && (
          <button
            type="button"
            style={removeBtnStyle}
            disabled={removing}
            onClick={handleRemove}
            data-testid="sandbox-cleanup-remove"
          >
            {removing ? 'Removing…' : 'Remove from this device'}
          </button>
        )}
        {link && (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            style={linkStyle}
            data-testid="sandbox-cleanup-provider-link"
            data-provider={provider}
          >
            {link.label} ↗
          </a>
        )}
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

type Props = {
  hint: SandboxReadCleanupHintState | null
  onDismiss: () => void
}

export function SandboxReadCleanupHint({ hint, onDismiss }: Props) {
  if (!hint || hint.readAccounts.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="sandbox-read-cleanup-hint"
      style={bannerStyle}
    >
      <div style={rowStyle}>
        <div style={contentStyle}>
          <div style={titleStyle}>Read-only mail connection no longer in use</div>
          {hint.readAccounts.map((acc) => (
            <AccountHint
              key={acc.accountId}
              accountId={acc.accountId}
              email={acc.email}
              provider={acc.provider}
              onDone={onDismiss}
            />
          ))}
        </div>
        <button
          type="button"
          style={dismissBtnStyle}
          onClick={onDismiss}
          aria-label="Dismiss"
          data-testid="sandbox-cleanup-dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  )
}
