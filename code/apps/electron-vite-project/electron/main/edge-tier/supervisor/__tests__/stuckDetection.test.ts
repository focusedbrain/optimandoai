/**
 * Stuck container detection via health probes (P5.9).
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ed25519 } from '@noble/curves/ed25519.js'
import {
  resolveDiagnosticReportSigner,
  verifyDiagnosticReport,
} from '@repo/beap-cert'

import {
  _setSettingsPathForTest,
  saveEdgeTierSettings,
  DEFAULT_EDGE_TIER_SETTINGS,
  type EdgeReplica,
} from '../../settings.js'
import {
  _setReplicaSshStorePathForTest,
  storeReplicaSshCredentials,
} from '../../replicaSshStorage.js'
import {
  _setSupervisorAuditPathForTest,
  readSupervisorAuditEntries,
} from '../auditLog.js'
import {
  _setDiagnosticReportsRootForTest,
  getReport,
  listReports,
} from '../reportStore.js'
import { _setSupervisorSigningKeyStorePathForTest } from '../supervisorSigningKey.js'
import {
  recordHealthProbeOutcome,
  _resetStuckDetectionForTest,
  STUCK_THRESHOLD_CONSECUTIVE_FAILURES,
} from '../supervisorPoll.js'
import { buildSupervisorStuckReport } from '../supervisorStuckReport.js'
import { REMOTE_POD_NAME } from '../../ssh/deploy.js'

const REPLICA: EdgeReplica = {
  host: 'edge.example.com',
  port: 18100,
  edge_pod_id: '550e8400-e29b-41d4-a716-446655440000',
  edge_public_key: 'ed25519:' + 'aa'.repeat(32),
  sso_attestation_jwt: 'eyJ.test.jwt',
}

const mockVault = {
  deriveApplicationKey: () => Buffer.alloc(32, 11),
}

describe('recordHealthProbeOutcome (P5.9)', () => {
  beforeEach(() => _resetStuckDetectionForTest())
  afterEach(() => _resetStuckDetectionForTest())

  test('three consecutive failures declare stuck; success resets counter', () => {
    expect(recordHealthProbeOutcome(REPLICA.edge_pod_id, 'depackager', false).isStuck).toBe(false)
    expect(recordHealthProbeOutcome(REPLICA.edge_pod_id, 'depackager', false).isStuck).toBe(false)
    expect(recordHealthProbeOutcome(REPLICA.edge_pod_id, 'depackager', false).isStuck).toBe(true)
    expect(recordHealthProbeOutcome(REPLICA.edge_pod_id, 'depackager', true).isStuck).toBe(false)
    expect(recordHealthProbeOutcome(REPLICA.edge_pod_id, 'depackager', false).consecutiveFailures).toBe(
      1,
    )
  })

  test(`threshold matches STUCK_THRESHOLD=${STUCK_THRESHOLD_CONSECUTIVE_FAILURES}`, () => {
    for (let i = 1; i < STUCK_THRESHOLD_CONSECUTIVE_FAILURES; i++) {
      expect(recordHealthProbeOutcome(REPLICA.edge_pod_id, 'validator', false).isStuck).toBe(false)
    }
    expect(recordHealthProbeOutcome(REPLICA.edge_pod_id, 'validator', false).isStuck).toBe(true)
  })
})

describe('supervisor stuck detection poll integration (P5.9)', () => {
  let tempDir: string
  let runSupervisorPollCycle: typeof import('../index.js').runSupervisorPollCycle
  let setSupervisorDepsForTest: typeof import('../index.js')._setSupervisorDepsForTest
  let resetPodSupervisorForTest: typeof import('../index.js')._resetPodSupervisorForTest
  let initPodSupervisor: typeof import('../index.js').initPodSupervisor

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'stuck-detection-'))
    process.env['WR_DESK_USER_DATA'] = tempDir
    _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
    _setReplicaSshStorePathForTest(join(tempDir, 'edge-replica-ssh-credentials.json'))
    _setSupervisorAuditPathForTest(join(tempDir, 'edge-tier-audit.log'))
    _setDiagnosticReportsRootForTest(join(tempDir, 'diagnostic-reports'))
    _setSupervisorSigningKeyStorePathForTest(join(tempDir, 'edge-supervisor-signing-key.json'))
    _resetStuckDetectionForTest()

    storeReplicaSshCredentials(
      REPLICA.edge_pod_id,
      { sshUser: 'beap', sshPort: 22, sshKey: 'fake-key' },
      mockVault,
    )
    saveEdgeTierSettings({
      ...DEFAULT_EDGE_TIER_SETTINGS,
      enabled: true,
      replicas: [REPLICA],
    })

    const mod = await import('../index.js')
    initPodSupervisor = mod.initPodSupervisor
    runSupervisorPollCycle = mod.runSupervisorPollCycle
    setSupervisorDepsForTest = mod._setSupervisorDepsForTest
    resetPodSupervisorForTest = mod._resetPodSupervisorForTest
    initPodSupervisor(mockVault)
  })

  afterEach(() => {
    resetPodSupervisorForTest()
    delete process.env['WR_DESK_USER_DATA']
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('three failing probes kill and replace hung container', async () => {
    const depackager = `${REMOTE_POD_NAME}-depackager`
    const commandLog: string[] = []
    const probeResults = [false, false, false]

    const mockSsh = {
      run: vi.fn(async (cmd: string) => {
        commandLog.push(cmd)
        if (cmd.includes('podman kill') && cmd.includes('SIGKILL')) {
          return { stdout: '', stderr: '', code: 0 }
        }
        if (cmd.includes('{{.Id}}')) {
          return { stdout: 'sha256:deadbeefcafe', stderr: '', code: 0 }
        }
        return { stdout: '', stderr: '', code: 0 }
      }),
      uploadContent: vi.fn(),
      disconnect: vi.fn(async () => undefined),
    }

    const replaceContainer = vi.fn(async () => ({
      success: true as const,
      new_container_id: 'sha256:newdepackager',
      replacement_duration_ms: 900,
    }))

    const probeContainerHealth = vi.fn(async (_ssh, spec) => {
      if (spec.role !== 'depackager') return true
      return probeResults.shift() ?? true
    })

    setSupervisorDepsForTest({
      connectSsh: vi.fn(async () => mockSsh),
      inspectStatus: vi.fn(async (_ssh, name) =>
        name === depackager ? 'running' : 'running',
      ),
      probeContainerHealth,
      pickupReports: vi.fn(async () => ({ reports: [] })),
      replaceContainer,
    })

    await runSupervisorPollCycle()
    await runSupervisorPollCycle()
    await runSupervisorPollCycle()

    expect(probeContainerHealth).toHaveBeenCalled()
    const depackagerProbeCalls = probeContainerHealth.mock.calls.filter(
      ([, spec]) => spec.role === 'depackager',
    )
    expect(depackagerProbeCalls.length).toBeGreaterThanOrEqual(3)
    expect(replaceContainer).toHaveBeenCalledTimes(1)
    expect(replaceContainer).toHaveBeenCalledWith(
      expect.objectContaining({ containerRole: 'depackager' }),
      expect.any(Object),
    )
    expect(commandLog.some((c) => c.includes('podman kill') && c.includes(depackager))).toBe(true)

    const audit = readSupervisorAuditEntries()
    expect(audit.some((e) => e.event === 'container_replaced' && e.reason === 'stuck_health_probe')).toBe(
      true,
    )

    const reports = listReports(REPLICA.edge_pod_id)
    expect(reports.length).toBeGreaterThanOrEqual(1)
    const stored = getReport(REPLICA.edge_pod_id, reports[0]!.filename)
    expect(stored).toBeTruthy()
    const parsed = JSON.parse(stored!) as { signer?: string; failure: { exception_kind: string } }
    expect(parsed.signer).toBe('supervisor')
    expect(parsed.failure.exception_kind).toBe('StuckHealthProbeError')
  })

  test('two failing probes then success does not replace', async () => {
    const depackager = `${REMOTE_POD_NAME}-depackager`
    const probeResults = [false, false, true, true]

    const replaceContainer = vi.fn()
    const probeContainerHealth = vi.fn(async (_ssh, spec) => {
      if (spec.role !== 'depackager') return true
      return probeResults.shift() ?? true
    })

    setSupervisorDepsForTest({
      connectSsh: vi.fn(async () => ({
        run: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
        uploadContent: vi.fn(),
        disconnect: vi.fn(),
      })),
      inspectStatus: vi.fn(async (_ssh, name) =>
        name === depackager ? 'running' : 'running',
      ),
      probeContainerHealth,
      pickupReports: vi.fn(),
      replaceContainer,
    })

    await runSupervisorPollCycle()
    await runSupervisorPollCycle()
    await runSupervisorPollCycle()

    expect(replaceContainer).not.toHaveBeenCalled()
  })

  test('supervisor-signed report verifies against desktop key', () => {
    const report = buildSupervisorStuckReport({
      replica: REPLICA,
      role: 'depackager',
      containerIdShort: 'deadbeefcafe',
      previousUptimeSeconds: 0,
      vault: mockVault,
      now: () => new Date('2026-05-24T15:00:00.000Z'),
    })
    expect(report).toBeTruthy()
    expect(resolveDiagnosticReportSigner(report!)).toBe('supervisor')

    const store = JSON.parse(
      readFileSync(join(tempDir, 'edge-supervisor-signing-key.json'), 'utf8'),
    ) as { public_key_hex: string }
    const publicKey = Uint8Array.from(Buffer.from(store.public_key_hex, 'hex'))
    expect(verifyDiagnosticReport(report!, publicKey)).toEqual({ ok: true })
  })
})
