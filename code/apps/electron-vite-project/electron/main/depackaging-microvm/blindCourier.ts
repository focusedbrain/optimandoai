/**
 * Blind-courier store (orchestrator-side) — Build 1 Invariant 2.
 *
 * The orchestrator stores ONLY: the closed safe-text, and per-artifact
 * { blob_id, content_type, ciphertext }. It holds NO decryption key and exposes
 * NO decrypt/unwrap function. Decryption requires the sandbox
 * `local_x25519_private_key_b64`, which by construction never exists in the
 * orchestrator process.
 *
 * ENFORCEMENT (do not regress):
 *   - This module MUST NOT import `decryptQuarantineBlob`, `decryptQBeapPackage`,
 *     or any X25519 *private* key material.
 *   - The stored record type below CANNOT hold a private key or plaintext.
 *   - `blindCourier.invariant.test.ts` asserts there is no decrypt export here
 *     and that stored records carry only public ciphertext + handles.
 *
 * The orchestrator is a courier: it transports/persists opaque ciphertext to the
 * sandbox, which is the only party that can ever open it.
 */

import type { QuarantineBlobFile } from '../quarantine-blob-storage/index'
import type { JobResult } from './hypervisorProvider'
import type { SafeTextV1 } from './safeText'

/**
 * One stored artifact as the courier holds it. Note the shape: it can express
 * ciphertext and an opaque handle, and NOTHING that could decrypt it.
 */
export interface CourierArtifactRecord {
  readonly blob_id: string
  readonly content_type: string
  readonly filename?: string
  /**
   * The opaque ciphertext blob. `sender_ephemeral_x25519_pub_b64` inside is a
   * PUBLIC key; there is no private key anywhere in this record. The matching
   * private key lives only on the sandbox.
   */
  readonly ciphertext: QuarantineBlobFile
}

export interface CourierRecord {
  readonly safeText: SafeTextV1
  readonly artifacts: readonly CourierArtifactRecord[]
}

/**
 * Project a (already signature- and schema-validated) job result into the
 * courier's storable record. This is a pure projection that strips nothing
 * secret (there is nothing secret to strip) — it simply asserts the shape the
 * orchestrator persists.
 *
 * Callers MUST have already run `verifyJobResultSignature` and `validateSafeText`
 * before persisting; this function does not re-validate (single-responsibility).
 */
export function toCourierRecord(result: JobResult, validatedSafeText: SafeTextV1): CourierRecord {
  const artifacts: CourierArtifactRecord[] = (result.artifacts ?? []).map((a) => ({
    blob_id: a.blob_id,
    content_type: a.content_type,
    filename: a.filename,
    ciphertext: a.blob,
  }))
  return { safeText: validatedSafeText, artifacts }
}
