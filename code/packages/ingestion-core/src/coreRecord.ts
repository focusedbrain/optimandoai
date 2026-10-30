/**
 * WR Handshake frozen signed core record (Phase 2 — A1–A7) [VII.3.1–3.2]
 *
 * The core record is FROZEN: new features land in registries and in the two
 * containers, never as new core fields [VII.3]. This module defines the
 * record type, its wire envelope, and the pure structural parser. Hashing
 * and signing live behind the canonicalization entry point
 * (electron: handshake/canonicalCore.ts) — signatures always cover the
 * complete canonical form of `core` minus nothing (the signature list is
 * detached, outside `core`), under the domain tag `wr.handshake.core` v3.
 */

import type { CanonicalJsonValue } from './canonical.js'
import type { ContainerEntry } from './containers.js'
import { parseContainer } from './containers.js'

// ── Core record [VII.3.1] ─────────────────────────────────────────────────────

/** SSO-bound party identity — the full claim set of the Phase-1 guard. */
export interface CorePartyId {
  sub: string
  iss: string
  email: string
  wrdesk_user_id: string
}

export interface CoreProfileRef {
  /** Registry identifier — content-dispatched in Phase 3 [VII.4.1]. */
  id: string
  version: number
}

export interface WrHandshakeCore {
  /** Profile identifier + version — immutable inside the signed core [VII.3.3]. */
  profile: CoreProfileRef
  initiator_id: CorePartyId
  /** Null until the responder is bound (initiate-stage cores). */
  responder_id: CorePartyId | null
  /**
   * Registry-backed ingress identifier — LOG-ONLY metadata [VII.4.6].
   * No semantic branch may ever read this field; a structural test guards
   * this (ingressPathNeutrality.test.ts). Null on all Phase-2 emissions and
   * on every backfilled row.
   */
  ingress_path: string | null
  /** Ordered declarations container [VII.3.4]. */
  declarations: ContainerEntry[]
  /** Ordered extensions container [VII.3.4]. */
  extensions: ContainerEntry[]
  /** ISO-8601 creation instant. */
  created_at: string
  /** Freshness/replay nonce — checked against the nonce store [VII.3.1]. */
  nonce: string
}

// ── Detached signature list [VII.3.2, Q3] ────────────────────────────────────

export type CoreSignatureMode =
  /** Signature over domainTag || canonicalBytes(core). */
  | 'canonical_bytes'
  /** Countersignature over domainTag || sha256(canonicalBytes(core)) [Q3]. */
  | 'canonical_hash'

export interface CoreSignature {
  /** Which party signed. */
  signer: 'initiator' | 'responder'
  alg: 'ed25519'
  mode: CoreSignatureMode
  /** Hex-encoded raw 32-byte Ed25519 public key. */
  public_key: string
  /** Hex-encoded 64-byte Ed25519 signature. */
  sig: string
}

/**
 * The wire envelope: core + ORDERED detached signature list. Per-profile
 * signature cardinality arrives with the profile registry (Phase 3); the
 * list structure lands now.
 */
export interface WrCanonicalEnvelope {
  /** Canonical-form schema version — 3 for this format. */
  v: 3
  core: WrHandshakeCore
  signatures: CoreSignature[]
}

export const WR_CORE_OBJECT_TYPE = 'wr.handshake.core'
export const WR_CANONICAL_SCHEMA_VERSION = 3 as const

// ── Structural parser (preserve-unknown inside containers) ───────────────────

export type EnvelopeParseResult =
  | { ok: true; envelope: WrCanonicalEnvelope }
  | { ok: false; reason: string }

const HEX_64 = /^[a-f0-9]{64}$/i
const HEX_128 = /^[a-f0-9]{128}$/i
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

function isNonEmptyString(v: unknown, max = 512): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max
}

function parsePartyId(raw: unknown, path: string): { ok: true; party: CorePartyId } | { ok: false; reason: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: `${path} must be an identity object` }
  }
  const p = raw as Record<string, unknown>
  for (const claim of ['sub', 'iss', 'email', 'wrdesk_user_id'] as const) {
    if (!isNonEmptyString(p[claim])) {
      return { ok: false, reason: `${path}.${claim} must be a non-empty string (full-claim identity [VII.3.8])` }
    }
  }
  return {
    ok: true,
    party: {
      sub: p.sub as string,
      iss: p.iss as string,
      email: p.email as string,
      wrdesk_user_id: p.wrdesk_user_id as string,
    },
  }
}

/**
 * Structural validation of a received envelope. Containers are validated via
 * the preserve-unknown parser — the entry objects are passed through
 * UNTOUCHED so canonical re-serialization reproduces the signed bytes.
 */
export function parseCanonicalEnvelope(raw: unknown): EnvelopeParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'envelope must be an object' }
  }
  const env = raw as Record<string, unknown>
  if (env.v !== WR_CANONICAL_SCHEMA_VERSION) {
    return { ok: false, reason: `unsupported canonical schema version: ${String(env.v)}` }
  }
  const coreRaw = env.core
  if (!coreRaw || typeof coreRaw !== 'object' || Array.isArray(coreRaw)) {
    return { ok: false, reason: 'envelope.core must be an object' }
  }
  const core = coreRaw as Record<string, unknown>

  // profile
  const profile = core.profile as Record<string, unknown> | undefined
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    return { ok: false, reason: 'core.profile is required' }
  }
  if (!isNonEmptyString(profile.id, 128) || !Number.isSafeInteger(profile.version) || (profile.version as number) < 1) {
    return { ok: false, reason: 'core.profile must carry id + positive integer version' }
  }

  // parties
  const initiator = parsePartyId(core.initiator_id, 'core.initiator_id')
  if (!initiator.ok) return initiator
  let responder: CorePartyId | null = null
  if (core.responder_id !== null && core.responder_id !== undefined) {
    const parsed = parsePartyId(core.responder_id, 'core.responder_id')
    if (!parsed.ok) return parsed
    responder = parsed.party
  }

  // ingress_path — log-only; structure-checked, never interpreted.
  if (core.ingress_path !== null && core.ingress_path !== undefined && !isNonEmptyString(core.ingress_path, 128)) {
    return { ok: false, reason: 'core.ingress_path must be null or a registry identifier string' }
  }

  // containers — preserve-unknown
  const declarations = parseContainer(core.declarations, 'core.declarations')
  if (!declarations.ok) return { ok: false, reason: declarations.reason }
  const extensions = parseContainer(core.extensions, 'core.extensions')
  if (!extensions.ok) return { ok: false, reason: extensions.reason }

  // created_at + nonce
  if (!isNonEmptyString(core.created_at, 64) || !ISO_8601.test(core.created_at as string)) {
    return { ok: false, reason: 'core.created_at must be ISO-8601' }
  }
  if (typeof core.nonce !== 'string' || !HEX_64.test(core.nonce)) {
    return { ok: false, reason: 'core.nonce must be 64-char hex' }
  }

  // signatures — ordered detached list
  if (!Array.isArray(env.signatures) || env.signatures.length < 1 || env.signatures.length > 8) {
    return { ok: false, reason: 'envelope.signatures must be a non-empty ordered list' }
  }
  const signatures: CoreSignature[] = []
  for (let i = 0; i < env.signatures.length; i++) {
    const s = env.signatures[i] as Record<string, unknown>
    if (!s || typeof s !== 'object' || Array.isArray(s)) {
      return { ok: false, reason: `signatures[${i}] must be an object` }
    }
    if (s.signer !== 'initiator' && s.signer !== 'responder') {
      return { ok: false, reason: `signatures[${i}].signer must be initiator|responder` }
    }
    if (s.alg !== 'ed25519') return { ok: false, reason: `signatures[${i}].alg must be ed25519` }
    if (s.mode !== 'canonical_bytes' && s.mode !== 'canonical_hash') {
      return { ok: false, reason: `signatures[${i}].mode must be canonical_bytes|canonical_hash` }
    }
    if (typeof s.public_key !== 'string' || !HEX_64.test(s.public_key)) {
      return { ok: false, reason: `signatures[${i}].public_key must be 64-char hex` }
    }
    if (typeof s.sig !== 'string' || !HEX_128.test(s.sig)) {
      return { ok: false, reason: `signatures[${i}].sig must be 128-char hex` }
    }
    signatures.push({
      signer: s.signer,
      alg: 'ed25519',
      mode: s.mode as CoreSignatureMode,
      public_key: (s.public_key as string).toLowerCase(),
      sig: (s.sig as string).toLowerCase(),
    })
  }

  // IMPORTANT: `core` is returned as the ORIGINAL object reference (with the
  // original container entry objects) so canonical bytes recompute over
  // exactly what the sender signed — unknown container content included.
  return {
    ok: true,
    envelope: {
      v: WR_CANONICAL_SCHEMA_VERSION,
      core: coreRaw as unknown as WrHandshakeCore,
      signatures,
    },
  }
}

/** The value a core signature covers: the core record itself (nothing less). */
export function coreSigningValue(core: WrHandshakeCore): CanonicalJsonValue {
  return core as unknown as CanonicalJsonValue
}
