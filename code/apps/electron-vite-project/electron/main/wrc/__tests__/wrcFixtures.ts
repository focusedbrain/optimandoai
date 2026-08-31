/**
 * Contract-faithful WRC test double + fixture builder.
 *
 * This is the "dev registry instance or contract-faithful test double" the
 * Phase-3 exit criteria call for. It SIGNS material the way the contract says
 * a publisher and the WRC ingest would, so the client's verification is proven
 * against real signatures, real Merkle proofs, and a real epoch sequence rather
 * than against stubs that return `true`.
 *
 * It is a test artifact only: no production module imports it, and it is the
 * one place in the repo that produces WRC signatures.
 */

import { createHash, generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto'
import { canonicalJsonString } from '@repo/ingestion-core'
import type {
  WrcCatalogHead,
  WrcDelegationRecord,
  WrcEntry,
  WrcEnvelope,
  WrcEvp,
  WrcInclusionStep,
  WrcPublisherManifest,
} from '../wrcContract'
import type { WrcDirectoryRecord, WrcOperatorRollover } from '../namespaceDirectory'
import type { WrcDevicePass, WrcDeviceRecord } from '../deviceRegistry'
import type { WrcPrincipalDelegation } from '../relayRelease'
import { nonceHash, sealToRecipient, type WrcPendingCapsule } from '../capsuleAdmission'
import type { WrcTransport, WrcTransportResult, WrcTxtResult } from '../wrcTransport'

// ── keys ──────────────────────────────────────────────────────────────────────

export interface WrcTestKeyPair {
  kid: string
  privateKey: KeyObject
  /** Raw 32-byte public key, base64url unpadded — the contract's key encoding. */
  pub: string
}

function b64url(b: Buffer): string {
  return b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function makeKeyPair(kid: string): WrcTestKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  return { kid, privateKey, pub: b64url(spki.subarray(spki.length - 32)) }
}

/** Sign canonical JSON of the object minus `sig`, no domain tag (§2). */
export function signObject<T extends Record<string, unknown>>(obj: T, key: WrcTestKeyPair): T {
  const { sig: _drop, ...unsigned } = obj as Record<string, unknown>
  const bytes = Buffer.from(canonicalJsonString(unsigned as never), 'utf8')
  return { ...(obj as Record<string, unknown>), sig: b64url(cryptoSign(null, bytes, key.privateKey)) } as T
}

/** X25519 pair for recipient-bound sealing fixtures (§XVI.7.5.2). */
export interface WrcTestBoxPair {
  privateKey: KeyObject
  /** Raw 32-byte X25519 public key, base64url unpadded. */
  pub: string
}

export function makeBoxPair(): WrcTestBoxPair {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  return { privateKey, pub: b64url(spki.subarray(spki.length - 32)) }
}

/**
 * §XVI.6.4 dual signature, layered exactly as the verifier checks it:
 * operator over (record − both sigs), publisher over (record − countersig).
 */
export function signDirectoryRecord(
  unsigned: Record<string, unknown>,
  operatorKey: WrcTestKeyPair,
  publisherKey: WrcTestKeyPair,
): WrcDirectoryRecord {
  const {
    operator_sig: _o,
    publisher_countersig: _p,
    ...base
  } = unsigned
  const operatorBytes = Buffer.from(canonicalJsonString(base as never), 'utf8')
  const operator_sig = b64url(cryptoSign(null, operatorBytes, operatorKey.privateKey))
  const withOperator = { ...base, operator_sig }
  const publisherBytes = Buffer.from(canonicalJsonString(withOperator as never), 'utf8')
  const publisher_countersig = b64url(cryptoSign(null, publisherBytes, publisherKey.privateKey))
  return { ...withOperator, publisher_countersig } as unknown as WrcDirectoryRecord
}

/** §XVI.6.4 operator rollover, dual-signed by outgoing and incoming keys. */
export function buildOperatorRollover(
  outgoing: WrcTestKeyPair,
  incoming: WrcTestKeyPair,
): WrcOperatorRollover {
  const base = {
    type: 'wrc/operator-rollover',
    outgoing_kid: outgoing.kid,
    incoming_kid: incoming.kid,
    incoming_pub: incoming.pub,
  }
  const bytes = Buffer.from(canonicalJsonString(base as never), 'utf8')
  return {
    ...base,
    sig_outgoing: b64url(cryptoSign(null, bytes, outgoing.privateKey)),
    sig_incoming: b64url(cryptoSign(null, bytes, incoming.privateKey)),
  } as WrcOperatorRollover
}

/**
 * §XVI.13.7 tenant-signed Device Record (Run 4). Signed with the tenant
 * fixture's ROOT key — the directory-registered verification key.
 */
export function signDeviceRecord(
  tenant: WrcPublisherFixture,
  spec: {
    principalPartyId: string
    devicePartyId: string
    deviceName: string
    deviceClass: string
    keyFingerprint?: string
    generation?: number
    status?: 'active' | 'revoked'
  },
  signer?: WrcTestKeyPair,
): WrcDeviceRecord {
  const key = signer ?? tenant.root
  return signObject(
    {
      type: 'wrc/device-record',
      tenant_part: tenant.publisherPart,
      principal_party_id: spec.principalPartyId,
      device_party_id: spec.devicePartyId,
      device_name: spec.deviceName,
      device_class: spec.deviceClass,
      key_fingerprint: spec.keyFingerprint ?? fingerprintOf(makeKeyPair('device-key').pub),
      generation: spec.generation ?? 1,
      status: spec.status ?? 'active',
      kid: key.kid,
      sig: '',
    } as unknown as Record<string, unknown>,
    key,
  ) as unknown as WrcDeviceRecord
}

/** §XVI.13.7 Device Pass held by the C initiator (Run 4). */
export function buildDevicePass(
  record: WrcDeviceRecord,
  spec: {
    cInitiatorPart: string
    cResponderPart: string
    registeredAt?: number
    expiresAt?: number
    status?: 'active' | 'withdrawn'
  },
): WrcDevicePass {
  return {
    type: 'wrc/device-pass',
    c_initiator_part: spec.cInitiatorPart,
    c_responder_part: spec.cResponderPart,
    record,
    registered_at: spec.registeredAt ?? 1_754_650_000,
    expires_at: spec.expiresAt ?? 4_000_000_000,
    status: spec.status ?? 'active',
  }
}

/**
 * §XVI.6.5 Delegation Certificate (Run 4): the publisher's directory-
 * registered ROOT key signs the principal's party id, SSO email, scope set,
 * and the principal's own verification key.
 */
export function signPrincipalDelegation(
  publisher: WrcPublisherFixture,
  spec: {
    principalPartyId: string
    ssoEmail: string
    principalPub: string
    scope?: string[]
    expiresAt?: number
  },
  signer?: WrcTestKeyPair,
): WrcPrincipalDelegation {
  const key = signer ?? publisher.root
  return signObject(
    {
      type: 'wrc/delegation-cert',
      publisher_part: publisher.publisherPart,
      principal_party_id: spec.principalPartyId,
      sso_email: spec.ssoEmail,
      scope: spec.scope ?? ['accept'],
      principal_pub: spec.principalPub,
      expires_at: spec.expiresAt ?? 4_000_000_000,
      kid: key.kid,
      sig: '',
    } as unknown as Record<string, unknown>,
    key,
  ) as unknown as WrcPrincipalDelegation
}

/** A receiver-side Principal Key with a detached-signature closure (Gate 5 claims). */
export function makeClaimKey(seed: string): {
  key: WrcTestKeyPair
  principal_pub: string
  sign(bytes: Buffer): string
} {
  const key = makeKeyPair(seed)
  return {
    key,
    principal_pub: key.pub,
    sign: (bytes: Buffer) => b64url(cryptoSign(null, bytes, key.privateKey)),
  }
}

/**
 * §XVI.7.5.2 Pending Handshake-Request Capsule (Run 4): nonce_I sealed to
 * the recipient's directory-registered encryption key, H(nonce_I) clear,
 * both Party Bindings, and the initiator principal's signature under its
 * Delegation Certificate.
 */
export function buildPendingCapsule(spec: {
  initiator: WrcPublisherFixture
  initiatorPrincipal: { partyId: string; email: string; key: WrcTestKeyPair }
  recipient: { partyId: string; email: string; encryptionPub: string }
  capsuleId: string
  requestInstanceId: string
  scope?: string[]
  issuedAt?: number
  expiresAt?: number
  nonce?: Buffer
  /** Delegation override (wrong scope / expired / rogue-signed vectors). */
  delegation?: WrcPrincipalDelegation
}): { capsule: WrcPendingCapsule; nonce: Buffer } {
  const nonce = spec.nonce ?? Buffer.from(`nonce-${spec.capsuleId}`, 'utf8')
  const delegation =
    spec.delegation ??
    signPrincipalDelegation(spec.initiator, {
      principalPartyId: spec.initiatorPrincipal.partyId,
      ssoEmail: spec.initiatorPrincipal.email,
      principalPub: spec.initiatorPrincipal.key.pub,
      scope: ['initiate'],
    })
  const capsule = signObject(
    {
      type: 'wrc/pending-capsule',
      capsule_id: spec.capsuleId,
      request_instance_id: spec.requestInstanceId,
      initiator_part: spec.initiator.publisherPart,
      party_bindings: {
        initiator: { party_id: spec.initiatorPrincipal.partyId, email: spec.initiatorPrincipal.email },
        recipient: { party_id: spec.recipient.partyId, email: spec.recipient.email },
      },
      scope: spec.scope ?? ['handshake'],
      nonce_i_sealed: sealToRecipient(spec.recipient.encryptionPub, nonce, spec.capsuleId),
      nonce_i_hash: nonceHash(nonce),
      issued_at: spec.issuedAt ?? 1_754_650_000,
      expires_at: spec.expiresAt ?? 4_000_000_000,
      delegation,
      sig: '',
    } as unknown as Record<string, unknown>,
    spec.initiatorPrincipal.key,
  ) as unknown as WrcPendingCapsule
  return { capsule, nonce }
}

export function hashObject(obj: unknown): string {
  const bytes = Buffer.from(canonicalJsonString(obj as never), 'utf8')
  return `sha256:${b64url(createHash('sha256').update(bytes).digest())}`
}

export function fingerprintOf(pubB64Url: string): string {
  const raw = Buffer.from(pubB64Url.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  return createHash('sha256').update(raw).digest('hex')
}

// ── Merkle ────────────────────────────────────────────────────────────────────

function hashBytes(h: string): Buffer {
  return Buffer.from(h.slice('sha256:'.length).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}
function toHash(b: Buffer): string {
  return `sha256:${b64url(b)}`
}

/**
 * Build a tree over leaf hashes sorted lexicographically (§2) and return the
 * root plus an inclusion proof per leaf. Odd node promotes.
 */
export function buildMerkle(leaves: readonly string[]): {
  root: string
  proofs: Map<string, WrcInclusionStep[]>
} {
  // One leaf per object: two catalog rows referencing the SAME object (e.g.
  // sub-handshake siblings sharing one EVP) must not duplicate its leaf, or
  // the per-hash proof map would interleave two positions into one path.
  const sorted = [...new Set(leaves)].sort()
  const proofs = new Map<string, WrcInclusionStep[]>()
  for (const l of sorted) proofs.set(l, [])
  if (sorted.length === 0) return { root: toHash(createHash('sha256').digest()), proofs }

  let level = sorted.map((h) => ({ hash: hashBytes(h), members: [h] }))
  while (level.length > 1) {
    const next: Array<{ hash: Buffer; members: string[] }> = []
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!
      const right = level[i + 1]
      if (!right) {
        next.push(left) // odd node promotes unchanged
        continue
      }
      for (const m of left.members) proofs.get(m)!.push({ pos: 'right', hash: toHash(right.hash) })
      for (const m of right.members) proofs.get(m)!.push({ pos: 'left', hash: toHash(left.hash) })
      next.push({
        hash: createHash('sha256').update(Buffer.concat([left.hash, right.hash])).digest(),
        members: [...left.members, ...right.members],
      })
    }
    level = next
  }
  return { root: toHash(level[0]!.hash), proofs }
}

// ── Publisher fixture ─────────────────────────────────────────────────────────

export interface WrcPublisherFixtureOptions {
  publisherPart?: string
  domain?: string
  entryId?: string
  epoch?: number
  issuedAt?: number
  freshnessWindowS?: number
  /** Sign the head with a delegated catalog key instead of the root key. */
  useDelegation?: boolean
  /** Delegation validity, when `useDelegation`. */
  delegationValidFromEpoch?: number
  delegationRevokedFromEpoch?: number | null
  entryStatus?: 'published' | 'suspended' | 'retired'
  /** Attach a platform suspension record to the entry envelope (A5). */
  suspendEntry?: boolean
  /** Pad the EVP past the 64 KiB canonical budget (§3.3). */
  oversizedEvp?: boolean
  /**
   * Override the record embedded in the head (delta v1.1 §A). `null` produces a
   * delegated head with NO embedded record; a record produces a substituted
   * one. Leave undefined for the correct record.
   */
  headDelegationOverride?: WrcDelegationRecord | null
  /** Sign the delegation with this key instead of the publisher root. */
  delegationSigner?: WrcTestKeyPair
  /** Override the delegation's `root_kid` — used to attempt sub-delegation. */
  delegationRootKid?: string
  /** §XVI.5.10 designation block on the primary entry (Run 3). */
  entryDesignation?: Record<string, unknown> | null
  /**
   * Additional entries under the SAME catalog head (Run 3): parent entries,
   * combination-code expansions, sibling sub-handshakes. `lookupKey` is the
   * resolver lookup id (a combination block, a responder part for a C pair, a
   * repository id); `entryId` is the entry's own id — for a combination
   * lookup they differ, which IS the expansion.
   */
  extraEntries?: Array<{
    lookupKey: string
    entryId: string
    status?: 'published' | 'suspended' | 'retired'
    designation?: Record<string, unknown> | null
    suspend?: boolean
  }>
  /** Share one WRC ingest key across fixtures (multi-publisher scenarios). */
  ingestKey?: WrcTestKeyPair
  /** Share one directory OPERATOR key across fixtures (Run 4, §XVI.6.4). */
  operatorKey?: WrcTestKeyPair
  /** Merged into the unsigned directory record BEFORE dual signing (Run 4). */
  directoryOverrides?: Record<string, unknown>
}

export interface WrcPublisherFixture {
  publisherPart: string
  domain: string
  entryId: string
  epoch: number
  root: WrcTestKeyPair
  catalogKey: WrcTestKeyPair
  ingest: WrcTestKeyPair
  manifest: WrcPublisherManifest
  head: WrcCatalogHead
  entry: WrcEntry
  evp: WrcEvp
  entryEnvelope: WrcEnvelope
  evpEnvelope: WrcEnvelope
  /** Run 3: envelopes for `extraEntries`, by lookup key / by object hash. */
  entriesByLookup: Map<string, WrcEnvelope>
  envelopesByHash: Map<string, WrcEnvelope>
  delegation: WrcDelegationRecord | null
  /** Delta v1.1 §B history payload, oldest first. */
  delegationHistory: WrcDelegationRecord[]
  txtRecords: string[]
  resolveClaim: Record<string, unknown>
  /** Run 4 (§XVI.6.4): the directory operator key that signed the record. */
  operator: WrcTestKeyPair
  /** Run 4 (§XVI.7.5.2): directory-registered X25519 encryption pair. */
  encryption: WrcTestBoxPair
  /** Run 4: the dual-signed Namespace Directory Record. */
  directoryRecord: WrcDirectoryRecord
}

export function buildPublisherFixture(
  options: WrcPublisherFixtureOptions = {},
): WrcPublisherFixture {
  const publisherPart = options.publisherPart ?? 'WR7X4K'
  const domain = options.domain ?? 'publisher.test'
  const entryId = options.entryId ?? '9B2M3'
  const epoch = options.epoch ?? 7
  const issuedAt = options.issuedAt ?? 1_754_650_000
  const freshnessWindowS = options.freshnessWindowS ?? 86_400

  const root = makeKeyPair('root-a1')
  const catalogKey = options.useDelegation ? makeKeyPair('cat-b2') : root
  const ingest = options.ingestKey ?? makeKeyPair('wrc-ingest-1')

  const delegation: WrcDelegationRecord | null = options.useDelegation
    ? (signObject(
        {
          type: 'wrc/catalog-delegation',
          publisher_part: publisherPart,
          delegate_kid: catalogKey.kid,
          delegate_pub: catalogKey.pub,
          authority: 'catalog-signing-only',
          valid_from_epoch: options.delegationValidFromEpoch ?? 1,
          revoked_from_epoch: options.delegationRevokedFromEpoch ?? null,
          root_kid: options.delegationRootKid ?? root.kid,
          sig: '',
        } as unknown as Record<string, unknown>,
        options.delegationSigner ?? root,
      ) as unknown as WrcDelegationRecord)
    : null

  const manifest = signObject(
    {
      type: 'wr/manifest',
      domain,
      publisher_part: publisherPart,
      root_kid: root.kid,
      root_pub: root.pub,
      sig: '',
    } as unknown as Record<string, unknown>,
    root,
  ) as unknown as WrcPublisherManifest

  const evpBase: Record<string, unknown> = {
    type: 'wrc/evp',
    publisher_part: publisherPart,
    entry_id: entryId,
    self_description: options.oversizedEvp ? 'x'.repeat(70_000) : 'A publisher of test entries.',
    value_statement: 'Signed value statement from the verified EVP.',
    scope_directory: [
      {
        scope: hashObject({ scope: 1 }),
        name: 'Scope one',
        desc: 'First scope',
        size_hint_b: 12_345,
        prefetch: 'none',
      },
    ],
    preparation_view: null,
    next_steps: ['Review the offer'],
    audit_links: true,
    epoch,
    kid: catalogKey.kid,
    sig: '',
  }
  const evp = signObject(evpBase, catalogKey) as unknown as WrcEvp
  const evpHash = hashObject(evp)

  const makeEntry = (
    id: string,
    status: 'published' | 'suspended' | 'retired',
    evpRef: string,
    designation: Record<string, unknown> | null | undefined,
  ): { entry: WrcEntry; hash: string } => {
    const base: Record<string, unknown> = {
      type: 'wrc/entry',
      entry_id: id,
      publisher_part: publisherPart,
      display: { name: 'Test Entry', icon: null, value_statement: 'Carrier-independent statement' },
      codes: [{ canonical: `${publisherPart}${id}C`, channels: ['assisted_email'] }],
      scopes: [hashObject({ scope: 1 })],
      evp_ref: evpRef,
      template_ref: null,
      status,
      designation: designation ?? null,
      epoch,
      kid: catalogKey.kid,
      sig: '',
    }
    const signed = signObject(base, catalogKey) as unknown as WrcEntry
    return { entry: signed, hash: hashObject(signed) }
  }

  const makeEvpFor = (id: string): { evp: WrcEvp; hash: string } => {
    const signed = signObject({ ...evpBase, entry_id: id }, catalogKey) as unknown as WrcEvp
    return { evp: signed, hash: hashObject(signed) }
  }

  const { entry, hash: entryHash } = makeEntry(
    entryId,
    options.entryStatus ?? 'published',
    evpHash,
    options.entryDesignation,
  )

  // Run 3: extra entries (parents, expansions) each with their own EVP, all
  // under the ONE catalog head so inclusion proofs stay real.
  const extraBuilt: Array<{
    lookupKey: string
    entry: WrcEntry
    entryHash: string
    evp: WrcEvp
    evpHash: string
    suspend: boolean
  }> = (options.extraEntries ?? []).map((spec) => {
    const extraEvp = makeEvpFor(spec.entryId)
    const built = makeEntry(spec.entryId, spec.status ?? 'published', extraEvp.hash, spec.designation)
    return {
      lookupKey: spec.lookupKey,
      entry: built.entry,
      entryHash: built.hash,
      evp: extraEvp.evp,
      evpHash: extraEvp.hash,
      suspend: spec.suspend === true,
    }
  })

  const { root: catalogRoot, proofs } = buildMerkle([
    entryHash,
    evpHash,
    ...extraBuilt.flatMap((b) => [b.entryHash, b.evpHash]),
  ])

  // Delta v1.1 §A: the delegation travels IN the head, so verification needs
  // nothing but the DNS-pinned root and this object.
  const head = signObject(
    {
      type: 'wrc/catalog-head',
      publisher_part: publisherPart,
      domain,
      catalog_root: catalogRoot,
      epoch,
      issued_at: issuedAt,
      freshness_window_s: freshnessWindowS,
      kid: catalogKey.kid,
      delegation: (options.headDelegationOverride === undefined
        ? delegation
        : options.headDelegationOverride) as unknown as Record<string, unknown> | null,
      sig: '',
    } as unknown as Record<string, unknown>,
    catalogKey,
  ) as unknown as WrcCatalogHead

  const countersign = (hash: string): string =>
    b64url(cryptoSign(null, Buffer.from(`${hash}${String(epoch)}`, 'utf8'), ingest.privateKey))

  const entryEnvelope: WrcEnvelope = {
    object: entry as unknown as Record<string, unknown>,
    hash: entryHash,
    publisher_sig_valid_kid: catalogKey.kid,
    ingest_countersig: { kid: ingest.kid, at: issuedAt + 100, sig: countersign(entryHash) },
    epoch,
    inclusion_proof: proofs.get(entryHash)!,
    suspension: options.suspendEntry
      ? { since: issuedAt + 500, reason_code: 'platform_review', reversible: true }
      : null,
  }

  const evpEnvelope: WrcEnvelope = {
    object: evp as unknown as Record<string, unknown>,
    hash: evpHash,
    publisher_sig_valid_kid: catalogKey.kid,
    ingest_countersig: { kid: ingest.kid, at: issuedAt + 100, sig: countersign(evpHash) },
    epoch,
    inclusion_proof: proofs.get(evpHash)!,
    suspension: null,
  }

  const envelopeOf = (
    object: Record<string, unknown>,
    hash: string,
    suspend: boolean,
  ): WrcEnvelope => ({
    object,
    hash,
    publisher_sig_valid_kid: catalogKey.kid,
    ingest_countersig: { kid: ingest.kid, at: issuedAt + 100, sig: countersign(hash) },
    epoch,
    inclusion_proof: proofs.get(hash)!,
    suspension: suspend
      ? { since: issuedAt + 500, reason_code: 'platform_review', reversible: true }
      : null,
  })

  const entriesByLookup = new Map<string, WrcEnvelope>()
  const envelopesByHash = new Map<string, WrcEnvelope>([
    [entryHash, entryEnvelope],
    [evpHash, evpEnvelope],
  ])
  entriesByLookup.set(entryId, entryEnvelope)
  for (const b of extraBuilt) {
    const env = envelopeOf(b.entry as unknown as Record<string, unknown>, b.entryHash, b.suspend)
    const evpEnv = envelopeOf(b.evp as unknown as Record<string, unknown>, b.evpHash, false)
    entriesByLookup.set(b.lookupKey, env)
    envelopesByHash.set(b.entryHash, env)
    envelopesByHash.set(b.evpHash, evpEnv)
  }

  // Run 4 — the §XVI.6.4 directory record: publisher verification key(s) =
  // the DNS-pinned root (this is what binds the Phase-3 entry chain to the
  // directory), plus the X25519 encryption key for recipient-bound sealing.
  const operator = options.operatorKey ?? makeKeyPair('dir-op-1')
  const encryption = makeBoxPair()
  const directoryRecord = signDirectoryRecord(
    {
      type: 'wrc/directory-record',
      publisher_part: publisherPart,
      keys: [{ kid: root.kid, pub: root.pub, generation: 1 }],
      encryption_pub: encryption.pub,
      resolver_endpoints: [`https://registry.test/v1/publishers/${publisherPart}`],
      relay_endpoints: [`https://relay.test/v1/${publisherPart}`],
      grammar_version: '1.95',
      domains: [domain],
      display_origin: null,
      account_holder_vetted: true,
      status: 'active',
      successor_publisher_part: null,
      generation: 3,
      expires_at: 4_000_000_000,
      operator_kid: operator.kid,
      publisher_kid: root.kid,
      ...(options.directoryOverrides ?? {}),
    },
    operator,
    root,
  )

  return {
    publisherPart,
    domain,
    entryId,
    epoch,
    root,
    catalogKey,
    ingest,
    manifest,
    head,
    entry,
    evp,
    entryEnvelope,
    evpEnvelope,
    entriesByLookup,
    envelopesByHash,
    delegation,
    delegationHistory: delegation ? [delegation] : [],
    txtRecords: [`v=wr1; part=${publisherPart}; root=${fingerprintOf(root.pub)}`],
    operator,
    encryption,
    directoryRecord,
    resolveClaim: {
      domain,
      status: 'active',
      generation: 1,
      catalog_head: head,
      root_fingerprint: fingerprintOf(root.pub),
    },
  }
}

// ── Transport double ──────────────────────────────────────────────────────────

export interface FixtureTransportOverrides {
  resolve?: WrcTransportResult
  catalogHead?: WrcTransportResult
  delegations?: WrcTransportResult
  entry?: WrcTransportResult
  object?: WrcTransportResult
  publisherManifest?: WrcTransportResult
  txt?: WrcTxtResult
  directoryRecord?: WrcTransportResult
  /** Called on every transport method — lets a test prove what was NOT called. */
  onCall?: (method: string) => void
}

/** Contract-faithful in-memory transport over a fixture. */
export function createFixtureTransport(
  fx: WrcPublisherFixture,
  overrides: FixtureTransportOverrides = {},
): WrcTransport {
  const note = (m: string) => overrides.onCall?.(m)
  return {
    async resolve() {
      note('resolve')
      return overrides.resolve ?? { ok: true, value: fx.resolveClaim }
    },
    async catalogHead() {
      note('catalogHead')
      return overrides.catalogHead ?? { ok: true, value: fx.head }
    },
    async delegations() {
      note('delegations')
      // Delta v1.1 §B: append-only rotation history, oldest first. Audit only.
      return overrides.delegations ?? { ok: true, value: fx.delegationHistory }
    },
    async entry(_part, entryId) {
      note('entry')
      if (overrides.entry) return overrides.entry
      // Run 3: serve by lookup key when the id is known (combination blocks,
      // pair responders); legacy fallback keeps single-entry tests unchanged.
      const byLookup = fx.entriesByLookup.get(entryId)
      if (byLookup) return { ok: true, value: byLookup }
      return { ok: true, value: fx.entryEnvelope }
    },
    async object(hash) {
      note('object')
      if (overrides.object) return overrides.object
      const env = fx.envelopesByHash.get(hash)
      if (env) return { ok: true, value: env }
      return { ok: false, code: 'http_status', message: 'HTTP 404', status: 404 }
    },
    async publisherManifest() {
      note('publisherManifest')
      return overrides.publisherManifest ?? { ok: true, value: fx.manifest }
    },
    async wrTxtRecords() {
      note('wrTxtRecords')
      return overrides.txt ?? { ok: true, records: fx.txtRecords }
    },
    async directoryRecord() {
      note('directoryRecord')
      return overrides.directoryRecord ?? { ok: true, value: fx.directoryRecord }
    },
  }
}

/**
 * Run 3: one transport over SEVERAL publisher fixtures, routed by publisher
 * part / domain — what a C ordered pair or an SC responder verification needs.
 * Build the fixtures with a shared `ingestKey` so one client can verify all
 * countersignatures.
 */
export function createMultiFixtureTransport(fixtures: readonly WrcPublisherFixture[]): WrcTransport {
  const byPart = new Map(fixtures.map((f) => [f.publisherPart, f]))
  const byDomain = new Map(fixtures.map((f) => [f.domain, f]))
  const notFound = { ok: false as const, code: 'http_status' as const, message: 'HTTP 404', status: 404 }

  return {
    async resolve(part) {
      const fx = byPart.get(part)
      return fx ? { ok: true, value: fx.resolveClaim } : notFound
    },
    async catalogHead(part) {
      const fx = byPart.get(part)
      return fx ? { ok: true, value: fx.head } : notFound
    },
    async delegations(part) {
      const fx = byPart.get(part)
      return fx ? { ok: true, value: fx.delegationHistory } : notFound
    },
    async entry(part, entryId) {
      const fx = byPart.get(part)
      if (!fx) return notFound
      const env = fx.entriesByLookup.get(entryId)
      return env ? { ok: true, value: env } : notFound
    },
    async object(hash) {
      for (const fx of fixtures) {
        const env = fx.envelopesByHash.get(hash)
        if (env) return { ok: true, value: env }
      }
      return notFound
    },
    async publisherManifest(domain) {
      const fx = byDomain.get(domain)
      return fx ? { ok: true, value: fx.manifest } : notFound
    },
    async wrTxtRecords(domain) {
      const fx = byDomain.get(domain)
      return fx ? { ok: true, records: fx.txtRecords } : { ok: true, records: [] }
    },
    async directoryRecord(part) {
      const fx = byPart.get(part)
      return fx ? { ok: true, value: fx.directoryRecord } : notFound
    },
  }
}
