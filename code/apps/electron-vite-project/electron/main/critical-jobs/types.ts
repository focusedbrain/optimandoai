/**
 * Critical-Job Routing Seam — shared types (Build A, Deliverable 1;
 * Amendment 1: two-pipeline structure, INV-6, kind rename).
 *
 * The seam is the abstraction by which a *critical job* resolves — by pure
 * configuration — to one of three executors: in-process, isolation microVM, or
 * (later) remote-over-handshake. This module owns the envelope (spec + result),
 * the kind vocabulary, the error codes, and the role/executor identifiers.
 *
 * ── TWO PIPELINES (the governing structure) ────────────────────────────────
 * The seam serves two fully separate pipelines. `detectAndRouteMessage` is the
 * fork point: a provider email is either plain mail (pipeline 1) or a BEAP
 * carrier (pipeline 2). Email is *also* a BEAP transport, which is why one
 * function historically inlined both — but they are distinct:
 *
 *   1. EMAIL / UNTRUSTED-CONTENT pipeline — provider API pulls raw mail →
 *      `depackage` (MIME parse inside the isolation boundary; SafeTextV1 +
 *      sealed original artifacts) → a BEAP capsule is created from the result.
 *      Key-less for content; this is the depackaging unit's / appliance's job.
 *      Kinds: `depackage`, `open-link`, `view-attachment`.
 *
 *   2. NATIVE BEAP pipeline — wire qBEAP/pBEAP packages from counterparties
 *      (over P2P, relay, coordination WS, OR carried inside an email) →
 *      `validate-native-beap` (structural) → qBEAP post-quantum decryption →
 *      decrypted-content validation → seal → insert.
 *      Kinds: `validate-native-beap`, `decrypt-qbeap` (RESERVED, unimplemented),
 *      `validate-decrypted-beap`.
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
 *   INV-2 (key custody, refined): vault-derived *seal* keys never leave the host
 *     process. No key material ever crosses to a *remote* node or the appliance.
 *     `CriticalJobSpec` has NO field able to carry seal/application/vault keys;
 *     outputs carry validated content + the existing result signature only, and
 *     HMAC sealing stays host-side on the consuming orchestrator
 *     (`validatorOrchestrator`). Exception scoped by INV-6: handshake *decryption*
 *     keys MAY be provisioned into a LOCAL zero-egress per-action microVM for
 *     `decrypt-qbeap` (mechanics are a future build — out of B1 scope; the spec
 *     still carries no key field — keys arrive via the job channel, memory-only).
 *   INV-5 (no plaintext in logs): error `code`s are stable identifiers and never
 *     embed job input bytes, decrypted JSON, safe-text, or artifacts.
 *   INV-6 (key-locality): key-requiring jobs execute at the KEY HOLDER. Remote
 *     routing is permitted PRECISELY when it delivers the job TO the key holder;
 *     what is forbidden is any rule that would require key MATERIAL to move. A
 *     key-requiring job never runs on the appliance (content-key-less by design).
 *     The key holder's most-isolated venue is a local, zero-egress, per-action
 *     microVM; in-process inside the sandbox VM is the free-tier floor. Per-kind:
 *       - `decrypt-qbeap` → consumer-local: the handshake private keys are by
 *         definition local to the consuming orchestrator, so ANY remote/appliance
 *         rule would mean shipping keys — forbidden everywhere (planned kind).
 *       - `view-attachment` → custody-holder-local: the artifact custody private
 *         key lives at the sandbox (the depackage-time custody target). A
 *         workstation rule routing it remote-to-sandbox delivers the job TO the
 *         key holder — legal (placement topology (c)); appliance rules are illegal.
 *     The resolution-table validator (`validateResolutionTable`) encodes these.
 *   INV-7 (no risk routing — B2): whenever a step cannot establish its safety
 *     contract (opaque payload unobtainable, guest failure, limits exceeded,
 *     safe-text rejection, ambiguous/partially-matching carrier classification,
 *     fidelity doubt), the message is quarantined (raw/opaque bytes custody-
 *     sealed, typed reason code) or the operation fails closed. There is NEVER a
 *     best-effort inline parse, partial-trust display, or silent downgrade of the
 *     isolation level. Tier/topology change WHERE the boundary sits (in-process-
 *     inside-the-VM vs microVM); they never change WHETHER untrusted structure
 *     crosses into the orchestrator unparsed. The `depackage-email` worker
 *     (`emailDepackage.ts`) emits a typed failure for every such case; the live
 *     adapter (`liveDepackageCutover.ts`) maps each to a quarantine reason.
 *
 * The validation cutover (B1) is flag-gated by WRDESK_SEAM_VALIDATION_CUTOVER;
 * the depackage-email cutover (B2) by WRDESK_SEAM_DEPACKAGE_CUTOVER. Both default
 * OFF — with the flags off, NONE of this is on the live email path.
 */

import type { JobKind } from '../depackaging-microvm/hypervisorProvider'
import type { SafeTextV1 } from '../depackaging-microvm/safeText'
import type { CourierArtifactRecord } from '../depackaging-microvm/blindCourier'
import type { DepackageEmailResult } from '../depackaging-microvm/emailDepackage'
import type {
  ValidateRequest,
  ValidateResponse,
  ValidationResult,
  CandidateCapsuleEnvelope,
} from '@repo/ingestion-core'

/**
 * The critical-job vocabulary, annotated by pipeline. This is the SAME literal
 * union as the microVM `JobKind` (single source — keeps the two from drifting):
 *
 *   Email / untrusted-content pipeline (key-less for content):
 *     - `depackage`         — MIME parse → SafeTextV1 + sealed artifacts.
 *     - `open-link`         — open/evaluate a URL in isolation (unimplemented).
 *     - `view-attachment`   — render a sealed artifact in isolation
 *                             (unimplemented; key-requiring → INV-6-local).
 *
 *   Native BEAP pipeline:
 *     - `validate-native-beap`     — structural validation of a wire candidate.
 *     - `decrypt-qbeap`            — RESERVED, UNIMPLEMENTED in B1. qBEAP
 *                                    post-quantum decryption; key-requiring →
 *                                    INV-6 local-only (local per-action microVM
 *                                    on paid/Linux; in-process sandbox-VM floor
 *                                    on free). `supports()` is false everywhere.
 *     - `validate-decrypted-beap`  — validation of already-decrypted BEAP
 *                                    content (wraps `validateDecryptedBeapContent`).
 */
export type CriticalJobKind = JobKind

/** Which of the two governing pipelines a kind belongs to (Amendment 1). */
export type Pipeline = 'email' | 'native-beap'

/**
 * Key-locality class (INV-6):
 *   - `none`                 → key-less (no decryption/custody key required).
 *   - `consumer-local`       → requires the consuming orchestrator's handshake
 *                              private keys; any remote/appliance rule = shipping
 *                              keys, forbidden everywhere.
 *   - `custody-holder-local` → requires the artifact custody private key (held at
 *                              the sandbox); a rule that delivers the job TO that
 *                              holder is legal, an appliance rule is illegal.
 */
export type KeyLocality = 'none' | 'consumer-local' | 'custody-holder-local'

export interface KindMetadata {
  readonly pipeline: Pipeline
  readonly keyLocality: KeyLocality
}

/** Per-kind pipeline + key-locality, the single source the table validator reads. */
export const KIND_METADATA: Readonly<Record<CriticalJobKind, KindMetadata>> = {
  // Email / untrusted-content pipeline (key-less for content)
  'depackage': { pipeline: 'email', keyLocality: 'none' },
  'depackage-email': { pipeline: 'email', keyLocality: 'none' },
  'open-link': { pipeline: 'email', keyLocality: 'none' },
  'view-attachment': { pipeline: 'email', keyLocality: 'custody-holder-local' },
  // Native BEAP pipeline
  'validate-native-beap': { pipeline: 'native-beap', keyLocality: 'none' },
  'decrypt-qbeap': { pipeline: 'native-beap', keyLocality: 'consumer-local' },
  'validate-decrypted-beap': { pipeline: 'native-beap', keyLocality: 'none' },
}

/**
 * Untrusted-content kinds (email pipeline). `workstation → in-process` is
 * ABSOLUTELY banned for these (INV-1); no rule marker can legalize it.
 */
export const UNTRUSTED_CONTENT_KINDS: ReadonlySet<CriticalJobKind> = new Set<CriticalJobKind>(
  (Object.keys(KIND_METADATA) as CriticalJobKind[]).filter(
    (k) => KIND_METADATA[k].pipeline === 'email',
  ),
)

/**
 * The two implemented validate kinds. `workstation → in-process` is permitted for
 * THESE ONLY, and only via a `transitional: true` rule (INV-1 refinement). This is
 * a deliberate narrow allowlist — it is NOT auto-derived, so a future key-less
 * native-BEAP kind does not silently inherit the workstation in-process exception.
 */
export const TRANSITIONAL_INPROCESS_KINDS: ReadonlySet<CriticalJobKind> =
  new Set<CriticalJobKind>(['validate-decrypted-beap', 'validate-native-beap'])

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
  // ── Email / untrusted-content pipeline ──
  /** Raw untrusted bytes (email MIME / attachment). Opaque to the orchestrator. */
  'depackage': { readonly inputBytes: Buffer }
  /**
   * B2 email cutover: the opaque provider payload (raw RFC822 or, where raw is
   * not faithfully obtainable, the provider-structured-json shipped unparsed).
   * The orchestrator inspects neither (R2). `maxInputBytes` is honored in-guest.
   *
   * `inputForm` tells the guest WHICH parser to run on the opaque bytes — it is a
   * routing discriminator, not a parse of the content. `'rfc822'` (default) runs
   * the bounded MIME parser; `'provider-structured-json'` runs the D4 walker, for
   * which `provider` selects the schema adapter (default `'outlook'`). Both forms
   * converge on the same internal representation inside the guest.
   */
  'depackage-email': {
    readonly inputBytes: Buffer
    readonly maxInputBytes?: number
    readonly inputForm?: 'rfc822' | 'provider-structured-json'
    readonly provider?: string
  }
  /** A URL to evaluate/open in isolation (unsupported in B1). */
  'open-link': { readonly url: string }
  /** An opaque sealed-artifact handle to render in isolation (unsupported in B1). */
  'view-attachment': { readonly artifactRef: string }

  // ── Native BEAP pipeline ──
  /** A native wire BEAP candidate envelope for structural validation. */
  'validate-native-beap': { readonly candidate: CandidateCapsuleEnvelope }
  /**
   * RESERVED, UNIMPLEMENTED (B1). qBEAP package + the handshake *identifier*
   * (not the key). Per INV-6, the actual decryption keys are provisioned to a
   * LOCAL per-action microVM via the job channel (memory-only) in a future
   * build — never carried in this spec (INV-2).
   */
  'decrypt-qbeap': { readonly packageJson: string; readonly handshakeId: string }
  /**
   * Exactly what the existing validator subprocess accepts. Carries no seal key
   * (INV-2): `plaintext_or_encrypted` holds either already-decrypted content or
   * opaque ciphertext + a handshake *identifier* — never vault key material.
   */
  'validate-decrypted-beap': Omit<ValidateRequest, 'request_id'>
}

export interface JobOutputMap {
  // Email / untrusted-content pipeline
  'depackage': DepackageOutput
  /**
   * B2: the typed result union the guest emits (plain | beap-carrier | mixed) OR
   * a typed worker failure (`ok:false` with a `DepackageFailureCode`). A worker
   * failure is a VALID output (the job ran and produced a verdict); the consumer
   * quarantines it. Dispatch-level problems are surfaced via `error` as usual.
   */
  'depackage-email': DepackageEmailResult
  'open-link': RenderVerdict
  'view-attachment': RenderVerdict
  // Native BEAP pipeline
  'validate-native-beap': ValidationResult
  /** RESERVED, UNIMPLEMENTED (B1): the decrypted canonical capsule JSON. */
  'decrypt-qbeap': { readonly canonicalJson: string }
  'validate-decrypted-beap': ValidateResponse
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
  // ── Build C: remote-handshake routing (critical_job_* family) ──────────────
  | 'E_REMOTE_KIND_REFUSED' // receiver's OWN resolution table does not permit the kind
  | 'E_KEY_LOCALITY' // INV-6: key-requiring kind cannot run at this node (consumer-local, or no custody key)
  | 'E_REMOTE_HANDSHAKE_INACTIVE' // no ACTIVE internal handshake / policy gate failed at receiver or sender
  | 'E_REMOTE_LINK_DOWN' // transport unreachable / timed out mid-job
  | 'E_REMOTE_PROTOCOL' // malformed/unparseable wire message (request or response)
  | 'E_REMOTE_PAYLOAD_TOO_LARGE' // request exceeded the receiving-side size cap (rejected at the gate)
  | 'E_REMOTE_REPLAY' // jobId already seen (replay dedupe at the receiving-side gate)

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
