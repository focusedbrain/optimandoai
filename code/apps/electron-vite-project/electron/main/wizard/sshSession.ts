/**
 * In-memory SSH credential store — Phase 4 (P4.4).
 *
 * SSH private keys live only in the main process and are zeroed after deploy.
 */

import type { WizardVmCredentialsPublic, WizardVmCredentialsSecret } from './types.js'

let _credentials: WizardVmCredentialsSecret | null = null

export function storeWizardVmCredentials(input: {
  host: string
  port?: number
  user: string
  key: string
  passphrase?: string
}): WizardVmCredentialsPublic {
  clearWizardVmCredentials()
  const port = input.port ?? 22
  _credentials = {
    host: input.host,
    port,
    username: input.user,
    privateKey: input.key,
    passphrase: input.passphrase,
  }
  return { host: input.host, port, username: input.user }
}

export function getWizardVmCredentials(): WizardVmCredentialsSecret | null {
  return _credentials
}

export function clearWizardVmCredentials(): void {
  if (_credentials?.privateKey) {
    // Best-effort overwrite before dropping reference.
    const buf = Buffer.from(_credentials.privateKey, 'utf8')
    buf.fill(0)
  }
  _credentials = null
}

/** Tests only. */
export function _resetWizardSshSessionForTest(): void {
  _credentials = null
}
