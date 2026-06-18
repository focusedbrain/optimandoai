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
import { isWeakEd25519PublicKey } from '../security/ed25519WeakKey'
import type { SafeTextV1 } from './safeText'
import type { BlobArtifact } from './depackagingWorker'
// Type-only (erased at compile → no runtime cycle): `emailDepackage` imports the
// runtime signing helpers below, so the value-level dependency is one-directional.
import type { DepackageEmailResult } from './emailDepackage'

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
  | 'depackage-email'
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
  /**
   * `depackage-email` only: which guest parser to run on the opaque bytes — a
   * ROUTING discriminator, not an orchestrator parse. `'rfc822'` (default) runs
   * the bounded MIME parser; `'provider-structured-json'` runs the D4 walker.
   * Ignored for the B1 `depackage` kind.
   */
  readonly inputForm?: 'rfc822' | 'provider-structured-json'
  /** `depackage-email` structured-json only: schema adapter (default `'outlook'`). */
  readonly provider?: string
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

/**
 * Result of a `depackage-email` job (B2). Unlike `JobResult` (the B1 depackage
 * shape), the worker emits a typed UNION (`plain | beap-carrier | mixed`) or a
 * typed failure. The guest signs the result (transport integrity) exactly as the
 * B1 worker does — the orchestrator still RE-VALIDATES every safe-text against
 * the closed schema (`validateSafeText`) before trusting it.
 */
export interface DepackageEmailJobResult {
  readonly jobId: string
  readonly kind: 'depackage-email'
  /** The worker's typed verdict: success union OR `{ok:false, code}` failure. */
  readonly result: DepackageEmailResult
  readonly result_signing_pub_b64?: string
  readonly result_signature_b64?: string
  /** Transport/parse-level failure (the job did not produce a signed verdict). */
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
   *
   * Returns the B1 `JobResult` for `kind:'depackage'`, or the B2
   * `DepackageEmailJobResult` for `kind:'depackage-email'`. (A plain
   * `Promise<JobResult>` is assignable to this union, so existing depackage-only
   * providers/fakes need no change.)
   */
  runJob(spec: JobSpec): Promise<JobResult | DepackageEmailJobResult>
}

// ── Canonical result bytes + signing (mechanism; attestation deferred) ──────────

/**
 * Deterministic byte serialization of the security-relevant result fields.
 * The guest signs these; the orchestrator verifies before trusting the result.
 * Excludes the signature fields themselves.
 */
export function canonicalJobResultBytes(
  r: Pick<JobResult, 'jobId' | 'ok' | 'safeText' | 'artifacts'>,
): Buffer {
  const artifactDigest = (r.artifacts ?? []).map((a) => ({
    blob_id: a.blob_id,
    content_type: a.content_type,
    ciphertext_sha256: createHash('sha256').update(a.blob.ciphertext_b64, 'utf8').digest('hex'),
  }))
  const canonical: Record<string, unknown> = {
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
 * When `expectedPubB64` is provided (VM-identity-bound attestation), the
 * result's `result_signing_pub_b64` MUST match it — proving the result was
 * signed by the host-provisioned key, not a self-generated one. This closes the
 * provenance gap: only a VM the host booted possesses the host-provisioned key.
 *
 * When `expectedPubB64` is absent, this proves transport integrity only (the
 * result wasn't mutated after signing). The orchestrator MUST still re-validate
 * `safeText` against the closed schema (`validateSafeText`).
 */
export function verifyJobResultSignature(
  r: JobResult,
  expectedPubB64?: string,
): boolean {
  if (!r.result_signature_b64 || !r.result_signing_pub_b64) return false
  if (expectedPubB64 && r.result_signing_pub_b64 !== expectedPubB64) return false
  try {
    const msg = canonicalJobResultBytes(r)
    const sig = Buffer.from(r.result_signature_b64, 'base64')
    const pub = new Uint8Array(Buffer.from(r.result_signing_pub_b64, 'base64'))
    if (isWeakEd25519PublicKey(pub)) return false
    return ed25519.verify(new Uint8Array(sig), new Uint8Array(msg), pub)
  } catch {
    return false
  }
}

// ── depackage-email result: canonical bytes + signing (B2) ──────────────────
//
// The `depackage-email` worker emits a typed UNION, so its canonical bytes
// commit to every security-relevant field of that union (the variant `type`,
// each safe-text, per-artifact ciphertext digests, per-package byte digests, and
// the display/threading metadata). Bytes are HASHED (never embedded), mirroring
// `canonicalJobResultBytes`. A recursive key-sort makes the serialization
// independent of object key order, so the guest (signing over the constructed
// object) and the host (signing over the JSON-parsed object) agree byte-for-byte.

function stableStringify(value: unknown): string {
  if (value === undefined || value === null || typeof value !== 'object') {
    // Mirror JSON: `undefined` is not representable, collapse to null.
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    // JSON serializes `undefined`/function array slots as null.
    return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  // CRITICAL for guest↔host signature agreement: drop `undefined`-valued keys
  // exactly as `JSON.stringify` does on the wire. The guest signs the in-memory
  // object; the host re-derives these bytes from the JSON-parsed object (which
  // never carried the dropped keys), so both sides MUST omit them identically.
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

/**
 * Deterministic byte serialization of a `depackage-email` result's
 * security-relevant fields (excludes the signature itself). The guest signs
 * these; the orchestrator verifies before trusting transport integrity.
 */
export function canonicalDepackageEmailResultBytes(
  jobId: string,
  result: DepackageEmailResult,
): Buffer {
  let body: Record<string, unknown>
  if (!result.ok) {
    body = { jobId, ok: false, code: result.code }
  } else {
    const artifacts = (result.artifacts ?? []).map((a) => ({
      blob_id: a.blob_id,
      content_type: a.content_type,
      ciphertext_sha256: createHash('sha256').update(a.blob.ciphertext_b64, 'utf8').digest('hex'),
    }))
    const packages = (result.type === 'beap-carrier' || result.type === 'mixed' ? result.packages : []).map(
      (p) => ({
        encodingHint: p.encodingHint,
        source: p.source,
        bytes_sha256: createHash('sha256').update(p.bytesB64, 'utf8').digest('hex'),
      }),
    )
    const safeText = result.type === 'beap-carrier' ? result.carrierSafeText ?? null : result.safeText
    body = {
      jobId,
      ok: true,
      type: result.type,
      safeText,
      artifacts,
      packages,
      displayEnvelope: result.displayEnvelope,
      threadingHints: result.threadingHints,
    }
  }
  return Buffer.from(stableStringify(body), 'utf8')
}

/** Sign a depackage-email result with a per-job Ed25519 key (guest-side). */
export function signDepackageEmailResult(
  jobId: string,
  result: DepackageEmailResult,
  signingPrivKey: Uint8Array,
): { result_signing_pub_b64: string; result_signature_b64: string } {
  const msg = canonicalDepackageEmailResultBytes(jobId, result)
  const sig = ed25519.sign(msg, signingPrivKey)
  const pub = ed25519.getPublicKey(signingPrivKey)
  return {
    result_signing_pub_b64: Buffer.from(pub).toString('base64'),
    result_signature_b64: Buffer.from(sig).toString('base64'),
  }
}

/**
 * Verify a depackage-email result's signature (host-side). Same weak-key
 * rejection and optional `expectedPubB64` provenance check as
 * `verifyJobResultSignature`.
 */
export function verifyDepackageEmailResultSignature(
  r: DepackageEmailJobResult,
  expectedPubB64?: string,
): boolean {
  if (!r.result_signature_b64 || !r.result_signing_pub_b64) return false
  if (expectedPubB64 && r.result_signing_pub_b64 !== expectedPubB64) return false
  try {
    const msg = canonicalDepackageEmailResultBytes(r.jobId, r.result)
    const sig = Buffer.from(r.result_signature_b64, 'base64')
    const pub = new Uint8Array(Buffer.from(r.result_signing_pub_b64, 'base64'))
    if (isWeakEd25519PublicKey(pub)) return false
    return ed25519.verify(new Uint8Array(sig), new Uint8Array(msg), pub)
  } catch {
    return false
  }
}
