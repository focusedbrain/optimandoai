/**
 * Build B — Sandbox Viewport UI source-level invariants.
 *
 * Reads source files as text and verifies:
 *   D1: Bulk-inbox gate (App.tsx)
 *   D2: Clone Inbox nav label + render branch + suppressed surfaces (App.tsx, CloneInboxView.tsx)
 *   D3: Processing console status mapping + fields (CloneInboxView.tsx)
 *   D4: Orphaned-sandbox placeholder copy (CloneInboxView.tsx, BeapInboxDashboard.tsx)
 *   D5: Host chip rename (EmailInboxToolbar.tsx)
 *
 * Uses readFileSync — runs in Node/vitest environment (same as other lib/__tests__ files).
 * No React components are imported here.
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

// ── D1 — Bulk-inbox gate ──────────────────────────────────────────────────────

describe('D1 — App.tsx bulk-inbox gate', () => {
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

  it('EmailInboxBulkView render branch appears after isSandbox ? branch', () => {
    const sandboxIdx = src.indexOf('isSandbox ?')
    const bulkViewIdx = src.indexOf('<EmailInboxBulkView')
    expect(sandboxIdx).toBeGreaterThan(-1)
    expect(bulkViewIdx).toBeGreaterThan(sandboxIdx)
  })
})

// ── D2 — Clone Inbox nav label + render + suppressed surfaces ─────────────────

describe('D2 — App.tsx Clone Inbox nav label', () => {
  const src = read('App.tsx')

  it('nav label is "Clone Inbox" when isSandbox', () => {
    expect(src).toContain("isSandbox ? 'Clone Inbox' : 'Inbox'")
  })

  it('imports CloneInboxView', () => {
    expect(src).toContain("import CloneInboxView from './components/CloneInboxView'")
  })

  it('renders <CloneInboxView> when isSandbox', () => {
    expect(src).toContain('<CloneInboxView')
  })

  it('compose shortcuts (✉ / BEAP) gated by !isSandbox', () => {
    const guardIdx = src.indexOf('!isSandbox &&')
    const emailComposeIdx = src.indexOf("setInboxComposeRequest('email')")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(emailComposeIdx).toBeGreaterThan(guardIdx)
  })
})

describe('D2 — CloneInboxView.tsx suppressed surfaces', () => {
  const src = read('components', 'CloneInboxView.tsx')

  it('does NOT import EmailInboxSyncControls', () => {
    expect(src).not.toMatch(/import.*EmailInboxSyncControls/)
  })

  it('does NOT import EmailProvidersSection', () => {
    expect(src).not.toMatch(/import.*EmailProvidersSection/)
  })

  it('does NOT import SyncFailureBanner', () => {
    expect(src).not.toMatch(/import.*SyncFailureBanner/)
  })

  it('does NOT import IngestionDelegationModal', () => {
    expect(src).not.toMatch(/import.*IngestionDelegationModal/)
  })

  it('keeps SandboxReadConsentWizard (mail processing setup)', () => {
    expect(src).toContain('SandboxReadConsentWizard')
  })

  it('header subtext matches spec exactly', () => {
    expect(src).toContain(
      'Cloned messages from your host for safe viewing and testing. Your mail lives on the host device.',
    )
  })

  it('uses isCloneMessage filter', () => {
    expect(src).toContain('isCloneMessage')
  })

  it('uses useIngestionStatus hook', () => {
    expect(src).toContain('useIngestionStatus')
  })

  it('tier accuracy: no microVM/hardware claims', () => {
    const lower = src.toLowerCase()
    expect(lower).not.toContain('microvm')
    expect(lower).not.toContain('crosvm')
    expect(lower).not.toContain('hardware')
    expect(lower).not.toContain('virtual machine')
  })
})

// ── D3 — Processing console ───────────────────────────────────────────────────

describe('D3 — CloneInboxView.tsx processing console', () => {
  const src = read('components', 'CloneInboxView.tsx')

  it('exports SandboxProcessingConsole', () => {
    expect(src).toContain('export function SandboxProcessingConsole')
  })

  it('status code → plain words mapping present for all three phrases', () => {
    expect(src).toContain('Processing normally')
    expect(src).toContain('Read consent needed')
    expect(src).toContain('Provider unreachable')
  })

  it('console has data-testid="sandbox-processing-console"', () => {
    expect(src).toContain('sandbox-processing-console')
  })

  it('shows delivered-to-host total', () => {
    expect(src).toContain('console-delivered')
    expect(src).toContain('lastPollDelivered')
  })

  it('shows held count field', () => {
    expect(src).toContain('console-held')
    expect(src).toContain('lastPollHeld')
  })

  it('shows last-poll time field', () => {
    expect(src).toContain('console-last-poll')
    expect(src).toContain('lastPollAt')
  })
})

// ── D4 — Orphaned sandbox placeholder ─────────────────────────────────────────

describe('D4 — CloneInboxView.tsx orphaned placeholder', () => {
  const src = read('components', 'CloneInboxView.tsx')

  it('exports OrphanedSandboxPlaceholder', () => {
    expect(src).toContain('export function OrphanedSandboxPlaceholder')
  })

  it('shows awaiting-pairing copy (exact spec wording)', () => {
    expect(src).toContain('Awaiting pairing')
    expect(src).toContain('complete the internal handshake with your host device')
    expect(src).toContain('start processing mail')
  })

  it('derives orphanedSandbox = isSandbox && !ledgerProvesInternalSandboxToHost && ready', () => {
    expect(src).toContain('orphanedSandbox')
    expect(src).toContain('ledgerProvesInternalSandboxToHost')
  })
})

describe('D4 — BeapInboxDashboard.tsx orphaned placeholder', () => {
  const src = read('components', 'BeapInboxDashboard.tsx')

  it('first-run block checks beapOrphanedSandbox', () => {
    expect(src).toContain('beapOrphanedSandbox')
  })

  it('shows awaiting-pairing copy in the first-run orphaned block', () => {
    expect(src).toContain('Awaiting pairing')
    expect(src).toContain('complete the internal handshake with your host device')
  })

  it('data-testid for the orphaned placeholder row', () => {
    expect(src).toContain('beap-orphaned-sandbox-placeholder')
  })
})

// ── D5 — Host chip rename ─────────────────────────────────────────────────────

describe('D5 — EmailInboxToolbar.tsx chip rename', () => {
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
