/**
 * CI regression net — captured main-process logs must not contain credential patterns (P4.5.14).
 */

import { describe, test, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('../../apps/electron-vite-project/electron/main/edge-tier/ssh/client.js', () => ({
  SshClient: class {
    connect = vi.fn(async () => undefined)
    disconnect = vi.fn(async () => undefined)
    run = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }))
    uploadContent = vi.fn(async () => undefined)
  },
}))

import {
  installMainProcessLogScrubbing,
  installLogCaptureForTest,
  drainCapturedLogs,
  resetCapturedLogs,
  _resetMainProcessLogScrubbingForTest,
} from '../../apps/electron-vite-project/electron/main/security/mainProcessLogger.js'
import {
  findSecretPatternsInText,
  REDACTED,
  SECRET_SUBSTRING_PATTERNS,
} from '../../apps/electron-vite-project/electron/main/security/secretScrubber.js'
import {
  wizardStoreVmCredentials,
  wizardProbe,
  assertNoSecretsInRendererPayload,
} from '../../apps/electron-vite-project/electron/main/wizard/handlers.js'
import { _resetWizardSshSessionForTest } from '../../apps/electron-vite-project/electron/main/wizard/sshSession.js'
import type { WizardHandlerDeps } from '../../apps/electron-vite-project/electron/main/wizard/handlers.js'
import type { TargetProbe } from '../../apps/electron-vite-project/electron/main/edge-tier/ssh/types.js'
import { _setHostKeyStorePathForTest } from '../../apps/electron-vite-project/electron/main/edge-tier/ssh/hostKeyStore.js'

const FIXTURE_KEY = join(
  fileURLToPath(
    new URL(
      '../../apps/electron-vite-project/electron/main/wizard/__tests__/fixtures/openssh-test-rsa-key',
      import.meta.url,
    ),
  ),
)

function scanCapturedLogs(): string[] {
  const violations: string[] = []
  for (const entry of drainCapturedLogs()) {
    for (const marker of SECRET_SUBSTRING_PATTERNS) {
      if (entry.line.includes(marker)) {
        violations.push(`${entry.level}: ${marker}`)
      }
    }
    for (const hit of findSecretPatternsInText(entry.line)) {
      violations.push(`${entry.level}: ${hit}`)
    }
    if (entry.line.includes('"privateKey"') && !entry.line.includes(REDACTED)) {
      violations.push(`${entry.level}: privateKey field with unredacted value`)
    }
    if (entry.line.includes('"passphrase"') && !entry.line.includes(REDACTED)) {
      violations.push(`${entry.level}: passphrase field with unredacted value`)
    }
  }
  return violations
}

function makeDeps(): WizardHandlerDeps {
  return {
    vault: { deriveApplicationKey: () => Buffer.alloc(32, 7) },
    ensureSession: vi.fn(async () => ({ accessToken: 'sso-token' })),
    getCachedUserInfo: vi.fn(() => ({
      sub: 'user-1',
      wrdesk_plan: 'pro',
      canonical_tier: 'pro',
      roles: [],
    })),
    requestAttestation: vi.fn(async () => ({ jwt: 'attest.jwt.token' })),
    probeTarget: vi.fn(async (): Promise<TargetProbe> => ({
      distro: 'ubuntu',
      version: '22.04',
      family: 'debian',
      podman_installed: true,
      package_manager: 'dpkg',
      is_root: true,
      has_passwordless_sudo: true,
      verdict: { ok: true },
    })),
    readManifestYaml: () => 'apiVersion: v1',
    verifyRoundTrip: vi.fn(async () => ({ verified: true })),
  }
}

let hostKeyDir = ''

beforeAll(() => {
  _resetMainProcessLogScrubbingForTest()
  installMainProcessLogScrubbing({ skipBroadcast: true })
  installLogCaptureForTest(true)
  hostKeyDir = mkdtempSync(join(tmpdir(), 'no-cred-logs-'))
  _setHostKeyStorePathForTest(join(hostKeyDir, 'edge-tier-host-keys.json'))
})

afterAll(() => {
  _resetMainProcessLogScrubbingForTest()
  _setHostKeyStorePathForTest(null)
  rmSync(hostKeyDir, { recursive: true, force: true })
})

beforeEach(() => {
  _resetWizardSshSessionForTest()
  resetCapturedLogs()
})

describe('no-credential-logs regression net', () => {
  test('wizard credential integration emits no secret patterns in captured logs', async () => {
    const credentials = wizardStoreVmCredentials({
      host: '10.0.0.8',
      user: 'deploy',
      keyFilePath: FIXTURE_KEY,
    })
    assertNoSecretsInRendererPayload(credentials)

    await wizardProbe(makeDeps())
    console.log('[WIZARD] probe finished', { host: credentials.host, port: credentials.port })

    const violations = scanCapturedLogs()
    expect(violations).toEqual([])
  })
})
