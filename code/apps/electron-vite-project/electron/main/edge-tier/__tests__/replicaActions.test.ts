/**
 * Replica actions — P4.7 backend tests.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

import {
  _setSettingsPathForTest,
  saveEdgeTierSettings,
  DEFAULT_EDGE_TIER_SETTINGS,
  loadEdgeTierSettings,
  type EdgeReplica,
} from '../settings.js'
import { _setKeyStorePathForTest } from '../keyStorage.js'
import {
  collectReplicaActionEvents,
  restartReplica,
  removeReplica,
  type ReplicaActionInput,
} from '../replicaActions.js'
import { buildRestartCommand, buildTeardownCommand, REMOTE_POD_NAME } from '../ssh/deploy.js'
import type { SshClient } from '../ssh/client.js'

const sampleReplica: EdgeReplica = {
  host: 'edge.example',
  port: 18100,
  edge_pod_id: '11111111-1111-4111-8111-111111111111',
  edge_public_key: 'ed25519:aa',
  sso_attestation_jwt: 'jwt',
}

const baseInput: ReplicaActionInput = {
  replicaId: sampleReplica.edge_pod_id,
  sshUser: 'root',
  sshPort: 22,
  sshKey: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n',
}

function makeMockSshClient(handler: (command: string) => { stdout: string; stderr: string; code: number | null }) {
  return {
    connect: vi.fn(async () => undefined),
    run: vi.fn(async (command: string) => handler(command)),
    uploadContent: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
  } as unknown as SshClient
}

describe('buildRestartCommand', () => {
  test('restarts the remote edge pod by name', () => {
    expect(buildRestartCommand()).toContain(`podman pod restart ${REMOTE_POD_NAME}`)
  })
})

describe('restartReplica', () => {
  let tempDir: string
  const commands: string[] = []

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'replica-actions-'))
    _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
    saveEdgeTierSettings({
      ...DEFAULT_EDGE_TIER_SETTINGS,
      enabled: true,
      replicas: [sampleReplica],
    })
    commands.length = 0
  })

  afterEach(() => {
    _setSettingsPathForTest(null)
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('runs podman pod restart on the remote VM', async () => {
    const client = makeMockSshClient((command) => {
      commands.push(command)
      return { stdout: '', stderr: '', code: 0 }
    })

    const events = await collectReplicaActionEvents(
      restartReplica(baseInput, {
        createSshClient: () => client,
      }),
    )

    expect(commands.some((c) => c.includes('podman pod restart'))).toBe(true)
    expect(events.at(-1)?.kind).toBe('done')
    expect(events.at(-1)?.result?.action).toBe('restart')
  })
})

describe('removeReplica', () => {
  let tempDir: string
  const commands: string[] = []

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'replica-actions-remove-'))
    _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
    _setKeyStorePathForTest(join(tempDir, 'edge-tier-encrypted-keys.json'))
    saveEdgeTierSettings({
      ...DEFAULT_EDGE_TIER_SETTINGS,
      enabled: true,
      replicas: [sampleReplica],
    })
    commands.length = 0
  })

  afterEach(() => {
    _setSettingsPathForTest(null)
    _setKeyStorePathForTest(null)
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('teardowns remote pod then removes replica from settings', async () => {
    const client = makeMockSshClient((command) => {
      commands.push(command)
      return { stdout: '', stderr: '', code: 0 }
    })

    const events = await collectReplicaActionEvents(
      removeReplica(baseInput, { vault: { deriveApplicationKey: () => Buffer.alloc(32, 1) }, createSshClient: () => client }),
    )

    expect(commands.some((c) => c.includes('podman pod stop') && c.includes('podman pod rm'))).toBe(true)
    expect(buildTeardownCommand()).toContain(REMOTE_POD_NAME)
    expect(loadEdgeTierSettings().replicas).toHaveLength(0)
    expect(events.at(-1)?.kind).toBe('done')
    expect(events.at(-1)?.result?.wasLastReplica).toBe(true)
  })
})
