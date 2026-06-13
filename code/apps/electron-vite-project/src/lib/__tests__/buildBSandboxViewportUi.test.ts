/**
 * Sandbox inbox viewport UI source-level invariants.
 *
 * Sandbox renders the same EmailInboxView as host with exactly two differences:
 *   • Nav label "Inbox Clone" (host: "Inbox")
 *   • Bulk toggle hidden (!isSandbox guard)
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

  it('compose shortcuts (✉ / BEAP) are NOT gated by !isSandbox', () => {
    const emailComposeIdx = src.indexOf("setInboxComposeRequest('email')")
    const beapComposeIdx = src.indexOf("setInboxComposeRequest('beap')")
    expect(emailComposeIdx).toBeGreaterThan(-1)
    expect(beapComposeIdx).toBeGreaterThan(-1)
    const composeRegion = src.slice(
      Math.max(0, emailComposeIdx - 400),
      beapComposeIdx + 200,
    )
    expect(composeRegion).not.toMatch(/!isSandbox\s*&&[\s\S]{0,200}setInboxComposeRequest\('email'\)/)
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

// ── Host chip rename (unchanged) ──────────────────────────────────────────────

describe('EmailInboxToolbar.tsx chip rename', () => {
  const src = read('components', 'EmailInboxToolbar.tsx')

  it('uses "Send to Sandbox" for the active chip', () => {
    expect(src).toContain('Send to Sandbox')
  })

  it('uses "Sandbox setup" for the incomplete chip', () => {
    expect(src).toContain('Sandbox setup')
  })

  it('does NOT use old standalone "Sandbox" button label', () => {
    expect(src).not.toMatch(/>\s*Sandbox\s*<\/button>/)
  })

  it('does NOT use old "Sandbox (setup)" label', () => {
    expect(src).not.toContain('Sandbox (setup)')
  })
})
