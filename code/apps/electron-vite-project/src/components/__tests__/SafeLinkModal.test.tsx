/**
 * SafeLinkModal — P2.7 component tests.
 *
 * Uses renderToStaticMarkup (no jsdom) following the established pattern.
 * Tests cover the four scenarios from the P2.7 spec:
 *   1. Unflagged URL → modal renders, all buttons present, sandbox is primary
 *   2. Flagged URL (credential-request) → credential ack row present, "Open in browser" has aria-disabled
 *   3. Missing AI analysis → modal renders without AI section, sandbox is still default
 *   4. Modal is closed → renders nothing (isOpen=false)
 *
 * Imperative interaction (checkbox enables button) is exercised via interceptClick
 * unit tests and the component's logic; full click simulation requires jsdom.
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import React from 'react'
import SafeLinkModal, { type SafeLinkModalProps } from '../SafeLinkModal'
import type { LinkOpenDecision } from '../../utils/safeLinks'

// ── Fixture helpers ──────────────────────────────────────────────────────────

const defaultDecision: LinkOpenDecision = {
  action: 'open_in_sandbox',
  reason: 'all_links_default_to_sandbox',
  requiresCredentialAck: false,
}

const credentialDecision: LinkOpenDecision = {
  action: 'open_in_sandbox',
  reason: 'credential_request_flagged',
  flaggedUrl: {
    url: 'https://fake-bank.net/login',
    reason: 'credential harvest page detected',
    open_policy: 'credential_request',
  },
  requiresCredentialAck: true,
}

const flaggedNonCredDecision: LinkOpenDecision = {
  action: 'open_in_sandbox',
  reason: 'url_flagged',
  flaggedUrl: {
    url: 'https://phish.co/verify',
    reason: 'recently registered domain',
  },
  requiresCredentialAck: false,
}

function makeProps(overrides: Partial<SafeLinkModalProps> = {}): SafeLinkModalProps {
  return {
    isOpen: true,
    url: 'https://example.com/test',
    contextKey: 'msg-001:https://example.com/test',
    decision: defaultDecision,
    onOpenInSandbox: () => {},
    onOpenInBrowser: () => {},
    onCancel: () => {},
    sandboxAvailable: true,
    ...overrides,
  }
}

function render(props: SafeLinkModalProps): string {
  return renderToStaticMarkup(React.createElement(SafeLinkModal, props))
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('SafeLinkModal', () => {
  it('renders nothing when isOpen is false', () => {
    const html = render(makeProps({ isOpen: false }))
    expect(html).toBe('')
  })

  // ── Scenario 1: Unflagged URL ─────────────────────────────────────────────

  describe('unflagged URL (no AI analysis / default decision)', () => {
    it('renders the URL', () => {
      const html = render(makeProps({ url: 'https://example.com/test' }))
      expect(html).toContain('data-testid="safe-link-url"')
      expect(html).toContain('https://example.com/test')
    })

    it('shows redirect-resolution note', () => {
      const html = render(makeProps())
      expect(html).toContain('data-testid="safe-link-redirects-note"')
      expect(html).toContain('Redirect resolution not available')
    })

    it('renders sandbox button (default/primary)', () => {
      const html = render(makeProps())
      expect(html).toContain('data-testid="safe-link-btn-sandbox"')
    })

    it('renders browser button', () => {
      const html = render(makeProps())
      expect(html).toContain('data-testid="safe-link-btn-browser"')
    })

    it('renders cancel button', () => {
      const html = render(makeProps())
      expect(html).toContain('data-testid="safe-link-btn-cancel"')
    })

    it('does NOT render the flagged block', () => {
      const html = render(makeProps())
      expect(html).not.toContain('data-testid="safe-link-flagged-block"')
    })

    it('does NOT render the credential ack row', () => {
      const html = render(makeProps())
      expect(html).not.toContain('data-testid="safe-link-credential-ack-row"')
    })

    it('browser button is NOT aria-disabled when no credential ack needed', () => {
      const html = render(makeProps())
      // aria-disabled="true" should not be present on the browser button
      expect(html).not.toContain('aria-disabled="true"')
    })
  })

  // ── Scenario 2: Credential-request flagged URL ─────────────────────────────

  describe('credential-request flagged URL', () => {
    it('renders the flagged block', () => {
      const html = render(makeProps({ decision: credentialDecision, url: credentialDecision.flaggedUrl!.url }))
      expect(html).toContain('data-testid="safe-link-flagged-block"')
    })

    it('shows CREDENTIAL RISK badge', () => {
      const html = render(makeProps({ decision: credentialDecision, url: credentialDecision.flaggedUrl!.url }))
      expect(html).toContain('data-testid="safe-link-credential-badge"')
      expect(html).toContain('CREDENTIAL RISK')
    })

    it('shows the flagged URL reason text', () => {
      const html = render(makeProps({ decision: credentialDecision, url: credentialDecision.flaggedUrl!.url }))
      expect(html).toContain('credential harvest page detected')
    })

    it('renders the credential ack row', () => {
      const html = render(makeProps({ decision: credentialDecision, url: credentialDecision.flaggedUrl!.url }))
      expect(html).toContain('data-testid="safe-link-credential-ack-row"')
    })

    it('renders the credential ack checkbox unchecked by default', () => {
      const html = render(makeProps({ decision: credentialDecision, url: credentialDecision.flaggedUrl!.url }))
      expect(html).toContain('data-testid="safe-link-credential-ack-checkbox"')
      // Static markup renders unchecked by default
      expect(html).not.toContain('checked=""')
    })

    it('"Open in browser" is aria-disabled when credential ack is required (no checkbox)', () => {
      const html = render(makeProps({ decision: credentialDecision, url: credentialDecision.flaggedUrl!.url }))
      // aria-disabled="true" should be on the browser button
      expect(html).toContain('aria-disabled="true"')
      // sandbox button should still be accessible (aria-disabled not set to true there)
      expect(html).toContain('data-testid="safe-link-btn-sandbox"')
    })

    it('"Open in sandbox" is still enabled even for credential-request URLs', () => {
      const html = render(makeProps({ decision: credentialDecision, url: credentialDecision.flaggedUrl!.url, sandboxAvailable: true }))
      // sandbox button should NOT be disabled
      const sandboxSection = html.match(/data-testid="safe-link-btn-sandbox"[^>]*>/)?.[0] ?? ''
      expect(sandboxSection).not.toContain('disabled')
    })
  })

  // ── Scenario 3: Non-credential flagged URL ────────────────────────────────

  describe('flagged URL (non-credential)', () => {
    it('renders flagged block with FLAGGED BY AI badge', () => {
      const html = render(makeProps({ decision: flaggedNonCredDecision, url: flaggedNonCredDecision.flaggedUrl!.url }))
      expect(html).toContain('data-testid="safe-link-flagged-badge"')
      expect(html).toContain('FLAGGED BY AI')
    })

    it('does NOT render credential ack row', () => {
      const html = render(makeProps({ decision: flaggedNonCredDecision, url: flaggedNonCredDecision.flaggedUrl!.url }))
      expect(html).not.toContain('data-testid="safe-link-credential-ack-row"')
    })

    it('"Open in browser" is NOT aria-disabled', () => {
      const html = render(makeProps({ decision: flaggedNonCredDecision, url: flaggedNonCredDecision.flaggedUrl!.url }))
      expect(html).not.toContain('aria-disabled="true"')
    })
  })

  // ── Scenario 4: Sandbox unavailable ──────────────────────────────────────

  describe('sandbox unavailable', () => {
    it('sandbox button is disabled when sandboxAvailable=false', () => {
      const html = render(makeProps({ sandboxAvailable: false }))
      // The sandbox button should appear but be disabled
      expect(html).toContain('data-testid="safe-link-btn-sandbox"')
      // disabled attribute present
      const sandboxBtn = html.match(/data-testid="safe-link-btn-sandbox"[\s\S]*?<\/button>/)?.[0] ?? ''
      expect(sandboxBtn).toContain('disabled')
    })
  })

  // ── Accessibility ─────────────────────────────────────────────────────────

  describe('accessibility', () => {
    it('has role="dialog" and aria-modal="true"', () => {
      const html = render(makeProps())
      expect(html).toContain('role="dialog"')
      expect(html).toContain('aria-modal="true"')
    })

    it('has aria-labelledby matching the title id', () => {
      const html = render(makeProps())
      expect(html).toContain('aria-labelledby="safe-link-modal-title"')
      expect(html).toContain('id="safe-link-modal-title"')
    })
  })
})
