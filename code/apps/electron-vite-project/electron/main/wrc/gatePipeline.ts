/**
 * §XVI.7.6 pre-delivery security boundary — the six-gate resolution pipeline.
 *
 * Authority: Annex XVI v1.95 (`docs/spec/Annex_XVI_WR_Code_v1.95.pdf`,
 * SHA256 064AAD6D…829F), §XVI.7.6. This module is the ONE resolution pipeline:
 * every capture surface (manual entry, e-mail detection, clipboard/selection)
 * exits into `runWrCodeGatePipeline`, and nothing downstream may present a
 * reference as resolvable without an admission produced here.
 *
 * The order IS the contract, and it is not caller-configurable:
 *
 *   Gate 1  Syntax            — Run-1 grammar module, no second parser
 *   Gate 2  Namespace         — every Publisher Identifier in the reference
 *   Gate 3  Entry             — designated entry exists, in an admitting state
 *   Gate 4  Self-match        — the reference is addressed to THIS receiver
 *   Gate 5  Relay release     — recipient-bound release (+ §XVI.8.4 claim)
 *   Gate 6  Capsule admission — before anything reaches a trusted surface
 *
 * Each gate is a hard stop: the first failure terminates the run with the
 * gate number and a precise reason, and `gatesPassed` is strictly the prefix
 * before the failing gate — there is no way to observe a later gate's verdict
 * past an earlier failure. Per §XVI.7.6, a failure is reported as a capture,
 * verification, or delivery failure — never as a request.
 *
 * External verification legs (directory, resolver, relay) enter through
 * {@link WrCodeGateDeps}. The deps interface is written against the DIRECTORY
 * MODEL of §XVI.6.4/6.5, not against the interim Phase-3 registry client, so
 * the later swap to a full Namespace Directory is internal to the adapter
 * (`gatePipelineAdapter.ts`). Everything the pipeline can decide locally —
 * gate ordering, status evaluation, self-match, the P15 link scan — is decided
 * HERE, where no dependency injection can skip it.
 */

import {
  captureWrCodeReference,
  type WrCodeCaptureFailureReason,
  type WrCodeReference,
} from '@repo/ingestion-core'
import {
  evaluateEntryLifecycleForRequest,
  type WrEntryLifecycleStatus,
} from './entryLifecycle'
import {
  deriveEntryDesignator,
  type WrCodeDesignationClaim,
  type WrCodeDesignationFailureReason,
  type WrCodeEntryDesignator,
} from './entryDesignator'
import type { WrcEntry, WrcEntryStatus, WrcEvp, WrcPublisherStatus, WrcSuspension } from './wrcContract'

// ── Gate identity ─────────────────────────────────────────────────────────────

export type WrCodeGateNumber = 1 | 2 | 3 | 4 | 5 | 6

export type WrCodeGateName =
  | 'syntax'
  | 'namespace'
  | 'entry'
  | 'self_match'
  | 'relay_release'
  | 'capsule_admission'

/** §XVI.7.6 — the normative order. Exported so fixtures can pin it. */
export const WR_CODE_GATE_ORDER: readonly WrCodeGateName[] = [
  'syntax',
  'namespace',
  'entry',
  'self_match',
  'relay_release',
  'capsule_admission',
]

// ── Reason vocabulary ─────────────────────────────────────────────────────────
//
// Codes the annex names literally (NOT_FOR_YOU, NOT_FOR_THIS_DEVICE,
// CLAIMED_BY_OTHER, CONSUMED, CONTEXT_EXHAUSTED) keep the annex's casing;
// everything else is a lowercase repo code. One flat union so a status surface
// can switch over it exhaustively.

export type WrCodeGateReason =
  // Gate 1 — the Run-1 grammar module's own failure vocabulary, verbatim
  // (empty | unknown_prefix | wrong_length | out_of_alphabet | check_failed).
  | WrCodeCaptureFailureReason
  // Gate 2 — namespace verification.
  | 'namespace_unknown_identifier'
  | 'namespace_unverified'
  | 'namespace_inactive'
  | 'namespace_revoked'
  | 'namespace_superseded'
  | 'namespace_compromised'
  // Gate 2 — §XVI.6.5 email-domain agreement (Run 4): the receiver's own
  // acting principal's SSO email must lie in its own publisher's DNS-verified
  // domain, "otherwise it cannot claim on the publisher's behalf".
  | 'sso_principal_mismatch'
  // Gate 3 — entry verification. The lifecycle vocabulary is the §XVI.8.1/8.3
  // model in `entryLifecycle.ts`; the catalog-precise pair (suspended/retired)
  // stays distinct because the status surface renders the publisher's own
  // §XVII.3.2 statement, not the model's normalization of it.
  | 'entry_unknown'
  | 'entry_unverified'
  | 'entry_verification_unavailable'
  | 'entry_suspended'
  | 'entry_retired'
  | 'entry_platform_suspended'
  | 'entry_inactive'
  | 'entry_revoked'
  | 'entry_superseded'
  | 'entry_compromised'
  | 'entry_declined'
  | 'entry_withdrawn'
  | 'entry_expired'
  | 'entry_not_admitting'
  | 'CONSUMED'
  | 'CLAIMED_BY_OTHER'
  | 'CONTEXT_EXHAUSTED'
  // Gate 3 — Run-3 canonical designation vocabulary (§XVI.5.10): the pure
  // derivation reasons plus the network-leg parent resolution failure.
  | WrCodeDesignationFailureReason
  | 'unresolved_parent'
  // Gate 3 — §XVI.5.7 SE session window (Run 4). An SE past expiry is the
  // existing `entry_expired` (the annex's own word: "afterwards it is
  // EXPIRED"); a session that has not started is its own state.
  | 'session_not_yet_valid'
  // Gate 4 — self-match.
  | 'NOT_FOR_YOU'
  | 'NOT_FOR_THIS_DEVICE'
  | 'self_match_unavailable'
  // Gate 4 — §XVI.13.7 device trust (Run 4): a device-bound reference whose
  // registration chain (tenant Device Record / Device Pass) does not verify.
  // The precise leg (wrong establishment, stale generation, expired pass, …)
  // rides in `detail` from the deviceRegistry vocabulary.
  | 'device_binding_unverified'
  // Gate 5 — recipient-bound release.
  | 'release_refused'
  | 'relay_unavailable'
  | 'claim_failed'
  // Gate 6 — capsule admission.
  | 'admission_embedded_link'
  | 'admission_refused'

// ── Directory-model shapes (deps contract) ────────────────────────────────────

/**
 * What Gate 2 requires of a namespace answer, phrased against the Namespace
 * Directory Record of §XVI.6.4/6.5: dual signature (operator + publisher),
 * ACTIVE status, verified account holder, and a valid DNS entry under the
 * publisher's domain naming this Publisher Identifier. The interim adapter
 * fills these legs from the Phase-3 chain; the pipeline only ever reads THIS
 * shape, so swapping the anchor never touches gate logic.
 */
export interface WrCodeNamespaceRecord {
  publisher_part: string
  /** DNS-verified domain naming this Publisher Identifier. */
  domain: string
  status: WrcPublisherStatus
  /** Operator + publisher provenance both verified (interim: DNS-pinned root + ingest countersign chain). */
  dual_signature_verified: boolean
  dns_verified: boolean
  /**
   * §XVI.6.4 verified-account-holder attestation. The interim anchor cannot
   * attest this separately from the verification chain; the adapter sets it
   * from chain success. TODO(§XVI.6.4/6.5): read the directory attestation.
   */
  account_holder_verified: boolean
  /** Superseded namespaces surface their successor explicitly, never silently. */
  successor_publisher_part: string | null
}

export type WrCodeNamespaceVerdict =
  | { ok: true; record: WrCodeNamespaceRecord }
  | {
      ok: false
      /** Uniform unknown-identifier (§XVI.4.2) is a capture error, not a status. */
      reason: 'namespace_unknown_identifier' | 'namespace_unverified'
      detail?: string
    }

/**
 * §XVI.8.4 use-limit posture of an entry, read (never written) by Gate 3 and
 * acted on by Gate 5. Absent means unbounded — the default of §XVI.8.4.
 */
export interface WrCodeUseLimitPosture {
  state: 'active' | 'claimed' | 'consumed' | 'exhausted'
  /** Set when `state` is `claimed`: who holds the reservation. */
  claimed_by: string | null
}

/** What Gate 3 requires the resolver leg to have verified about the entry. */
export interface WrCodeEntryMaterial {
  entry_id: string
  /** Publisher-signed catalog status (§XVII.3.2 vocabulary). */
  catalog_status: WrcEntryStatus
  /** Platform-side suspension from the envelope; never merged into the above. */
  suspension: WrcSuspension | null
  /** Whether this entry is an invitation (admits PENDING) or an offering (admits ACTIVE). */
  kind: 'offering' | 'invitation'
  /**
   * §XVI.8.1/8.3 lifecycle state as declared by the resolver or the local
   * lifecycle store, when one is declared. Null means the catalog status and
   * the §XVI.8.4 posture below are the only state carriers (interim default).
   */
  lifecycle: WrEntryLifecycleStatus | null
  /**
   * Recipient binding, when the entry is not a public offering: who the entry
   * is addressed to and at which granularity (§XVI.7.6 Gate 4). Null for
   * public entries. Interim entries carry no binding; the field exists so the
   * self-match gate is already written against the full model.
   */
  recipient_binding: {
    granularity: 'principal' | 'device'
    party_id: string
  } | null
  /** §XVI.8.4 posture, when the entry is use-limited. Null = unbounded. */
  use_limit: WrCodeUseLimitPosture | null
  /** Superseded entries surface their successor explicitly (§XVI.8.1). */
  successor_entry_id: string | null
  /**
   * §XVI.5.7 SE session binding (Run 4): the resolver-declared session
   * identity and time window. MANDATORY for SE — the pipeline refuses an SE
   * without one — and meaningless (null) for durable classes. Session state
   * is distinct from entry lifecycle AND from §XVI.8.4 use states; nothing
   * merges them.
   */
  session: { id: string; not_before: number | null; expires_at: number } | null
  /**
   * §XVI.5.10 designation CLAIM as the resolver stated it (Run 3): the
   * registered pair for C, the combination expansion for I/S*. The pipeline —
   * never the deps, never a caller — derives the canonical designator from
   * this claim inside Gate 3; the claim itself is data, not identity.
   */
  designation: WrCodeDesignationClaim | null
  entry: WrcEntry | null
  evp: WrcEvp | null
}

export type WrCodeEntryVerdict =
  | { ok: true; material: WrCodeEntryMaterial }
  | {
      ok: false
      reason:
        | 'entry_unknown'
        | 'entry_unverified'
        | 'entry_verification_unavailable'
        // Run 3 (§XVI.5.10): the entry constituent must resolve to an entry
        // binding "under a currently governing parent" — a parent that does
        // not resolve, or is not in a governing state, refuses here.
        | 'unresolved_parent'
      detail?: string
    }

/** The receiver's own identity material, for Gates 2 (SSO binding) and 4. */
export interface WrCodeReceiverIdentity {
  /** Own current Publisher Identifier, when acting for a publisher (C self-match). */
  publisher_part?: string | null
  /** Principal-level Party Identifier. */
  party_id?: string | null
  /** Device-Scoped Principal Identifier. */
  device_party_id?: string | null
  /**
   * §XVI.6.5 SSO Identity: the ONE verified email address of the acting
   * principal. When present together with `publisher_part`, Gate 2 verifies
   * the email-domain agreement (Run 4); when absent, the receiver asserts no
   * acting-for-publisher binding, and any Gate-5 claim that would need one
   * fails its own delegation leg instead.
   */
  sso_email?: string | null
}

/**
 * What Gate 5 hands to Gate 6: the verified pre-consent material for public
 * offerings, and/or the relay-released capsule ("ciphertext plus signed
 * envelope", §XVI.7.6 Gate 5) for recipient-bound entries. Sealed fields in
 * the capsule stay sealed until Gate 6 opens them.
 */
export interface WrCodeReleasedMaterial {
  evp: WrcEvp | null
  capsule: Record<string, unknown> | null
}

export type WrCodeReleaseVerdict =
  | { ok: true; released: WrCodeReleasedMaterial }
  | {
      ok: false
      reason:
        | 'release_refused'
        | 'relay_unavailable'
        | 'CLAIMED_BY_OTHER'
        | 'CONSUMED'
        | 'CONTEXT_EXHAUSTED'
        | 'claim_failed'
      detail?: string
    }

export type WrCodeAdmissionVerdict =
  | { ok: true }
  | { ok: false; reason: 'admission_refused'; detail?: string }

export interface WrCodeGateDeps {
  /**
   * Gate 2 — one call per Publisher Identifier in the reference. Fail-closed:
   * any verification failure is a refusal, never a downgraded pass.
   */
  verifyNamespace(publisherPart: string): Promise<WrCodeNamespaceVerdict>
  /**
   * Gate 3 — verify the entry the reference designates: local block for P,
   * ordered pair for C, expanded combination for sub-handshake classes
   * (§XVI.5.10). Returns verified material only; no pre-consent payload.
   */
  verifyEntry(
    reference: WrCodeReference,
    namespaces: readonly WrCodeNamespaceRecord[],
  ): Promise<WrCodeEntryVerdict>
  /**
   * Gate 5 — recipient-bound release. For use-limited entries this is where
   * the §XVI.8.4 compare-and-set claim fires (successful passage through
   * Gate 5 moves the entry to CLAIMED); a losing claimant gets
   * CLAIMED_BY_OTHER and no material.
   */
  releaseMaterial(input: {
    reference: WrCodeReference
    material: WrCodeEntryMaterial
    /** The PIPELINE-derived canonical designator — the only claim/state key. */
    designator: WrCodeEntryDesignator
    receiver: WrCodeReceiverIdentity
    requestInstanceId: string | null
  }): Promise<WrCodeReleaseVerdict>
  /**
   * Gate 6 seam — capsule-level admission checks that need state the pipeline
   * does not own (capsule signature, nonce_I, party bindings, replay by
   * request_instance_id). The non-delegable P15 link scan runs in the
   * pipeline BEFORE this is consulted. TODO(§XVI.7.6 Gate 6): attach the BEAP
   * capsule verification chain here when the capsule path lands.
   */
  admitCapsule(input: {
    reference: WrCodeReference
    material: WrCodeEntryMaterial
    released: WrCodeReleasedMaterial
    receiver: WrCodeReceiverIdentity
    requestInstanceId: string | null
  }): Promise<WrCodeAdmissionVerdict>
  /**
   * §XVI.8.4 posture read for Gate 3, keyed by the PIPELINE-derived canonical
   * designator (Run 3). Optional: absent means the deps keep no use-limit
   * state; a stubbed `material.use_limit` remains the fixture-side carrier.
   */
  useLimitPosture?(designator: WrCodeEntryDesignator): WrCodeUseLimitPosture | null
  /**
   * Gate 2, Run 4 (§XVI.6.5 email-domain agreement): verify that the
   * receiver's SSO-verified email lies in its own publisher's DNS-verified
   * domain. Consulted only when the receiver presents an SSO email together
   * with a publisher part; a receiver that presents one and cannot be
   * verified refuses at Gate 2 — including when the deps cannot verify at
   * all (fail closed, never a downgraded pass).
   */
  verifyActingPrincipal?(
    receiver: WrCodeReceiverIdentity,
  ): Promise<{ ok: true } | { ok: false; detail?: string }>
  /**
   * Clock for the pipeline's own time checks (§XVI.5.7 SE session window).
   * Optional; wall clock by default. Injected by the adapter so gate and
   * store time never disagree in tests.
   */
  now?(): number
  /**
   * Gate 4, Run 4 (§XVI.13.7): the authoritative device-registration
   * substrate behind a DEVICE-granularity receiving party. Consulted only
   * after the local self-match already succeeded — i.e. this IS the bound
   * device — to prove the binding chain itself: the tenant Device Record for
   * an SI device selection, the Device Pass (Registered Counterpart Device)
   * for a device-bound SC. A device-bound reference with NO substrate fails
   * closed: per the annex, a Device Pass is the ONLY route by which an
   * organization's device becomes addressable outside its own tenant.
   */
  verifyDeviceBinding?(input: {
    reference: WrCodeReference
    designator: WrCodeEntryDesignator
    receiver: WrCodeReceiverIdentity
  }): Promise<{ ok: true } | { ok: false; detail?: string }>
  /**
   * Called when a gate AFTER a successful Gate-5 claim fails, so the §XVI.8.4
   * reservation reverts to ACTIVE — a failed verification never consumes a
   * use. Optional because only claim-capable deps have anything to revert.
   */
  releaseClaim?(input: {
    reference: WrCodeReference
    designator: WrCodeEntryDesignator
    receiver: WrCodeReceiverIdentity
  }): void
}

// ── Pipeline input / outcome ──────────────────────────────────────────────────

export interface WrCodeGateInput {
  /** The submitted candidate, exactly as captured. Submission is the caller's explicit act (§XVI.5.8). */
  raw: string
  /** The receiver's identity material for self-match and release. */
  receiver?: WrCodeReceiverIdentity
  /** Idempotency handle for Gate 6 replay detection (§XVI.7.6, §XVI.8.4). */
  requestInstanceId?: string | null
}

export interface WrCodeGateRefusal {
  ok: false
  gate: WrCodeGateNumber
  gateName: WrCodeGateName
  reason: WrCodeGateReason
  detail?: string
  /**
   * §XVI.4.2 / §XVI.7.6 — true when the refusal is reported on the
   * capture-error path (typos, unknown identifiers) rather than as a status
   * surface about a real object.
   */
  captureError: boolean
  /** Strictly the gates that PASSED before the failing one. */
  gatesPassed: WrCodeGateName[]
  /** Superseded namespace/entry surfaces its successor; never a silent redirect (§XVI.8.1). */
  successorPublisherPart?: string | null
  successorEntryId?: string | null
  /** Compromised → unsuppressible warning class, distinct from the reason line. */
  unsuppressibleWarning?: boolean
}

export interface WrCodeGateAdmission {
  ok: true
  reference: WrCodeReference
  /** One verified record per Publisher Identifier, in reference order. */
  namespaces: WrCodeNamespaceRecord[]
  material: WrCodeEntryMaterial
  /** Canonical entry designator, derived inside Gate 3 (Run 3, §XVI.5.10). */
  designator: WrCodeEntryDesignator
  released: WrCodeReleasedMaterial
  /** Always all six, in normative order — pinned by fixtures. */
  gatesPassed: WrCodeGateName[]
}

export type WrCodeGateOutcome = WrCodeGateAdmission | WrCodeGateRefusal

// ── Gate 4 (local, non-delegable) ─────────────────────────────────────────────

/**
 * §XVI.7.6 Gate 4 — self-match. Pure and local: the pipeline owns it so no
 * deps object can weaken it. Exported for direct fixture coverage.
 */
export function evaluateSelfMatch(
  reference: WrCodeReference,
  material: WrCodeEntryMaterial,
  receiver: WrCodeReceiverIdentity,
  designator?: WrCodeEntryDesignator | null,
):
  | { ok: true }
  | { ok: false; reason: 'NOT_FOR_YOU' | 'NOT_FOR_THIS_DEVICE' | 'self_match_unavailable'; detail?: string } {
  // C — the second block must be the receiver's own current Publisher
  // Identifier, seen directly in the code (§XVI.7.6 Gate 4).
  if (reference.cls === 'C') {
    if (!receiver.publisher_part) {
      return {
        ok: false,
        reason: 'NOT_FOR_YOU',
        detail: 'receiver has no publisher identifier to match the counterparty block',
      }
    }
    return reference.counterparty === receiver.publisher_part
      ? { ok: true }
      : { ok: false, reason: 'NOT_FOR_YOU' }
  }

  // I and sub-handshake classes — the receiving-party constituent of the
  // expanded combination code must be the receiver, at the granularity the
  // issuer bound (§XVI.5.10, §XVI.7.6 Gate 4). Run 3: the constituent arrives
  // on the canonical designator the pipeline derived in Gate 3.
  if (reference.cls !== 'P') {
    const rp = designator?.receiving_party ?? null
    if (!rp) {
      // No verified expansion — never guess.
      return {
        ok: false,
        reason: 'self_match_unavailable',
        detail: `no verified receiving-party constituent for class ${reference.cls}`,
      }
    }
    switch (rp.kind) {
      case 'publisher':
        return receiver.publisher_part === rp.id ? { ok: true } : { ok: false, reason: 'NOT_FOR_YOU' }
      case 'principal':
        return receiver.party_id === rp.id ? { ok: true } : { ok: false, reason: 'NOT_FOR_YOU' }
      case 'device': {
        // Bound to one Device-Scoped Principal Identifier: only that device.
        if (receiver.device_party_id === rp.id) return { ok: true }
        // Another device of the same principal is told so, distinctly
        // (NOT_FOR_THIS_DEVICE, a refinement of NOT_FOR_YOU — §XVI.5.10).
        return receiver.party_id && rp.id.startsWith(`${receiver.party_id}:`)
          ? { ok: false, reason: 'NOT_FOR_THIS_DEVICE' }
          : { ok: false, reason: 'NOT_FOR_YOU' }
      }
    }
  }

  // P — recipient-bound offerings match the receiver's Party Identifier at the
  // granularity the issuer bound; unbound P offerings are public.
  const binding = material.recipient_binding
  if (!binding) return { ok: true }
  if (binding.granularity === 'principal') {
    return receiver.party_id === binding.party_id
      ? { ok: true }
      : { ok: false, reason: 'NOT_FOR_YOU' }
  }
  // Device granularity: this device's Device-Scoped Principal Identifier only.
  if (receiver.device_party_id === binding.party_id) return { ok: true }
  // Another device of the same principal is told so, distinctly (§XVI.7.6).
  return receiver.party_id && binding.party_id.startsWith(`${receiver.party_id}:`)
    ? { ok: false, reason: 'NOT_FOR_THIS_DEVICE' }
    : { ok: false, reason: 'NOT_FOR_YOU' }
}

// ── Gate 6 link scan (local, non-delegable) ───────────────────────────────────

const EMBEDDED_LINK = /(?:https?:\/\/|www\.)/i

/**
 * §XVI.7.6 Gate 6 / P15 — no field of admitted material may reference a link,
 * an external resource, or an unregistered carrier. Scans every human-visible
 * string of the released material. Exported for fixtures.
 */
export function findEmbeddedLink(material: WrCodeEntryMaterial, evp: WrcEvp | null): string | null {
  const texts: string[] = []
  if (material.entry) {
    texts.push(material.entry.display.name, material.entry.display.value_statement)
  }
  if (evp) {
    texts.push(evp.self_description, evp.value_statement, ...evp.next_steps)
    for (const item of evp.scope_directory) texts.push(item.name, item.desc)
  }
  for (const t of texts) if (EMBEDDED_LINK.test(t)) return t
  return null
}

// ── The pipeline ──────────────────────────────────────────────────────────────

/**
 * Run the six gates of §XVI.7.6, in order, fail-closed. Never throws: a deps
 * exception is a refusal of the gate that consulted it.
 */
export async function runWrCodeGatePipeline(
  input: WrCodeGateInput,
  deps: WrCodeGateDeps,
): Promise<WrCodeGateOutcome> {
  const gatesPassed: WrCodeGateName[] = []
  const receiver = input.receiver ?? {}
  const requestInstanceId = input.requestInstanceId ?? null

  const refuse = (
    gate: WrCodeGateNumber,
    reason: WrCodeGateReason,
    extra?: Partial<Omit<WrCodeGateRefusal, 'ok' | 'gate' | 'gateName' | 'reason' | 'gatesPassed'>>,
  ): WrCodeGateRefusal => ({
    ok: false,
    gate,
    gateName: WR_CODE_GATE_ORDER[gate - 1]!,
    reason,
    captureError: false,
    gatesPassed: [...gatesPassed],
    ...extra,
  })

  // ── Gate 1 — local syntax and submission (offline; the Run-1 grammar) ──────
  const captured = captureWrCodeReference(input.raw)
  if (!captured.ok) {
    // Typos, OCR/speech errors, malformed or unknown classes: capture-error
    // path, per the §XVI.7.6 gate table.
    return refuse(1, captured.reason, { captureError: true })
  }
  const reference = captured
  gatesPassed.push('syntax')

  // ── Gate 2 — namespace verification, every Publisher Identifier ────────────
  // One for P, I, and sub-handshake classes; both for class C (§XVI.7.6).
  const publisherParts: string[] =
    reference.cls === 'C' && reference.counterparty
      ? [reference.publisher, reference.counterparty]
      : [reference.publisher]

  const namespaces: WrCodeNamespaceRecord[] = []
  for (const part of publisherParts) {
    let verdict: WrCodeNamespaceVerdict
    try {
      verdict = await deps.verifyNamespace(part)
    } catch (e) {
      verdict = {
        ok: false,
        reason: 'namespace_unverified',
        detail: e instanceof Error ? e.message : String(e),
      }
    }
    if (!verdict.ok) {
      return refuse(2, verdict.reason, {
        detail: verdict.detail,
        // §XVI.4.2 uniform 404 → capture-error path, never a status surface.
        captureError: verdict.reason === 'namespace_unknown_identifier',
      })
    }
    const rec = verdict.record
    // Fail-closed on every directory leg, not only on status.
    if (!rec.dual_signature_verified || !rec.dns_verified || !rec.account_holder_verified) {
      return refuse(2, 'namespace_unverified', {
        detail: `directory legs: dual_sig=${rec.dual_signature_verified} dns=${rec.dns_verified} account=${rec.account_holder_verified}`,
      })
    }
    if (rec.status !== 'active') {
      const reason: WrCodeGateReason =
        rec.status === 'inactive'
          ? 'namespace_inactive'
          : rec.status === 'revoked'
            ? 'namespace_revoked'
            : rec.status === 'superseded'
              ? 'namespace_superseded'
              : 'namespace_compromised'
      return refuse(2, reason, {
        detail: `publisher ${rec.publisher_part}`,
        successorPublisherPart: rec.status === 'superseded' ? rec.successor_publisher_part : undefined,
        unsuppressibleWarning: rec.status === 'compromised' || undefined,
      })
    }
    namespaces.push(rec)
  }

  // §XVI.7.6 Gate 2, Run 4 — the receiver's own acting-principal SSO binding.
  // Fires when the receiver claims to act for a publisher AND presents its
  // SSO email; fail-closed when the claim is presented but unverifiable.
  if (receiver.publisher_part && receiver.sso_email) {
    if (!deps.verifyActingPrincipal) {
      return refuse(2, 'sso_principal_mismatch', {
        detail: 'no verifier for the acting principal SSO binding',
      })
    }
    let sso: { ok: true } | { ok: false; detail?: string }
    try {
      sso = await deps.verifyActingPrincipal(receiver)
    } catch (e) {
      sso = { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
    if (!sso.ok) {
      return refuse(2, 'sso_principal_mismatch', { detail: sso.detail })
    }
  }
  gatesPassed.push('namespace')

  // ── Gate 3 — entry verification ─────────────────────────────────────────────
  let entryVerdict: WrCodeEntryVerdict
  try {
    entryVerdict = await deps.verifyEntry(reference, namespaces)
  } catch (e) {
    entryVerdict = {
      ok: false,
      reason: 'entry_unverified',
      detail: e instanceof Error ? e.message : String(e),
    }
  }
  if (!entryVerdict.ok) {
    return refuse(3, entryVerdict.reason, {
      detail: entryVerdict.detail,
      captureError: entryVerdict.reason === 'entry_unknown',
    })
  }
  const material = entryVerdict.material

  // Run 3 (§XVI.5.10/5.11): the canonical designator is derived HERE, inside
  // the trusted boundary, from the parsed reference and the resolver's claim —
  // no dependency injection and no caller-supplied designation can replace it.
  const derived = deriveEntryDesignator(reference, material.designation, material.entry_id)
  if (!derived.ok) {
    return refuse(3, derived.reason, { detail: derived.detail })
  }
  const designator = derived.designator

  // §XVI.5.7 (Run 4) — SE resolves ONLY while its session and expiry are
  // valid. The window is evaluated HERE, inside the pipeline, so no deps
  // implementation can wave an expired session through. Session state stays
  // distinct from entry lifecycle and §XVI.8.4 use states; the annex merges
  // nothing, so neither do we.
  if (reference.cls === 'SE') {
    if (!material.session) {
      return refuse(3, 'designation_mismatch', {
        detail: 'SE requires a session or bounded time window (§XVI.5.7); the resolver declared none',
      })
    }
    const nowS = deps.now?.() ?? Math.floor(Date.now() / 1000)
    if (material.session.not_before !== null && nowS < material.session.not_before) {
      return refuse(3, 'session_not_yet_valid', {
        detail: `session ${material.session.id} starts at ${material.session.not_before}`,
      })
    }
    if (nowS >= material.session.expires_at) {
      // The annex's own word for this state: EXPIRED, identifier never
      // reissued (P11). Not inactive, not revoked, not a use state.
      return refuse(3, 'entry_expired', {
        detail: `SE session ${material.session.id} expired at ${material.session.expires_at}`,
      })
    }
  }

  // §XVI.8.4 posture, keyed by the canonical designator when the deps keep
  // state; a fixture-declared posture on the material is the local fallback.
  const posture = deps.useLimitPosture?.(designator) ?? material.use_limit

  const stateRefusal = evaluateEntryStateForGate3(material, posture, receiver)
  if (stateRefusal) {
    return refuse(3, stateRefusal.reason, {
      detail: stateRefusal.detail,
      successorEntryId: stateRefusal.successorEntryId,
      unsuppressibleWarning: stateRefusal.unsuppressibleWarning,
    })
  }
  gatesPassed.push('entry')

  // ── Gate 4 — self-match (local, non-delegable) ─────────────────────────────
  const selfMatch = evaluateSelfMatch(reference, material, receiver, designator)
  if (!selfMatch.ok) {
    return refuse(4, selfMatch.reason, { detail: selfMatch.detail })
  }

  // Run 4 (§XVI.13.7) — the identifier matched; now the REGISTRATION must.
  // Device-granularity addressing exists only where a tenant Device Record
  // (SI) or a Device Pass (SC) stands behind it, so a device-bound reference
  // is verified against that substrate or refused — no substrate, no pass.
  if (designator.receiving_party?.kind === 'device') {
    if (!deps.verifyDeviceBinding) {
      return refuse(4, 'device_binding_unverified', {
        detail: 'no device-registration substrate is available to prove the binding',
      })
    }
    let bound: { ok: true } | { ok: false; detail?: string }
    try {
      bound = await deps.verifyDeviceBinding({ reference, designator, receiver })
    } catch (e) {
      bound = { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
    if (!bound.ok) {
      return refuse(4, 'device_binding_unverified', { detail: bound.detail })
    }
  }
  gatesPassed.push('self_match')

  // ── Gate 5 — recipient-bound release (+ §XVI.8.4 claim) ────────────────────
  let release: WrCodeReleaseVerdict
  try {
    release = await deps.releaseMaterial({
      reference,
      material,
      designator,
      receiver,
      requestInstanceId,
    })
  } catch (e) {
    release = { ok: false, reason: 'release_refused', detail: e instanceof Error ? e.message : String(e) }
  }
  if (!release.ok) {
    return refuse(5, release.reason, { detail: release.detail })
  }
  gatesPassed.push('relay_release')

  // From here on a §XVI.8.4 claim may be held: any later failure must revert
  // it — a failed verification never consumes a use.
  const revertClaim = () => {
    try {
      deps.releaseClaim?.({ reference, designator, receiver })
    } catch {
      // Reverting is best-effort here; the claim's own timeout is the backstop.
    }
  }

  // ── Gate 6 — capsule admission, before any UI ──────────────────────────────
  // Non-delegable first: P15 — no admitted field may carry a link.
  const link = findEmbeddedLink(material, release.released.evp)
  if (link) {
    revertClaim()
    return refuse(6, 'admission_embedded_link', { detail: link })
  }
  let admission: WrCodeAdmissionVerdict
  try {
    admission = await deps.admitCapsule({
      reference,
      material,
      released: release.released,
      receiver,
      requestInstanceId,
    })
  } catch (e) {
    admission = { ok: false, reason: 'admission_refused', detail: e instanceof Error ? e.message : String(e) }
  }
  if (!admission.ok) {
    revertClaim()
    return refuse(6, admission.reason, { detail: admission.detail })
  }
  gatesPassed.push('capsule_admission')

  return {
    ok: true,
    reference,
    namespaces,
    material,
    designator,
    released: release.released,
    gatesPassed: [...gatesPassed],
  }
}

// ── Gate 3 state evaluation ───────────────────────────────────────────────────

interface Gate3StateRefusal {
  reason: WrCodeGateReason
  detail?: string
  successorEntryId?: string | null
  unsuppressibleWarning?: boolean
}

/**
 * The one identity a §XVI.8.4 claim is held under. Device-scoped when the
 * receiver has one, else principal, else the acting publisher part. Exported
 * so the claim store and the pipeline can never disagree about who "you" are.
 */
export function claimantIdOf(receiver: WrCodeReceiverIdentity): string | null {
  return receiver.device_party_id ?? receiver.party_id ?? receiver.publisher_part ?? null
}

/**
 * §XVI.7.6 Gate 3 — "in a state that admits a request (PENDING for an
 * invitation; ACTIVE for an offering)", layered exactly as the status model
 * keeps them: platform suspension first (closest to the object), then the
 * publisher-signed catalog status IN ITS OWN VOCABULARY, then the §XVI.8.1/8.4
 * lifecycle model of `entryLifecycle.ts` — which is where CLAIMED / CONSUMED /
 * EXHAUSTED, the invitation states, and the successor of a superseded entry
 * are decided.
 */
function evaluateEntryStateForGate3(
  material: WrCodeEntryMaterial,
  posture: WrCodeUseLimitPosture | null,
  receiver: WrCodeReceiverIdentity,
): Gate3StateRefusal | null {
  if (material.suspension) {
    return {
      reason: 'entry_platform_suspended',
      detail: material.suspension.reason_code,
    }
  }
  // The catalog-precise pair keeps the publisher's own statement distinct
  // (`entryLifecycleFromCatalogStatus` maps them to inactive/revoked for
  // model-level consumers).
  if (material.catalog_status === 'suspended') return { reason: 'entry_suspended' }
  if (material.catalog_status === 'retired') return { reason: 'entry_retired' }

  // Effective lifecycle: an explicit resolver/store declaration wins; a
  // §XVI.8.4 posture overlays the catalog's implicit ACTIVE; default active.
  const lifecycle: WrEntryLifecycleStatus =
    material.lifecycle ?? (posture && posture.state !== 'active' ? posture.state : 'active')

  const admission = evaluateEntryLifecycleForRequest({
    lifecycle,
    kind: material.kind,
    claimedBy: posture?.claimed_by ?? null,
    selfClaimant: claimantIdOf(receiver),
    successorEntryId: material.successor_entry_id,
  })
  if (admission.admits) return null
  return {
    reason: admission.reason,
    detail: admission.detail,
    successorEntryId: admission.successorEntryId,
    unsuppressibleWarning: admission.unsuppressibleWarning,
  }
}
