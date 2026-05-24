/**
 * Edge tier dashboard — P4.6 backend tests.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  app: {
    on: vi.fn(),
    getPath: vi.fn(() => '/tmp/vitest-electron-mock'),
  },
}))

import {
  _setSettingsPathForTest,
  saveEdgeTierSettings,
  DEFAULT_EDGE_TIER_SETTINGS,
  type EdgeReplica,
} from '../settings.js'
import {
  _setAuditStorePathForTest,
  _resetAuditStoreForTest,
  appendEdgeVerification,
  ingestVerifierLogLine,
} from '../verificationAudit.js'
import {
  probeReplicaHealth,
  buildReplicaStatus,
  getDashboardReplicas,
  getDashboardVerifications,
  onVerifierVerificationIngested,
  refreshReplicaHealthCache,
  _setDashboardDepsForTest,
  _resetDashboardForTest,
  HEALTH_PROBE_INTERVAL_MS,
} from '../dashboard.js'

const sampleReplica: EdgeReplica = {
  host: 'edge.example',
  port: 18100,
  edge_pod_id: '11111111-1111-4111-8111-111111111111',
  edge_public_key: 'ed25519:aa',
  sso_attestation_jwt: 'jwt',
}

describe('probeReplicaHealth', () => {
  test('returns healthy on HTTP 200 with status ok', async () => {
    _setDashboardDepsForTest({
      fetchHealth: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok' }),
      })),
    })
    const result = await probeReplicaHealth('edge.example', 18100)
    expect(result.health).toBe('healthy')
    _resetDashboardForTest()
  })

  test('returns unhealthy on connection failure', async () => {
    _setDashboardDepsForTest({
      fetchHealth: vi.fn(async () => {
        throw new Error('ECONNREFUSED')
      }),
    })
    const result = await probeReplicaHealth('edge.example', 18100)
    expect(result.health).toBe('unhealthy')
    expect(result.error).toContain('ECONNREFUSED')
    _resetDashboardForTest()
  })
})

describe('dashboard replica cache and verifications', () => {
  let tempDir: string
  const fixedNow = Date.parse('2026-05-24T12:10:00.000Z')

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'edge-dashboard-'))
    _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
    _setAuditStorePathForTest(join(tempDir, 'edge-verification-audit.json'))
    _resetAuditStoreForTest()
    _resetDashboardForTest()
    saveEdgeTierSettings({
      ...DEFAULT_EDGE_TIER_SETTINGS,
      enabled: true,
      replicas: [sampleReplica],
    })
    _setDashboardDepsForTest({
      fetchHealth: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok' }),
      })),
      now: () => fixedNow,
    })
  })

  afterEach(() => {
    _setSettingsPathForTest(null)
    _setAuditStorePathForTest(null)
    _resetAuditStoreForTest()
    _resetDashboardForTest()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('refreshReplicaHealthCache stores health per replica', async () => {
    await refreshReplicaHealthCache()
    const replicas = getDashboardReplicas()
    expect(replicas).toHaveLength(1)
    expect(replicas[0]!.health).toBe('healthy')
    expect(replicas[0]!.host).toBe('edge.example')
  })

  test('buildReplicaStatus computes certs per minute from audit store', () => {
    const fiveMinAgo = new Date(fixedNow - 4 * 60 * 1000).toISOString()
    appendEdgeVerification({
      timestamp: fiveMinAgo,
      edge_pod_id: sampleReplica.edge_pod_id,
      sub: 'user',
      result: 'verified',
      phase: 'shallow',
    })
    appendEdgeVerification({
      timestamp: fiveMinAgo,
      edge_pod_id: sampleReplica.edge_pod_id,
      sub: 'user',
      result: 'verified',
      phase: 'shallow',
    })
    const status = buildReplicaStatus(sampleReplica, fixedNow)
    expect(status.certs_per_minute).toBeCloseTo(0.4, 5)
  })

  test('ingestVerifierLogLine populates dashboard verifications via hook', () => {
    const line = JSON.stringify({
      type: 'beap_edge_verification',
      timestamp: '2026-05-24T12:02:00.000Z',
      edge_pod_id: sampleReplica.edge_pod_id,
      sub: 'user-sub',
      result: 'verified',
      phase: 'shallow',
    })
    ingestVerifierLogLine(line)
    const events = getDashboardVerifications()
    expect(events[0]?.result).toBe('verified')
    expect(events[0]?.edge_pod_id).toBe(sampleReplica.edge_pod_id)
  })

  test('appendEdgeVerification keeps at most 50 verifications in audit store', () => {
    for (let i = 0; i < 55; i++) {
      appendEdgeVerification({
        timestamp: `2026-05-24T12:00:${String(i).padStart(2, '0')}.000Z`,
        edge_pod_id: sampleReplica.edge_pod_id,
        sub: 'user',
        result: 'verified',
        phase: 'shallow',
      })
    }
    expect(getDashboardVerifications()).toHaveLength(50)
  })

  test('health probe interval constant is 30 seconds', () => {
    expect(HEALTH_PROBE_INTERVAL_MS).toBe(30_000)
  })
})
