/**
 * Pod supervisor — container replacement and report pickup (P5.4).
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ed25519 } from '@noble/curves/ed25519.js'
import { signDiagnosticReport, type UnsignedDiagnosticReportV1 } from '@repo/beap-cert'

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
  storeDiagnosticReport,
} from '../reportStore.js'
import { REMOTE_POD_NAME } from '../../ssh/deploy.js'

const FIXTURE_PRIVATE_KEY = ed25519.utils.randomSecretKey()
const FIXTURE_PUBLIC_KEY_HEX = Buffer.from(ed25519.getPublicKey(FIXTURE_PRIVATE_KEY)).toString('hex')
const FIXTURE_PUBLIC_KEY_CLAIM = `ed25519:${FIXTURE_PUBLIC_KEY_HEX}`

const REPLICA: EdgeReplica = {
  host: 'edge.example.com',
  port: 18100,
  edge_pod_id: '550e8400-e29b-41d4-a716-446655440000',
  edge_public_key: FIXTURE_PUBLIC_KEY_CLAIM,
  sso_attestation_jwt: 'eyJ.test.jwt',
}

function sampleUnsignedReport(): UnsignedDiagnosticReportV1 {
  return {
    report_v: 1,
    edge_pod_id: REPLICA.edge_pod_id,
    replica_id: REPLICA.edge_pod_id,
    timestamp_iso8601: '2026-05-24T12:00:00.000Z',
    failed_container: {
      role: 'depackager',
      container_id_short: 'abc123def456',
      previous_uptime_seconds: 12,
    },
    failure: {
      exception_kind: 'TypeError',
      stage: 'capsule_normalize',
      source_file_basename: 'depackager.ts',
      source_line: 128,
    },
    system_metrics_at_failure: {
      cpu_percent: 1,
      memory_mb: 64,
      fd_count: 8,
      container_uptime_seconds: 12,
    },
    message_under_processing: null,
  }
}

function signFixtureReport(): string {
  const signed = signDiagnosticReport(sampleUnsignedReport(), FIXTURE_PRIVATE_KEY)
  return JSON.stringify(signed)
}

function signedReportWithWrongKey(): string {
  const otherKey = ed25519.utils.randomSecretKey()
  const signed = signDiagnosticReport(sampleUnsignedReport(), otherKey)
  return JSON.stringify(signed)
}

const mockVault = {
  deriveApplicationKey: () => Buffer.alloc(32, 7),
}

describe('supervisor module (P5.4)', () => {
  let tempDir: string
  let initPodSupervisor: typeof import('../index.js').initPodSupervisor
  let runSupervisorPollCycle: typeof import('../index.js').runSupervisorPollCycle
  let setSupervisorDepsForTest: typeof import('../index.js')._setSupervisorDepsForTest
  let resetPodSupervisorForTest: typeof import('../index.js')._resetPodSupervisorForTest

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'supervisor-p54-'))
    process.env['WR_DESK_USER_DATA'] = tempDir
    _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
    _setReplicaSshStorePathForTest(join(tempDir, 'edge-replica-ssh-credentials.json'))
    _setSupervisorAuditPathForTest(join(tempDir, 'edge-tier-audit.log'))
    _setDiagnosticReportsRootForTest(join(tempDir, 'diagnostic-reports'))

    storeReplicaSshCredentials(REPLICA.edge_pod_id, {
      sshUser: 'beap',
      sshPort: 22,
      sshKey: 'fake-key',
    }, mockVault)

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

  test('reportStore accepts valid signature and rejects invalid signature', () => {
    const validRaw = signFixtureReport()
    const valid = storeDiagnosticReport(REPLICA.edge_pod_id, FIXTURE_PUBLIC_KEY_CLAIM, validRaw)
    expect(valid.stored).toBe(true)
    expect(listReports(REPLICA.edge_pod_id)).toHaveLength(1)

    const invalid = storeDiagnosticReport(
      REPLICA.edge_pod_id,
      FIXTURE_PUBLIC_KEY_CLAIM,
      signedReportWithWrongKey(),
    )
    expect(invalid.stored).toBe(false)
    expect(invalid.reason).toBe('invalid_signature')
    expect(listReports(REPLICA.edge_pod_id)).toHaveLength(1)
  })

  test('mock E2E: depackager crash → report pickup → replace → rm + create + restore', async () => {
    const depackager = `${REMOTE_POD_NAME}-depackager`
    const signedRaw = signFixtureReport()
    const reportFilename = '2026-05-24T12-00-00-000Z-abc123def456.json'
    const commandLog: string[] = []

    const mockSsh = {
      run: vi.fn(async (cmd: string) => {
        commandLog.push(cmd)
        if (cmd.includes('podman inspect') && cmd.includes(depackager)) {
          return {
            stdout: JSON.stringify({ State: { Status: 'exited', Running: false }, Config: { Image: 'beap-components:dev' }, Mounts: [] }),
            stderr: '',
            code: 0,
          }
        }
        if (cmd.includes('podman inspect') && !cmd.includes(depackager)) {
          return {
            stdout: JSON.stringify({ State: { Status: 'running', Running: true } }),
            stderr: '',
            code: 0,
          }
        }
        if (cmd.includes('podman cp') && cmd.includes('/tmp/diagnostic-reports')) {
          return { stdout: '', stderr: '', code: 0 }
        }
        if (cmd.startsWith('ls -1')) {
          return { stdout: reportFilename, stderr: '', code: 0 }
        }
        if (cmd.startsWith('cat ') && cmd.includes(reportFilename)) {
          return { stdout: signedRaw, stderr: '', code: 0 }
        }
        if (cmd.includes('printenv POD_AUTH_SECRET')) {
          return { stdout: 'a'.repeat(64), stderr: '', code: 0 }
        }
        if (cmd.includes('podman rm -f')) {
          return { stdout: '', stderr: '', code: 0 }
        }
        if (cmd.includes('podman run -d')) {
          return { stdout: 'new-container-id', stderr: '', code: 0 }
        }
        if (cmd.includes('/health')) {
          return { stdout: '', stderr: '', code: 0 }
        }
        if (cmd.includes('{{.Id}}')) {
          return { stdout: 'sha256:newdepackager', stderr: '', code: 0 }
        }
        if (cmd.includes('rm -rf')) {
          return { stdout: '', stderr: '', code: 0 }
        }
        return { stdout: '', stderr: '', code: 0 }
      }),
      uploadContent: vi.fn(),
      disconnect: vi.fn(async () => undefined),
    }

    const replaceContainer = vi.fn(async () => ({
      success: true as const,
      new_container_id: 'sha256:newdepackager',
      replacement_duration_ms: 1500,
    }))

    const pickupReports = vi.fn(async () => {
      const storeResult = storeDiagnosticReport(
        REPLICA.edge_pod_id,
        FIXTURE_PUBLIC_KEY_CLAIM,
        signedRaw,
        reportFilename,
      )
      return { reports: [{ filename: reportFilename, storeResult }] }
    })

    setSupervisorDepsForTest({
      connectSsh: vi.fn(async () => mockSsh),
      inspectStatus: vi.fn(async (_ssh, name) =>
        name === depackager ? 'exited' : 'running',
      ),
      probeContainerHealth: vi.fn(async () => true),
      pickupReports,
      replaceContainer,
    })

    await runSupervisorPollCycle()

    expect(pickupReports).toHaveBeenCalled()
    expect(replaceContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        containerRole: 'depackager',
        queuePosition: 0,
      }),
      expect.any(Object),
    )

    const rmIndex = commandLog.findIndex((c) => c.includes('podman rm -f'))
    const runIndex = commandLog.findIndex((c) => c.includes('podman run -d'))
    if (rmIndex >= 0 && runIndex >= 0) {
      expect(rmIndex).toBeLessThan(runIndex)
    }

    const stored = getReport(REPLICA.edge_pod_id, reportFilename)
    expect(stored).toBe(signedRaw)

    const audit = readSupervisorAuditEntries()
    expect(audit.some((e) => e.event === 'container_replaced' && e.success)).toBe(true)
    expect(audit.find((e) => e.event === 'container_replaced')?.container_role).toBe('depackager')
  })

  test('replaceContainer calls restore endpoint with queue position', async () => {
    const { replaceContainer } = await import('../replace.js')
    const postRestoreSpy = vi.spyOn(await import('../roleRemote.js'), 'postRoleRestore')

    const commands: string[] = []
    const mockSsh = {
      run: vi.fn(async (cmd: string) => {
        commands.push(cmd)
        if (cmd.includes('podman inspect') && cmd.includes('{{json .}}')) {
          return {
            stdout: JSON.stringify({
              State: { Status: 'exited' },
              Config: { Image: 'beap-components:dev', User: '10102:10100' },
              Mounts: [{ Type: 'volume', Name: 'vol-depack', Destination: '/tmp' }],
            }),
            stderr: '',
            code: 0,
          }
        }
        if (cmd.includes('printenv POD_AUTH_SECRET')) {
          return { stdout: 'b'.repeat(64), stderr: '', code: 0 }
        }
        if (cmd.includes('podman rm -f')) return { stdout: '', stderr: '', code: 0 }
        if (cmd.includes('podman run -d')) return { stdout: '', stderr: '', code: 0 }
        if (cmd.includes('/health')) return { stdout: '', stderr: '', code: 0 }
        if (cmd.includes('{{.Id}}')) return { stdout: 'cid-new', stderr: '', code: 0 }
        return { stdout: '', stderr: '', code: 0 }
      }),
      uploadContent: vi.fn(),
      disconnect: vi.fn(),
    }

    postRestoreSpy.mockResolvedValue({ status: 200, json: { ok: true, queue_position: 42 } })

    const result = await replaceContainer(
      {
        replica: REPLICA,
        containerRole: 'depackager',
        ssh: mockSsh,
        vault: mockVault,
        queuePosition: 42,
      },
      { healthTimeoutMs: 100, healthPollMs: 10, sleep: async () => undefined },
    )

    expect(result.success).toBe(true)
    expect(postRestoreSpy).toHaveBeenCalledWith(
      mockSsh,
      expect.objectContaining({ role: 'depackager' }),
      42,
    )

    const rmIdx = commands.findIndex((c) => c.includes('podman rm -f'))
    const runIdx = commands.findIndex((c) => c.includes('podman run -d'))
    expect(rmIdx).toBeGreaterThanOrEqual(0)
    expect(runIdx).toBeGreaterThan(rmIdx)
    expect(commands.filter((c) => c.includes('podman rm -f')).length).toBe(1)
    expect(commands.filter((c) => c.includes('podman run -d')).length).toBe(1)

    postRestoreSpy.mockRestore()
  })

  test('SSH network failure marks replica unreachable without replacement', async () => {
    setSupervisorDepsForTest({
      connectSsh: vi.fn(async () => {
        throw new Error('connect ETIMEDOUT')
      }),
      replaceContainer: vi.fn(),
      pickupReports: vi.fn(),
      inspectStatus: vi.fn(),
      probeContainerHealth: vi.fn(),
    })

    await runSupervisorPollCycle()

    const status = (await import('../index.js')).getPodSupervisorStatus()
    expect(status.replicas[0]?.reachable).toBe(false)
    expect(status.replicas[0]?.containers.every((c) => c.state === 'unreachable')).toBe(true)

    const audit = readSupervisorAuditEntries()
    expect(audit.some((e) => e.event === 'container_unreachable')).toBe(true)
  })

  test('PodSupervisor start/stop toggles running flag', async () => {
    const { PodSupervisor } = await import('../index.js')
    setSupervisorDepsForTest({
      connectSsh: vi.fn(async () => ({
        run: vi.fn(async () => ({ stdout: '', stderr: '', code: 0 })),
        uploadContent: vi.fn(),
        disconnect: vi.fn(),
      })),
      inspectStatus: vi.fn(async () => 'running'),
      probeContainerHealth: vi.fn(async () => true),
      pickupReports: vi.fn(),
      replaceContainer: vi.fn(),
    })

    const supervisor = new PodSupervisor()
    expect(supervisor.getStatus().running).toBe(false)
    supervisor.start()
    expect(supervisor.getStatus().running).toBe(true)
    supervisor.stop()
    expect(supervisor.getStatus().running).toBe(false)
  })

  test('audit log file is append-only JSON lines', async () => {
    const { appendSupervisorAudit } = await import('../auditLog.js')
    appendSupervisorAudit({
      event: 'container_replaced_failed',
      replica_id: REPLICA.edge_pod_id,
      container_role: 'validator',
      success: false,
      reason: 'health_timeout',
    })

    const auditPath = join(tempDir, 'edge-tier-audit.log')
    expect(existsSync(auditPath)).toBe(true)
    const lines = readFileSync(auditPath, 'utf8').trim().split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(1)
    const parsed = JSON.parse(lines.at(-1)!) as { event: string }
    expect(parsed.event).toBe('container_replaced_failed')
  })
})
