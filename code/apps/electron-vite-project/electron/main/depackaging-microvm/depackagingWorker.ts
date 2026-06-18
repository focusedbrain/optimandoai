/**
 * Depackaging worker — the payload that runs INSIDE the ephemeral guest.
 *
 * This is the heart of Build 1's security core. It is pure (node `crypto` +
 * the reused quarantine primitive) so it is portable into the crosvm golden
 * image AND unit-testable on the dev box. It performs, in isolation:
 *
 *   1. Parse untrusted bytes (bounded MIME extraction).
 *   2. TEXT-PURITY: positive-construct a closed `SafeTextV1` from ONLY the
 *      permitted plain-text fields; discard the original parsed structure.
 *   3. BLIND-COURIER custody: per-artifact, encrypt the original bytes TO the
 *      sandbox's X25519 public key via the proven `encryptForQuarantine`
 *      primitive (ephemeral key + HKDF-SHA256 + AES-256-GCM). The per-artifact
 *      DEK is generated in-guest and is recoverable ONLY by the holder of the
 *      sandbox `local_x25519_private_key_b64`. Plaintext never leaves the guest.
 *   4. Sign the result so the orchestrator can verify transport integrity.
 *
 * The orchestrator that later receives the result has NO decrypt capability —
 * it never sees plaintext and never holds the sandbox private key.
 *
 * REUSE, DO NOT REINVENT: custody is `encryptForQuarantine` verbatim — the same
 * audited primitive that is live in `messageRouter.ts`. We add no new crypto.
 */

import { randomUUID } from 'crypto'
import { ed25519 } from '@noble/curves/ed25519'
import { encryptForQuarantine } from '../quarantine-encrypt/index'
import type { QuarantineBlobFile } from '../quarantine-blob-storage/index'
import { extractMime } from './mimeExtract'
import { constructSafeText, type SafeTextV1 } from './safeText'
import { signJobResult, type JobResult, type JobSpec } from './hypervisorProvider'
import { applyStage1Validation } from './stage1Validation'
import type { StageAttestation } from './stageAttestation'

/** An original artifact, encrypted so only the sandbox can ever open it. */
export interface BlobArtifact {
  readonly blob_id: string
  /** MIME type recorded for routing only; the bytes are opaque ciphertext. */
  readonly content_type: string
  readonly filename?: string
  /** Opaque ciphertext blob (X25519+HKDF+AES-GCM to the sandbox pubkey). */
  readonly blob: QuarantineBlobFile
}

export interface DepackagingOutput {
  readonly safeText: SafeTextV1
  readonly artifacts: readonly BlobArtifact[]
  readonly stage_attestation?: StageAttestation
}

/**
 * Core depackaging logic (guest-side). Returns safe-text + encrypted artifacts.
 * Throws only on unrecoverable internal error; malformed input fails CLOSED
 * (whole input becomes one opaque artifact, empty text) — never as text.
 */
export function depackage(inputBytes: Buffer, sandboxPeerX25519PubB64: string): DepackagingOutput {
  let subjectRaw = ''
  let plainTextBodyRaw = ''
  const rawArtifacts: { contentType: string; filename?: string; bytes: Buffer }[] = []

  try {
    const mime = extractMime(inputBytes)
    subjectRaw = mime.subject
    plainTextBodyRaw = mime.plainTextParts.join('\n\n')
    for (const part of mime.artifactParts) {
      rawArtifacts.push({ contentType: part.contentType, filename: part.filename, bytes: part.bytes })
    }
  } catch {
    // Fail closed: opaque, no text.
    subjectRaw = ''
    plainTextBodyRaw = ''
    rawArtifacts.length = 0
    rawArtifacts.push({ contentType: 'application/octet-stream', bytes: Buffer.from(inputBytes) })
  }

  const artifacts: BlobArtifact[] = []
  for (const ra of rawArtifacts) {
    const enc = encryptForQuarantine(ra.bytes, sandboxPeerX25519PubB64)
    // Zeroize the plaintext copy as soon as it is sealed (defense-in-depth).
    try {
      ra.bytes.fill(0)
    } catch {
      /* best effort */
    }
    if (!enc.ok) {
      // A key/encoding failure must NOT silently drop the artifact or leak it as
      // text. Surface by throwing — the job fails and emits no partial result.
      throw new Error(`artifact custody failed: ${enc.error}`)
    }
    artifacts.push({
      blob_id: randomUUID(),
      content_type: ra.contentType,
      filename: ra.filename,
      blob: enc.blob,
    })
  }

  const rawSafeText = constructSafeText({
    subjectRaw,
    plainTextBodyRaw,
    attachmentBlobIds: artifacts.map((a) => a.blob_id),
  })

  const { paddedSafeText, attestation } = applyStage1Validation(rawSafeText)

  return { safeText: paddedSafeText, artifacts, stage_attestation: attestation }
}

/**
 * Full job entry point as the guest would run it: depackage, then sign the
 * result with an Ed25519 key. Returns a `JobResult` ready to hand back to the
 * orchestrator over the provider transport.
 *
 * @param hostSigningKey  When the host provisions a per-boot signing key (VM-
 *   identity-bound attestation), the guest uses it instead of self-generating.
 *   This proves to the host that the result came from the VM it booted: only
 *   that VM possesses the host-provisioned key. When absent (in-process
 *   executor, tests without provenance), a fresh random key is generated
 *   (backward-compatible — proves transport integrity only).
 */
export function runDepackagingJob(spec: JobSpec, hostSigningKey?: Uint8Array): JobResult {
  try {
    const { safeText, artifacts, stage_attestation } = depackage(spec.inputBytes, spec.sandboxPeerX25519PubB64)
    const base = { jobId: spec.jobId, ok: true as const, safeText, artifacts, stage_attestation }
    const selfGenerated = !hostSigningKey
    const signingPriv = hostSigningKey ?? ed25519.utils.randomPrivateKey()
    const sig = signJobResult(base, signingPriv)
    if (selfGenerated) signingPriv.fill(0)
    else try { hostSigningKey!.fill(0) } catch { /* host key may be non-writable in tests */ }
    return { ...base, ...sig }
  } catch (err: unknown) {
    return {
      jobId: spec.jobId,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
