/**
 * UX-1 D3 — IngestionStatusBanner unit tests.
 *
 * Uses renderToStaticMarkup (no jsdom needed) to verify:
 *   • Each actionable code renders correct copy + data-testid
 *   • OK states render nothing
 *   • PAUSED_HOST_DELEGATED renders nothing (action on OTHER device)
 *   • null status renders nothing (suppressed / loading)
 *   • ui-readability: every rendered banner sets explicit color
 *   • data-ingestion-code attribute is correct for each code
 */
import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { IngestionStatusBanner } from './IngestionStatusBanner'
import type { IngestionStatusResult } from '../../electron/main/email/ingestionStatus'

function makeStatus(
  code: IngestionStatusResult['code'],
  over: Partial<IngestionStatusResult> = {},
): IngestionStatusResult {
  return {
    code,
    owner: code === 'OK_SINGLE_MACHINE' ? 'host' : 'sandbox',
    thisNodeRole: code === 'OK_SINGLE_MACHINE' ? 'host' : 'sandbox',
    hostShouldReadPoll: code === 'OK_SINGLE_MACHINE',
    sandboxShouldReadPoll: code !== 'OK_SINGLE_MACHINE',
    ownershipReason: 'test',
    accounts: [],
    resolvedAt: Date.now(),
    sandboxTopologyKind: 'none',
    ...over,
  }
}

describe('IngestionStatusBanner — actionable states render correct copy', () => {
  it('ACTION_NEEDED_READ_CONSENT: title + detail about connecting on sandbox device', () => {
    const html = renderToStaticMarkup(
      <IngestionStatusBanner status={makeStatus('ACTION_NEEDED_READ_CONSENT')} />,
    )
    expect(html).toContain('Inbound mail is paused')
    expect(html).toContain('sandbox device')
    expect(html).toContain('read-only')
    expect(html).toContain('data-testid="ingestion-status-banner"')
    expect(html).toContain('data-ingestion-code="ACTION_NEEDED_READ_CONSENT"')
  })

  it('dedicated host ACTION_NEEDED shows actionable missing read-account copy', () => {
    const html = renderToStaticMarkup(
      <IngestionStatusBanner
        status={makeStatus('ACTION_NEEDED_READ_CONSENT', {
          thisNodeRole: 'host',
          owner: 'sandbox',
          sandboxTopologyKind: 'dedicated',
        })}
      />,
    )
    expect(html).toContain('Sandbox read account needed')
    expect(html).toContain('no email account set up')
    expect(html).not.toContain('ingestion-banner-connect-cta')
  })

  it('dedicated sandbox ACTION_NEEDED shows local setup CTA', () => {
    const html = renderToStaticMarkup(
      <IngestionStatusBanner
        status={makeStatus('ACTION_NEEDED_READ_CONSENT', {
          thisNodeRole: 'sandbox',
          sandboxTopologyKind: 'dedicated',
        })}
        onConnectReadAccount={() => {}}
      />,
    )
    expect(html).toContain('Set up read-only account')
    expect(html).toContain('Set up a read-only email account here')
  })

  it('PAUSED_SANDBOX_UNREACHABLE: title + detail about unreachable sandbox', () => {
    const html = renderToStaticMarkup(
      <IngestionStatusBanner status={makeStatus('PAUSED_SANDBOX_UNREACHABLE')} />,
    )
    expect(html).toContain('Inbound mail is paused')
    expect(html).toContain('unreachable')
    expect(html).toContain('data-ingestion-code="PAUSED_SANDBOX_UNREACHABLE"')
  })

  it('DEGRADED_HELD_MESSAGES: softer notice about messages held on sandbox', () => {
    const html = renderToStaticMarkup(
      <IngestionStatusBanner status={makeStatus('DEGRADED_HELD_MESSAGES')} />,
    )
    expect(html).toContain('held')
    expect(html).toContain('sandbox')
    expect(html).toContain('data-ingestion-code="DEGRADED_HELD_MESSAGES"')
    // Degraded is not a hard "paused" — title should not say "paused"
    expect(html).not.toContain('Inbound mail is paused')
  })
})

describe('IngestionStatusBanner — silent states render nothing', () => {
  it('null status → renders nothing', () => {
    const html = renderToStaticMarkup(<IngestionStatusBanner status={null} />)
    expect(html).toBe('')
  })

  it('OK_SINGLE_MACHINE → renders nothing', () => {
    const html = renderToStaticMarkup(
      <IngestionStatusBanner status={makeStatus('OK_SINGLE_MACHINE')} />,
    )
    expect(html).toBe('')
  })

  it('OK_SANDBOX_FETCHING → renders nothing', () => {
    const html = renderToStaticMarkup(
      <IngestionStatusBanner status={makeStatus('OK_SANDBOX_FETCHING')} />,
    )
    expect(html).toBe('')
  })

  it('PAUSED_HOST_DELEGATED → renders nothing (action is on sandbox, not this device)', () => {
    const html = renderToStaticMarkup(
      <IngestionStatusBanner status={makeStatus('PAUSED_HOST_DELEGATED')} />,
    )
    expect(html).toBe('')
  })
})

describe('IngestionStatusBanner — ui-readability invariants', () => {
  it('ACTION_NEEDED banner sets explicit foreground color (bg+fg pair)', () => {
    const html = renderToStaticMarkup(
      <IngestionStatusBanner status={makeStatus('ACTION_NEEDED_READ_CONSENT')} />,
    )
    // The outer div sets color and background (ui-readability rule 1)
    expect(html).toMatch(/background:/)
    expect(html).toMatch(/color:/)
  })

  it('role=status and aria-live=polite are present for accessibility', () => {
    const html = renderToStaticMarkup(
      <IngestionStatusBanner status={makeStatus('ACTION_NEEDED_READ_CONSENT')} />,
    )
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
  })
})
