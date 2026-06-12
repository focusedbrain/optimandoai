/**
 * UX-3 D1 — RevocationNoticeBanner unit tests.
 *
 * Uses renderToStaticMarkup (no jsdom needed). Verifies:
 *   • Happy-path copy (hasAccounts=true) — spec-mandated sentences
 *   • No-account copy variant (hasAccounts=false)
 *   • role=status, data-testid, dismiss button rendered
 *   • ui-readability: explicit color set on the surface
 *   • No microVM / hardware / BEAP implementation claims
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { RevocationNoticeBanner } from './RevocationNoticeBanner'
import type { RevokeNoticeRecord } from '../hooks/useRevocationBanner'

function makeNotice(hasAccounts: boolean): RevokeNoticeRecord {
  return {
    handshakeId: 'hs-test-001',
    hasAccounts,
    revokedAt: Date.now(),
    dismissed: false,
  }
}

function render(notice: RevokeNoticeRecord | null) {
  return renderToStaticMarkup(
    <RevocationNoticeBanner notice={notice} onDismiss={() => {}} />,
  )
}

// ── Null / empty ──────────────────────────────────────────────────────────────

describe('RevocationNoticeBanner — null notice', () => {
  it('renders nothing when notice is null', () => {
    expect(render(null)).toBe('')
  })
})

// ── Happy-path copy (hasAccounts=true) ───────────────────────────────────────

describe('RevocationNoticeBanner — happy-path copy (hasAccounts=true)', () => {
  const html = () => render(makeNotice(true))

  it('contains "Sandbox unlinked."', () => {
    expect(html()).toContain('Sandbox unlinked.')
  })

  it('explains inbound mail is fetched again on this device using existing account', () => {
    expect(html()).toContain('Inbound mail is fetched on this device again')
    expect(html()).toContain('using your existing account')
  })

  it('says no extra setup needed', () => {
    expect(html()).toContain('No extra setup needed')
  })

  it('mentions "if your connection is still active"', () => {
    expect(html()).toContain('if your connection is still active')
  })
})

// ── No-account copy variant (hasAccounts=false) ───────────────────────────────

describe('RevocationNoticeBanner — no-account variant (hasAccounts=false)', () => {
  const html = () => render(makeNotice(false))

  it('contains "Sandbox unlinked."', () => {
    expect(html()).toContain('Sandbox unlinked.')
  })

  it('instructs user to connect an account', () => {
    expect(html()).toContain('connect an email account here')
  })

  it('does NOT use the happy-path "existing account" phrase', () => {
    expect(html()).not.toContain('existing account')
  })
})

// ── Accessibility / testids ───────────────────────────────────────────────────

describe('RevocationNoticeBanner — accessibility', () => {
  it('has role=status', () => {
    expect(render(makeNotice(true))).toContain('role="status"')
  })

  it('has aria-live=polite', () => {
    expect(render(makeNotice(true))).toContain('aria-live="polite"')
  })

  it('has data-testid=revocation-notice-banner', () => {
    expect(render(makeNotice(true))).toContain('data-testid="revocation-notice-banner"')
  })

  it('has dismiss button with data-testid=revocation-notice-dismiss', () => {
    expect(render(makeNotice(true))).toContain('data-testid="revocation-notice-dismiss"')
  })

  it('dismiss button has aria-label=Dismiss', () => {
    expect(render(makeNotice(true))).toContain('aria-label="Dismiss"')
  })
})

// ── ui-readability ────────────────────────────────────────────────────────────

describe('RevocationNoticeBanner — ui-readability tokens', () => {
  it('sets explicit text color using CSS variable (not inherited)', () => {
    const html = render(makeNotice(true))
    expect(html).toContain('--text-primary')
  })
})

// ── Tier-accuracy ─────────────────────────────────────────────────────────────

describe('RevocationNoticeBanner — tier-accuracy (no impl detail claims)', () => {
  const html = () => render(makeNotice(true))

  it('does not mention microVM / crosvm', () => {
    expect(html()).not.toMatch(/microVM|crosvm/i)
  })

  it('does not mention BEAP', () => {
    expect(html()).not.toContain('BEAP')
  })

  it('does not mention hardware', () => {
    expect(html()).not.toMatch(/hardware/i)
  })
})
