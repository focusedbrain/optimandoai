/**
 * Runtime defense-in-depth for BEAP pod isolation (see SECURITY/ISOLATION.md).
 */

import type { IngestionMode } from '../ingestion/modeResolver.js'

export const ALLOWED_INGESTION_MODES: readonly IngestionMode[] = [
  'EdgeActive',
  'HostPodActive',
  'Blocked',
]

/** Modes that must never exist — CI static gate also forbids these strings in modeResolver. */
export const FORBIDDEN_UNTRUSTED_INGESTION_MODES: readonly string[] = [
  'LegacyInProcess',
  'Legacy_In_Process',
  'InProcessUntrusted',
  'InProcessExternal',
  'HostInProcess',
]

export class SecurityInvariantError extends Error {
  readonly code = 'SECURITY_INVARIANT_VIOLATION'

  constructor(message: string) {
    super(message)
    this.name = 'SecurityInvariantError'
  }
}

export function isAllowedIngestionMode(mode: string): mode is IngestionMode {
  if (FORBIDDEN_UNTRUSTED_INGESTION_MODES.includes(mode)) {
    return false
  }
  return (ALLOWED_INGESTION_MODES as readonly string[]).includes(mode)
}

/** processIncomingInputInProcess is trusted-internal only. */
export function assertTrustedInternalSourceOnly(sourceType: string): void {
  if (sourceType !== 'internal') {
    throw new SecurityInvariantError(
      `processIncomingInputInProcess refused sourceType=${sourceType}; ` +
        'untrusted capsule bytes must use dispatchProcessIncomingInput → pod path',
    )
  }
}

/**
 * External/untrusted dispatch must never run in-process validation or decrypt.
 * Blocked mode holds; active modes use pod HTTP only.
 */
export function assertExternalUntrustedViaPodOnly(mode: string): void {
  if (!isAllowedIngestionMode(mode)) {
    throw new SecurityInvariantError(
      `dispatchProcessIncomingInput refused ingestion mode=${mode}; ` +
        `allowed modes: ${ALLOWED_INGESTION_MODES.join(', ')}`,
    )
  }
}
