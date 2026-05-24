/**
 * Wizard VM credentials IPC — unit tests (P4.5.11)
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import {
  assertNoSecretsInRendererPayload,
  wizardStoreVmCredentials,
} from '../handlers.js'
import { getWizardVmCredentials, _resetWizardSshSessionForTest } from '../sshSession.js'
import { parseVmCredentialsInput, pickSshKeyFileViaDialog } from '../ipc.js'
import { MAX_SSH_KEY_FILE_BYTES } from '../readSshKeyFile.js'

const FIXTURE_KEY = join(
  fileURLToPath(new URL('./fixtures/openssh-test-rsa-key', import.meta.url)),
)

beforeEach(() => {
  _resetWizardSshSessionForTest()
})

describe('parseVmCredentialsInput', () => {
  test('requires keyFilePath instead of inline key', () => {
    expect(() => parseVmCredentialsInput({ host: 'h', user: 'u', key: 'pem' })).toThrow(
      /keyFilePath/,
    )
  })
})

describe('wizard:setVmCredentials flow', () => {
  test('main holds key; renderer-bound response has no PEM', () => {
    const credentials = wizardStoreVmCredentials({
      host: '10.0.0.1',
      user: 'deploy',
      keyFilePath: FIXTURE_KEY,
    })

    expect(credentials).toEqual({ host: '10.0.0.1', port: 22, username: 'deploy' })
    expect(getWizardVmCredentials()?.privateKey).toContain('BEGIN OPENSSH PRIVATE KEY')
    expect(() => assertNoSecretsInRendererPayload(credentials)).not.toThrow()
    expect(() => assertNoSecretsInRendererPayload({ credentials, state: { step: 'provide_vm' } })).not.toThrow()
  })

  test('rejects oversized key file', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'wizard-ipc-oversize-'))
    try {
      const path = join(tempDir, 'big')
      writeFileSync(path, Buffer.alloc(MAX_SSH_KEY_FILE_BYTES + 1, 0x41))
      expect(() =>
        wizardStoreVmCredentials({ host: 'h', user: 'u', keyFilePath: path }),
      ).toThrow(/exceeds/)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test('rejects malformed key file', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'wizard-ipc-malformed-'))
    try {
      const path = join(tempDir, 'bad')
      writeFileSync(path, 'not-a-key')
      expect(() =>
        wizardStoreVmCredentials({ host: 'h', user: 'u', keyFilePath: path }),
      ).toThrow(/Invalid SSH private key/)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})

describe('wizard:pickSshKeyFile', () => {
  test('returns canceled when dialog is dismissed', async () => {
    const result = await pickSshKeyFileViaDialog(async () => ({ canceled: true, filePaths: [] }))
    expect(result).toEqual({ canceled: true })
  })

  test('returns file path when user selects a file', async () => {
    const result = await pickSshKeyFileViaDialog(async () => ({
      canceled: false,
      filePaths: ['/home/user/.ssh/id_ed25519'],
    }))
    expect(result).toEqual({ canceled: false, filePath: '/home/user/.ssh/id_ed25519' })
  })
})
