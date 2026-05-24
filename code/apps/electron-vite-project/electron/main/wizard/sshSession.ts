/**
 * In-memory SSH credential store — Phase 4 (P4.4).
 *
 * SSH private keys live only in the main process as Buffers and are zeroed on clear.
 */

import { registerCredentialClearer, zeroizeBuffer } from '../security/zeroize.js'
import type { WizardVmCredentialsPublic, WizardVmCredentialsSecret } from './types.js'

let _credentials: WizardVmCredentialsSecret | null = null

registerCredentialClearer(() => clearWizardVmCredentials())

export function storeWizardVmCredentials(input: {
  host: string
  port?: number
  user: string
  privateKey: Buffer
  passphrase?: Buffer
}): WizardVmCredentialsPublic {
  clearWizardVmCredentials()
  const port = input.port ?? 22
  _credentials = {
    host: input.host,
    port,
    username: input.user,
    privateKey: input.privateKey,
    passphrase: input.passphrase,
  }
  return { host: input.host, port, username: input.user }
}

export function getWizardVmCredentials(): WizardVmCredentialsSecret | null {
  return _credentials
}

export function clearWizardVmCredentials(): void {
  if (_credentials) {
    zeroizeBuffer(_credentials.privateKey)
    zeroizeBuffer(_credentials.passphrase)
  }
  _credentials = null
}

/** Tests only — inspect internal buffers without stringifying secrets. */
export function _getWizardCredentialBuffersForTest(): {
  privateKey: Buffer
  passphrase?: Buffer
} | null {
  if (!_credentials) return null
  return {
    privateKey: _credentials.privateKey,
    passphrase: _credentials.passphrase,
  }
}

/** Tests only. */
export function _resetWizardSshSessionForTest(): void {
  clearWizardVmCredentials()
}
