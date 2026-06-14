/**
 * Sandbox inbox viewport UI source-level invariants.
 *
 * Sandbox renders the same EmailInboxView as host with exactly two differences:
 *   • Nav label "Inbox Clone" (host: "Inbox")
 *   • Bulk toggle hidden (!isSandbox guard)
 *   • Origin-delete toggle hidden (!isSandbox guard — host-only)
 *
 * Uses readFileSync — runs in Node/vitest environment (same as other lib/__tests__ files).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
/** apps/electron-vite-project/src */
const srcRoot = join(__dir, '..', '..')

function read(...parts: string[]): string {
  return readFileSync(join(srcRoot, ...parts), 'utf-8')
}

// ── Bulk-inbox gate ───────────────────────────────────────────────────────────

describe('App.tsx bulk-inbox gate', () => {
  const src = read('App.tsx')

  it('imports useOrchestratorMode', () => {
    expect(src).toContain("import { useOrchestratorMode } from './hooks/useOrchestratorMode'")
  })

  it('isSandbox derived in App function body', () => {
    expect(src).toContain('const { isSandbox } = useOrchestratorMode()')
  })

  it('⚡ bulk toggle is inside !isSandbox guard', () => {
    const guardIdx = src.indexOf('!isSandbox && (')
    const toggleIdx = src.indexOf('Switch to bulk inbox')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(toggleIdx).toBeGreaterThan(guardIdx)
  })

  it('EmailInboxBulkView only when !isSandbox && inboxBulkMode', () => {
    expect(src).toContain('!isSandbox && inboxBulkMode')
    expect(src).toContain('<EmailInboxBulkView')
  })
})

// ── Sandbox inbox parity with host ────────────────────────────────────────────

describe('App.tsx sandbox inbox parity', () => {
  const src = read('App.tsx')

  it('nav label is "Inbox Clone" when isSandbox', () => {
    expect(src).toContain("isSandbox ? 'Inbox Clone' : 'Inbox'")
  })

  it('does NOT import CloneInboxView', () => {
    expect(src).not.toContain("import CloneInboxView")
    expect(src).not.toContain('<CloneInboxView')
  })

  it('sandbox and host both render EmailInboxView (bulk branch excluded)', () => {
    const beapIdx = src.indexOf(") : activeView === 'beap-inbox' ? (")
    expect(beapIdx).toBeGreaterThan(-1)
    const slice = src.slice(beapIdx)
    expect(slice).toContain('<EmailInboxView')
    expect(slice).not.toContain('<CloneInboxView')
  })

  it('compose shortcuts (✉ / BEAP) ARE gated by !isSandbox (P3 sandbox UI)', () => {
    // P3: compose shortcuts are hidden on sandbox — structurally absent, not shown-disabled.
    // Updated from the pre-P3 invariant "not gated" to the P3 invariant "gated on !isSandbox".
    const emailComposeIdx = src.indexOf("setInboxComposeRequest('email')")
    const beapComposeIdx = src.indexOf("setInboxComposeRequest('beap')")
    expect(emailComposeIdx).toBeGreaterThan(-1)
    expect(beapComposeIdx).toBeGreaterThan(-1)
    // Both calls must appear after the !isSandbox guard
    const guardIdx = src.indexOf("P3 sandbox UI: compose shortcuts absent on sandbox")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(emailComposeIdx).toBeGreaterThan(guardIdx)
    expect(beapComposeIdx).toBeGreaterThan(guardIdx)
  })
})

describe('EmailInboxView.tsx — full provider section (sandbox uses same component)', () => {
  const src = read('components', 'EmailInboxView.tsx')

  it('imports EmailProvidersSection', () => {
    expect(src).toMatch(/import.*EmailProvidersSection/)
  })

  it('renders EmailProvidersSection with multi-account select (Default Account in section)', () => {
    expect(src).toContain('<EmailProvidersSection')
    const providersSrc = readFileSync(
      join(srcRoot, '..', '..', 'extension-chromium', 'src', 'wrguard', 'components', 'EmailProvidersSection.tsx'),
      'utf-8',
    )
    expect(providersSrc).toContain('Default Account')
  })

  it('sandbox ingestion banner wires connect CTA to handleConnectEmail', () => {
    expect(src).toContain("ingestionStatus?.thisNodeRole === 'sandbox' ? handleConnectEmail")
    expect(src).not.toContain('openReadConsentWizard')
  })

  it('origin-delete toggle is host-only (!isSandbox guard, same as bulk toggle)', () => {
    expect(src).toContain('isSandbox={isSandbox}')
    expect(src).toMatch(/onSetDeleteFromProviderOnLocalDelete=\{\s*!isSandbox/)
    const providersSrc = readFileSync(
      join(srcRoot, '..', '..', 'extension-chromium', 'src', 'wrguard', 'components', 'EmailProvidersSection.tsx'),
      'utf-8',
    )
    expect(providersSrc).toContain('!isSandbox')
    expect(providersSrc).toContain('Also delete from the email provider when I delete here')
    expect(providersSrc).toMatch(/onSetDeleteFromProviderOnLocalDelete.*!isSandbox|!isSandbox.*onSetDeleteFromProviderOnLocalDelete/)
  })
})

// ── REGRESSION: isSandbox uses ledgerProvesInternalSandboxToHost ──────────────

describe('REGRESSION — useOrchestratorMode isSandbox must include ledgerProvesInternalSandboxToHost', () => {
  const src = readFileSync(
    join(srcRoot, 'hooks', 'useOrchestratorMode.ts'),
    'utf-8',
  )

  it('isSandbox is derived as mode===sandbox OR ledgerProvesInternalSandboxToHost (not mode alone)', () => {
    expect(src).toContain('ledgerProvesInternalSandboxToHost')
    expect(src).not.toMatch(/isSandbox:\s*mode\s*===\s*['"]sandbox['"](?!\s*\|\|)/)
  })

  it('isHost accounts for isSandbox (host=true only when not effectively sandbox)', () => {
    expect(src).toContain('isHost')
    expect(src).toMatch(/isHost:.*!isSandbox|isHost:.*&&.*!isSandbox|!isSandbox.*isHost/)
  })
})

describe('EmailInboxToolbar.tsx — no toolbar sandbox chip', () => {
  const src = read('components', 'EmailInboxToolbar.tsx')

  it('does not render Send to Sandbox or Sandbox setup chips', () => {
    expect(src).not.toContain('Send to Sandbox')
    expect(src).not.toContain('Sandbox setup')
    expect(src).not.toContain('internalSandbox')
  })
})
