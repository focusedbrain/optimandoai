/**
 * VM reboot recovery — automatic key re-delivery (P4.5.8).
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const mocks = vi.hoisted(() => ({
  notifyRecoveryEvent: vi.fn(),
  notifyEdgeFetchStateChanged: vi.fn(),
  notifyEdgeVerificationsUpdated: vi.fn(),
  listAccountsSync: vi.fn(),
  getAccountConfig: vi.fn(),
  updateAccount: vi.fn(async (_id: string, patch: unknown) => patch),
  connectSsh: vi.fn(),
  getAccountStatus: vi.fn(),
  deliverKey: vi.fn(),
}))

vi.mock('electron', () => ({
  Notification: { isSupported: () => false },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
}))

vi.mock('@repo/email-fetch', () => ({
  parseAccountKeyHex: (hex: string) => Buffer.from(hex, 'hex'),
  zeroizeBuffer: () => undefined,
}))

vi.mock('../recoveryNotify.js', () => ({
  notifyRecoveryEvent: (...args: unknown[]) => mocks.notifyRecoveryEvent(...args),
}))

vi.mock('../../email/edgeFetch/events.js', () => ({
  notifyEdgeFetchStateChanged: () => mocks.notifyEdgeFetchStateChanged(),
}))

vi.mock('../ipc.js', () => ({
  notifyEdgeVerificationsUpdated: () => mocks.notifyEdgeVerificationsUpdated(),
}))

vi.mock('../../email/gateway.js', () => ({
  emailGateway: {
    listAccountsSync: () => mocks.listAccountsSync(),
    getAccountConfig: (id: string) => mocks.getAccountConfig(id),
    updateAccount: (id: string, patch: unknown) => mocks.updateAccount(id, patch),
  },
}))

vi.mock('../replicaActions.js', () => ({
  connectReplicaActionSsh: (...args: unknown[]) => mocks.connectSsh(...args),
}))

vi.mock('../../email/edgeFetch/mailFetcherRemote.js', () => ({
  mailFetcherGetAccountStatus: (...args: unknown[]) => mocks.getAccountStatus(...args),
  mailFetcherRemoteRequest: vi.fn(),
}))

import {
  _setSettingsPathForTest,
  saveEdgeTierSettings,
  DEFAULT_EDGE_TIER_SETTINGS,
  type EdgeReplica,
} from '../settings.js'
import {
  _setAccountKeyStorePathForTest,
  storeWrappedAccountKey,
} from '../accountKeyStorage.js'
import {
  _setReplicaSshStorePathForTest,
  storeReplicaSshCredentials,
} from '../replicaSshStorage.js'
import {
  _setAuditStorePathForTest,
  _resetAuditStoreForTest,
  getRecentEdgeVerifications,
} from '../verificationAudit.js'
import { _setCachedReplicaHealthForTest, _resetDashboardForTest } from '../dashboard.js'

const replicaId = '11111111-1111-4111-8111-111111111111'
const accountId = 'acc-1'
const accountEmail = 'user@example.com'
const accountKeyHex = 'aa'.repeat(32)

const sampleReplica: EdgeReplica = {
  host: 'edge.example',
  port: 18100,
  edge_pod_id: replicaId,
  edge_public_key: 'ed25519:aa',
  sso_attestation_jwt: 'jwt',
}

const vaultUnlocked = {
  deriveApplicationKey: () => Buffer.alloc(32, 9),
}

const vaultLocked = {
  deriveApplicationKey: () => null as Buffer | null,
}

describe('rebootRecovery', () => {
  let tempDir: string
  let initRebootRecovery: typeof import('../rebootRecovery.js').initRebootRecovery
  let runRebootRecoveryCycle: typeof import('../rebootRecovery.js').runRebootRecoveryCycle
  let setRebootRecoveryDepsForTest: typeof import('../rebootRecovery.js')._setRebootRecoveryDepsForTest
  let resetRebootRecoveryForTest: typeof import('../rebootRecovery.js')._resetRebootRecoveryForTest

  beforeEach(async () => {
    const mod = await import('../rebootRecovery.js')
    initRebootRecovery = mod.initRebootRecovery
    runRebootRecoveryCycle = mod.runRebootRecoveryCycle
    setRebootRecoveryDepsForTest = mod._setRebootRecoveryDepsForTest
    resetRebootRecoveryForTest = mod._resetRebootRecoveryForTest

    tempDir = mkdtempSync(join(tmpdir(), 'edge-recovery-'))
    _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
    _setAccountKeyStorePathForTest(join(tempDir, 'edge-fetch-account-keys.json'))
    _setReplicaSshStorePathForTest(join(tempDir, 'edge-replica-ssh-credentials.json'))
    _setAuditStorePathForTest(join(tempDir, 'edge-verification-audit.json'))
    _resetAuditStoreForTest()
    _resetDashboardForTest()
    resetRebootRecoveryForTest()

    saveEdgeTierSettings({
      ...DEFAULT_EDGE_TIER_SETTINGS,
      enabled: true,
      replicas: [sampleReplica],
    })

    _setCachedReplicaHealthForTest(replicaId, 'healthy')
    initRebootRecovery(vaultUnlocked)

    mocks.listAccountsSync.mockReturnValue([
      {
        id: accountId,
        email: accountEmail,
        edgeFetch: {
          replicaId,
          state: 'active',
          remoteState: 'active',
          updatedAt: Date.now(),
        },
      },
    ])
    mocks.getAccountConfig.mockImplementation((id: string) => {
      if (id !== accountId) return null
      return {
        id: accountId,
        email: accountEmail,
        edgeFetch: {
          replicaId,
          state: 'active',
          remoteState: 'active',
          updatedAt: Date.now(),
        },
      }
    })
    mocks.updateAccount.mockClear()
    mocks.notifyRecoveryEvent.mockClear()
    mocks.notifyEdgeFetchStateChanged.mockClear()
    mocks.notifyEdgeVerificationsUpdated.mockClear()
    mocks.deliverKey.mockReset()
    mocks.getAccountStatus.mockReset()
    mocks.connectSsh.mockReset()

    storeWrappedAccountKey(accountId, accountKeyHex, vaultUnlocked)
    storeReplicaSshCredentials(
      replicaId,
      { sshUser: 'root', sshPort: 22, sshKey: 'ssh-key' },
      vaultUnlocked,
    )

    const sshRunner = { disconnect: vi.fn(async () => undefined) }
    mocks.connectSsh.mockResolvedValue(sshRunner)
    mocks.getAccountStatus.mockResolvedValue([
      { account_id: accountId, state: 'awaiting_key', last_error: null },
    ])
    mocks.deliverKey.mockResolvedValue({ ok: true, status: 200 })

    setRebootRecoveryDepsForTest({
      connectSsh: mocks.connectSsh,
      getAccountStatus: mocks.getAccountStatus,
      deliverKey: mocks.deliverKey,
      now: () => 1_700_000_000_000,
    })
  })

  afterEach(() => {
    _setSettingsPathForTest(null)
    _setAccountKeyStorePathForTest(null)
    _setReplicaSshStorePathForTest(null)
    _setAuditStorePathForTest(null)
    _resetAuditStoreForTest()
    _resetDashboardForTest()
    resetRebootRecoveryForTest?.()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('delivers key when mail-fetcher reports awaiting_key and transitions to active', async () => {
    await runRebootRecoveryCycle()

    expect(mocks.connectSsh).toHaveBeenCalledTimes(1)
    expect(mocks.getAccountStatus).toHaveBeenCalledTimes(1)
    expect(mocks.deliverKey).toHaveBeenCalledWith(expect.anything(), accountId, accountKeyHex)

    expect(mocks.updateAccount).toHaveBeenCalledWith(
      accountId,
      expect.objectContaining({
        edgeFetch: expect.objectContaining({ state: 'active', remoteState: 'active' }),
      }),
    )

    const audits = getRecentEdgeVerifications()
    expect(audits.some((a) => a.result === 'key_redelivered_after_restart')).toBe(true)
    expect(mocks.notifyRecoveryEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'key_redelivered', accountId }),
    )
  })

  test('skips delivery when replica is unhealthy', async () => {
    _setCachedReplicaHealthForTest(replicaId, 'unhealthy')
    await runRebootRecoveryCycle()
    expect(mocks.connectSsh).not.toHaveBeenCalled()
    expect(mocks.deliverKey).not.toHaveBeenCalled()
  })

  test('vault locked: no delivery, notification surfaced', async () => {
    initRebootRecovery(vaultLocked)
    await runRebootRecoveryCycle()

    expect(mocks.deliverKey).not.toHaveBeenCalled()
    expect(mocks.updateAccount).toHaveBeenCalledWith(
      accountId,
      expect.objectContaining({
        edgeFetch: expect.objectContaining({ state: 'awaiting_key' }),
      }),
    )
    expect(mocks.notifyRecoveryEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'vault_locked',
        message: expect.stringContaining('waiting for vault unlock'),
      }),
    )
    const audits = getRecentEdgeVerifications()
    expect(audits.some((a) => a.result === 'vault_locked_waiting')).toBe(true)
  })

  test('unwrap failure marks account degraded', async () => {
    const { readFileSync, writeFileSync } = await import('node:fs')
    const keyPath = join(tempDir, 'edge-fetch-account-keys.json')
    const store = JSON.parse(readFileSync(keyPath, 'utf8')) as {
      keys: Array<{ ciphertext_b64: string }>
    }
    store.keys[0]!.ciphertext_b64 = Buffer.from('corrupt-ciphertext').toString('base64')
    writeFileSync(keyPath, JSON.stringify(store))

    await runRebootRecoveryCycle()

    expect(mocks.deliverKey).not.toHaveBeenCalled()
    expect(mocks.updateAccount).toHaveBeenCalledWith(
      accountId,
      expect.objectContaining({
        edgeFetch: expect.objectContaining({ state: 'degraded' }),
      }),
    )
    expect(mocks.notifyRecoveryEvent).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'unwrap_failed' }),
    )
    const audits = getRecentEdgeVerifications()
    expect(audits.some((a) => a.result === 'unwrap_failed_degraded')).toBe(true)
  })

  test('mail-fetcher deliver_key 500 is logged and retried next cycle', async () => {
    mocks.deliverKey.mockResolvedValue({ ok: false, status: 500, error: 'internal' })
    await runRebootRecoveryCycle()

    expect(mocks.deliverKey).toHaveBeenCalledTimes(1)
    expect(mocks.updateAccount).not.toHaveBeenCalledWith(
      accountId,
      expect.objectContaining({
        edgeFetch: expect.objectContaining({ state: 'active' }),
      }),
    )
  })
})
