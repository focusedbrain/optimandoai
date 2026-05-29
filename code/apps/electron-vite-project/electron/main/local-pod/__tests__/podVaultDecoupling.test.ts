/**
 * Pod lifecycle vs inner-vault decoupling — regression suite.
 *
 * Intentionally does NOT use test/setup.ts (no global mock pod / hostPodReady override).
 * Run: pnpm exec vitest run --config apps/electron-vite-project/vitest.podVault.config.ts
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'


vi.mock('../supervisor/index.js', () => ({
  startLocalPodSupervisor: vi.fn(),
  stopLocalPodSupervisor: vi.fn(),
}))

vi.mock('../../edge-tier/jwks.js', () => ({
  refreshJwksOnStartup: vi.fn().mockResolvedValue(undefined),
  getCachedJwksJson: vi.fn(() => null),
}))

import {
  startLocalPod,
  _resetStateForTest,
  getLocalPodStatus,
} from '../index.js'
import { getLocalPodUnavailableMessage, _resetPodStatusForTest } from '../podStatus.js'
import { getPodSessionAuthSecret, clearPodSessionAuthSecret } from '../podSessionAuth.js'
import { type PodmanExecutor } from '../podRunner.js'
import { extractPdfViaDepackager } from '../../email/pdfPodClient.js'

vi.mock('../../edge-tier/sessionBridge.js', () => ({
  getLocalSsoSub: () => 'sso-test-sub',
}))

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURE_MANIFEST = join(__dirname, 'fixtures', 'pod.yaml')

const passPodmanCheck = async (): Promise<void> => {}

function makeNoopExecutor(): PodmanExecutor {
  return vi.fn().mockResolvedValue(undefined)
}

describe('podVaultDecoupling (no global mock pod)', () => {
  beforeEach(() => {
    _resetStateForTest()
    _resetPodStatusForTest()
    clearPodSessionAuthSecret()
    delete process.env['WR_POD_BASE_URL']
    delete process.env['WR_DEPACKAGER_BASE']
  })

  afterEach(() => {
    _resetStateForTest()
    clearPodSessionAuthSecret()
  })

  test('pod starts with Podman ready and inner vault locked (ephemeral seal)', async () => {
    const executor = makeNoopExecutor()

    await startLocalPod({
      manifestPath: FIXTURE_MANIFEST,
      executor,
      podmanCheck: passPodmanCheck,
      skipImageDigestVerify: true,
      skipPodHealthWait: true,
    })

    expect(executor).toHaveBeenCalled()
    expect(getPodSessionAuthSecret()).not.toBeNull()
    expect(getLocalPodStatus().status).toBe('ready')
  })

  test('depackager client surfaces actionable error, not local_pod_not_running', async () => {
    const result = await extractPdfViaDepackager(Buffer.from('%PDF'), {
      messageId: 'composer',
      attachmentId: 'att-1',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).not.toBe('local_pod_not_running')
      expect(result.reason).toMatch(/Verification environment/)
    }
  })

  test('getLocalPodUnavailableMessage never mentions inner vault locked', () => {
    const msg = getLocalPodUnavailableMessage()
    expect(msg.toLowerCase()).not.toContain('inner vault locked')
    expect(msg).not.toBe('local_pod_not_running')
  })
})
