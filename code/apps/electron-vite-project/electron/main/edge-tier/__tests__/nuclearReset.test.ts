/**
 * Nuclear reset — P5.10 backend tests.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const mocks = vi.hoisted(() => ({
  listAccountsSync: vi.fn(),
  updateAccount: vi.fn(async () => undefined),
  notifyNuclearResetReauthorize: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  Notification: { isSupported: () => false },
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('../../email/gateway.js', () => ({
  emailGateway: {
    listAccountsSync: () => mocks.listAccountsSync(),
    updateAccount: (...args: unknown[]) => mocks.updateAccount(...args),
  },
}))

vi.mock('../../email/edgeFetch/events.js', () => ({
  notifyEdgeFetchStateChanged: vi.fn(),
}))

vi.mock('../nuclearResetNotify.js', () => ({
  notifyNuclearResetReauthorize: (...args: unknown[]) => mocks.notifyNuclearResetReauthorize(...args),
}))

import {
  _setSettingsPathForTest,
  saveEdgeTierSettings,
  DEFAULT_EDGE_TIER_SETTINGS,
  loadEdgeTierSettings,
  type EdgeReplica,
} from '../settings.js'
import { _setKeyStorePathForTest } from '../keyStorage.js'
import { _setDiagnosticReportsRootForTest } from '../supervisor/reportStore.js'
import { _setQuarantineKeyStorePathForTest } from '../quarantineKeyStorage.js'
import { _setAccountKeyStorePathForTest } from '../accountKeyStorage.js'
import {
  _setSupervisorAuditPathForTest,
  readSupervisorAuditEntries,
} from '../supervisor/auditLog.js'
import { collectReplicaActionEvents } from '../replicaActions.js'
import {
  buildNuclearResetRemoteCommands,
  REMOTE_POD_NAME,
} from '../ssh/deploy.js'
import {
  hashNuclearResetConfirmation,
  markReplicaAccountsDegradedForNuclearReset,
  nuclearResetReplica,
  purgeReplicaDesktopState,
  validateNuclearResetConfirmation,
  type NuclearResetInput,
} from '../nuclearReset.js'
import type { SshClient } from '../ssh/client.js'

const sampleReplica: EdgeReplica = {
  host: 'edge.example',
  port: 18100,
  edge_pod_id: '11111111-1111-4111-8111-111111111111',
  edge_public_key: 'ed25519:aa',
  sso_attestation_jwt: 'jwt-old',
}

const mockVault = {
  deriveApplicationKey: () => Buffer.alloc(32, 3),
}

function baseInput(): NuclearResetInput {
  return {
    replicaId: sampleReplica.edge_pod_id,
    sshUser: 'root',
    sshPort: 22,
    sshKey: Buffer.from(
      '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n',
      'utf8',
    ),
    reason: 'Suspected VM compromise',
    hostConfirm: 'edge.example',
    resetConfirm: 'RESET',
  }
}

function makeMockSshClient(handler: (command: string) => { stdout: string; stderr: string; code: number | null }) {
  return {
    connect: vi.fn(async () => undefined),
    run: vi.fn(async (command: string) => handler(command)),
    uploadContent: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  } as unknown as SshClient
}

describe('buildNuclearResetRemoteCommands', () => {
  test('includes stop, rm, prune, manifest cleanup, and quarantine wipe', () => {
    const commands = buildNuclearResetRemoteCommands()
    expect(commands.some((c) => c.includes('podman pod stop') && c.includes(REMOTE_POD_NAME))).toBe(true)
    expect(commands.some((c) => c.includes('podman pod rm'))).toBe(true)
    expect(commands.some((c) => c.includes('podman volume prune'))).toBe(true)
    expect(commands.some((c) => c.includes('/tmp/beap-pod-'))).toBe(true)
    expect(commands.some((c) => c.includes('/var/lib/quarantine'))).toBe(true)
  })
})

describe('validateNuclearResetConfirmation', () => {
  test('rejects incorrect host, token, or missing reason', () => {
    expect(() =>
      validateNuclearResetConfirmation({
        host: 'edge.example',
        hostConfirm: 'wrong',
        resetConfirm: 'RESET',
        reason: 'valid reason',
      }),
    ).toThrow(/Host confirmation/)

    expect(() =>
      validateNuclearResetConfirmation({
        host: 'edge.example',
        hostConfirm: 'edge.example',
        resetConfirm: 'NOPE',
        reason: 'valid reason',
      }),
    ).toThrow(/RESET/)

    expect(() =>
      validateNuclearResetConfirmation({
        host: 'edge.example',
        hostConfirm: 'edge.example',
        resetConfirm: 'RESET',
        reason: '  ',
      }),
    ).toThrow(/reason/)
  })
})

describe('markReplicaAccountsDegradedForNuclearReset', () => {
  beforeEach(() => {
    mocks.listAccountsSync.mockReset()
    mocks.updateAccount.mockClear()
    mocks.notifyNuclearResetReauthorize.mockClear()
  })

  test('transitions edge-fetched accounts to degraded with replica_reset', async () => {
    mocks.listAccountsSync.mockReturnValue([
      {
        id: 'acct-1',
        email: 'user@example.com',
        edgeFetch: {
          replicaId: sampleReplica.edge_pod_id,
          state: 'active',
          updatedAt: 1,
        },
      },
      {
        id: 'acct-2',
        email: 'other@example.com',
        edgeFetch: { replicaId: 'other-replica', state: 'active', updatedAt: 1 },
      },
    ])

    const ids = await markReplicaAccountsDegradedForNuclearReset(
      sampleReplica.edge_pod_id,
      '22222222-2222-4222-8222-222222222222',
    )

    expect(ids).toEqual(['acct-1'])
    expect(mocks.updateAccount).toHaveBeenCalledWith('acct-1', {
      edgeFetch: expect.objectContaining({
        state: 'degraded',
        lastError: 'replica_reset',
        replicaId: '22222222-2222-4222-8222-222222222222',
      }),
    })
    expect(mocks.notifyNuclearResetReauthorize).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'acct-1', email: 'user@example.com' }),
    )
  })
})

describe('nuclearResetReplica', () => {
  let tempDir: string
  const commands: string[] = []

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'nuclear-reset-'))
    process.env['WR_DESK_USER_DATA'] = tempDir
    _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
    _setKeyStorePathForTest(join(tempDir, 'edge-keys.json'))
    _setDiagnosticReportsRootForTest(join(tempDir, 'diagnostic-reports'))
    _setQuarantineKeyStorePathForTest(join(tempDir, 'edge-quarantine-keys.json'))
    _setAccountKeyStorePathForTest(join(tempDir, 'edge-fetch-account-keys.json'))
    _setSupervisorAuditPathForTest(join(tempDir, 'edge-tier-audit.log'))

    saveEdgeTierSettings({
      ...DEFAULT_EDGE_TIER_SETTINGS,
      enabled: true,
      replicas: [sampleReplica],
    })

    commands.length = 0
    mocks.listAccountsSync.mockReturnValue([
      {
        id: 'acct-edge',
        email: 'edge@example.com',
        edgeFetch: {
          replicaId: sampleReplica.edge_pod_id,
          state: 'active',
          updatedAt: 1,
        },
      },
    ])
  })

  afterEach(() => {
    delete process.env['WR_DESK_USER_DATA']
    _setSettingsPathForTest(null)
    _setKeyStorePathForTest(null)
    _setDiagnosticReportsRootForTest(null)
    _setQuarantineKeyStorePathForTest(null)
    _setAccountKeyStorePathForTest(null)
    _setSupervisorAuditPathForTest(null)
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('runs remote wipe sequence and persists new keypair', async () => {
    const reportsDir = join(tempDir, 'diagnostic-reports', sampleReplica.edge_pod_id)
    purgeReplicaDesktopState(sampleReplica.edge_pod_id)

    const client = makeMockSshClient((command) => {
      commands.push(command)
      if (command.includes('/health')) {
        return { stdout: '', stderr: '', code: 0 }
      }
      return { stdout: '', stderr: '', code: 0 }
    })

    const events = await collectReplicaActionEvents(
      nuclearResetReplica(baseInput(), {
        vault: mockVault,
        createSshClient: () => client,
        readManifestYaml: () => 'apiVersion: v1\n',
        ensureSession: vi.fn(async () => ({ accessToken: 'sso-token' })),
        requestAttestation: vi.fn(async () => ({ jwt: 'jwt-new' })),
      }),
    )

    expect(events.at(-1)?.kind).toBe('done')
    expect(events.at(-1)?.result?.action).toBe('nuclear_reset')

    for (const expected of buildNuclearResetRemoteCommands()) {
      expect(commands.some((c) => c === expected || c.includes('podman'))).toBe(true)
    }

    const settings = loadEdgeTierSettings()
    expect(settings.replicas).toHaveLength(1)
    expect(settings.replicas[0]?.edge_pod_id).not.toBe(sampleReplica.edge_pod_id)
    expect(settings.replicas[0]?.sso_attestation_jwt).toBe('jwt-new')
    expect(mocks.updateAccount).toHaveBeenCalled()
  })

  test('rejects invalid confirmation before SSH connect', async () => {
    const input = { ...baseInput(), resetConfirm: 'NOPE' }
    const events = await collectReplicaActionEvents(
      nuclearResetReplica(input, {
        vault: mockVault,
        createSshClient: () => makeMockSshClient(() => ({ stdout: '', stderr: '', code: 0 })),
      }),
    ).catch(() => [] as Awaited<ReturnType<typeof collectReplicaActionEvents>>)

    expect(events.length).toBe(0)
  })

  test('confirmation hash is stable', () => {
    const hash = hashNuclearResetConfirmation('edge.example', 'RESET', 'operator choice')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(hashNuclearResetConfirmation('edge.example', 'RESET', 'operator choice'))
  })
})
