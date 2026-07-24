/**
 * Canonical core — THE hash/signature entry point for new-format (v3)
 * handshake objects (Phase 2 — A8, A1–A7) [VII.3.1–3.2, VII.6.1.3].
 *
 * Wire strategy (version-gated, dual-format):
 *  - Outbound capsules keep the complete legacy v2 surface (schema_version 2,
 *    subset capsule_hash + sender_signature) so old peers' allowlist rebuild
 *    keeps verifying what we send [risk register: cross-version handshakes].
 *  - Additionally every outbound capsule carries `wr_canonical_v3`: a frozen
 *    signed core record [VII.3.1] whose declarations container embeds the
 *    COMPLETE capsule content under `optirando.decl.capsule`. Its signature
 *    covers the complete canonical form of the core (domain tag
 *    `wr.handshake.core` v3) — scopes, policy, tier signals, keys and routing
 *    included, which the v2 subset hash never covered (A8).
 *  - Receivers that understand v3 verify BOTH: legacy rules keep running
 *    (dedup, chain, pinning), then the canonical envelope is verified
 *    fail-closed. Capsules without an envelope verify under legacy rules
 *    alone and are marked `legacy` in evidence records.
 *
 * Large payload fields (context_blocks, context_blocks_sealed) are covered by
 * their SHA-256 inside the signed declaration instead of byte-duplication, so
 * the dual format stays inside the 64KB Gate-2 input cap. Full coverage is
 * preserved: the hash binds the bytes.
 *
 * Countersignatures [Q3]: mode 'canonical_hash' signs the canonical-form
 * hash under the same domain tag — both signatures cover the same referenced
 * bytes. The ordered signature list lands now; per-profile cardinality
 * enforcement arrives with the profile registry (Phase 3).
 */

import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import {
  canonicalJsonBytes,
  canonicalJsonString,
  domainTag,
  signingBytes,
  evaluateContainerCriticality,
  parseCanonicalEnvelope,
  parseContainer,
  resolveProfile,
  checkProfileContainerRules,
  WR_CORE_OBJECT_TYPE,
  WR_CANONICAL_SCHEMA_VERSION,
} from '@repo/ingestion-core'
import type {
  CanonicalJsonValue,
  ContainerEntry,
  CorePartyId,
  CoreSignature,
  WrCanonicalEnvelope,
  WrHandshakeCore,
} from '@repo/ingestion-core'
import { isWeakEd25519PublicKey } from '../security/ed25519WeakKey'

export const CAPSULE_DECLARATION_NS = 'optirando.decl.capsule'

/**
 * Phase-2 emissions are still produced by the legacy formation dialects; the
 * registered `legacy_v0` profile blesses this signature discipline [Q2].
 * Real profile assignment arrives with the one pipeline (Phase 4).
 */
export const PHASE2_EMISSION_PROFILE = Object.freeze({ id: 'legacy_v0', version: 1 })

// ── Ed25519 over canonical bytes ──────────────────────────────────────────────

/** PKCS#8 DER prefix for a raw 32-byte Ed25519 seed (RFC 8410). */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

function privateKeyFromHex(privateKeyHex: string) {
  if (!/^[a-f0-9]+$/i.test(privateKeyHex) || privateKeyHex.length < 64) {
    throw new Error('privateKey must be hex (64-char seed or PKCS#8 DER)')
  }
  if (privateKeyHex.length === 64) {
    // Raw seed → wrap in PKCS#8. NOTE: generateKeyPairSync('ed25519', { seed })
    // silently IGNORES the seed option (Node has no such option) and returns a
    // random keypair — signing with it produces signatures that never verify.
    const der = Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(privateKeyHex, 'hex')])
    return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
  }
  return createPrivateKey({ key: Buffer.from(privateKeyHex, 'hex'), format: 'der', type: 'pkcs8' })
}

function rawPubKeyToSpki(rawHex: string): Buffer {
  const key = Buffer.from(rawHex, 'hex')
  if (key.length !== 32) throw new Error('publicKey must be 32 bytes')
  const oid = Buffer.from([0x06, 0x03, 0x2b, 0x65, 0x70])
  const algSeq = Buffer.concat([Buffer.from([0x30, 0x05]), oid])
  const bitStr = Buffer.concat([Buffer.from([0x03, 0x21, 0x00]), key])
  const elements = Buffer.concat([algSeq, bitStr])
  return Buffer.concat([Buffer.from([0x30, elements.length]), elements])
}

/** sha256(canonicalBytes(core)) — the referenced bytes countersignatures bind [Q3]. */
export function canonicalCoreHash(core: WrHandshakeCore): Buffer {
  return createHash('sha256')
    .update(canonicalJsonBytes(core as unknown as CanonicalJsonValue))
    .digest()
}

function bytesForMode(core: WrHandshakeCore, mode: CoreSignature['mode']): Buffer {
  if (mode === 'canonical_bytes') {
    return Buffer.from(
      signingBytes(WR_CORE_OBJECT_TYPE, WR_CANONICAL_SCHEMA_VERSION, core as unknown as CanonicalJsonValue),
    )
  }
  // canonical_hash [Q3]: domain tag || sha256(canonical bytes)
  return Buffer.concat([
    Buffer.from(domainTag(WR_CORE_OBJECT_TYPE, WR_CANONICAL_SCHEMA_VERSION)),
    canonicalCoreHash(core),
  ])
}

/**
 * Sign the COMPLETE core record (minus nothing — the signature list is
 * detached). There is intentionally no way to sign a field subset.
 */
export function signCore(
  core: WrHandshakeCore,
  privateKeyHex: string,
  publicKeyHex: string,
  signer: CoreSignature['signer'],
  mode: CoreSignature['mode'] = 'canonical_bytes',
): CoreSignature {
  const sig = sign(null, bytesForMode(core, mode), privateKeyFromHex(privateKeyHex))
  return { signer, alg: 'ed25519', mode, public_key: publicKeyHex.toLowerCase(), sig: sig.toString('hex') }
}

export function verifyCoreSignature(core: WrHandshakeCore, signature: CoreSignature): boolean {
  try {
    if (isWeakEd25519PublicKey(new Uint8Array(Buffer.from(signature.public_key, 'hex')))) return false
    const publicKey = createPublicKey({ key: rawPubKeyToSpki(signature.public_key), format: 'der', type: 'spki' })
    return verify(null, bytesForMode(core, signature.mode), publicKey, Buffer.from(signature.sig, 'hex'))
  } catch {
    return false
  }
}

// ── Capsule → signed core (emission) ─────────────────────────────────────────

/** Fields that are signatures themselves or the envelope — never inside the signed content. */
const SIGNATURE_SURFACE_FIELDS: ReadonlySet<string> = new Set([
  'sender_signature',
  'countersigned_hash',
  'wr_canonical_v3',
])

/** Large fields covered by SHA-256 reference instead of byte duplication. */
const HASH_COVERED_FIELDS: ReadonlySet<string> = new Set(['context_blocks', 'context_blocks_sealed'])

/**
 * Stable projection of a hash-covered field before hashing. The Gate-2
 * rebuild normalizes optional block fields to explicit nulls; hashing the
 * same projection on BOTH sides keeps the reference byte-stable across that
 * normalization (absent and null collapse to null; key order is handled by
 * the canonical serializer).
 */
function projectHashCoveredField(field: string, value: unknown): CanonicalJsonValue {
  if (field === 'context_blocks' && Array.isArray(value)) {
    return value.map((b) => {
      const block = b as Record<string, unknown>
      return {
        block_id: (block.block_id as string) ?? null,
        block_hash: (block.block_hash as string) ?? null,
        scope_id: (block.scope_id as string | null | undefined) ?? null,
        type: (block.type as string) ?? null,
        content: (block.content as CanonicalJsonValue | undefined) ?? null,
      }
    })
  }
  if (field === 'context_blocks_sealed' && value && typeof value === 'object' && !Array.isArray(value)) {
    const e = value as Record<string, unknown>
    return {
      envelope_type: (e.envelope_type as string) ?? null,
      schema_version: (e.schema_version as number) ?? null,
      handshake_id: (e.handshake_id as string) ?? null,
      sender_device_id: (e.sender_device_id as string) ?? null,
      receiver_device_id: (e.receiver_device_id as string) ?? null,
      sender_ephemeral_x25519_pub_b64: (e.sender_ephemeral_x25519_pub_b64 as string) ?? null,
      salt_b64: (e.salt_b64 as string) ?? null,
      nonce_b64: (e.nonce_b64 as string) ?? null,
      ciphertext_b64: (e.ciphertext_b64 as string) ?? null,
    }
  }
  return value as CanonicalJsonValue
}

/**
 * The complete capsule content as it enters the signed declaration payload:
 * every field except the signature surface, with large fields replaced by
 * `{ __sha256 }` references over their stable projection. Full coverage —
 * nothing else is dropped.
 */
export function capsuleContentForSigning(capsule: Record<string, unknown>): Record<string, CanonicalJsonValue> {
  const out: Record<string, CanonicalJsonValue> = {}
  for (const key of Object.keys(capsule)) {
    const value = capsule[key]
    if (value === undefined || SIGNATURE_SURFACE_FIELDS.has(key)) continue
    if (HASH_COVERED_FIELDS.has(key) && value !== null) {
      out[key] = { __sha256: sha256OfJson(projectHashCoveredField(key, value)) }
      continue
    }
    out[key] = value as CanonicalJsonValue
  }
  return out
}

function sha256OfJson(value: unknown): string {
  return createHash('sha256')
    .update(canonicalJsonBytes(value as CanonicalJsonValue))
    .digest('hex')
}

export interface BuildCoreOptions {
  initiator: CorePartyId
  responder: CorePartyId | null
  /** ISO instant — the capsule timestamp. */
  createdAt: string
  /** 64-hex freshness nonce — the capsule nonce [VII.3.1]. */
  nonce: string
  /** Extra extension entries (none in Phase 2 emissions). */
  extensions?: ContainerEntry[]
  /**
   * Phase 4: real profile assignment by the one pipeline. Emissions without
   * one stay `legacy_v0` (Q2-blessed legacy signature discipline).
   */
  profile?: { id: string; version: number }
  /** Phase 4 (Q4): recorded on new formations by the one pipeline; log-only. */
  ingressPath?: string | null
  /** Phase 4 [IX.3.1 rule 5]: capture provenance etc. as signed declarations. */
  extraDeclarations?: ContainerEntry[]
}

/**
 * Build the frozen signed core for an outbound capsule. `ingress_path` is
 * null on every Phase-2 emission (values are recorded by the one pipeline
 * from Phase 4 per Q4) and is log-only forever [VII.4.6].
 */
export function buildCoreForCapsule(
  capsule: Record<string, unknown>,
  opts: BuildCoreOptions,
): WrHandshakeCore {
  return {
    profile: opts.profile ? { ...opts.profile } : { ...PHASE2_EMISSION_PROFILE },
    initiator_id: opts.initiator,
    responder_id: opts.responder,
    ingress_path: opts.ingressPath ?? null,
    declarations: [
      {
        ns: CAPSULE_DECLARATION_NS,
        version: 1,
        critical: true,
        payload: capsuleContentForSigning(capsule),
      },
      ...(opts.extraDeclarations ?? []),
    ],
    extensions: opts.extensions ?? [],
    created_at: opts.createdAt,
    nonce: opts.nonce,
  }
}

/**
 * Dual-format emission helper: attach the signed canonical envelope to a
 * fully built v2 capsule. Returns a NEW capsule object; the v2 surface is
 * untouched (old peers' allowlist rebuild keeps verifying it).
 */
export function attachCanonicalEnvelope<T extends Record<string, unknown>>(
  capsule: T,
  opts: BuildCoreOptions & {
    privateKeyHex: string
    publicKeyHex: string
    signer: CoreSignature['signer']
  },
): T & { wr_canonical_v3: WrCanonicalEnvelope } {
  const core = buildCoreForCapsule(capsule, opts)
  const signature = signCore(core, opts.privateKeyHex, opts.publicKeyHex, opts.signer, 'canonical_bytes')
  return { ...capsule, wr_canonical_v3: { v: WR_CANONICAL_SCHEMA_VERSION, core, signatures: [signature] } }
}

// ── Verification (receive) ────────────────────────────────────────────────────

export type EnvelopeVerification =
  | {
      ok: true
      envelope: WrCanonicalEnvelope
      /** Namespaces of preserved-and-ignored unknown non-critical entries. */
      ignoredNamespaces: string[]
    }
  | {
      ok: false
      reason: string
      refusedNamespace?: string
      /** Set on profile-dispatch refusals — named in the visible refusal [VII.4.2]. */
      refusedProfile?: { id: string; version: number }
    }

/**
 * Fields cross-checked between the pipeline's capsule view and the signed
 * capsule declaration. A value present on the received capsule that is
 * missing from or different in the signed content ⇒ the wire was altered or
 * the sender under-signed ⇒ fail closed.
 */
const BINDING_FIELDS: readonly string[] = [
  'schema_version',
  'capsule_type',
  'handshake_id',
  'relationship_id',
  'sender_id',
  'sender_wrdesk_user_id',
  'sender_email',
  'receiver_id',
  'receiver_email',
  'capsule_hash',
  'context_hash',
  'context_commitment',
  'nonce',
  'timestamp',
  'seq',
  'external_processing',
  'reciprocal_allowed',
  'wrdesk_policy_hash',
  'wrdesk_policy_version',
  'sharing_mode',
  'prev_hash',
  'sender_public_key',
  'sender_x25519_public_key_b64',
  'sender_mlkem768_public_key_b64',
  'handshake_type',
  'sender_device_id',
  'receiver_device_id',
  'sender_device_role',
  'receiver_device_role',
  'receiver_pairing_code',
  'p2p_endpoint',
  'p2p_auth_token',
  'senderIdentity',
  'receiverIdentity',
  'tierSignals',
  'context_block_proofs',
]

function canonicalEq(a: unknown, b: unknown): boolean {
  try {
    return (
      canonicalJsonString(a as CanonicalJsonValue) === canonicalJsonString(b as CanonicalJsonValue)
    )
  } catch {
    return false
  }
}

/**
 * Verify a received capsule's canonical envelope, fail-closed [VII.4.2]:
 *  1. structural parse (containers preserved byte-faithfully),
 *  2. at least one valid full-coverage 'canonical_bytes' signature whose key
 *     is the capsule's pinned sender key,
 *  3. every additional signature in the ordered list must verify,
 *  4. container criticality: unknown/reserved CRITICAL namespace → visible
 *     refusal naming the namespace [VII.3.5],
 *  5. binding cross-check: the signed capsule declaration must match the
 *     received capsule on every consumed field (under-signing rejection).
 */
export function verifyCanonicalEnvelope(
  capsule: Record<string, unknown>,
  expectedSenderPublicKeyHex: string,
): EnvelopeVerification {
  const parsed = parseCanonicalEnvelope(capsule.wr_canonical_v3)
  if (!parsed.ok) return { ok: false, reason: `envelope_parse:${parsed.reason}` }
  const { envelope } = parsed

  // 1b — profile dispatch, FAIL-CLOSED [VII.4.2]: unknown profile id or
  // unsupported profile version → visible refusal naming the profile; no
  // fallback path exists. Profiles are registry records (Phase 3), never
  // code branches; the record parameterizes the checks below.
  const profileRef = envelope.core.profile
  const resolution = resolveProfile(profileRef.id, profileRef.version)
  if (!resolution.ok) {
    return {
      ok: false,
      reason: `${resolution.reason}:${profileRef.id}@${profileRef.version}`,
      refusedProfile: { id: profileRef.id, version: profileRef.version },
    }
  }
  const profile = resolution.record

  // 2+3 — signatures. The full-coverage signature must be bound to the same
  // key the legacy surface pins (TOFU / counterparty pinning applies to both).
  // Countersignature discipline [VII.3.2, Q3]: every signature in the ordered
  // list verifies over the SAME core value (byte-identical by construction of
  // bytesForMode); a countersignature over differing bytes cannot verify.
  let boundFullCoverage = false
  const distinctValidKeys = new Set<string>()
  for (const signature of envelope.signatures) {
    if (!verifyCoreSignature(envelope.core, signature)) {
      return { ok: false, reason: `signature_invalid:${signature.signer}:${signature.mode}` }
    }
    distinctValidKeys.add(signature.public_key.toLowerCase())
    if (
      signature.mode === 'canonical_bytes' &&
      signature.public_key === expectedSenderPublicKeyHex.toLowerCase()
    ) {
      boundFullCoverage = true
    }
  }
  if (!boundFullCoverage) {
    return { ok: false, reason: 'no_full_coverage_signature_from_sender_key' }
  }

  // Per-profile signature cardinality (registry-parameterized): 2-sig
  // profiles count as established only when DOUBLY signed over the identical
  // core [VII.3.2]. Distinct keys, not list length — the same signer twice
  // is one signature.
  if (distinctValidKeys.size < profile.signature_cardinality) {
    return {
      ok: false,
      reason: `signature_cardinality_unmet:${distinctValidKeys.size}<${profile.signature_cardinality}`,
      refusedProfile: { id: profile.id, version: profile.version },
    }
  }

  // 4 — container criticality (both containers; order preserved).
  const declarations = parseContainer((envelope.core as unknown as Record<string, unknown>).declarations, 'declarations')
  const extensions = parseContainer((envelope.core as unknown as Record<string, unknown>).extensions, 'extensions')
  if (!declarations.ok) return { ok: false, reason: declarations.reason }
  if (!extensions.ok) return { ok: false, reason: extensions.reason }
  const ignoredNamespaces: string[] = []
  for (const entries of [declarations.entries, extensions.entries]) {
    const verdict = evaluateContainerCriticality(entries)
    if (!verdict.ok) {
      return {
        ok: false,
        reason: `unknown_critical_namespace:${verdict.refusedNamespace}`,
        refusedNamespace: verdict.refusedNamespace,
      }
    }
    ignoredNamespaces.push(...verdict.ignoredNonCritical)
  }

  // 4b — profile container rules AT SCHEMA LEVEL [VII.4.5]: e.g. a
  // `private_personal` core carrying a publisher_attestation block is
  // rejected here, not by UI; `pbeap_publisher` requires one.
  const allNamespaces = [...declarations.entries, ...extensions.entries].map((e) => e.ns)
  const containerVerdict = checkProfileContainerRules(profile, allNamespaces)
  if (!containerVerdict.ok) {
    return {
      ok: false,
      reason: `${containerVerdict.reason}:${profile.id}`,
      refusedProfile: { id: profile.id, version: profile.version },
    }
  }

  // 5 — binding cross-check against the signed capsule declaration.
  const capsuleDecl = declarations.entries.find((e) => e.ns === CAPSULE_DECLARATION_NS)
  if (!capsuleDecl || !capsuleDecl.payload || typeof capsuleDecl.payload !== 'object' || Array.isArray(capsuleDecl.payload)) {
    return { ok: false, reason: 'missing_capsule_declaration' }
  }
  const signedContent = capsuleDecl.payload as Record<string, unknown>
  for (const field of BINDING_FIELDS) {
    const wireValue = capsule[field]
    if (wireValue === undefined || wireValue === null) continue
    const signedValue = signedContent[field]
    if (signedValue === undefined) {
      return { ok: false, reason: `under_signed_field:${field}` }
    }
    if (!canonicalEq(wireValue, signedValue)) {
      return { ok: false, reason: `binding_mismatch:${field}` }
    }
  }
  // Hash-covered large fields: verify the reference when the wire carries bytes.
  for (const field of HASH_COVERED_FIELDS) {
    const wireValue = capsule[field]
    if (wireValue === undefined || wireValue === null) continue
    const ref = signedContent[field] as { __sha256?: string } | undefined
    if (!ref || typeof ref.__sha256 !== 'string') {
      return { ok: false, reason: `under_signed_field:${field}` }
    }
    if (ref.__sha256 !== sha256OfJson(projectHashCoveredField(field, wireValue))) {
      return { ok: false, reason: `binding_mismatch:${field}` }
    }
  }

  // Party binding [VII.3.8]: the capsule's sender identity must full-claim
  // match one of the signed core parties (initiator on initiate — the only
  // capsule the initiator can send before a responder is bound).
  const senderIdentity = capsule.senderIdentity as Record<string, unknown> | undefined
  if (senderIdentity && typeof senderIdentity === 'object') {
    const matchesParty = (party: CorePartyId | null): boolean =>
      !!party &&
      party.sub === senderIdentity.sub &&
      party.iss === senderIdentity.iss &&
      party.email === senderIdentity.email &&
      party.wrdesk_user_id === senderIdentity.wrdesk_user_id
    const core = envelope.core
    const senderIsParty =
      capsule.capsule_type === 'initiate'
        ? matchesParty(core.initiator_id)
        : matchesParty(core.initiator_id) || matchesParty(core.responder_id)
    if (!senderIsParty) {
      return { ok: false, reason: 'sender_identity_not_bound_to_core_party' }
    }
  }

  return { ok: true, envelope, ignoredNamespaces }
}

/** Whether a capsule carries the new canonical form. */
export function hasCanonicalEnvelope(capsule: Record<string, unknown> | null | undefined): boolean {
  return !!capsule && typeof capsule === 'object' && capsule.wr_canonical_v3 !== undefined
}
