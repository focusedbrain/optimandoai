/**
 * Pod secrets helpers — Phase 1, P1.8.
 *
 * generatePodAuthSecret  — fresh 32-byte random hex per pod session.
 * deriveSealKeyHex       — HMAC seal key derived from the vault VMK.
 *
 * Both values are ephemeral: generated at pod start and never stored.
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
 * Derive SEAL_KEY_HEX from the vault VMK using HKDF.
 *
 * Returns the hex-encoded key, or null if the vault is locked (VMK not in
 * memory).  The returned Buffer from deriveApplicationKey is zeroized after
 * hex encoding so key material does not linger in the V8 heap.
 *
 * The derived key is byte-identical to what the sealer container expects
 * (standard HMAC-SHA256; no domain separation beyond the HKDF info label).
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
