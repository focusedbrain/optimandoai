/**
 * LOCAL_VERIFY mode switching — unit tests (P3.8)
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'

vi.mock('electron', () => ({
  Notification: Object.assign(
    vi.fn().mockImplementation(() => ({ show: vi.fn() })),
    { isSupported: vi.fn(() => true) },
  ),
}))

vi.mock('../supervisor/index.js', () => ({
  startLocalPodSupervisor: vi.fn(),
  stopLocalPodSupervisor: vi.fn(),
}))

import {
  startLocalPod,
  restartLocalPod,
  stopLocalPod,
  _resetStateForTest,
} from '../index.js'
import { type PodmanExecutor } from '../podRunner.js'
import { _setSettingsPathForTest, saveEdgeTierSettings, loadEdgeTierSettings, DEFAULT_EDGE_TIER_SETTINGS } from '../../edge-tier/settings.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const FIXTURE_LOCAL_HOST = join(__dirname, 'fixtures', 'pod.yaml')
const FIXTURE_LOCAL_VERIFY = join(__dirname, 'fixtures', 'pod-local-verify.yaml')

let tempDir = ''

function makeMockVault() {
  return {
    deriveApplicationKey: vi.fn((): Buffer | null => Buffer.alloc(32, 0xab)),
  }
}

function makeCapturingExecutor() {
  const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = []
  let capturedContent: string | null = null
  const executor: PodmanExecutor = vi.fn(async (args) => {
    calls.push({ args: [...args], env: { ...process.env } })
    if (args[0] === 'play' && args[2]) {
      try {
        capturedContent = readFileSync(args[2], 'utf8')
      } catch {
        capturedContent = null
      }
    }
  })
  return { executor, calls, getContent: () => capturedContent }
}

const passPodmanCheck = async (): Promise<void> => {}

function localPodStartOpts(executor: PodmanExecutor, extra?: Record<string, unknown>) {
  return {
    executor,
    podmanCheck: passPodmanCheck,
    skipImageDigestVerify: true,
    ...extra,
  }
}

describe('edge_tier.enabled mode switching', () => {
  beforeEach(() => {
    _resetStateForTest()
    tempDir = mkdtempSync(join(tmpdir(), 'local-pod-edge-'))
    _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
    saveEdgeTierSettings({ ...DEFAULT_EDGE_TIER_SETTINGS })
  })

  afterEach(() => {
    _resetStateForTest()
    _setSettingsPathForTest(null)
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('enabled=false starts LOCAL_HOST manifest', async () => {
    const vault = makeMockVault()
    const { executor, calls, getContent } = makeCapturingExecutor()

    await startLocalPod(vault, localPodStartOpts(executor, {
      manifestPath: FIXTURE_LOCAL_HOST,
    }))

    expect(calls.filter((c) => c.args[0] === 'play')).toHaveLength(1)
    const content = getContent()
    expect(content).toContain('beap-pod-test')
    expect(content).not.toContain('LOCAL_SSO_SUB')
  })

  test('enabled=true starts LOCAL_VERIFY manifest with injected env', async () => {
    const vault = makeMockVault()
    const { executor, getContent } = makeCapturingExecutor()
    const jwks = JSON.stringify({ keys: [{ kty: 'OKP', kid: 't' }] })

    saveEdgeTierSettings({
      enabled: true,
      replicas: [
        {
          host: 'edge.example',
          port: 18100,
          edge_pod_id: '11111111-1111-4111-8111-111111111111',
          edge_public_key: 'ed25519:aa'.repeat(32).slice(0, 71),
          sso_attestation_jwt: 'stub.jwt.here',
        },
      ],
      fallback_policy: 'reject',
      native_beap_routing: 'direct',
      cached_jwks_json: jwks,
    })

    await startLocalPod(vault, localPodStartOpts(executor, {
      manifestPath: FIXTURE_LOCAL_VERIFY,
      podName: 'beap-pod-local-verify-test',
      startContext: {
        localSsoSub: 'user-sub-abc',
        jwksJson: jwks,
      },
    }))

    const content = getContent()
    expect(content).toContain('user-sub-abc')
    expect(content).toContain('11111111-1111-4111-8111-111111111111')
    expect(content).toContain(jwks)
    expect(content).not.toContain('__KEYCLOAK_JWKS_JSON__')
    expect(content).toContain('LOCAL_VERIFY_ALLOW_DIRECT_P2P')
    expect(content).toMatch(/LOCAL_VERIFY_ALLOW_DIRECT_P2P[\s\S]*value: "1"/)
  })

  test('toggling edge_tier.enabled triggers pod restart in correct mode', async () => {
    const vault = makeMockVault()
    const { executor, calls, getContent } = makeCapturingExecutor()
    const jwks = JSON.stringify({ keys: [] })

    await startLocalPod(vault, localPodStartOpts(executor, {
      manifestPath: FIXTURE_LOCAL_HOST,
      podName: 'beap-pod-test',
    }))

    expect(calls.filter((c) => c.args[0] === 'play')).toHaveLength(1)
    expect(getContent()).not.toContain('LOCAL_SSO_SUB')

    saveEdgeTierSettings({
      enabled: true,
      replicas: [
        {
          host: '127.0.0.1',
          port: 18100,
          edge_pod_id: '22222222-2222-4222-8222-222222222222',
          edge_public_key: 'ed25519:bb'.repeat(32).slice(0, 71),
          sso_attestation_jwt: 'stub.jwt.here',
        },
      ],
      fallback_policy: 'reject',
      cached_jwks_json: jwks,
    })

    await restartLocalPod(vault, {
      edgeTier: loadEdgeTierSettings(),
      localSsoSub: 'user-sub-restart',
      jwksJson: jwks,
    }, localPodStartOpts(executor, {
      manifestPath: FIXTURE_LOCAL_VERIFY,
      podName: 'beap-pod-local-verify-test',
    }))

    const playCalls = calls.filter((c) => c.args[0] === 'play')
    expect(playCalls.length).toBe(2)

    const stopCall = calls.find((c) => c.args[0] === 'pod' && c.args[1] === 'stop')
    const rmCall = calls.find((c) => c.args[0] === 'pod' && c.args[1] === 'rm')
    expect(stopCall).toBeDefined()
    expect(rmCall).toBeDefined()

    const content = getContent()
    expect(content).toContain('user-sub-restart')
    expect(content).toContain('22222222-2222-4222-8222-222222222222')

    await stopLocalPod()
  })
})
