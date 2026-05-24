/**
 * Global edge-tier actions — P4.8 backend tests.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
}))

const { redeployMock, restartPodMock } = vi.hoisted(() => ({
  redeployMock: vi.fn(),
  restartPodMock: vi.fn(async () => undefined),
}))

vi.mock('../replicaActions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../replicaActions.js')>()
  return {
    ...actual,
    redeployReplica: redeployMock,
  }
})

vi.mock('../podLifecycle.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../podLifecycle.js')>()
  return {
    ...actual,
    applyEdgeTierSettingsAndRestartPod: restartPodMock,
  }
})

import {
  _setSettingsPathForTest,
  saveEdgeTierSettings,
  DEFAULT_EDGE_TIER_SETTINGS,
  loadEdgeTierSettings,
  type EdgeReplica,
} from '../settings.js'
import {
  collectGlobalActionEvents,
  pauseEdgeTier,
  rotateAllEdgeKeys,
  toDashboardFallbackPolicy,
  toStoredFallbackPolicy,
  updateFallbackPolicy,
  type RotateAllEdgeKeysInput,
} from '../globalActions.js'

const replicaA: EdgeReplica = {
  host: 'edge-a.example',
  port: 18100,
  edge_pod_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  edge_public_key: 'ed25519:aa',
  sso_attestation_jwt: 'jwt-a',
}

const replicaB: EdgeReplica = {
  host: 'edge-b.example',
  port: 18100,
  edge_pod_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  edge_public_key: 'ed25519:bb',
  sso_attestation_jwt: 'jwt-b',
}

const baseRotateInput: RotateAllEdgeKeysInput = {
  sshUser: 'root',
  sshPort: 22,
  sshKey: '-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n',
}

const vault = { deriveApplicationKey: () => Buffer.alloc(32, 1) }

async function* successRedeploy(input: { replicaId: string }) {
  yield { kind: 'stage' as const, message: 'deploy', stage_name: 'start_pod' }
  yield {
    kind: 'done' as const,
    message: 'done',
    stage_name: 'cleanup',
    result: {
      action: 'redeploy' as const,
      newReplica: {
        host: 'edge.example',
        port: 18100,
        edge_pod_id: `new-${input.replicaId.slice(0, 8)}`,
        edge_public_key: 'ed25519:new',
      },
    },
  }
}

describe('fallback policy mapping', () => {
  test('defaults to reject and maps downgrade_with_badge to local_only', () => {
    expect(toStoredFallbackPolicy('reject')).toBe('reject')
    expect(toStoredFallbackPolicy('downgrade_with_badge')).toBe('local_only')
    expect(toDashboardFallbackPolicy('local_only')).toBe('downgrade_with_badge')
    expect(DEFAULT_EDGE_TIER_SETTINGS.fallback_policy).toBe('reject')
  })
})

describe('updateFallbackPolicy', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'global-actions-fallback-'))
    _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
    saveEdgeTierSettings({ ...DEFAULT_EDGE_TIER_SETTINGS, enabled: true, replicas: [replicaA] })
  })

  afterEach(() => {
    _setSettingsPathForTest(null)
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('persists downgrade_with_badge as local_only', () => {
    updateFallbackPolicy('downgrade_with_badge')
    expect(loadEdgeTierSettings().fallback_policy).toBe('local_only')
  })
})

describe('pauseEdgeTier', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'global-actions-pause-'))
    _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
    restartPodMock.mockClear()
  })

  afterEach(() => {
    _setSettingsPathForTest(null)
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('flips enabled flag and restarts local pod in LOCAL_HOST mode', async () => {
    saveEdgeTierSettings({ ...DEFAULT_EDGE_TIER_SETTINGS, enabled: true, replicas: [replicaA] })
    restartPodMock.mockImplementation(async (_vault, next) => {
      saveEdgeTierSettings(next)
    })
    await pauseEdgeTier(vault)
    expect(loadEdgeTierSettings().enabled).toBe(false)
    expect(restartPodMock).toHaveBeenCalledTimes(1)
  })
})

describe('rotateAllEdgeKeys', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'global-actions-rotate-'))
    _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
    redeployMock.mockReset()
  })

  afterEach(() => {
    _setSettingsPathForTest(null)
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('redeploys each replica sequentially', async () => {
    saveEdgeTierSettings({
      ...DEFAULT_EDGE_TIER_SETTINGS,
      enabled: true,
      replicas: [replicaA, replicaB],
    })
    redeployMock.mockImplementation(successRedeploy)

    const events = await collectGlobalActionEvents(
      rotateAllEdgeKeys(baseRotateInput, { vault }),
    )

    expect(redeployMock).toHaveBeenCalledTimes(2)
    expect(events.at(-1)?.kind).toBe('done')
  })

  test('reports partial failure when replica 2 of 3 fails', async () => {
    const replicaC: EdgeReplica = {
      ...replicaB,
      host: 'edge-c.example',
      edge_pod_id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    }
    saveEdgeTierSettings({
      ...DEFAULT_EDGE_TIER_SETTINGS,
      enabled: true,
      replicas: [replicaA, replicaB, replicaC],
    })

    redeployMock.mockImplementation(async function* (input: { replicaId: string }) {
      if (input.replicaId === replicaB.edge_pod_id) {
        yield { kind: 'error' as const, message: 'SSH auth failed', stage_name: 'connect' }
        return
      }
      yield* successRedeploy(input)
    })

    const events = await collectGlobalActionEvents(
      rotateAllEdgeKeys(baseRotateInput, { vault }),
    )

    const last = events.at(-1)
    expect(last?.kind).toBe('error')
    expect(last?.partial_failure?.failed_index).toBe(1)
    expect(last?.partial_failure?.total_replicas).toBe(3)
    expect(last?.partial_failure?.completed_replica_ids.length).toBe(1)
  })
})
