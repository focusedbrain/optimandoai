/**
 * Behavioral mirrors of main-process guards (keep aligned when editing):
 * - IMAP 2‑min interval: ipc.ts ~4937 (`registerInboxHandlers`)
 * - DB-driven auto-sync tick: syncOrchestrator.ts `startAutoSync` (~990)
 * - IPC validation: ipc.ts `email:setProcessingPaused` (~510)
 */
import { describe, it, expect } from 'vitest'

/** Same predicate as IMAP periodic loop account filter. */
function imapPeriodicPullWouldInclude(acc: {
  provider: string
  status: string
  processingPaused?: boolean
}): boolean {
  if (acc.provider !== 'imap' || acc.status !== 'active') return false
  if (acc.processingPaused === true) return false
  return true
}

/** Same predicate as `startAutoSync` tick after auto_sync_enabled check. */
function dbAutoSyncTickWouldSync(accountCfg: { processingPaused?: boolean } | null | undefined): boolean {
  if (accountCfg?.processingPaused === true) return false
  return true
}

function validateSetProcessingPausedArgs(
  accountId: unknown,
  paused: unknown,
): { ok: true; id: string; paused: boolean } | { ok: false; error: string } {
  const id = typeof accountId === 'string' ? accountId.trim() : ''
  if (!id) return { ok: false, error: 'accountId required' }
  if (typeof paused !== 'boolean') return { ok: false, error: 'paused must be a boolean' }
  return { ok: true, id, paused }
}

describe('IMAP 2‑min periodic pull (ipc parity)', () => {
  it('runs for active IMAP without pause', () => {
    expect(imapPeriodicPullWouldInclude({ provider: 'imap', status: 'active' })).toBe(true)
    expect(imapPeriodicPullWouldInclude({ provider: 'imap', status: 'active', processingPaused: false })).toBe(true)
  })

  it('skips paused IMAP even when active', () => {
    expect(imapPeriodicPullWouldInclude({ provider: 'imap', status: 'active', processingPaused: true })).toBe(false)
  })

  it('legacy list row without flag is not treated as paused', () => {
    expect(imapPeriodicPullWouldInclude({ provider: 'imap', status: 'active', processingPaused: undefined })).toBe(
      true,
    )
  })

  it('does not conflate auth_error with pause (non-active IMAP is excluded for other reasons)', () => {
    expect(
      imapPeriodicPullWouldInclude({ provider: 'imap', status: 'auth_error', processingPaused: false }),
    ).toBe(false)
    expect(
      imapPeriodicPullWouldInclude({ provider: 'imap', status: 'auth_error', processingPaused: true }),
    ).toBe(false)
  })
})

describe('startAutoSync tick pause guard (parity)', () => {
  it('skips sync when processingPaused true', () => {
    expect(dbAutoSyncTickWouldSync({ processingPaused: true })).toBe(false)
  })

  it('runs when undefined/false/missing cfg (legacy unpaused)', () => {
    expect(dbAutoSyncTickWouldSync({ processingPaused: false })).toBe(true)
    expect(dbAutoSyncTickWouldSync({})).toBe(true)
    expect(dbAutoSyncTickWouldSync(undefined)).toBe(true)
  })
})

describe('email:setProcessingPaused IPC validation (parity)', () => {
  it('rejects empty id and non-boolean paused', () => {
    expect(validateSetProcessingPausedArgs('', true)).toEqual({ ok: false, error: 'accountId required' })
    expect(validateSetProcessingPausedArgs('  ', true)).toEqual({ ok: false, error: 'accountId required' })
    expect(validateSetProcessingPausedArgs('x', 'true' as unknown)).toEqual({
      ok: false,
      error: 'paused must be a boolean',
    })
  })

  it('accepts trimmed id and boolean', () => {
    expect(validateSetProcessingPausedArgs('  acc-1  ', false)).toEqual({ ok: true, id: 'acc-1', paused: false })
  })
})
