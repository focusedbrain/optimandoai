/**
 * Live-path pBEAP trust adapter (Build 2b — safe cutover slice).
 *
 * The live receive path used to base64-decode pBEAP and record a passive
 * `trust_note` — i.e. it SILENTLY trusted unverified public content. This adapter
 * ends that: every pBEAP message gets an explicit, persisted trust decision via
 * Build-1's `classifyPbeapTrust`. It NEVER claims `verified_bound` unless the
 * sender is bound to a known handshake counterparty AND the signature verifies.
 *
 * DEFERRED (honest current state): the sender's canonical signing-bytes
 * computation (extension Gate 5) is not yet mirrored in the main process, so
 * callers pass `signingBytes: null` today and the result is `unverified_public`
 * with a precise reason. Wiring the real canonicalization later makes
 * `verified_bound` reachable WITHOUT changing how call sites record the result.
 *
 * No verified-sender badge exists in the UI, so the exposure is bounded — but the
 * live path now stops blind-trusting, which is the point.
 */

import { classifyPbeapTrust, type PbeapTrustResult, type KnownCounterparty } from './pbeapTrust'

export interface LivePbeapTrustInput {
  /** The parsed BEAP package's `header` object (untrusted, may be anything). */
  header: unknown
  /** Known handshake counterparties to bind against; empty => cannot bind. */
  knownCounterparties?: readonly KnownCounterparty[]
  /** Canonical signing-bytes; null today (Gate-5 canonicalization deferred). */
  signingBytes?: Uint8Array | null
}

export function classifyLivePbeapTrust(input: LivePbeapTrustInput): PbeapTrustResult {
  const h = (input.header && typeof input.header === 'object' ? input.header : {}) as Record<string, unknown>
  return classifyPbeapTrust({
    header: {
      sender_fingerprint: typeof h.sender_fingerprint === 'string' ? h.sender_fingerprint : null,
      signature_b64:
        typeof h.signature_b64 === 'string'
          ? h.signature_b64
          : typeof h.signature === 'string'
            ? h.signature
            : null,
    },
    knownCounterparties: input.knownCounterparties ?? [],
    signingBytes: input.signingBytes ?? null,
  })
}

/** Structured, persistable record of the pBEAP trust decision (replaces the
 *  silent trust_note). Folded into the row's depackaged metadata. */
export function pbeapTrustMetadata(result: PbeapTrustResult): {
  pbeap_trust: { level: PbeapTrustResult['level']; reason: string; bound_handshake_id: string | null }
} {
  return {
    pbeap_trust: {
      level: result.level,
      reason: result.reason,
      bound_handshake_id: result.boundHandshakeId,
    },
  }
}
