/**
 * Wizard SSH session zeroing — unit tests (P4.5.12)
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  clearWizardVmCredentials,
  storeWizardVmCredentials,
  _getWizardCredentialBuffersForTest,
  _resetWizardSshSessionForTest,
} from '../sshSession.js'
import { wizardStoreVmCredentials } from '../handlers.js'

const FIXTURE_KEY = join(
  fileURLToPath(new URL('./fixtures/openssh-test-rsa-key', import.meta.url)),
)

function isZeroFilled(buf: Buffer | undefined): boolean {
  return !buf || buf.length === 0 || buf.every((b) => b === 0)
}

beforeEach(() => {
  _resetWizardSshSessionForTest()
})

describe('clearWizardVmCredentials', () => {
  test('zero-fills private key and passphrase buffers', () => {
    const privateKey = Buffer.from('-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----')
    const passphrase = Buffer.from('hunter2')
    storeWizardVmCredentials({
      host: '10.0.0.1',
      user: 'root',
      privateKey,
      passphrase,
    })

    const before = _getWizardCredentialBuffersForTest()
    expect(before?.privateKey).toBe(privateKey)
    expect(before?.passphrase).toBe(passphrase)

    clearWizardVmCredentials()

    expect(isZeroFilled(privateKey)).toBe(true)
    expect(isZeroFilled(passphrase)).toBe(true)
    expect(_getWizardCredentialBuffersForTest()).toBeNull()
  })
})

describe('wizard:reset credential cleanup', () => {
  test('clearWizardVmCredentials after load zero-fills buffers (reset handler path)', () => {
    wizardStoreVmCredentials({
      host: '10.0.0.1',
      user: 'deploy',
      keyFilePath: FIXTURE_KEY,
      passphrase: Buffer.from('phase-4-pass'),
    })

    const stored = _getWizardCredentialBuffersForTest()
    expect(stored).not.toBeNull()
    const keyRef = stored!.privateKey
    const passRef = stored!.passphrase!

    clearWizardVmCredentials()

    expect(isZeroFilled(keyRef)).toBe(true)
    expect(isZeroFilled(passRef)).toBe(true)
    expect(_getWizardCredentialBuffersForTest()).toBeNull()
  })
})
