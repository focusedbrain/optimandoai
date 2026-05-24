/**
 * Pod-level replacement escalation tests (P5.8).
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  _setSupervisorAuditPathForTest,
  readSupervisorAuditEntries,
} from '../auditLog.js'
import {
  replaceContainer,
  shouldEscalateToPodReplace,
  REMOTE_POD_NAME,
} from '../replace.js'
import type { EdgeReplica } from '../../settings.js'

const REPLICA: EdgeReplica = {
  host: 'edge.example.com',
  port: 18100,
  edge_pod_id: '550e8400-e29b-41d4-a716-446655440000',
  edge_public_key: 'ed25519:' + 'aa'.repeat(32),
  sso_attestation_jwt: 'eyJ.test.jwt',
}

const mockVault = {
  deriveApplicationKey: () => Buffer.alloc(32, 9),
}

vi.mock('../../keyStorage.js', () => ({
  loadEncryptedEdgePrivateKeyHex: vi.fn(() => 'bb'.repeat(32)),
}))

describe('shouldEscalateToPodReplace (P5.8)', () => {
  test('escalates on health_timeout and restore failures', () => {
    expect(shouldEscalateToPodReplace('health_timeout')).toBe(true)
    expect(shouldEscalateToPodReplace('restore_failed:HTTP_500')).toBe(true)
    expect(shouldEscalateToPodReplace('podman_play_failed:invalid pod state')).toBe(true)
    expect(shouldEscalateToPodReplace('podman_run_failed:no such pod')).toBe(true)
    expect(shouldEscalateToPodReplace('pod_auth_secret_unavailable')).toBe(false)
    expect(shouldEscalateToPodReplace('podman_rm_failed:1')).toBe(false)
  })
})

describe('replaceContainer pod escalation (P5.8)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'replace-escalation-'))
    process.env['WR_DESK_USER_DATA'] = tempDir
    _setSupervisorAuditPathForTest(join(tempDir, 'edge-tier-audit.log'))
  })

  afterEach(() => {
    delete process.env['WR_DESK_USER_DATA']
    _setSupervisorAuditPathForTest(null)
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('container health_timeout escalates to pod stop + rm + play kube', async () => {
    const commands: string[] = []
    const depackager = `${REMOTE_POD_NAME}-depackager`

    const mockSsh = {
      run: vi.fn(async (cmd: string) => {
        commands.push(cmd)
        if (cmd.includes('printenv POD_AUTH_SECRET')) {
          return { stdout: 'c'.repeat(64), stderr: '', code: 0 }
        }
        if (cmd.includes('podman inspect') && cmd.includes(depackager)) {
          return {
            stdout: JSON.stringify({
              State: { Status: 'exited', Running: false },
              Config: { Image: 'beap-components:dev', User: '10102:10100' },
              Mounts: [],
            }),
            stderr: '',
            code: 0,
          }
        }
        if (cmd.includes('podman rm -f') && cmd.includes(depackager)) {
          return { stdout: '', stderr: '', code: 0 }
        }
        if (cmd.includes('podman run -d')) {
          return { stdout: 'new-container-id', stderr: '', code: 0 }
        }
        if (cmd.includes(' && ') && cmd.includes('/health')) {
          return { stdout: '', stderr: '', code: 0 }
        }
        if (cmd.includes('/health')) {
          return { stdout: '', stderr: 'timeout', code: 1 }
        }
        if (cmd.includes('{{.Id}}')) {
          return { stdout: 'sha256:deadbeef', stderr: '', code: 0 }
        }
        if (cmd.includes('rm -f') && cmd.includes('beap-pod-remote-edge.yaml')) {
          return { stdout: '', stderr: '', code: 0 }
        }
        return { stdout: '', stderr: '', code: 0 }
      }),
      uploadContent: vi.fn(async () => undefined),
      disconnect: vi.fn(async () => undefined),
    }

    const redeliverCredentials = vi.fn(async () => undefined)

    const result = await replaceContainer(
      {
        replica: REPLICA,
        containerRole: 'depackager',
        ssh: mockSsh,
        vault: mockVault,
        queuePosition: 0,
      },
      {
        healthTimeoutMs: 80,
        healthPollMs: 20,
        sleep: async () => undefined,
        readManifestYaml: () => 'apiVersion: v1\nkind: Pod\n',
        redeliverCredentials,
      },
    )

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.escalated_to_pod).toBe(true)
      expect(result.pod_escalation_reason).toBe('health_timeout')
    }

    expect(commands.some((c) => c.includes('podman pod stop'))).toBe(true)
    expect(commands.some((c) => c.includes('podman pod rm'))).toBe(true)
    expect(commands.some((c) => c.includes('podman play kube'))).toBe(true)
    expect(redeliverCredentials).toHaveBeenCalledWith(REPLICA, mockSsh, mockVault)
  })

  test('supervisor audit differentiates pod_replaced from container_replaced', async () => {
    const { appendSupervisorAudit } = await import('../auditLog.js')
    appendSupervisorAudit({
      event: 'container_replaced',
      replica_id: REPLICA.edge_pod_id,
      container_role: 'validator',
      success: true,
      duration_ms: 100,
    })
    appendSupervisorAudit({
      event: 'pod_replaced',
      replica_id: REPLICA.edge_pod_id,
      container_role: 'depackager',
      success: true,
      duration_ms: 5000,
      reason: 'health_timeout',
    })

    const audit = readSupervisorAuditEntries()
    expect(audit.some((e) => e.event === 'container_replaced')).toBe(true)
    expect(audit.some((e) => e.event === 'pod_replaced')).toBe(true)
    expect(audit.find((e) => e.event === 'pod_replaced')?.reason).toBe('health_timeout')
  })
})
