/**
 * Wizard credential-path log fixture — P4.5.14 snapshot.
 *
 * Captures scrubbed log structure after a representative wizard + edge-tier flow.
 */

import { describe, test, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('../../edge-tier/ssh/client.js', () => ({
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
} from '../mainProcessLogger.js'
import {
  findSecretPatternsInText,
  REDACTED,
  SECRET_SUBSTRING_PATTERNS,
} from '../secretScrubber.js'
import {
  wizardStoreVmCredentials,
  wizardProbe,
  assertNoSecretsInRendererPayload,
} from '../../wizard/handlers.js'
import { _resetWizardSshSessionForTest } from '../../wizard/sshSession.js'
import type { WizardHandlerDeps } from '../../wizard/handlers.js'
import type { TargetProbe } from '../../edge-tier/ssh/types.js'

const FIXTURE_KEY = join(
  fileURLToPath(new URL('../../wizard/__tests__/fixtures/openssh-test-rsa-key', import.meta.url)),
)

function makeProbe(): TargetProbe {
  return {
    distro: 'ubuntu',
    version: '22.04',
    family: 'debian',
    podman_installed: true,
    package_manager: 'dpkg',
    is_root: true,
    has_passwordless_sudo: true,
    verdict: { ok: true },
  }
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
    probeTarget: vi.fn(async () => makeProbe()),
    readManifestYaml: () => 'apiVersion: v1',
    verifyRoundTrip: vi.fn(async () => ({ verified: true })),
  }
}

function summarizeCapturedLogs(lines: readonly { level: string; line: string }[]) {
  const levels = lines.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.level] = (acc[entry.level] ?? 0) + 1
    return acc
  }, {})
  const prefixes = [
    ...new Set(
      lines
        .map((entry) => entry.line.match(/^\[[^\]]+\]/)?.[0])
        .filter((value): value is string => Boolean(value)),
    ),
  ].sort()
  return {
    lineCount: lines.length,
    levels,
    prefixes,
  }
}

function scanLogsForSecrets(lines: readonly { level: string; line: string }[]): string[] {
  const violations: string[] = []
  for (const entry of lines) {
    const hits = findSecretPatternsInText(entry.line)
    for (const hit of hits) {
      violations.push(`${entry.level}: ${hit}`)
    }
    for (const marker of SECRET_SUBSTRING_PATTERNS) {
      if (entry.line.includes(marker)) {
        violations.push(`${entry.level}: ${marker}`)
      }
    }
    if (entry.line.includes('"privateKey"') && !entry.line.includes(REDACTED)) {
      violations.push(`${entry.level}: sensitive JSON field name in log line`)
    }
    if (entry.line.includes('"passphrase"') && !entry.line.includes(REDACTED)) {
      violations.push(`${entry.level}: sensitive JSON field name in log line`)
    }
  }
  return violations
}

beforeAll(() => {
  _resetMainProcessLogScrubbingForTest()
  installMainProcessLogScrubbing({ skipBroadcast: true })
  installLogCaptureForTest(true)
})

afterAll(() => {
  _resetMainProcessLogScrubbingForTest()
})

beforeEach(() => {
  _resetWizardSshSessionForTest()
  resetCapturedLogs()
})

afterEach(() => {
  resetCapturedLogs()
})

describe('wizard credential log fixture', () => {
  test('scrubbed logs contain no credential patterns', async () => {
    const credentials = wizardStoreVmCredentials({
      host: '10.0.0.1',
      user: 'deploy',
      keyFilePath: FIXTURE_KEY,
    })
    assertNoSecretsInRendererPayload(credentials)

    await wizardProbe(makeDeps())

    // Simulate a dangerous log line — scrubbing must redact before capture.
    console.log('wizard debug', { privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nleak\n-----END OPENSSH PRIVATE KEY-----' })

    const logs = drainCapturedLogs()
    const violations = scanLogsForSecrets(logs)
    expect(violations).toEqual([])
    expect(logs.join('\n')).not.toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(logs.some((entry) => entry.line.includes(REDACTED))).toBe(true)
  })

  test('matches snapshot for scrubbed log structure', async () => {
    wizardStoreVmCredentials({
      host: '10.0.0.1',
      user: 'deploy',
      keyFilePath: FIXTURE_KEY,
    })
    await wizardProbe(makeDeps())
    console.log('[WIZARD] probe complete', { host: '10.0.0.1', port: 22 })

    expect(summarizeCapturedLogs(drainCapturedLogs())).toMatchSnapshot()
  })
})
