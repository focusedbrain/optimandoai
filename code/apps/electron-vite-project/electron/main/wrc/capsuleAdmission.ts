/**
 * §XVI.7.6 Gate 6 — Capsule admission (receiver Orchestrator, before any UI).
 *
 * Authority: Annex XVI v1.95 (SHA256 064AAD6D…829F), §XVI.7.6 Gate 6 with
 * §XVI.7.5 steps 2/7/9. The normative ordered chain, verbatim:
 *
 *   "Before the capsule is admitted to trusted state, the Orchestrator
 *    verifies: the capsule signature against the initiator's directory-
 *    registered key or a valid Delegation Certificate chaining to it; the
 *    initiator's account-holder and DNS status again at admission time, and
 *    that the initiating principal's SSO-verified email recorded in the
 *    Delegation Certificate lies in the initiator's DNS-verified domain;
 *    that both Party Bindings are well-formed and that the receiver-side
 *    binding names the receiver's own Party Identifier and its own verified
 *    email address; that request_instance_id is new (or maps to existing
 *    state, in which case existing state is surfaced instead); freshness
 *    and expiry; that nonce_I decrypts under the receiver's key and hashes
 *    to the H(nonce_I) carried in the clear; that the requested
 *    profile/scope is admissible under receiver and tenant policy; and that
 *    no field of the capsule references a link, an external resource, or an
 *    unregistered carrier (P15)."
 *
 * The P15 scan is pipeline-owned (non-delegable, `findEmbeddedLink`); every
 * other leg lives here, in the annex's order, each fail-closed with its own
 * reason. Gate 6 produces exactly one of: ADMITTED with the opened material,
 * or REJECTED with a deterministic leg — no partial admission.
 *
 * Values already established by Gates 1–5 (reference identity, namespace
 * records, canonical designator, released capsule bytes) are REUSED, never
 * re-accepted from the capsule: where the capsule repeats one (the initiator
 * part), equality is verified rather than the earlier trusted value replaced.
 *
 * Sealing (§XVI.7.5.2 "nonce_I encrypted to the responder publisher's
 * directory-registered encryption key"): X25519 ECDH (ephemeral → recipient)
 * → HKDF-SHA256 → AES-256-GCM, context-bound to the capsule id so a sealed
 * nonce cannot be transplanted between capsules.
 */

import {
  createHash,
  createCipheriv,
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto'
import { wrcCanonicalBytes, wrcVerifyEd25519 } from './wrcCrypto'
import type { WrcDirectoryRecord } from './namespaceDirectory'
import type { WrcPrincipalDelegation } from './relayRelease'

// ── Sealed-box helpers (§XVI.7.5.2) ──────────────────────────────────────────

/** RFC 8410 SPKI DER prefix for a raw 32-byte X25519 public key. */
const SPKI_X25519_PREFIX = Buffer.from('302a300506032b656e032100', 'hex')

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')

function x25519PublicFromRaw(rawB64Url: string): KeyObject | null {
  const raw = fromB64url(rawB64Url)
  if (raw.length !== 32) return null
  try {
    return createPublicKey({ key: Buffer.concat([SPKI_X25519_PREFIX, raw]), format: 'der', type: 'spki' })
  } catch {
    return null
  }
}

function sealKey(shared: Buffer, context: string): Buffer {
  return Buffer.from(hkdfSync('sha256', shared, Buffer.from('wrc/seal/v1'), Buffer.from(context), 32))
}

/**
 * Seal `plaintext` to a directory-registered X25519 key, bound to `context`.
 * Layout: ephemeral raw pub (32) ‖ iv (12) ‖ tag (16) ‖ ciphertext, base64url.
 */
export function sealToRecipient(recipientPubB64Url: string, plaintext: Buffer, context: string): string {
  const recipientPub = x25519PublicFromRaw(recipientPubB64Url)
  if (!recipientPub) throw new Error('malformed recipient encryption key')
  const eph = generateKeyPairSync('x25519')
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipientPub })
  const key = sealKey(shared, context)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const spki = eph.publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  return b64url(Buffer.concat([spki.subarray(spki.length - 32), iv, cipher.getAuthTag(), ct]))
}

/** Open a sealed box with the recipient's X25519 private key. Null on ANY failure. */
export function openSealed(recipientPriv: KeyObject, sealedB64Url: string, context: string): Buffer | null {
  const blob = fromB64url(sealedB64Url)
  if (blob.length < 32 + 12 + 16) return null
  const ephPub = x25519PublicFromRaw(b64url(blob.subarray(0, 32)))
  if (!ephPub) return null
  try {
    const shared = diffieHellman({ privateKey: recipientPriv, publicKey: ephPub })
    const key = sealKey(shared, context)
    const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(32, 44))
    decipher.setAuthTag(blob.subarray(44, 60))
    return Buffer.concat([decipher.update(blob.subarray(60)), decipher.final()])
  } catch {
    return null
  }
}

/** sha256 hex over raw nonce bytes — the clear H(nonce_I) form (§XVI.7.5.2). */
export function nonceHash(nonce: Buffer): string {
  return createHash('sha256').update(nonce).digest('hex')
}

// ── Capsule wire shape (§XVI.7.5.2) ───────────────────────────────────────────

export interface WrcCapsulePartyBinding {
  party_id: string
  /** SSO-verified email of that party (§XVI.6.5). */
  email: string
}

export interface WrcPendingCapsule {
  type: 'wrc/pending-capsule'
  capsule_id: string
  request_instance_id: string
  /** Initiator Publisher Identifier — must EQUAL the reference's block 2. */
  initiator_part: string
  /** Ordered Party Bindings of both parties (§XVI.7.5.2). */
  party_bindings: {
    initiator: WrcCapsulePartyBinding
    recipient: WrcCapsulePartyBinding
  }
  /** Requested profile/scope. */
  scope: string[]
  /** nonce_I sealed to the recipient publisher's directory-registered encryption key. */
  nonce_i_sealed: string
  /** H(nonce_I) in the clear, sha256 hex. */
  nonce_i_hash: string
  issued_at: number
  expires_at: number
  /** The initiator's Delegation Certificate (initiate scope). */
  delegation: WrcPrincipalDelegation
  sig: string
}

function decodeCapsule(value: unknown): WrcPendingCapsule | null {
  if (typeof value !== 'object' || value === null) return null
  const o = value as Record<string, unknown>
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
  if (o.type !== 'wrc/pending-capsule') return null
  if (!str(o.capsule_id) || !str(o.request_instance_id) || !str(o.initiator_part)) return null
  if (!str(o.nonce_i_sealed) || !str(o.nonce_i_hash) || !str(o.sig)) return null
  if (!num(o.issued_at) || !num(o.expires_at)) return null
  if (!Array.isArray(o.scope) || !o.scope.every(str)) return null
  const pb = o.party_bindings as Record<string, unknown> | null
  const binding = (v: unknown): WrcCapsulePartyBinding | null => {
    if (typeof v !== 'object' || v === null) return null
    const b = v as Record<string, unknown>
    return str(b.party_id) && str(b.email) ? { party_id: b.party_id, email: b.email } : null
  }
  const initiator = binding(pb?.initiator)
  const recipient = binding(pb?.recipient)
  if (!initiator || !recipient) return null
  if (typeof o.delegation !== 'object' || o.delegation === null) return null
  return {
    type: 'wrc/pending-capsule',
    capsule_id: o.capsule_id,
    request_instance_id: o.request_instance_id,
    initiator_part: o.initiator_part,
    party_bindings: { initiator, recipient },
    scope: o.scope as string[],
    nonce_i_sealed: o.nonce_i_sealed,
    nonce_i_hash: o.nonce_i_hash,
    issued_at: o.issued_at,
    expires_at: o.expires_at,
    delegation: o.delegation as WrcPrincipalDelegation,
    sig: o.sig,
  }
}

// ── Verdicts ──────────────────────────────────────────────────────────────────

export type WrcAdmissionLeg =
  | 'capsule_malformed'
  | 'capsule_sig_invalid'
  | 'initiator_mismatch'
  | 'initiator_unverified'
  | 'initiator_delegation_invalid'
  | 'initiator_sso_domain_mismatch'
  | 'recipient_binding_mismatch'
  | 'request_replayed'
  | 'capsule_not_fresh'
  | 'capsule_expired'
  | 'nonce_unverifiable'
  | 'nonce_hash_mismatch'
  | 'scope_inadmissible'

export interface WrcAdmittedCapsule {
  capsule_id: string
  request_instance_id: string
  /** The opened initiator nonce, base64url — never exposed pre-admission. */
  nonce_i: string
  scope: string[]
  initiator_party: WrcCapsulePartyBinding
}

export type WrcAdmissionResult =
  | { ok: true; admitted: WrcAdmittedCapsule; idempotentReplay: boolean }
  | { ok: false; leg: WrcAdmissionLeg; detail?: string }

/** Replay ledger for request_instance_id (§XVI.7.5.9). */
export interface WrcAdmissionReplayStore {
  /** The capsule id previously admitted under this request id, if any. */
  seen(requestInstanceId: string): string | null
  /**
   * ATOMICALLY bind the request id to this capsule (first writer wins) and
   * return the SETTLED capsule id. Settled ≠ recorded means a concurrent
   * admission bound the id to a DIFFERENT capsule first — the caller must
   * refuse as replay rather than admit under an aliased id.
   */
  record(requestInstanceId: string, capsuleId: string): string
}

export function createMemoryAdmissionReplayStore(): WrcAdmissionReplayStore {
  const seen = new Map<string, string>()
  return {
    seen: (id) => seen.get(id) ?? null,
    record: (id, capsuleId) => {
      const prior = seen.get(id)
      if (prior !== undefined) return prior
      seen.set(id, capsuleId)
      return capsuleId
    },
  }
}

/** Structural view of the WRC security DB — avoids a value-import cycle. */
interface WrcAdmissionDb {
  prepare(sql: string): {
    get: (...args: unknown[]) => unknown
    run: (...args: unknown[]) => { changes: number }
  }
}

/**
 * Durable Gate-6 request-id ledger (Run 5, Slice 5) on the WRC security DB
 * (`wrc_admission_request_ledger`). One row per request_instance_id; the
 * binding is INSERT-if-absent then read-back, so two concurrent admissions
 * with the same id settle on exactly one capsule, a successfully admitted
 * request cannot become a second logically distinct admission after restart,
 * and a request id reused against a different capsule stays refused. Rows
 * are written ONLY by `verifyCapsuleAdmission` after every other leg passed —
 * a Gate-6 failure never persists a false success. A malformed persisted row
 * or unavailable DB THROWS: unknown idempotency history must refuse, never
 * read as "never seen".
 */
export function createDbAdmissionReplayStore(db: WrcAdmissionDb): WrcAdmissionReplayStore {
  const readSettled = (id: string): string | null => {
    const row = db
      .prepare('SELECT capsule_id FROM wrc_admission_request_ledger WHERE request_instance_id = ?')
      .get(id) as { capsule_id?: unknown } | undefined
    if (row === undefined) return null
    if (typeof row.capsule_id !== 'string' || !row.capsule_id) {
      throw new Error('malformed admission ledger row')
    }
    return row.capsule_id
  }
  return {
    seen: readSettled,
    record(id, capsuleId) {
      db.prepare(
        `INSERT INTO wrc_admission_request_ledger (request_instance_id, capsule_id, created_at)
           VALUES (?, ?, ?)
         ON CONFLICT(request_instance_id) DO NOTHING`,
      ).run(id, capsuleId, new Date().toISOString())
      const settled = readSettled(id)
      if (settled === null) throw new Error('admission ledger unreadable after bind')
      return settled
    },
  }
}

/** Allowed clock skew for `issued_at` (§XVI.7.6 leaves the tolerance open). */
export const WRC_DEFAULT_ADMISSION_SKEW_S = 300

// ── The ordered admission chain ───────────────────────────────────────────────

export interface VerifyCapsuleAdmissionInput {
  /** The relay-released capsule bytes — from Gate 5, never from the caller. */
  capsule: unknown
  /** Initiator part established at Gate 1 (the reference's own block 2). */
  expectedInitiatorPart: string
  /**
   * The initiator's Directory Record, RE-verified at admission time by the
   * caller (§XVI.7.6: "account-holder and DNS status again at admission
   * time"). Null = that re-verification failed — fail closed.
   */
  initiatorRecord: WrcDirectoryRecord | null
  /** The receiver's own identity: Party Identifier + own verified email. */
  receiver: { party_id: string | null; email: string | null }
  /** The recipient publisher's X25519 decryption key (Orchestrator key service). */
  decryptKey: KeyObject | null
  replay: WrcAdmissionReplayStore
  /** Receiver/tenant policy over the requested scope. Default: admit (policy seam). */
  scopeAdmissible?: (scope: readonly string[]) => boolean
  nowS: number
  skewS?: number
}

export function verifyCapsuleAdmission(input: VerifyCapsuleAdmissionInput): WrcAdmissionResult {
  const skew = input.skewS ?? WRC_DEFAULT_ADMISSION_SKEW_S

  const capsule = decodeCapsule(input.capsule)
  if (!capsule) return { ok: false, leg: 'capsule_malformed' }

  // Identity equality with the earlier trusted value — never replacement.
  if (capsule.initiator_part !== input.expectedInitiatorPart) {
    return {
      ok: false,
      leg: 'initiator_mismatch',
      detail: `capsule names ${capsule.initiator_part}, reference names ${input.expectedInitiatorPart}`,
    }
  }

  // ── 1. capsule signature: initiator's directory-registered key or a valid
  //       Delegation Certificate chaining to it ──────────────────────────────
  const record = input.initiatorRecord
  if (!record) return { ok: false, leg: 'initiator_unverified' }
  const delegation = capsule.delegation
  if (
    delegation.type !== 'wrc/delegation-cert' ||
    delegation.publisher_part !== capsule.initiator_part
  ) {
    return { ok: false, leg: 'initiator_delegation_invalid', detail: 'delegation is not the initiator publisher\u2019s' }
  }
  const signer = record.keys.find((k) => k.kid === delegation.kid)
  if (!signer) {
    return { ok: false, leg: 'initiator_delegation_invalid', detail: `kid ${delegation.kid} is not directory-registered` }
  }
  {
    const { sig: _s, ...unsigned } = delegation as unknown as Record<string, unknown>
    if (!wrcVerifyEd25519(wrcCanonicalBytes(unsigned), delegation.sig, signer.pub)) {
      return { ok: false, leg: 'initiator_delegation_invalid', detail: 'delegation signature invalid' }
    }
  }
  if (!delegation.scope.includes('initiate')) {
    return { ok: false, leg: 'initiator_delegation_invalid', detail: 'delegation lacks initiate scope' }
  }
  if (input.nowS >= delegation.expires_at) {
    return { ok: false, leg: 'initiator_delegation_invalid', detail: 'delegation expired' }
  }
  {
    const { sig: _s, ...unsigned } = capsule as unknown as Record<string, unknown>
    if (!wrcVerifyEd25519(wrcCanonicalBytes(unsigned), capsule.sig, delegation.principal_pub)) {
      return { ok: false, leg: 'capsule_sig_invalid' }
    }
  }

  // ── 2. initiator status re-verified; SSO email in DNS-verified domain ────
  if (record.status !== 'active' || !record.account_holder_vetted) {
    return { ok: false, leg: 'initiator_unverified', detail: `initiator status ${record.status}` }
  }
  const at = delegation.sso_email.lastIndexOf('@')
  const emailDomain = at > 0 ? delegation.sso_email.slice(at + 1).toLowerCase() : ''
  if (!emailDomain || !record.domains.map((d) => d.toLowerCase()).includes(emailDomain)) {
    return {
      ok: false,
      leg: 'initiator_sso_domain_mismatch',
      detail: `${emailDomain || '(none)'} is not among the initiator's DNS-verified domains`,
    }
  }
  // The initiating principal in the binding must BE the delegated principal.
  if (
    capsule.party_bindings.initiator.party_id !== delegation.principal_party_id ||
    capsule.party_bindings.initiator.email !== delegation.sso_email
  ) {
    return { ok: false, leg: 'initiator_delegation_invalid', detail: 'initiator binding does not match the delegation' }
  }

  // ── 3. Party Bindings well-formed; recipient binding names the receiver ──
  if (!input.receiver.party_id || !input.receiver.email) {
    return { ok: false, leg: 'recipient_binding_mismatch', detail: 'receiver presents no party id or verified email' }
  }
  if (
    capsule.party_bindings.recipient.party_id !== input.receiver.party_id ||
    capsule.party_bindings.recipient.email.toLowerCase() !== input.receiver.email.toLowerCase()
  ) {
    return { ok: false, leg: 'recipient_binding_mismatch' }
  }

  // ── 4. request_instance_id: new, or maps to existing state ───────────────
  const prior = input.replay.seen(capsule.request_instance_id)
  const idempotentReplay = prior !== null && prior === capsule.capsule_id
  if (prior !== null && prior !== capsule.capsule_id) {
    return { ok: false, leg: 'request_replayed', detail: 'request_instance_id bound to a different capsule' }
  }

  // ── 5. freshness and expiry ───────────────────────────────────────────────
  if (capsule.issued_at > input.nowS + skew) {
    return { ok: false, leg: 'capsule_not_fresh', detail: `issued_at ${capsule.issued_at} is in the future` }
  }
  if (input.nowS >= capsule.expires_at) {
    return { ok: false, leg: 'capsule_expired', detail: `expired at ${capsule.expires_at}` }
  }

  // ── 6. nonce_I decrypts under the receiver's key; hashes to H(nonce_I) ───
  if (!input.decryptKey) {
    return { ok: false, leg: 'nonce_unverifiable', detail: 'no recipient decryption key available' }
  }
  const nonce = openSealed(input.decryptKey, capsule.nonce_i_sealed, capsule.capsule_id)
  if (!nonce) return { ok: false, leg: 'nonce_unverifiable', detail: 'sealed nonce did not open' }
  if (nonceHash(nonce) !== capsule.nonce_i_hash) {
    return { ok: false, leg: 'nonce_hash_mismatch' }
  }

  // ── 7. requested profile/scope admissible under receiver/tenant policy ───
  const admissible = input.scopeAdmissible ? input.scopeAdmissible(capsule.scope) : true
  if (!admissible) {
    return { ok: false, leg: 'scope_inadmissible', detail: capsule.scope.join(',') }
  }

  // (8. the P15 link scan is pipeline-owned and already ran / runs there.)

  // Record-and-settle: a concurrent admission may have bound this request id
  // to a DIFFERENT capsule between the leg-4 read and now — the settled
  // binding decides, atomically in the store, and the loser refuses.
  const settled = input.replay.record(capsule.request_instance_id, capsule.capsule_id)
  if (settled !== capsule.capsule_id) {
    return { ok: false, leg: 'request_replayed', detail: 'request_instance_id bound to a different capsule' }
  }
  return {
    ok: true,
    idempotentReplay,
    admitted: {
      capsule_id: capsule.capsule_id,
      request_instance_id: capsule.request_instance_id,
      nonce_i: b64url(nonce),
      scope: [...capsule.scope],
      initiator_party: { ...capsule.party_bindings.initiator },
    },
  }
}
