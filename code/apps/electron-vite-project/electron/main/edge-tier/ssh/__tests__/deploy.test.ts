/**
 * Remote pod deployer — unit tests (P4.3)
 */

import { describe, test, expect, vi } from 'vitest'

import {
  buildAllHealthCommand,
  buildPodmanPlayCommand,
  buildRemotePodmanPreflightCommand,
  buildTeardownCommand,
  collectDeployEvents,
  deployEdgePod,
  REMOTE_MANIFEST_PATH,
  REMOTE_POD_NAME,
} from '../deploy.js'
import type { DeployArgs, DeployDeps, DeploySshClient } from '../deploy.js'

const SAMPLE_MANIFEST = `# BEAP REMOTE_EDGE placeholder manifest
apiVersion: v1
kind: Pod
metadata:
  name: beap-pod-remote-edge
spec:
  containers:
    - name: certifier
      env:
        - name: EDGE_PRIVATE_KEY_HEX
          value: "\${EDGE_PRIVATE_KEY_HEX}"
`

const TEST_PRIVATE_KEY_HEX = 'a'.repeat(64)
const TEST_POD_AUTH_SECRET = 'b'.repeat(64)
const TEST_POD_ID = '11111111-2222-4333-8444-555555555555'
const TEST_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyIn0.signature'
const TEST_PUBLIC_KEY = `ed25519:${'c'.repeat(64)}`

function makeDeployArgs(overrides: Partial<DeployArgs> = {}): DeployArgs {
  const client =
    overrides.client ?? makeMockClient(() => ({ stdout: '', stderr: '', code: 0 }))
  return {
    host: '203.0.113.10',
    podId: TEST_POD_ID,
    publicKey: TEST_PUBLIC_KEY,
    privateKeyHex: TEST_PRIVATE_KEY_HEX,
    attestationJwt: TEST_JWT,
    podAuthSecret: TEST_POD_AUTH_SECRET,
    manifestYaml: SAMPLE_MANIFEST,
    certTtlSeconds: 86400,
    ...overrides,
    client,
  }
}

function makeMockClient(
  handler: (command: string) => { stdout: string; stderr: string; code: number | null },
): DeploySshClient {
  return {
    run: vi.fn(async (command: string) => handler(command)),
    uploadContent: vi.fn(async () => undefined),
  }
}

function makeDeps(
  handler: (command: string) => { stdout: string; stderr: string; code: number | null },
  opts?: { sleep?: DeployDeps['sleep']; healthTimeoutMs?: number; healthPollMs?: number },
): DeployDeps {
  return {
    run: vi.fn(async (command: string) => handler(command)),
    uploadContent: vi.fn(async () => undefined),
    sleep: opts?.sleep ?? (async () => undefined),
    healthTimeoutMs: opts?.healthTimeoutMs,
    healthPollMs: opts?.healthPollMs,
  }
}

describe('buildPodmanPlayCommand — snapshot and secret handling', () => {
  test('secrets stay on one env-prefixed line (snapshot)', () => {
    const cmd = buildPodmanPlayCommand({
      podAuthSecret: TEST_POD_AUTH_SECRET,
      privateKeyHex: TEST_PRIVATE_KEY_HEX,
      podId: TEST_POD_ID,
      attestationJwt: TEST_JWT,
      certTtlSeconds: 86400,
    })

    expect(cmd).toMatchSnapshot()
    expect(cmd.split('\n').length).toBe(1)
    expect(cmd).toContain(`EDGE_PRIVATE_KEY_HEX='${TEST_PRIVATE_KEY_HEX}'`)
    expect(cmd).toContain('envsubst < /tmp/beap-pod-remote-edge.yaml | podman play kube -')
    expect(cmd).not.toMatch(/<<['"]?/)
    expect(cmd).not.toMatch(/echo\s+\$/)
    expect(cmd).not.toMatch(/EDGE_PRIVATE_KEY_HEX=\s*\n/)
    expect(cmd).not.toContain(TEST_PRIVATE_KEY_HEX + '\n')
    expect(cmd).toMatch(/HISTFILE=\/dev\/null/)
  })

  test('does not write secrets to a separate shell file construct', () => {
    const cmd = buildPodmanPlayCommand({
      podAuthSecret: TEST_POD_AUTH_SECRET,
      privateKeyHex: TEST_PRIVATE_KEY_HEX,
      podId: TEST_POD_ID,
      attestationJwt: TEST_JWT,
      certTtlSeconds: 3600,
    })

    expect(cmd).not.toMatch(/>\s*\/tmp\//)
    expect(cmd).not.toMatch(/tee\s/)
    expect(cmd).not.toMatch(/source\s/)
  })
})

describe('buildAllHealthCommand', () => {
  test('checks all four containers via podman exec', () => {
    const cmd = buildAllHealthCommand()
    expect(cmd).toContain(`${REMOTE_POD_NAME}-ingestor`)
    expect(cmd).toContain(`${REMOTE_POD_NAME}-validator`)
    expect(cmd).toContain(`${REMOTE_POD_NAME}-depackager`)
    expect(cmd).toContain(`${REMOTE_POD_NAME}-certifier`)
    expect(cmd).toContain('/health')
  })
})

describe('buildRemotePodmanPreflightCommand', () => {
  test('matches @repo/podman-probe remote Linux contract', () => {
    expect(buildRemotePodmanPreflightCommand()).toBe(
      'command -v podman >/dev/null 2>&1 && podman info >/dev/null 2>&1',
    )
  })
})

describe('deployEdgePod — happy path', () => {
  test('emits stages, done event, and replica metadata', async () => {
    const commands: string[] = []
    const uploads: Array<{ path: string; content: string }> = []
    const client = makeMockClient((command) => {
      commands.push(command)
      return { stdout: '', stderr: '', code: 0 }
    })
    client.uploadContent = vi.fn(async (content, path) => {
      uploads.push({ path, content: typeof content === 'string' ? content : content.toString('utf8') })
    })

    const events = await collectDeployEvents(makeDeployArgs({ client }))

    expect(events.some((e) => e.kind === 'stage' && e.stage_name === 'verify_podman')).toBe(true)
    expect(events.some((e) => e.kind === 'stage' && e.stage_name === 'upload_manifest')).toBe(true)
    expect(events.some((e) => e.kind === 'stage' && e.stage_name === 'start_pod')).toBe(true)
    expect(events.some((e) => e.kind === 'stage' && e.stage_name === 'health_check')).toBe(true)
    expect(events.some((e) => e.kind === 'stage' && e.stage_name === 'cleanup')).toBe(true)

    const done = events.find((e) => e.kind === 'done')
    expect(done).toBeDefined()
    expect(done!.replica_state).toEqual({
      host: '203.0.113.10',
      podId: TEST_POD_ID,
      publicKey: TEST_PUBLIC_KEY,
      attestationJwt: TEST_JWT,
    })

    expect(uploads[0]?.path).toBe(REMOTE_MANIFEST_PATH)
    expect(uploads[0]?.content).toContain('${EDGE_PRIVATE_KEY_HEX}')
    expect(uploads[0]?.content).not.toContain(TEST_PRIVATE_KEY_HEX)

    expect(commands.some((c) => c.includes(buildRemotePodmanPreflightCommand()))).toBe(true)
    expect(commands.some((c) => c.includes('env ') && c.includes('podman play kube'))).toBe(true)
    expect(commands.some((c) => c.includes('podman exec') && c.includes('/health'))).toBe(true)
    expect(commands.some((c) => c.includes(`rm -f ${REMOTE_MANIFEST_PATH}`))).toBe(true)
    expect(commands.some((c) => c.includes('podman pod stop'))).toBe(false)
  })
})

describe('deployEdgePod — failure at verify_podman', () => {
  test('does not upload manifest when remote Podman is missing', async () => {
    const uploads: string[] = []
    const client = makeMockClient((command) => {
      if (command.includes('command -v podman')) {
        return { stdout: '', stderr: 'podman missing', code: 1 }
      }
      return { stdout: '', stderr: '', code: 0 }
    })
    client.uploadContent = vi.fn(async (_content, path) => {
      uploads.push(path)
    })

    const events = await collectDeployEvents(makeDeployArgs({ client }))

    const error = events.find((e) => e.kind === 'error')
    expect(error).toBeDefined()
    expect(error!.stage_name).toBe('verify_podman')
    expect(error!.message).toMatch(/healthy Podman engine/)
    expect(uploads).toHaveLength(0)
  })
})

describe('deployEdgePod — failure at start_pod', () => {
  test('runs cleanup and emits error when podman play fails', async () => {
    const commands: string[] = []
    const client = makeMockClient((command) => {
      commands.push(command)
      if (command.includes('podman play kube')) {
        return { stdout: '', stderr: 'play failed', code: 1 }
      }
      return { stdout: '', stderr: '', code: 0 }
    })

    const events = await collectDeployEvents(makeDeployArgs({ client }))

    const error = events.find((e) => e.kind === 'error')
    expect(error).toBeDefined()
    expect(error!.stage_name).toBe('start_pod')
    expect(error!.message).toMatch(/podman play kube failed/)

    const teardownCalls = commands.filter(
      (c) => c.includes('podman pod stop') && c.includes(`rm -f ${REMOTE_MANIFEST_PATH}`),
    )
    expect(teardownCalls.length).toBeGreaterThan(0)
  })
})

describe('deployEdgePod — failure at health_check', () => {
  test('stops pod, removes manifest, and emits error on health timeout', async () => {
    const commands: string[] = []
    let healthCalls = 0
    const deps = makeDeps(
      (command) => {
        commands.push(command)
        if (command.includes('podman exec') && command.includes('/health')) {
          healthCalls++
          return { stdout: '', stderr: 'not ready', code: 1 }
        }
        return { stdout: '', stderr: '', code: 0 }
      },
      { healthTimeoutMs: 1, healthPollMs: 0 },
    )

    const events = await collectDeployEvents(makeDeployArgs({ client: makeMockClient(() => ({ stdout: '', stderr: '', code: 0 })) }), deps)

    const error = events.find((e) => e.kind === 'error')
    expect(error).toBeDefined()
    expect(error!.stage_name).toBe('health_check')
    expect(healthCalls).toBeGreaterThan(0)

    expect(commands.some((c) => c.includes(buildTeardownCommand().slice(0, 40)))).toBe(true)
    expect(
      commands.some(
        (c) => c.includes(`podman pod stop ${REMOTE_POD_NAME}`) && c.includes(`rm -f ${REMOTE_MANIFEST_PATH}`),
      ),
    ).toBe(true)
  })
})

describe('deployEdgePod — event stream', () => {
  test('yields structured events consumable by wizard UI', async () => {
    const events: Array<{ kind: string; message: string }> = []
    for await (const event of deployEdgePod(makeDeployArgs())) {
      events.push(event)
    }

    for (const event of events) {
      expect(typeof event.message).toBe('string')
      expect(event.message.length).toBeGreaterThan(0)
    }
    expect(events[0]?.kind).toBe('stage')
  })
})
