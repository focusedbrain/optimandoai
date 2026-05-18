/**
 * Guards additive UX fields on tryEnqueueContextSync without changing handshake DB semantics.
 */
import { describe, test, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => process.env.TEMP ?? process.env.TMPDIR ?? '/tmp' },
  safeStorage: { isEncryptionAvailable: () => false },
  ipcMain: { handle: () => undefined, on: () => undefined, removeHandler: () => undefined },
  BrowserWindow: class {
    webContents = { send: () => undefined }
    static getAllWindows() {
      return []
    }
  },
}))

import { tryEnqueueContextSync } from '../contextSyncEnqueue'
import { buildTestSession } from '../sessionFactory'
import { createHandshakeTestDb } from './handshakeTestDb'

describe('tryEnqueueContextSync — additive UX shape', () => {
  test('VAULT_LOCKED returns structured user-visible deferral fields', () => {
    const db = createHandshakeTestDb()
    const session = buildTestSession({
      wrdesk_user_id: 'u1',
      email: 'alice@example.com',
      sub: 'u1',
    })
    const r = tryEnqueueContextSync(db, 'hs-no-row', session, {
      lastCapsuleHash: 'hash0',
      getVaultStatus: () => ({ isUnlocked: false }),
    })

    expect(r.success).toBe(false)
    expect(r.reason).toBe('VAULT_LOCKED')
    expect(r.state).toBe('queued_until_unlock')
    expect(r.userVisible).toBe(true)
    expect(r.action).toBe('UNLOCK_WHEN_READY')
    expect(r.message).toMatch(/vault/i)
  })
})
