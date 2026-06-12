/**
 * UX-3 D2 — SandboxReadCleanupHint unit tests.
 *
 * Uses renderToStaticMarkup (no jsdom needed). Verifies:
 *   • Renders nothing when hint is null
 *   • Title, detail copy, and non-removing messaging
 *   • Provider security-page links (Gmail and Outlook) with correct URLs
 *   • Accessibility: role=status, aria-live=polite, data-testids present
 *   • Token-only: Remove button says "Remove from this device" (not "delete account")
 *   • Dismiss button rendered
 *   • ui-readability: --text-primary token set
 *   • Tier-accuracy: no microVM / BEAP / hardware claims
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SandboxReadCleanupHint } from './SandboxReadCleanupHint'
import type { SandboxReadCleanupHintState } from '../hooks/useSandboxReadCleanupHint'

function makeHint(
  provider: 'gmail' | 'microsoft365' = 'gmail',
  email = 'test@example.com',
): SandboxReadCleanupHintState {
  return {
    handshakeId: 'hs-test-001',
    readAccounts: [{ accountId: 'acc-001', email, provider }],
  }
}

function render(hint: SandboxReadCleanupHintState | null) {
  return renderToStaticMarkup(
    <SandboxReadCleanupHint hint={hint} onDismiss={() => {}} />,
  )
}

// ── Null / empty ──────────────────────────────────────────────────────────────

describe('SandboxReadCleanupHint — null hint', () => {
  it('renders nothing when hint is null', () => {
    expect(render(null)).toBe('')
  })

  it('renders nothing when readAccounts is empty', () => {
    const empty: SandboxReadCleanupHintState = { handshakeId: 'hs-x', readAccounts: [] }
    expect(render(empty)).toBe('')
  })
})

// ── Copy ──────────────────────────────────────────────────────────────────────

describe('SandboxReadCleanupHint — copy', () => {
  it('shows title about read-only connection no longer in use', () => {
    const html = render(makeHint())
    expect(html).toMatch(/read.only mail connection no longer in use/i)
  })

  it('shows the account email in the detail', () => {
    expect(render(makeHint('gmail', 'alice@gmail.com'))).toContain('alice@gmail.com')
  })

  it('explains connection is no longer used', () => {
    expect(render(makeHint())).toContain('no longer used')
  })

  it('confirms the connection cannot send mail', () => {
    expect(render(makeHint())).toContain('cannot send mail')
  })

  it('says not removing is fine (user choice)', () => {
    expect(render(makeHint())).toContain('Not removing it is fine')
  })
})

// ── Remove button ─────────────────────────────────────────────────────────────

describe('SandboxReadCleanupHint — remove button', () => {
  it('has data-testid=sandbox-cleanup-remove', () => {
    expect(render(makeHint())).toContain('data-testid="sandbox-cleanup-remove"')
  })

  it('button says "Remove from this device" (token-only, not "delete account")', () => {
    expect(render(makeHint())).toContain('Remove from this device')
    expect(render(makeHint())).not.toMatch(/delete account/i)
  })
})

// ── Provider security-page links ──────────────────────────────────────────────

describe('SandboxReadCleanupHint — Gmail security link', () => {
  const html = () => render(makeHint('gmail'))

  it('has data-testid=sandbox-cleanup-provider-link', () => {
    expect(html()).toContain('data-testid="sandbox-cleanup-provider-link"')
  })

  it('links to myaccount.google.com/permissions', () => {
    expect(html()).toContain('https://myaccount.google.com/permissions')
  })

  it('link text mentions Google Account', () => {
    expect(html()).toContain('Google Account')
  })
})

describe('SandboxReadCleanupHint — Outlook security link', () => {
  const html = () => render(makeHint('microsoft365'))

  it('links to account.microsoft.com/privacy/app-access', () => {
    expect(html()).toContain('https://account.microsoft.com/privacy/app-access')
  })

  it('link text mentions Microsoft', () => {
    expect(html()).toContain('Microsoft')
  })

  it('link opens in new tab (target=_blank)', () => {
    expect(html()).toContain('target="_blank"')
  })

  it('link has rel=noopener noreferrer', () => {
    expect(html()).toContain('noopener noreferrer')
  })
})

// ── Accessibility / testids ───────────────────────────────────────────────────

describe('SandboxReadCleanupHint — accessibility', () => {
  it('has role=status', () => {
    expect(render(makeHint())).toContain('role="status"')
  })

  it('has aria-live=polite', () => {
    expect(render(makeHint())).toContain('aria-live="polite"')
  })

  it('has data-testid=sandbox-read-cleanup-hint', () => {
    expect(render(makeHint())).toContain('data-testid="sandbox-read-cleanup-hint"')
  })

  it('has dismiss button with data-testid=sandbox-cleanup-dismiss', () => {
    expect(render(makeHint())).toContain('data-testid="sandbox-cleanup-dismiss"')
  })

  it('dismiss button has aria-label=Dismiss', () => {
    expect(render(makeHint())).toContain('aria-label="Dismiss"')
  })
})

// ── ui-readability ────────────────────────────────────────────────────────────

describe('SandboxReadCleanupHint — ui-readability tokens', () => {
  it('sets explicit text color using CSS variable (not inherited)', () => {
    expect(render(makeHint())).toContain('--text-primary')
  })
})

// ── Tier-accuracy ─────────────────────────────────────────────────────────────

describe('SandboxReadCleanupHint — tier-accuracy', () => {
  it('does not mention microVM / crosvm', () => {
    expect(render(makeHint())).not.toMatch(/microVM|crosvm/i)
  })

  it('does not mention BEAP', () => {
    expect(render(makeHint())).not.toContain('BEAP')
  })

  it('does not mention hardware', () => {
    expect(render(makeHint())).not.toMatch(/hardware/i)
  })
})
