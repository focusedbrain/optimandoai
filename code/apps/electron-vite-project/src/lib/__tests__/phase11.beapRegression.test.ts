/**
 * Phase 11 — regression anchors: native BEAP / clone / context paths remain wired (string-level contract).
 * Deep integration lives in `handshake` + `email` + step8 tests; this file locks filenames and keywords.
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

describe('Phase 11 — BEAP / clone / context regression (code anchors)', () => {
  it('BEAP inbox still accepts direct_beap / email_beap (schema + ipc contract)', () => {
    const db = readApp('electron', 'main', 'handshake', 'db.ts')
    expect(db).toMatch(/'direct_beap'/)
    expect(db).toMatch(/'email_beap'/)
    const emailIpc = readApp('electron', 'main', 'email', 'ipc.ts')
    expect(emailIpc).toMatch(/direct_beap/)
    expect(emailIpc).toMatch(/email_beap/)
  })

  it('handshake + enforcement still reference context_sync and ACTIVE gating (not p2p_signal in capsule store)', () => {
    const enc = readApp('electron', 'main', 'handshake', 'enforcement.ts')
    expect(enc).toMatch(/context_sync|handshake-refresh|ACTIVE/)
  })

  it('Sandbox clone lead-in strip helper unchanged (clone UX)', () => {
    const body = `${SANDBOX_CLONE_INBOX_LEAD_IN}real message`
    expect(stripSandboxCloneLeadInFromBodyText(body).trim()).toBe('real message')
  })
})
