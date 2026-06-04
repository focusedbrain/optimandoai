/**
 * Critical-Job Routing Seam — shared types (Build A, Deliverable 1).
 *
 * The seam is the abstraction by which a *critical job* ("depackage this",
 * "validate this depackaged email", "validate this native BEAP", "open this
 * link", "view this attachment") resolves — by pure configuration — to one of
 * three executors: in-process, isolation microVM, or (later) remote-over-
 * handshake. This module owns the envelope (spec + result), the kind vocabulary,
 * the error codes, and the role/executor identifiers.
 *
 * ── NAMING (decided; do not conflate) ──────────────────────────────────────
 *   - The crosvm per-action VM subsystem (`electron/main/depackaging-microvm/`)
 *     is the *isolation microVM*. The seam reaches it via `MicroVMExecutor` /
 *     the `SandboxHypervisorProvider` interface. New seam code never calls it
 *     "sandbox".
 *   - `electron/main/sandbox/` is the unrelated *content-review sub-orchestrator*
 *     (Distribution Gate → queue → forked worker). It is NOT touched by the seam;
 *     only its `SandboxTask` constraints vocabulary (network/filesystem/time
 *     limit) informed the `limits`/`flush` fields below.
 *   - `sandbox` remains valid as a product *role* name (workstation | sandbox |
 *     appliance).
 *
 * ── INVARIANTS encoded here ────────────────────────────────────────────────
 *   INV-2 (seal-key custody): `CriticalJobSpec` has NO field able to carry
 *     vault-derived key material (validator seal key, application keys). Outputs
 *     carry validated content + the existing result signature only; HMAC sealing
 *     stays host-side on the consuming orchestrator (`validatorOrchestrator`),
 *     never inside a microVM guest or on a remote node.
 *   INV-5 (no plaintext in logs): error `code`s are stable identifiers and never
 *     embed job input bytes, decrypted JSON, safe-text, or artifacts.
 *
 * This build is entirely flag-gated and is NOT called from the live email path.
 */

import type { JobKind } from '../depackaging-microvm/hypervisorProvider'
import type { SafeTextV1 } from '../depackaging-microvm/safeText'
import type { CourierArtifactRecord } from '../depackaging-microvm/blindCourier'
import type {
  ValidateRequest,
  ValidateResponse,
  ValidationResult,
  CandidateCapsuleEnvelope,
} from '@repo/ingestion-core'

/**
 * The critical-job vocabulary. This is the SAME literal union as the microVM
 * `JobKind` (generalized from the original single literal `'depackaging'` in
 * Build A); re-aliased here as the seam's public name. Keeping it a single
 * source prevents the two from drifting.
 */
export type CriticalJobKind = JobKind

/** Product role. Drives the in-process rule (INV-1) via the resolution table. */
export type Role = 'workstation' | 'sandbox' | 'appliance'

/** Coarse entitlement tier (pro/publisher/enterprise all map to 'paid'). */
export type Tier = 'free' | 'paid'

/** Which executor handled (or would handle) a job. */
export type ExecutorId = 'in-process' | 'microvm' | 'remote-handshake'

/** Reset granularity contract, identical across executors. */
export type FlushMode = 'per-action' | 'per-vm' | 'session'

// ── Per-kind input / output maps ───────────────────────────────────────────

/** Final, post-verification depackage output the orchestrator may persist. */
export interface DepackageOutput {
  readonly safeText: SafeTextV1
  readonly artifacts: readonly CourierArtifactRecord[]
}

/**
 * Placeholder verdict for link-opening / attachment-viewing. No executor
 * produces this in Build A (both kinds are unsupported here); the shape exists
 * so the envelope is total over all kinds.
 */
export interface RenderVerdict {
  readonly safe: boolean
  readonly reason?: string
}

export interface JobInputMap {
  /** Raw untrusted bytes (email MIME / attachment). Opaque to the orchestrator. */
  'depackage': { readonly inputBytes: Buffer }
  /**
   * Exactly what the existing validator subprocess accepts. Carries no seal key
   * (INV-2): `plaintext_or_encrypted` holds either already-decrypted content or
   * opaque ciphertext + a handshake *identifier* — never vault key material.
   */
  'validate-depackaged': Omit<ValidateRequest, 'request_id'>
  /** A native wire BEAP candidate envelope for structural validation. */
  'validate-native-beap': { readonly candidate: CandidateCapsuleEnvelope }
  /** A URL to evaluate/open in isolation (unsupported in Build A). */
  'open-link': { readonly url: string }
  /** An opaque sealed-artifact handle to render in isolation (unsupported in Build A). */
  'view-attachment': { readonly artifactRef: string }
}

export interface JobOutputMap {
  'depackage': DepackageOutput
  'validate-depackaged': ValidateResponse
  'validate-native-beap': ValidationResult
  'open-link': RenderVerdict
  'view-attachment': RenderVerdict
}

// ── Envelope ───────────────────────────────────────────────────────────────

export interface JobLimits {
  /** Hard wall-clock ceiling. Enforced by the dispatcher AND any executor. */
  readonly maxWallClockMs: number
  /** Optional input-size ceiling. */
  readonly maxInputBytes?: number
}

/**
 * Immutable description of one critical job. Identical across all executors.
 *
 * INV-2: there is deliberately NO field for seal/application/vault keys.
 * `custodyPubKeyB64` is a PUBLIC X25519 key (the sealing target for depackage /
 * view-attachment outputs); it grants no decryption capability.
 */
export interface CriticalJobSpec<K extends CriticalJobKind = CriticalJobKind> {
  readonly jobId: string
  readonly kind: K
  readonly input: JobInputMap[K]
  /** PUBLIC X25519 key to which outputs are sealed. Never a private/seal key. */
  readonly custodyPubKeyB64?: string
  readonly limits: JobLimits
  readonly flush: FlushMode
}

/** Diagnostic metadata (INV-5: identifiers + counters only, never plaintext). */
export interface ResultMeta {
  /** `'none'` when dispatch failed before any executor was chosen. */
  readonly executorId: ExecutorId | 'none'
  readonly flushed: FlushMode | 'none'
  readonly durationMs: number
}

export interface CriticalJobResult<K extends CriticalJobKind = CriticalJobKind> {
  readonly jobId: string
  readonly ok: boolean
  readonly output?: JobOutputMap[K]
  /** Stable error identifier + non-sensitive message (INV-5). */
  readonly error?: { readonly code: CriticalJobErrorCode; readonly message: string }
  /** Transport-integrity proof from the guest/worker (depackage only). */
  readonly result_signing_pub_b64?: string
  readonly result_signature_b64?: string
  readonly meta?: ResultMeta
}

// ── Errors ─────────────────────────────────────────────────────────────────

export type CriticalJobErrorCode =
  | 'E_ROLE_FORBIDDEN' // INV-1: in-process attempted under role=workstation
  | 'E_UNSUPPORTED_KIND' // resolved executor does not support this kind
  | 'E_EXECUTOR_UNAVAILABLE' // resolved executor isAvailable() === false
  | 'E_NO_EXECUTOR' // no rule resolved and no fallback (INV-3 fail-closed)
  | 'E_TIMEOUT' // dispatcher-level wall-clock exceeded
  | 'E_SIGNATURE_INVALID' // result signature failed verification
  | 'E_SAFETEXT_REJECTED' // safe-text failed closed-schema re-validation
  | 'E_EXECUTION_ERROR' // executor threw / job failed internally
  | 'E_INVALID_TABLE' // resolution table violates INV-1/INV-3

/** Typed error so callers can branch on `code` without string matching. */
export class CriticalJobError extends Error {
  constructor(
    readonly code: CriticalJobErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'CriticalJobError'
  }
}

/** Kinds whose output is depackage-style and MUST pass `verify.ts` (signature + safe-text). */
export const SAFE_TEXT_OUTPUT_KINDS: ReadonlySet<CriticalJobKind> = new Set<CriticalJobKind>([
  'depackage',
])
