/**
 * ThisDeviceCard unit tests.
 *
 * The electron-vite-project workspace runs Vitest in the default Node environment
 * (no jsdom), so these tests use `renderToStaticMarkup` for structural assertions
 * rather than driving real DOM events. The click→bridge wiring is exercised by the
 * orchestrator IPC integration tests + manual QA; here we verify the UI contract
 * (no UUID, no Copy button, formatted pairing code, Regenerate affordance, helper
 * text wording).
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ThisDeviceCard from './ThisDeviceCard'

describe('ThisDeviceCard', () => {
  it('renders the 6-digit pairing code formatted as XXX-XXX with a Regenerate button', () => {
    const html = renderToStaticMarkup(
      <ThisDeviceCard deviceName="My Laptop" mode="host" pairingCode="482917" />,
    )

    // Formatted display (dash injected after the 3rd digit, monospace via inline style).
    expect(html).toContain('482-917')
    expect(html).toMatch(/data-testid="this-device-pairing-code"/)
    expect(html).toMatch(/font-size:22px/)

    // Regenerate affordance.
    expect(html).toMatch(/data-testid="this-device-regenerate-button"/)
    expect(html).toContain('>Regenerate</button>')

    // Updated label + helper copy.
    expect(html).toContain('Pairing code')
    expect(html).toContain('Read this code aloud or write it down to pair your other device')

    // Device name / role still surfaced.
    expect(html).toContain('My Laptop')
    expect(html).toContain('>host<')
  })

  it('does NOT expose the legacy Coordination ID surface (no UUID, no Copy button, no old strings)', () => {
    const uuid = '11111111-2222-3333-4444-555555555555'
    // The legacy `instanceId` prop has been removed from the component contract.
    // We pass a UUID through the now-defunct prop name to prove (a) the type rejects
    // it (@ts-expect-error fires if the prop ever comes back) and (b) the rendered
    // markup never echoes the UUID anywhere — only the 6-digit pairing code surfaces.
    const html = renderToStaticMarkup(
      // @ts-expect-error — verifying the legacy `instanceId` prop is gone from the type.
      <ThisDeviceCard deviceName="My Laptop" mode="host" pairingCode="123456" instanceId={uuid} />,
    )

    // No UUID is rendered anywhere.
    expect(html).not.toContain(uuid)

    // Copy affordances and Coordination ID label/testids are gone.
    expect(html).not.toMatch(/this-device-copy-button/)
    expect(html).not.toMatch(/this-device-coordination-id/)
    expect(html).not.toMatch(/Copy Coordination ID/)
    expect(html).not.toContain('Coordination ID')
    expect(html).not.toContain('Share this ID with your other device')
    expect(html).not.toContain('>Copy</button>')
    expect(html).not.toContain('>Copied</button>')
  })

  it('renders an em-dash placeholder when no pairing code is available yet', () => {
    const html = renderToStaticMarkup(
      <ThisDeviceCard deviceName="My Laptop" mode="sandbox" pairingCode="" />,
    )
    expect(html).toMatch(/data-testid="this-device-pairing-code"[^>]*>—</)
    // Regenerate button is still present (lets the user mint a code immediately).
    expect(html).toMatch(/data-testid="this-device-regenerate-button"/)
  })

  it('exposes the correct preload bridge on the window contract (smoke check)', () => {
    // Surface-level guarantee that the production component reaches for the
    // `orchestratorMode.regeneratePairingCode` bridge on click. We don't drive a
    // click here (no DOM in the test env), but we assert the source contains the
    // exact bridge call so a rename on the preload side surfaces as a test failure.
    const src = ThisDeviceCard.toString()
    expect(src).toContain('regeneratePairingCode')
    expect(src).toContain('orchestratorMode')
  })
})
