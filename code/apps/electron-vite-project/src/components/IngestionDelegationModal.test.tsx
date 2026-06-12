/**
 * UX-1 D4 — IngestionDelegationModal unit tests.
 *
 * Uses renderToStaticMarkup (no jsdom needed). Verifies:
 *   • Correct 3-sentence copy (tier-accurate — no microVM/hardware claims)
 *   • role=dialog, aria-modal=true, data-testid present
 *   • CTA button rendered
 *   • No claims about microVM, hardware, or implementation details
 *   • ui-readability: bg + explicit color present on the card surface
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { IngestionDelegationModal } from './IngestionDelegationModal'

function render(handshakeId = 'hs-test-001') {
  return renderToStaticMarkup(
    <IngestionDelegationModal handshakeId={handshakeId} onDismiss={() => {}} />,
  )
}

describe('IngestionDelegationModal — required copy (spec)', () => {
  it('title: "Your sandbox is now connected."', () => {
    expect(render()).toContain('Your sandbox is now connected.')
  })

  it('explains inbound mail moves to sandbox + action needed', () => {
    const html = render()
    expect(html).toContain('Inbound mail is now fetched on your sandbox device')
    expect(html).toContain('connect a read-only mail account there')
  })

  it('explains outbound is unchanged', () => {
    expect(render()).toContain('Sending from this device is unchanged and keeps working.')
  })

  it('has a "Got it" CTA button', () => {
    const html = render()
    expect(html).toContain('Got it')
    expect(html).toContain('data-testid="ingestion-delegation-modal-cta"')
  })
})

describe('IngestionDelegationModal — tier accuracy (no hardware/microVM claims)', () => {
  it('does NOT mention microVM, crosvm, or hardware', () => {
    const html = render().toLowerCase()
    expect(html).not.toContain('microvm')
    expect(html).not.toContain('crosvm')
    expect(html).not.toContain('hardware')
    expect(html).not.toContain('kvm')
  })

  it('does NOT mention "BEAP" or internal implementation terms', () => {
    const html = render().toLowerCase()
    expect(html).not.toContain('beap')
    expect(html).not.toContain('capsule')
    expect(html).not.toContain('depackage')
  })
})

describe('IngestionDelegationModal — accessibility + structural contract', () => {
  it('role=dialog and aria-modal=true present', () => {
    const html = render()
    expect(html).toContain('role="dialog"')
    expect(html).toContain('aria-modal="true"')
  })

  it('data-testid="ingestion-delegation-modal" present', () => {
    expect(render()).toContain('data-testid="ingestion-delegation-modal"')
  })

  it('card surface sets both background and explicit color (ui-readability rule)', () => {
    const html = render()
    // The card div should carry both background and color inline styles
    expect(html).toMatch(/background:/)
    expect(html).toMatch(/color:/)
  })
})
