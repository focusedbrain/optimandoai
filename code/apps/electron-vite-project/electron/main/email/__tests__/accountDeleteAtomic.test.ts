/**
 * Atomic deleteAccount — auto-sync loop stop, sync_state + remote queue purge.
 */
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  registerAutoSyncLoop,
  stopAutoSyncLoopForAccount,
  hasAutoSyncLoop,
  __clearAutoSyncLoopsForTests,
} from '../autoSyncLoopRegistry'
import { purgeAccountLedgerState } from '../accountDeletePersistence'

const DELETED_ID = 'acc-delete-me'
const KEEP_ID = 'acc-keep-gmail'

function makeElectronMock(userData: string) {
  return {
    app: {
      getPath: (name: string): string => {
        if (name === 'userData') return userData
        if (name === 'home') return os.homedir()
        return path.join(userData, name)
      },
      isPackaged: false,
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s: string) => Buffer.from(s),
      decryptString: (b: Buffer) => b.toString(),
    },
  }
}

function writeTwoAccountFixture(userDataDir: string): void {
  fs.mkdirSync(userDataDir, { recursive: true })
  const payload = {
    accounts: [
      {
        id: DELETED_ID,
        email: 'old@web.de',
        displayName: 'Old',
        provider: 'imap',
        authType: 'password',
        status: 'active',
        createdAt: 1,
        updatedAt: 1,
        imap: {
          host: 'imap.web.de',
          port: 993,
          security: 'ssl',
          username: 'old@web.de',
          password: 'x',
          _encrypted: false,
        },
        folders: { monitored: ['INBOX'], inbox: 'INBOX' },
      },
      {
        id: KEEP_ID,
        email: 'keep@gmail.com',
        displayName: 'Gmail',
        provider: 'gmail',
        authType: 'oauth',
        status: 'active',
        createdAt: 2,
        updatedAt: 2,
        folders: { monitored: ['INBOX'], inbox: 'INBOX' },
      },
    ],
  }
  fs.writeFileSync(path.join(userDataDir, 'email-accounts.json'), JSON.stringify(payload), 'utf-8')
}

describe('autoSyncLoopRegistry', () => {
  afterEach(() => __clearAutoSyncLoopsForTests())

  it('stops and removes only the deleted account loop', () => {
    const stopDeleted = vi.fn()
    const stopKeep = vi.fn()
    registerAutoSyncLoop(DELETED_ID, { stop: stopDeleted })
    registerAutoSyncLoop(KEEP_ID, { stop: stopKeep })

    expect(stopAutoSyncLoopForAccount(DELETED_ID)).toBe(true)
    expect(stopDeleted).toHaveBeenCalledOnce()
    expect(stopKeep).not.toHaveBeenCalled()
    expect(hasAutoSyncLoop(DELETED_ID)).toBe(false)
    expect(hasAutoSyncLoop(KEEP_ID)).toBe(true)
  })
})

describe('purgeAccountLedgerState', () => {
  it('deletes sync_state and remote queue rows for the target account id only', () => {
    const runs: Array<{ sql: string; args: unknown[] }> = []
    const db = {
      prepare: (sql: string) => ({
        run: (...args: unknown[]) => {
          runs.push({ sql, args })
          return { changes: sql.includes('email_sync_state') ? 1 : 3 }
        },
      }),
    }

    const result = purgeAccountLedgerState(db, DELETED_ID)
    expect(result).toEqual({ syncStateRowDeleted: 1, queueRowsDeleted: 3 })
    expect(runs).toHaveLength(2)
    expect(runs.every((r) => r.args[0] === DELETED_ID)).toBe(true)
    expect(runs.some((r) => r.sql.includes('email_sync_state'))).toBe(true)
    expect(runs.some((r) => r.sql.includes('remote_orchestrator_mutation_queue'))).toBe(true)
  })
})

describe('emailGateway.deleteAccount (atomic cleanup)', () => {
  let tmpRoot: string
  let userData: string

  beforeEach(() => {
    vi.resetModules()
    __clearAutoSyncLoopsForTests()
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'delete-account-atomic-'))
    userData = path.join(tmpRoot, 'userData')
    writeTwoAccountFixture(userData)
    vi.doMock('electron', () => makeElectronMock(userData))
  })

  afterEach(() => {
    __clearAutoSyncLoopsForTests()
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
    vi.doUnmock('electron')
    vi.resetModules()
  })

  it('removes gateway row, stops auto-sync, and purges ledger rows for deleted id only', async () => {
    const { emailGateway } = await import('../gateway')
    const { registerAutoSyncLoop, hasAutoSyncLoop } = await import('../autoSyncLoopRegistry')

    const stopDeleted = vi.fn()
    registerAutoSyncLoop(DELETED_ID, { stop: stopDeleted })
    registerAutoSyncLoop(KEEP_ID, { stop: vi.fn() })

    const ledgerRuns: Array<{ sql: string; args: unknown[] }> = []
    const db = {
      prepare: (sql: string) => ({
        run: (...args: unknown[]) => {
          ledgerRuns.push({ sql, args })
          return { changes: 1 }
        },
        get: (...args: unknown[]) => {
          if (sql.includes('email_sync_state') && args[0] === KEEP_ID) {
            return { sync_interval_ms: 300_000 }
          }
          return undefined
        },
      }),
    }

    expect((await emailGateway.listAccounts()).map((a) => a.id).sort()).toEqual([DELETED_ID, KEEP_ID].sort())

    await emailGateway.deleteAccount(DELETED_ID, { db })

    const remaining = await emailGateway.listAccounts()
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).toBe(KEEP_ID)

    const onDisk = JSON.parse(fs.readFileSync(path.join(userData, 'email-accounts.json'), 'utf-8'))
    expect(onDisk.accounts).toHaveLength(1)
    expect(onDisk.accounts[0].id).toBe(KEEP_ID)

    expect(stopDeleted).toHaveBeenCalledOnce()
    expect(hasAutoSyncLoop(DELETED_ID)).toBe(false)
    expect(hasAutoSyncLoop(KEEP_ID)).toBe(true)

    expect(ledgerRuns.filter((r) => r.args[0] === DELETED_ID)).toHaveLength(2)
    expect(ledgerRuns.some((r) => r.args[0] === KEEP_ID)).toBe(false)
  })
})
