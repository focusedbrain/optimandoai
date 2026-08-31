/**
 * §XVI.7.6 Gate 5 — Recipient-bound release (Relay).
 *
 * Authority: Annex XVI v1.95 (SHA256 064AAD6D…829F), §XVI.7.6 Gate 5 with
 * §XVI.7.5 steps 2/5/9. The normative chain, verbatim:
 *
 *   "The receiver presents a claim signed with its Principal Key and, where
 *    it acts for a publisher, its Delegation Certificate with accept scope.
 *    The Relay releases the capsule only if: the claim signature verifies;
 *    the delegation chains to a directory-registered key of the Publisher
 *    Identifier named as recipient in the capsule (or, for an individual,
 *    the Principal Identifier matches); the capsule is not expired,
 *    withdrawn, or already terminal; and rate and replay limits are
 *    satisfied. The Relay releases ciphertext plus signed envelope; it can
 *    decrypt nothing."
 *
 * That order IS the implementation order, and it is also the enumeration
 * protection: a claimant whose signature or delegation fails learns nothing
 * about whether a capsule exists, is expired, or was withdrawn — those legs
 * are unreachable behind the identity legs. "Release … only to a claim that
 * chains to a Party Identifier named in the capsule, not to mere possession
 * of the reference" (§XVI.7.5.5).
 *
 * The relay holds SEALED capsules: protected fields (nonce_I) are encrypted
 * to the recipient publisher's directory-registered encryption key, so the
 * relay stores and releases what it cannot read. No accessor on the store
 * exposes capsule content except `release` — passing Gate 5 IS the only way
 * relay-controlled material becomes observable.
 *
 * §XVI.7.5.9 idempotency: reprocessing the same claim for the same
 * request_instance_id by the same party returns existing state (a
 * re-release), never a duplicate; a DIFFERENT party replaying a seen
 * request_instance_id is refused as replay.
 */

import { createHash } from 'node:crypto'
import { wrcCanonicalBytes, wrcVerifyEd25519 } from './wrcCrypto'
import type { WrcDirectoryKey } from './namespaceDirectory'

// ── Wire shapes ───────────────────────────────────────────────────────────────

/**
 * §XVI.6.5 Delegation Certificate (minimal normative primitive): the
 * publisher's own directory-registered key signs the binding of a principal
 * (party id + SSO email + the principal's OWN verification key) to a scope
 * set. Verifiers check scope, expiry, and the chain to a directory key —
 * "revoked/out-of-scope delegation = invalid signature".
 */
export interface WrcPrincipalDelegation {
  type: 'wrc/delegation-cert'
  publisher_part: string
  principal_party_id: string
  /** §XVI.6.5 SSO Identity of the delegated principal. */
  sso_email: string
  /** Granted scopes; Gate 5 requires 'accept' (§XVI.7.6). */
  scope: string[]
  /** Raw Ed25519 public key of the delegated Principal Key, base64url. */
  principal_pub: string
  expires_at: number
  /** Publisher directory key that signed this certificate. */
  kid: string
  sig: string
}

/** §XVI.7.6 Gate 5 — the receiver's signed release claim. */
export interface WrcReleaseClaim {
  type: 'wrc/release-claim'
  capsule_id: string
  /** The claiming Party Identifier. */
  party_id: string
  /** Set when acting for a publisher (then a delegation must chain). */
  publisher_part: string | null
  request_instance_id: string
  issued_at: number
  /** Raw Ed25519 public key the claim is signed with. */
  principal_pub: string
  sig: string
}

/** Who the capsule names as recipient (§XVI.7.5.2 Party Binding, relay view). */
export interface WrcRelayRecipient {
  party_id: string
  /** Null for an individual recipient (B2C): no publisher, no delegation. */
  publisher_part: string | null
  /**
   * Fingerprint of the recipient principal's key when the depositor bound
   * one (sha256 hex of the raw public key). Null when the initiator holds
   * only the Party Identifier — then the party match is the normative check.
   */
  principal_key_fingerprint: string | null
}

export type WrcRelayCapsuleStatus = 'available' | 'withdrawn' | 'terminal'

/** What the relay stores per deposited capsule. */
export interface WrcRelayEnvelope {
  type: 'wrc/relay-envelope'
  capsule_id: string
  /** Namespace + canonical entry key the capsule answers (§XVI.7.5.2). */
  publisher_part: string
  entry_key: string
  recipient: WrcRelayRecipient
  expires_at: number
  status: WrcRelayCapsuleStatus
  /**
   * The signed capsule, sealed fields and all. Opaque to the relay: nonce_I
   * inside is encrypted to the recipient's directory-registered encryption
   * key, so holding this grants the relay nothing.
   */
  capsule: Record<string, unknown>
}

// ── Verdicts ──────────────────────────────────────────────────────────────────

export type WrcReleaseLeg =
  | 'claim_malformed'
  | 'claim_sig_invalid'
  | 'delegation_missing'
  | 'delegation_sig_invalid'
  | 'delegation_key_unregistered'
  | 'delegation_scope_missing'
  | 'delegation_expired'
  | 'delegation_principal_mismatch'
  | 'recipient_publisher_mismatch'
  | 'recipient_party_mismatch'
  | 'recipient_key_mismatch'
  | 'capsule_unknown'
  | 'capsule_expired'
  | 'capsule_withdrawn'
  | 'capsule_terminal'
  | 'claim_replayed'
  | 'rate_limited'
  | 'directory_unavailable'

export type WrcRelayReleaseResult =
  | {
      ok: true
      /** "ciphertext plus signed envelope" — capsule content, still sealed. */
      capsule: Record<string, unknown>
      capsuleId: string
    }
  | { ok: false; leg: WrcReleaseLeg; detail?: string }

// ── Helpers ───────────────────────────────────────────────────────────────────

/** sha256 hex over the raw public key bytes (same form the device registry uses). */
export function principalKeyFingerprint(pubB64Url: string): string {
  const raw = Buffer.from(pubB64Url.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  return createHash('sha256').update(raw).digest('hex')
}

function verifyObjectSig(obj: Record<string, unknown>, pub: string): boolean {
  const sig = obj.sig
  if (typeof sig !== 'string' || sig.length === 0) return false
  const { sig: _omit, ...unsigned } = obj
  let bytes: Buffer
  try {
    bytes = wrcCanonicalBytes(unsigned)
  } catch {
    return false
  }
  return wrcVerifyEd25519(bytes, sig, pub)
}

// ── The ordered release chain (pure) ──────────────────────────────────────────

export interface VerifyReleaseInput {
  envelope: WrcRelayEnvelope
  claim: WrcReleaseClaim
  /** Present when the claim acts for a publisher. */
  delegation: WrcPrincipalDelegation | null
  /**
   * Directory-registered keys of the publisher named as RECIPIENT in the
   * capsule — the delegation must chain to one of these (§XVI.7.6 Gate 5).
   * Null when that directory lookup failed (fail-closed leg).
   */
  recipientDirectoryKeys: readonly WrcDirectoryKey[] | null
  nowS: number
}

export type WrcReleaseChainVerdict = { ok: true } | { ok: false; leg: WrcReleaseLeg; detail?: string }

/**
 * §XVI.7.6 Gate 5 legs 1–3 in normative order (leg 4, rate/replay, is relay
 * state and lives in the store). Pure so fixtures can pin each leg.
 */
export function verifyReleaseChain(input: VerifyReleaseInput): WrcReleaseChainVerdict {
  const { envelope, claim, delegation, nowS } = input

  // ── 1. the claim signature verifies ──────────────────────────────────────
  if (claim.type !== 'wrc/release-claim' || !claim.party_id || !claim.principal_pub) {
    return { ok: false, leg: 'claim_malformed' }
  }
  if (claim.capsule_id !== envelope.capsule_id) {
    // A claim signed for a different capsule never gets this one.
    return { ok: false, leg: 'claim_malformed', detail: 'claim names a different capsule' }
  }
  if (!verifyObjectSig(claim as unknown as Record<string, unknown>, claim.principal_pub)) {
    return { ok: false, leg: 'claim_sig_invalid' }
  }

  // ── 2. the claim chains to a Party Identifier NAMED IN THE CAPSULE ───────
  const recipient = envelope.recipient
  if (recipient.publisher_part !== null) {
    // Publisher recipient: the delegation must chain to a directory-
    // registered key of THAT publisher, carry accept scope, be unexpired,
    // and bind exactly the claiming principal and its key.
    if (claim.publisher_part !== recipient.publisher_part) {
      return {
        ok: false,
        leg: 'recipient_publisher_mismatch',
        detail: 'claim does not act for the publisher named as recipient',
      }
    }
    if (!delegation) return { ok: false, leg: 'delegation_missing' }
    if (delegation.publisher_part !== recipient.publisher_part) {
      return { ok: false, leg: 'delegation_missing', detail: 'delegation is for another publisher' }
    }
    const keys = input.recipientDirectoryKeys
    if (!keys) return { ok: false, leg: 'directory_unavailable' }
    const signer = keys.find((k) => k.kid === delegation.kid)
    if (!signer) return { ok: false, leg: 'delegation_key_unregistered', detail: delegation.kid }
    if (!verifyObjectSig(delegation as unknown as Record<string, unknown>, signer.pub)) {
      return { ok: false, leg: 'delegation_sig_invalid' }
    }
    if (!delegation.scope.includes('accept')) {
      return { ok: false, leg: 'delegation_scope_missing', detail: delegation.scope.join(',') }
    }
    if (nowS >= delegation.expires_at) {
      return { ok: false, leg: 'delegation_expired', detail: `expired at ${delegation.expires_at}` }
    }
    // The delegated principal — key AND party — must be the claimant.
    if (
      delegation.principal_pub !== claim.principal_pub ||
      delegation.principal_party_id !== claim.party_id
    ) {
      return { ok: false, leg: 'delegation_principal_mismatch' }
    }
    // And the claiming party must be the one the capsule names.
    if (claim.party_id !== recipient.party_id) {
      return { ok: false, leg: 'recipient_party_mismatch' }
    }
  } else {
    // Individual recipient: "the Principal Identifier matches" — the party
    // named in the capsule, at key granularity when the depositor bound one.
    if (claim.publisher_part !== null) {
      return {
        ok: false,
        leg: 'recipient_publisher_mismatch',
        detail: 'claim acts for a publisher; the capsule names an individual',
      }
    }
    if (claim.party_id !== recipient.party_id) {
      return { ok: false, leg: 'recipient_party_mismatch' }
    }
    if (
      recipient.principal_key_fingerprint !== null &&
      principalKeyFingerprint(claim.principal_pub) !== recipient.principal_key_fingerprint
    ) {
      return { ok: false, leg: 'recipient_key_mismatch' }
    }
  }

  // ── 3. the capsule is not expired, withdrawn, or already terminal ────────
  // Reachable only behind the identity legs (enumeration protection).
  if (envelope.status === 'withdrawn') return { ok: false, leg: 'capsule_withdrawn' }
  if (envelope.status === 'terminal') return { ok: false, leg: 'capsule_terminal' }
  if (nowS >= envelope.expires_at) {
    return { ok: false, leg: 'capsule_expired', detail: `expired at ${envelope.expires_at}` }
  }

  return { ok: true }
}

// ── Relay store ───────────────────────────────────────────────────────────────

/**
 * Pre-authorized operational default (§XVI.7.6 leaves the rate open):
 * conservative 10 release attempts per capsule per 60-second window,
 * configurable via `WRDESK_WRC_RELAY_RATE_LIMIT` / `WRDESK_WRC_RELAY_RATE_WINDOW_S`.
 */
export const WRC_DEFAULT_RELAY_RATE_LIMIT = 10
export const WRC_DEFAULT_RELAY_RATE_WINDOW_S = 60

export interface WrcRelayClient {
  /** Depositor side (§XVI.7.5.2): the capsule enters recipient-bound custody. */
  deposit(envelope: WrcRelayEnvelope): void
  /** Presence only — never content. Lets the release adapter know Gate 5 has work. */
  hasEnvelope(publisherPart: string, entryKey: string): boolean
  /**
   * The capsule id addressed by an entry slot — an ADDRESS, not content
   * (the reference holder already addresses the slot; §XVI.7.5.5 claims are
   * per-capsule, so the signed claim must name it). Null when none is held.
   */
  capsuleIdFor(publisherPart: string, entryKey: string): string | null
  /** Initiator withdrawal / entry turning terminal. */
  setStatus(capsuleId: string, status: WrcRelayCapsuleStatus): void
  /** THE release boundary: the ordered §XVI.7.6 Gate-5 chain. */
  release(input: {
    publisherPart: string
    entryKey: string
    claim: WrcReleaseClaim
    delegation: WrcPrincipalDelegation | null
  }): Promise<WrcRelayReleaseResult>
}

export interface WrcMemoryRelayOptions {
  /**
   * Directory keys of a publisher, for the delegation chain — the relay
   * verifies claims against DIRECTORY state, never against key material the
   * claimant carries (§XVI.6.5). Null = lookup failed (fail closed).
   */
  directoryKeys(publisherPart: string): Promise<readonly WrcDirectoryKey[] | null>
  now?: () => number
  rateLimit?: number
  rateWindowS?: number
}

export function createMemoryRelay(options: WrcMemoryRelayOptions): WrcRelayClient {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000))
  const envLimit = Number(process.env.WRDESK_WRC_RELAY_RATE_LIMIT)
  const envWindow = Number(process.env.WRDESK_WRC_RELAY_RATE_WINDOW_S)
  const rateLimit =
    options.rateLimit ??
    (Number.isFinite(envLimit) && envLimit > 0 ? envLimit : WRC_DEFAULT_RELAY_RATE_LIMIT)
  const rateWindowS =
    options.rateWindowS ??
    (Number.isFinite(envWindow) && envWindow > 0 ? envWindow : WRC_DEFAULT_RELAY_RATE_WINDOW_S)

  const byEntry = new Map<string, WrcRelayEnvelope>()
  const byId = new Map<string, WrcRelayEnvelope>()
  /** capsule_id → request_instance_id → claiming party (replay ledger). */
  const seenRequests = new Map<string, Map<string, string>>()
  /** capsule_id → attempt timestamps inside the current window. */
  const attempts = new Map<string, number[]>()

  const entryKeyOf = (publisherPart: string, entryKey: string) => `${publisherPart}/${entryKey}`

  return {
    deposit(envelope) {
      byEntry.set(entryKeyOf(envelope.publisher_part, envelope.entry_key), envelope)
      byId.set(envelope.capsule_id, envelope)
    },

    hasEnvelope(publisherPart, entryKey) {
      return byEntry.has(entryKeyOf(publisherPart, entryKey))
    },

    capsuleIdFor(publisherPart, entryKey) {
      return byEntry.get(entryKeyOf(publisherPart, entryKey))?.capsule_id ?? null
    },

    setStatus(capsuleId, status) {
      const env = byId.get(capsuleId)
      if (env) env.status = status
    },

    async release({ publisherPart, entryKey, claim, delegation }) {
      const nowS = now()

      // Rate accounting rides on the ADDRESSED capsule slot, counted for
      // every attempt (successful ones too), so hammering signatures is bounded.
      const envelope = byEntry.get(entryKeyOf(publisherPart, entryKey))
      const rateKey = envelope?.capsule_id ?? entryKeyOf(publisherPart, entryKey)
      const windowStart = nowS - rateWindowS
      const stamps = (attempts.get(rateKey) ?? []).filter((t) => t > windowStart)
      if (stamps.length >= rateLimit) {
        attempts.set(rateKey, stamps)
        return { ok: false, leg: 'rate_limited' }
      }
      stamps.push(nowS)
      attempts.set(rateKey, stamps)

      if (!envelope) return { ok: false, leg: 'capsule_unknown' }

      // Legs 1–3 in normative order.
      const keys =
        envelope.recipient.publisher_part !== null
          ? await options.directoryKeys(envelope.recipient.publisher_part)
          : null
      const chain = verifyReleaseChain({
        envelope,
        claim,
        delegation,
        recipientDirectoryKeys: keys,
        nowS,
      })
      if (!chain.ok) return { ok: false, leg: chain.leg, detail: chain.detail }

      // Leg 4 — replay: a request_instance_id is bound to its first claimant.
      // Same party + same id → idempotent re-release (§XVI.7.5.9); another
      // party replaying a seen id → refused, deterministically.
      const ledger = seenRequests.get(envelope.capsule_id) ?? new Map<string, string>()
      const prior = ledger.get(claim.request_instance_id)
      if (prior !== undefined && prior !== claim.party_id) {
        return { ok: false, leg: 'claim_replayed' }
      }
      ledger.set(claim.request_instance_id, claim.party_id)
      seenRequests.set(envelope.capsule_id, ledger)

      // "ciphertext plus signed envelope; it can decrypt nothing."
      return { ok: true, capsule: envelope.capsule, capsuleId: envelope.capsule_id }
    },
  }
}
