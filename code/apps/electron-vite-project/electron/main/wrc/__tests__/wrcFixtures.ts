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
  const sorted = [...leaves].sort()
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
  delegation: WrcDelegationRecord | null
  /** Delta v1.1 §B history payload, oldest first. */
  delegationHistory: WrcDelegationRecord[]
  txtRecords: string[]
  resolveClaim: Record<string, unknown>
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
  const ingest = makeKeyPair('wrc-ingest-1')

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

  const entryBase: Record<string, unknown> = {
    type: 'wrc/entry',
    entry_id: entryId,
    publisher_part: publisherPart,
    display: { name: 'Test Entry', icon: null, value_statement: 'Carrier-independent statement' },
    codes: [{ canonical: `${publisherPart}${entryId}C`, channels: ['assisted_email'] }],
    scopes: [hashObject({ scope: 1 })],
    evp_ref: evpHash,
    template_ref: null,
    status: options.entryStatus ?? 'published',
    epoch,
    kid: catalogKey.kid,
    sig: '',
  }
  const entry = signObject(entryBase, catalogKey) as unknown as WrcEntry
  const entryHash = hashObject(entry)

  const { root: catalogRoot, proofs } = buildMerkle([entryHash, evpHash])

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
    delegation,
    delegationHistory: delegation ? [delegation] : [],
    txtRecords: [`v=wr1; root=${fingerprintOf(root.pub)}`],
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
    async entry() {
      note('entry')
      return overrides.entry ?? { ok: true, value: fx.entryEnvelope }
    },
    async object(hash) {
      note('object')
      if (overrides.object) return overrides.object
      if (hash === fx.evpEnvelope.hash) return { ok: true, value: fx.evpEnvelope }
      if (hash === fx.entryEnvelope.hash) return { ok: true, value: fx.entryEnvelope }
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
  }
}
