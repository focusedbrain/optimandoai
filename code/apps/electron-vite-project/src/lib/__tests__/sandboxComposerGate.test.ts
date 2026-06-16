/**
 * P3 sandbox UI — composer/reply-field gate invariants.
 *
 * Validates that:
 *   - BEAP and email compose buttons are structurally absent on sandbox (gated on !isSandbox).
 *   - Inline composers are not mounted on sandbox.
 *   - FABs are hidden on sandbox.
 *   - Reply/send affordances are replaced with a lock notice on sandbox.
 *   - Handshake, Host AI, and read-only email setup UI are NOT altered.
 *   - Host path: compose buttons and reply remain present (unchanged).
 *
 * Uses readFileSync — pure Node/vitest, no DOM, no component mount.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const srcRoot = join(__dir, '..', '..')

function read(...parts: string[]): string {
  return readFileSync(join(srcRoot, ...parts), 'utf-8')
}

const LOCK_COPY = 'Sending messages is disabled on the sandbox for security.'

// ── App.tsx header compose buttons ───────────────────────────────────────────

describe('App.tsx header compose buttons', () => {
  const src = read('App.tsx')

  it('✉ email compose button is wrapped in !isSandbox guard', () => {
    // The section that contains the ✉ button must be inside a !isSandbox guard.
    const guardIdx = src.indexOf("P3 sandbox UI: compose shortcuts absent on sandbox")
    const emailBtnIdx = src.indexOf("setInboxComposeRequest('email')")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(emailBtnIdx).toBeGreaterThan(guardIdx)
  })

  it('BEAP compose button is wrapped in !isSandbox guard', () => {
    const guardIdx = src.indexOf("P3 sandbox UI: compose shortcuts absent on sandbox")
    const beapBtnIdx = src.indexOf("setInboxComposeRequest('beap')")
    expect(guardIdx).toBeGreaterThan(-1)
    expect(beapBtnIdx).toBeGreaterThan(guardIdx)
  })

  it('WrMultiTriggerBar email/beap/letter composer triggers gated on !isSandbox', () => {
    expect(src).toContain('if (!isSandbox)')
    expect(src).toContain("setDashboardComposeMode('email')")
    // The setDashboardComposeMode calls must be inside the !isSandbox block
    const notSandboxIdx = src.indexOf('if (!isSandbox)')
    const emailModeIdx = src.indexOf("setDashboardComposeMode('email')")
    expect(emailModeIdx).toBeGreaterThan(notSandboxIdx)
  })

  it('handshake button 🤝 is NOT inside the sandbox compose guard (always visible)', () => {
    const handshakeIdx = src.indexOf("setActiveView('handshakes')")
    const guardIdx = src.indexOf("P3 sandbox UI: compose shortcuts absent on sandbox")
    // Handshake button is before the compose guard section
    expect(handshakeIdx).toBeLessThan(guardIdx)
  })
})

// ── EmailInboxView.tsx ────────────────────────────────────────────────────────

describe('EmailInboxView.tsx compose gates', () => {
  const src = read('components/EmailInboxView.tsx')

  it('FABs are wrapped in {!isSandbox && (...)} guard', () => {
    expect(src).toContain('P3 sandbox UI: absent on sandbox')
    const guardIdx = src.indexOf('{!isSandbox && (')
    expect(guardIdx).toBeGreaterThan(-1)
  })

  it('composeRequest effect skips opening composers on sandbox', () => {
    expect(src).toContain('P3 sandbox UI: compose requests are ignored on sandbox')
    expect(src).toContain('if (!isSandbox) {')
  })

  it('toolbar onEmailCompose/onBeapCompose gated on !isSandbox', () => {
    expect(src).toContain("onEmailCompose={!isSandbox ?")
    expect(src).toContain("onBeapCompose={!isSandbox ?")
  })

  it('BeapInlineComposer is only mounted when !isSandbox', () => {
    expect(src).toContain('P3 sandbox UI: inline composers absent on sandbox')
    expect(src).toContain('!isSandbox && composeMode === \'beap\'')
  })

  it('EmailInlineComposer is only mounted when !isSandbox', () => {
    expect(src).toContain('!isSandbox && composeMode === \'email\'')
  })
})

describe('EmailInboxView.tsx InboxDetailAiPanel send buttons', () => {
  const src = read('components/EmailInboxView.tsx')

  it('InboxDetailAiPanel uses useOrchestratorMode for panelIsSandbox', () => {
    expect(src).toContain('const { isSandbox: panelIsSandbox } = useOrchestratorMode()')
  })

  it('BEAP send button replaced with lock notice on sandbox', () => {
    expect(src).toContain('panelIsSandbox ?')
    expect(src).toContain(LOCK_COPY)
  })

  it('email draft send button also gated (same lock copy)', () => {
    // Both send buttons share the same lock copy string — verify it appears at least twice
    const count = (src.match(new RegExp(LOCK_COPY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length
    expect(count).toBeGreaterThanOrEqual(2)
  })
})

// ── EmailMessageDetail.tsx ────────────────────────────────────────────────────

describe('EmailMessageDetail.tsx reply-icon gate', () => {
  const src = read('components/EmailMessageDetail.tsx')

  it('destructures isSandbox as detailIsSandbox from useOrchestratorMode', () => {
    expect(src).toContain('isSandbox: detailIsSandbox')
  })

  it('imports UI_BADGE for deletion/automation badge styles (regression: df35248f removed import)', () => {
    expect(src).toMatch(/import\s*\{\s*UI_BADGE\s*\}\s*from\s*['"]\.\.\/styles\/uiContrastTokens['"]/)
    expect(src).toContain('...UI_BADGE.red')
  })

  it('reply ↩ button replaced with lock notice when detailIsSandbox', () => {
    expect(src).toContain('detailIsSandbox ?')
    expect(src).toContain(LOCK_COPY)
  })

  it('lock notice uses 🔒 icon', () => {
    expect(src).toContain('🔒')
  })

  it('↩ reply button still present for host (inside else branch)', () => {
    // The reply glyph must still exist in the file for the host path
    expect(src).toContain('inbox-detail-reply-glyph')
    expect(src).toContain('↩')
  })
})

// ── BeapInboxDashboard.tsx ────────────────────────────────────────────────────

describe('BeapInboxDashboard.tsx FABs gate', () => {
  const src = read('components/BeapInboxDashboard.tsx')

  it('FABs wrapped in !beapIsSandbox guard', () => {
    expect(src).toContain('P3 sandbox UI: absent on sandbox')
    expect(src).toContain('{!beapIsSandbox && (')
  })
})

// ── BeapBulkInboxDashboard.tsx ────────────────────────────────────────────────

describe('BeapBulkInboxDashboard.tsx composers + FABs gate', () => {
  const src = read('components/BeapBulkInboxDashboard.tsx')

  it('inline composers gated on !beapBulkIsSandbox', () => {
    expect(src).toContain('P3 sandbox UI: inline composers absent on sandbox')
    expect(src).toContain('!beapBulkIsSandbox && composeMode')
  })

  it('FABs wrapped in !beapBulkIsSandbox guard', () => {
    expect(src).toContain('P3 sandbox UI: absent on sandbox')
    expect(src).toContain('{!beapBulkIsSandbox && (')
  })
})

// ── EmailInboxBulkView.tsx ────────────────────────────────────────────────────

describe('EmailInboxBulkView.tsx composers + FABs gate', () => {
  const src = read('components/EmailInboxBulkView.tsx')

  it('inline composers gated on !bulkIsSandbox', () => {
    expect(src).toContain('P3 sandbox UI: inline composers absent on sandbox')
    expect(src).toContain('!bulkIsSandbox && composeMode')
  })

  it('FABs wrapped in !bulkIsSandbox guard', () => {
    expect(src).toContain('P3 sandbox UI: absent on sandbox')
    expect(src).toContain('{!bulkIsSandbox && (')
  })
})

// ── INV-HANDSHAKE: pairing / read-setup UI untouched ─────────────────────────

describe('Pairing and read-setup UI are NOT removed on sandbox', () => {
  it('App.tsx: handshake view is still navigable', () => {
    const src = read('App.tsx')
    expect(src).toContain("setActiveView('handshakes')")
    expect(src).toContain('🤝')
  })

  it('App.tsx: EmailInboxView is still rendered on sandbox', () => {
    const src = read('App.tsx')
    // Sandbox renders EmailInboxView (not a clone-only route)
    expect(src).toContain('<EmailInboxView')
  })

  it('EmailInboxView.tsx: still renders isSandbox-gated topology banners and read setup', () => {
    const src = read('components/EmailInboxView.tsx')
    // Email providers section (read-only setup) is not gated
    expect(src).toContain('EmailProvidersSection')
    expect(src).toContain('hostTriggeredIngestion={isDedicatedSandboxHostTriggered}')
  })
})

// ── Host path: compose and reply unchanged ────────────────────────────────────

describe('Host path: compose affordances still present in source', () => {
  it('App.tsx: email compose request logic still exists', () => {
    const src = read('App.tsx')
    expect(src).toContain("setInboxComposeRequest('email')")
    expect(src).toContain("setInboxComposeRequest('beap')")
  })

  it('EmailInboxView.tsx: BeapInlineComposer still imported and used', () => {
    const src = read('components/EmailInboxView.tsx')
    expect(src).toContain('BeapInlineComposer')
    expect(src).toContain('EmailInlineComposer')
  })

  it('EmailMessageDetail.tsx: ↩ reply button still present in source (host path)', () => {
    const src = read('components/EmailMessageDetail.tsx')
    expect(src).toContain('inbox-detail-reply-icon-only')
    expect(src).toContain('handleReply')
  })
})
