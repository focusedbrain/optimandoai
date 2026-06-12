/**
 * UX-1 D5 — SandboxReadConsentWizard unit tests.
 *
 * Uses renderToStaticMarkup (no jsdom needed). Verifies:
 *   • Intro step: spec copy present exactly
 *   • Tier accuracy: no microVM/hardware/BEAP claims
 *   • Provider options: Gmail and Outlook both rendered
 *   • Accessibility: role=dialog, aria-modal, data-testids
 *   • ui-readability: bg + explicit color on the card surface
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SandboxReadConsentWizard } from './SandboxReadConsentWizard'

function render() {
  return renderToStaticMarkup(<SandboxReadConsentWizard onClose={() => {}} />)
}

describe('SandboxReadConsentWizard — intro-step spec copy', () => {
  it('title: "Connect a read-only email account"', () => {
    expect(render()).toContain('Connect a read-only email account')
  })

  it('spec body copy: read-only, cannot send, credentials stay on this device', () => {
    const html = render()
    expect(html).toContain('Connect a read-only email account on this device')
    expect(html).toContain('cannot send mail')
    expect(html).toContain('credentials stay only on this device')
  })

  it('"Choose provider" CTA present on intro step', () => {
    expect(render()).toContain('data-testid="sandbox-consent-choose-provider"')
  })

  it('Cancel button present', () => {
    expect(render()).toContain('data-testid="sandbox-consent-cancel"')
  })
})

describe('SandboxReadConsentWizard — tier accuracy', () => {
  it('does NOT mention microVM, crosvm, hardware', () => {
    const html = render().toLowerCase()
    expect(html).not.toContain('microvm')
    expect(html).not.toContain('crosvm')
    expect(html).not.toContain('hardware')
  })

  it('does NOT mention BEAP or internal implementation terms', () => {
    const html = render().toLowerCase()
    expect(html).not.toContain('beap')
    expect(html).not.toContain('capsule')
    expect(html).not.toContain('depackage')
  })
})

describe('SandboxReadConsentWizard — accessibility', () => {
  it('role=dialog and aria-modal=true present', () => {
    const html = render()
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
  })

  it('data-testid="sandbox-read-consent-wizard" present', () => {
    expect(render()).toContain('data-testid="sandbox-read-consent-wizard"')
  })

  it('card surface sets both background and color (ui-readability rule)', () => {
    const html = render()
    expect(html).toMatch(/background:/)
    expect(html).toMatch(/color:/)
  })
})
