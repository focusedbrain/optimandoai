/**
 * SSH host key TOFU verification — P4.5.13.
 *
 * Trust-on-first-use: the first connect to a host:port pins the observed host key.
 * A MITM during that first session would pin the attacker's key — an inherent TOFU
 * limitation (documented here; not surfaced in wizard copy per product decision).
 */

import { createHash } from 'node:crypto'

import { utils } from 'ssh2'

import {
  getStoredFingerprint,
  storeFingerprint,
  touchVerifiedFingerprint,
  formatFingerprintForDisplay,
} from './hostKeyStore.js'
import { emitSshHostKeyFirstSeen } from './hostKeyEvents.js'

export class HostKeyMismatchError extends Error {
  readonly code = 'HOST_KEY_MISMATCH' as const

  constructor(
    public readonly host: string,
    public readonly port: number,
    public readonly keyType: string,
    public readonly storedFingerprint: string,
    public readonly observedFingerprint: string,
  ) {
    super(`SSH host key changed for ${host}:${port}`)
    this.name = 'HostKeyMismatchError'
  }
}

export interface HostKeyMismatchPayload {
  readonly code: 'HOST_KEY_MISMATCH'
  readonly host: string
  readonly port: number
  readonly key_type: string
  readonly stored_fingerprint: string
  readonly observed_fingerprint: string
  readonly stored_fingerprint_display: string
  readonly observed_fingerprint_display: string
  readonly message: string
}

export function fingerprintSha256Hex(hostKey: Buffer): string {
  return createHash('sha256').update(hostKey).digest('hex')
}

export function hostKeyTypeFromBytes(hostKey: Buffer): string {
  const parsed = utils.parseKey(hostKey)
  if (parsed instanceof Error || !parsed) {
    return 'unknown'
  }
  const key = Array.isArray(parsed) ? parsed[0] : parsed
  return key?.type ?? 'unknown'
}

/**
 * Returns true when the host key should be accepted.
 * Throws HostKeyMismatchError when a stored pin exists and does not match.
 */
export function assertHostKeyTrusted(input: {
  host: string
  port: number
  hostKey: Buffer
}): boolean {
  const observed = fingerprintSha256Hex(input.hostKey)
  const keyType = hostKeyTypeFromBytes(input.hostKey)
  const stored = getStoredFingerprint(input.host, input.port)

  if (!stored) {
    storeFingerprint(input.host, input.port, keyType, observed)
    emitSshHostKeyFirstSeen({
      host: input.host,
      port: input.port,
      key_type: keyType,
      fingerprint_sha256: observed,
    })
    return true
  }

  if (stored.fingerprint_sha256.toLowerCase() !== observed.toLowerCase()) {
    throw new HostKeyMismatchError(
      input.host,
      input.port,
      keyType,
      stored.fingerprint_sha256,
      observed,
    )
  }

  touchVerifiedFingerprint(input.host, input.port)
  return true
}

export function toHostKeyMismatchPayload(err: HostKeyMismatchError): HostKeyMismatchPayload {
  return {
    code: 'HOST_KEY_MISMATCH',
    host: err.host,
    port: err.port,
    key_type: err.keyType,
    stored_fingerprint: err.storedFingerprint,
    observed_fingerprint: err.observedFingerprint,
    stored_fingerprint_display: formatFingerprintForDisplay(err.storedFingerprint),
    observed_fingerprint_display: formatFingerprintForDisplay(err.observedFingerprint),
    message: err.message,
  }
}

export function isHostKeyMismatchError(err: unknown): err is HostKeyMismatchError {
  return err instanceof HostKeyMismatchError
}
