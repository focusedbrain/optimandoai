/**
 * Wizard cancellation — unit tests (P4.4)
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

import { wizardGenerateAndDeploy } from '../handlers.js'
import {
  _resetWizardSshSessionForTest,
  storeWizardVmCredentials,
} from '../sshSession.js'
import type { WizardHandlerDeps } from '../handlers.js'
import type { DeployEvent } from '../../edge-tier/ssh/deploy.js'

const SSH_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\ncancel-test\n-----END OPENSSH PRIVATE KEY-----'

vi.mock('../../edge-tier/keygen.js', () => ({
  generateEdgeKeypair: () => ({
    privateKeyHex: 'cc'.repeat(32),
    publicKeyHex: 'dd'.repeat(32),
    publicKeyClaim: 'ed25519:dd',
    podId: 'cancel-pod',
  }),
}))

vi.mock('../../edge-tier/keyStorage.js', () => ({
  storeEncryptedEdgePrivateKey: vi.fn(),
}))

vi.mock('../../edge-tier/settings.js', () => ({
  upsertEdgeReplica: vi.fn(),
}))

const teardownRun = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }))

vi.mock('../../edge-tier/ssh/client.js', () => ({
  SshClient: class {
    connect = vi.fn(async () => undefined)
    disconnect = vi.fn(async () => undefined)
    run = teardownRun
    uploadContent = vi.fn(async () => undefined)
  },
}))

async function* mockDeploy(): AsyncGenerator<DeployEvent> {
  yield { kind: 'stage', message: 'upload', stage_name: 'upload_manifest' }
  await new Promise((r) => setTimeout(r, 50))
  yield { kind: 'stage', message: 'start', stage_name: 'start_pod' }
  yield { kind: 'done', message: 'should not reach' }
}

vi.mock('../../edge-tier/ssh/deploy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../edge-tier/ssh/deploy.js')>()
  return {
    ...actual,
    deployEdgePod: mockDeploy,
  }
})

function makeDeps(): WizardHandlerDeps {
  return {
    vault: { deriveApplicationKey: () => Buffer.alloc(32, 1) },
    ensureSession: vi.fn(async () => ({ accessToken: 'token' })),
    requestAttestation: vi.fn(async () => ({ jwt: 'jwt' })),
    readManifestYaml: () => 'manifest',
  }
}

beforeEach(() => {
  _resetWizardSshSessionForTest()
  teardownRun.mockClear()
  storeWizardVmCredentials({
    host: 'h',
    user: 'u',
    privateKey: Buffer.from(SSH_KEY, 'utf8'),
  })
})

describe('wizardGenerateAndDeploy cancellation', () => {
  test('exits with error and runs teardown when AbortSignal fires', async () => {
    const controller = new AbortController()
    const events: DeployEvent[] = []

    const task = (async () => {
      for await (const event of wizardGenerateAndDeploy(makeDeps(), { replicaIndex: 0 }, controller.signal)) {
        events.push(event)
      }
    })()

    controller.abort()

    await task

    expect(events.some((e) => e.kind === 'error' && e.message.includes('cancelled'))).toBe(true)
    expect(teardownRun).toHaveBeenCalled()
  })
})
