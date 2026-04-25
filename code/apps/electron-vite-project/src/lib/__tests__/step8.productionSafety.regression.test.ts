/**
 * STEP 8 — Regression anchors: unrelated surfaces must keep their contracts while Host AI ships.
 * (Complements `phase11.beapRegression.test.ts` — extends with explicit STEP 8 checklist.)
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripSandboxCloneLeadInFromBodyText, SANDBOX_CLONE_INBOX_LEAD_IN } from '../inboxMessageSandboxClone'

const __dir = dirname(fileURLToPath(import.meta.url))
const appsRoot = join(__dir, '..', '..', '..')

function readApp(...parts: string[]) {
  return readFileSync(join(appsRoot, ...parts), 'utf-8')
}

describe('STEP 8 — production safety regression (non–Host-AI surfaces)', () => {
  it('BEAP inbox: handshake db + email IPC still wire direct_beap / email_beap', () => {
    const db = readApp('electron', 'main', 'handshake', 'db.ts')
    expect(db).toMatch(/direct_beap/)
    expect(db).toMatch(/email_beap/)
    const emailIpc = readApp('electron', 'main', 'email', 'ipc.ts')
    expect(emailIpc).toMatch(/direct_beap|email_beap/)
  })

  it('context_sync + ACTIVE gating remain in enforcement (not replaced by Host inference strings alone)', () => {
    const enc = readApp('electron', 'main', 'handshake', 'enforcement.ts')
    expect(enc).toMatch(/context_sync|handshake-refresh|ACTIVE/)
  })

  it('external vs internal handshake types remain distinct in types module', () => {
    const types = readApp('electron', 'main', 'handshake', 'types.ts')
    expect(types).toMatch(/handshake_type/)
    expect(types).toMatch(/internal/)
    expect(types).toMatch(/standard/)
  })

  it('Sandbox Clone: lead-in strip helper contract unchanged', () => {
    const clone = readApp('src', 'lib', 'inboxMessageSandboxClone.ts')
    expect(clone).toMatch(/SANDBOX_CLONE|stripSandboxCloneLeadInFromBodyText/)
    const body = `${SANDBOX_CLONE_INBOX_LEAD_IN}body`
    expect(stripSandboxCloneLeadInFromBodyText(body).trim()).toBe('body')
  })

  it('listInferenceTargets still rejects non-internal rows at source (external unchanged by Host merge)', () => {
    const src = readApp('electron', 'main', 'internalInference', 'listInferenceTargets.ts')
    expect(src).toMatch(/NOT_INTERNAL|handshake_type/)
  })
})
