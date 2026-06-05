/**
 * SandboxHypervisorProvider — Build 1 (Layered Sandbox security core).
 *
 * Abstraction over an ephemeral, isolated execution backend that runs a single
 * depackaging job and is then destroyed ("create → run → nuke"). Defined now so
 * later builds can add Hyper-V / VirtualBox backends WITHOUT reshaping callers;
 * Build 1 ships ONLY the crosvm/Linux backend (`CrosvmProvider`).
 *
 * INVARIANT CONTEXT (do not regress):
 *   - The provider runs the depackaging worker (allowlist text construction +
 *     per-artifact encryption) INSIDE the isolated guest. Raw untrusted bytes go
 *     in; only `JobResult` (safe-text JSON + opaque blob ciphertext + a result
 *     signature) comes out. The host orchestrator never parses the raw bytes and
 *     never holds blob decryption keys.
 *   - The job VM has DEFAULT-DENY egress: a depackaging job needs no network
 *     (bytes are handed in). Backends MUST enforce zero outbound network.
 *
 * This file is transport/lifecycle-agnostic types only — no crosvm specifics.
 */

import { ed25519 } from '@noble/curves/ed25519'
import { createHash } from 'crypto'
import type { SafeTextV1 } from './safeText'
import type { BlobArtifact } from './depackagingWorker'

/**
 * What kind of isolated critical job to run. This is the shared critical-job
 * vocabulary (see `electron/main/critical-jobs/types.ts`, where it is re-exported
 * as `CriticalJobKind` with per-pipeline annotations). Generalized from the
 * original single literal `'depackaging'` (Build A) and refined by Amendment 1.
 *
 * The crosvm microVM backend currently *executes* only `'depackage'`.
 * `'decrypt-qbeap'` is RESERVED and unimplemented in B1: it is a key-requiring
 * native-BEAP-pipeline job whose most-isolated venue is a *local* zero-egress
 * per-action microVM (INV-6 key-locality); it never routes to a key-less node.
 */
export type JobKind =
  | 'depackage'
  | 'validate-decrypted-beap'
  | 'validate-native-beap'
  | 'decrypt-qbeap'
  | 'open-link'
  | 'view-attachment'

/**
 * Immutable description of one isolated job. The `inputBytes` are the untrusted
 * payload (e.g. raw email MIME / attachment bytes) — they are handed INTO the
 * guest and must never be parsed by the orchestrator.
 */
export interface JobSpec {
  readonly jobId: string
  readonly kind: JobKind
  /** Untrusted bytes to depackage. Opaque to the orchestrator. */
  readonly inputBytes: Buffer
  /**
   * The paired sandbox's `peer_x25519_public_key_b64` (PUBLIC key only).
   * Artifacts are encrypted TO this key inside the guest; only the holder of the
   * matching `local_x25519_private_key_b64` (the sandbox) can later decrypt.
   * The orchestrator passing this in never gains decrypt capability.
   */
  readonly sandboxPeerX25519PubB64: string
  /** Hard resource ceilings enforced by the backend. */
  readonly limits?: JobLimits
}

export interface JobLimits {
  readonly maxWallClockMs?: number
  readonly maxInputBytes?: number
}

/**
 * Result emitted by the guest. Contains ONLY safe-text + opaque ciphertext +
 * a detached signature over the canonical result. Never raw bytes, never keys.
 */
export interface JobResult {
  readonly jobId: string
  readonly ok: boolean
  readonly safeText?: SafeTextV1
  readonly artifacts?: readonly BlobArtifact[]
  /**
   * Ed25519 public key (base64) the guest used to sign this result, plus the
   * detached signature over `canonicalJobResultBytes`. Build 1 wires the
   * mechanism; binding this key to a *genuine* attested VM identity is a
   * later (attestation) build — see "what's NOT done".
   */
  readonly result_signing_pub_b64?: string
  readonly result_signature_b64?: string
  readonly error?: string
}

export interface SandboxHypervisorProvider {
  /** Stable id for logs/diagnostics (e.g. 'crosvm'). */
  readonly backendId: string
  /** True if this backend can run on the current host (platform/binaries present). */
  isAvailable(): Promise<boolean>
  /**
   * Run a single job in a fresh isolated guest, collect the signed result, then
   * destroy the guest and discard its writable overlay. MUST leave nothing
   * behind. MUST enforce default-deny egress for the job VM.
   */
  runJob(spec: JobSpec): Promise<JobResult>
}

// ── Canonical result bytes + signing (mechanism; attestation deferred) ──────────

/**
 * Deterministic byte serialization of the security-relevant result fields.
 * The guest signs these; the orchestrator verifies before trusting the result.
 * Excludes the signature fields themselves.
 */
export function canonicalJobResultBytes(r: Pick<JobResult, 'jobId' | 'ok' | 'safeText' | 'artifacts'>): Buffer {
  const artifactDigest = (r.artifacts ?? []).map((a) => ({
    blob_id: a.blob_id,
    content_type: a.content_type,
    // Hash of the ciphertext — proves the result commits to exact blob bytes
    // without embedding them.
    ciphertext_sha256: createHash('sha256').update(a.blob.ciphertext_b64, 'utf8').digest('hex'),
  }))
  const canonical = {
    jobId: r.jobId,
    ok: r.ok,
    safeText: r.safeText ?? null,
    artifacts: artifactDigest,
  }
  return Buffer.from(JSON.stringify(canonical), 'utf8')
}

/** Sign a result with a per-job Ed25519 key (guest-side). */
export function signJobResult(
  base: Pick<JobResult, 'jobId' | 'ok' | 'safeText' | 'artifacts'>,
  signingPrivKey: Uint8Array,
): { result_signing_pub_b64: string; result_signature_b64: string } {
  const msg = canonicalJobResultBytes(base)
  const sig = ed25519.sign(msg, signingPrivKey)
  const pub = ed25519.getPublicKey(signingPrivKey)
  return {
    result_signing_pub_b64: Buffer.from(pub).toString('base64'),
    result_signature_b64: Buffer.from(sig).toString('base64'),
  }
}

/**
 * Verify a job-result signature (orchestrator-side). Returns true only if the
 * detached signature matches the canonical bytes under the embedded public key.
 *
 * NOTE: this proves *integrity of transport* (the result wasn't mutated after
 * signing) but NOT *identity* — binding `result_signing_pub_b64` to a genuine,
 * attested job VM is deferred to the attestation build. Until then the
 * orchestrator MUST still re-validate `safeText` against the closed schema
 * (`validateSafeText`) and treat the signer key as untrusted-by-default.
 */
export function verifyJobResultSignature(r: JobResult): boolean {
  if (!r.result_signature_b64 || !r.result_signing_pub_b64) return false
  try {
    const msg = canonicalJobResultBytes(r)
    const sig = Buffer.from(r.result_signature_b64, 'base64')
    const pub = Buffer.from(r.result_signing_pub_b64, 'base64')
    return ed25519.verify(new Uint8Array(sig), new Uint8Array(msg), new Uint8Array(pub))
  } catch {
    return false
  }
}
