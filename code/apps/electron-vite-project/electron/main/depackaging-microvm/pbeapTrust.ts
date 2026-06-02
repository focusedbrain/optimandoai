/**
 * pBEAP trust classification — Build 1, §5 (folds in the Spike §2 signature gap).
 *
 * SPIKE FINDING: the main email path base64-decodes pBEAP and never verifies the
 * Ed25519 `signature` defined by the protocol. There is no "verified sender"
 * badge in the UI, so the exposure is BOUNDED (not phishing-grade) — but the
 * path was SILENTLY TRUSTING unverified content. This module ends the silent
 * trust by forcing an explicit, recorded decision.
 *
 * TRUST MODEL (the important part):
 *   A signature that verifies under a key the SENDER THEMSELVES supplied proves
 *   nothing about identity — anyone can self-sign. Authentication requires
 *   BINDING the sender to a key established out-of-band: a known handshake
 *   counterparty. Therefore:
 *
 *     • verified_bound  — sender_fingerprint matches a known handshake
 *                         counterparty AND the signature verifies under THAT
 *                         counterparty's stored public key.
 *     • unverified_public — everything else (no handshake, no/invalid signature,
 *                         or signature only self-consistent). Email pBEAP can
 *                         arrive from strangers; this is the honest default and
 *                         MUST be surfaced to the trust/UI layer as NOT
 *                         authenticated — never rendered as a verified sender.
 *
 * The exact canonical signing-bytes computation is owned by the sender
 * (extension Gate 5 / `beapCrypto.computeSigningData`). It is INJECTED here so
 * this module does not fork that canonicalization; integration wires the real
 * one. The classification logic — and the refusal to silently trust — lives here.
 */

import { ed25519 } from '@noble/curves/ed25519'

export type PbeapTrustLevel = 'verified_bound' | 'unverified_public'

export interface PbeapTrustResult {
  level: PbeapTrustLevel
  /** Counterparty handshake id when bound; null for unverified public content. */
  boundHandshakeId: string | null
  reason: string
}

/** Minimal view of a pBEAP header relevant to trust. */
export interface PbeapHeaderView {
  sender_fingerprint?: string | null
  /** Detached Ed25519 signature, base64. */
  signature_b64?: string | null
}

/** A known handshake counterparty we could bind a sender to. */
export interface KnownCounterparty {
  handshakeId: string
  /** Counterparty fingerprint as computed by the protocol (must match header). */
  fingerprint: string
  /** Counterparty Ed25519 public key, raw bytes (32). */
  ed25519PublicKey: Uint8Array
}

export interface ClassifyPbeapArgs {
  header: PbeapHeaderView
  /** Known handshake counterparties to attempt binding against. */
  knownCounterparties: readonly KnownCounterparty[]
  /**
   * Canonical bytes the signature is computed over. Supplied by the caller using
   * the authoritative sender canonicalization (extension Gate 5). If the caller
   * cannot compute it, pass null → result is `unverified_public`.
   */
  signingBytes: Uint8Array | null
}

/**
 * Classify a pBEAP message's trust level. NEVER returns `verified_bound` unless
 * the sender is bound to a known counterparty key AND the signature verifies.
 */
export function classifyPbeapTrust(args: ClassifyPbeapArgs): PbeapTrustResult {
  const fp = args.header.sender_fingerprint
  const sig = args.header.signature_b64
  const unverified = (reason: string): PbeapTrustResult => ({
    level: 'unverified_public',
    boundHandshakeId: null,
    reason,
  })

  if (!fp || typeof fp !== 'string') return unverified('no_sender_fingerprint')
  if (!sig || typeof sig !== 'string') return unverified('no_signature')
  if (!args.signingBytes) return unverified('signing_bytes_unavailable')

  const match = args.knownCounterparties.find((c) => c.fingerprint === fp)
  if (!match) return unverified('no_handshake_for_fingerprint')

  let verified = false
  try {
    verified = ed25519.verify(
      new Uint8Array(Buffer.from(sig, 'base64')),
      args.signingBytes,
      match.ed25519PublicKey,
    )
  } catch {
    verified = false
  }

  if (!verified) return unverified('signature_did_not_verify_under_counterparty_key')

  return {
    level: 'verified_bound',
    boundHandshakeId: match.handshakeId,
    reason: 'bound_to_known_counterparty',
  }
}
