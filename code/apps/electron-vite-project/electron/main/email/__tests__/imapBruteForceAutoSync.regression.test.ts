/**
 * Regression: IMAP 2‑minute brute-force interval must register from a reachable path
 * (registerInboxHandlers), not as dead code after `return` inside showOutlookSetupDialog.
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ipcPath = path.join(__dirname, '..', 'ipc.ts')

describe('IMAP brute-force auto-sync registration (regression)', () => {
  const src = fs.readFileSync(ipcPath, 'utf-8')

  it('registers from registerInboxHandlers (reachable init path)', () => {
    const regIdx = src.indexOf('export function registerInboxHandlers')
    expect(regIdx, 'registerInboxHandlers must exist').toBeGreaterThan(-1)
    const windowAfter = src.slice(regIdx, regIdx + 80_000)
    expect(windowAfter).toContain('ensureImapBruteForceAutoSyncIntervalRegistered(getDb)')
  })

  it('prevents duplicate intervals (one-time guard)', () => {
    expect(src).toContain('if (imapBruteForceAutoSyncIntervalHandle != null) return')
    expect(src).toContain('let imapBruteForceAutoSyncIntervalHandle')
  })

  it('does not tie IMAP interval registration to showOutlookSetupDialog', () => {
    const outlookIdx = src.indexOf('export async function showOutlookSetupDialog')
    expect(outlookIdx).toBeGreaterThan(-1)
    const tailFromOutlook = src.slice(outlookIdx)
    expect(tailFromOutlook).not.toContain('[IMAP-AUTO-SYNC]')
    expect(tailFromOutlook).not.toContain('imapBruteForceAutoSyncIntervalHandle')
    expect(tailFromOutlook).not.toContain('setInterval')
  })
})
