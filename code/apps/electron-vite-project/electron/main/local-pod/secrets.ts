/**
 * Pod secrets helpers — Phase 1, P1.8.
 *
 * generatePodAuthSecret       — fresh 32-byte random hex per pod session.
 * generateEphemeralSealKeyHex — fresh 32-byte random hex per pod start (pod-internal seal).
 * deriveSealKeyHex            — HMAC seal key derived from the inner vault VMK (optional upgrade path).
 *
 * Ephemeral values are never stored.
 */

import { randomBytes } from 'node:crypto'

/**
 * Application key purpose label for the pod seal key.
 *
 * Must differ from the validator-subprocess label ('validator-seal-key-v1') so
 * the two keys are independent even though they share the same VMK derivation
 * context.  Phase 3 may unify them once the validator subprocess is retired
 * (P1.11).
 */
export const POD_SEAL_KEY_INFO = 'pod-seal-key-v1'

/**
 * Generate a fresh 32-byte random POD_AUTH_SECRET (hex-encoded).
 *
 * This value is the shared inter-container HMAC secret injected into all four
 * pod containers at startup.  A new value is generated every time the pod
 * starts — it is never persisted.
 */
export function generatePodAuthSecret(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Ephemeral SEAL_KEY_HEX for the sealer container at pod start.
 *
 * Pod seals are pod-internal integrity only; the host re-seals inbox content
 * with ledger/validator keys.  A new key is generated every start.
 */
export function generateEphemeralSealKeyHex(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Derive SEAL_KEY_HEX from the inner vault VMK using HKDF.
 *
 * Returns the hex-encoded key, or null if the inner vault is locked (VMK not in
 * memory).  Reserved for a future lazy-sealer upgrade path — default pod startup
 * uses {@link generateEphemeralSealKeyHex} instead.
 */
export function deriveSealKeyHex(
  vault: { deriveApplicationKey(info: string): Buffer | null },
): string | null {
  const key = vault.deriveApplicationKey(POD_SEAL_KEY_INFO)
  if (!key) return null
  const hex = key.toString('hex')
  key.fill(0) // zeroize after conversion — belt-and-suspenders
  return hex
}
