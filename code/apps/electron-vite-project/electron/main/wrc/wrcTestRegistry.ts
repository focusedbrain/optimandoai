/**
 * Built-in WR Code test registry — `wrc-test` builds only.
 *
 * An in-process registry behind the transport seam (`wrcTransport.ts`). It
 * answers every call the WRC client makes — resolve, entry, object, manifest,
 * `_wr` TXT, directory — from publishers it builds and signs itself, so a test
 * build exercises the six gates end to end with no server, no certificate and
 * no network. Everything above the seam (decoders, signatures, Merkle proofs,
 * directory verification, all gates) runs unchanged.
 *
 * Deterministic: every key derives from a fixed seed, so every machine that
 * runs a test build sees the same publishers, keys and codes.
 *
 * Containment (WRC contract v2.0, this repo's build rules):
 *   - Release builds alias this module to `wrcTestRegistry.release-stub.ts`
 *     (`vite.config.ts`), and `scripts/verify-wrc-build-flavor.cjs` fails a
 *     release build whose main bundle still contains {@link WRC_TEST_REGISTRY_MARKER}.
 *   - Every key id carries the `test-` prefix, which release trust refuses.
 *   - Every domain is under the reserved `.test` TLD (RFC 2606).
 *   - The runtime keeps test state in its own security DB file.
 *
 * The signed-in account's SSO email domain is registered, live, as a domain of
 * the test identity's own publisher, so the user's real session can act for it
 * at Gate 2 and receive C and SC references at Gate 4.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  type KeyObject,
} from 'node:crypto'
import { buildWrCodeReference, type WrCodeClass } from '@repo/ingestion-core'
import { wrcCanonicalBytes, wrcHashObject, wrcHashToBytes } from './wrcCrypto'
import type { WrcInclusionStep } from './wrcContract'
import type { WrcTransport, WrcTransportResult, WrcTxtResult } from './wrcTransport'
import { WRC_TRANSPORT_MAX_BYTES } from './wrcTransport'
import type { WrcRuntimeIdentity } from './wrcIdentity'
import { defaultUseLimitProfile, type WrcUseLimitStore } from './useLimitStore'

/** Seed namespace; also the marker the release-bundle guard searches for. */
export const WRC_TEST_REGISTRY_MARKER = 'optirando-wrc-test-registry/v1'

export const WRC_TEST_REGISTRY_BASE_URL = 'wrc-test://in-process'

/** The test identity's own publisher (C responder, SC receiving publisher). */
export const WRC_TEST_OWN_PUBLISHER = 'TEST02'
export const WRC_TEST_PARTY_ID = 'test-party-1'

export type WrcTestExpectation =
  | { ok: true }
  | { ok: false; gate: 1 | 2 | 3 | 4 | 5 | 6; reason: string }

export interface WrcTestCode {
  /** Ungrouped canonical form, e.g. `PTEST0110001…`. */
  canonical: string
  /** Grouped rendering for people, e.g. `P-TEST01-10001…`. */
  display: string
  label: string
  /** Outcome of a first submission by the test identity. */
  expect: WrcTestExpectation
}

export interface WrcTestRegistry {
  config: {
    registryBaseUrl: string
    ingestPublicKey: string
    directoryOperatorKid: string
    directoryOperatorPub: string
  }
  transport: WrcTransport
  /** Receiver identity without `sso_email`; the runtime adds the live session email. */
  identity(): WrcRuntimeIdentity
  /** Declare the §XVI.8.4 one-time-use entries (idempotent; never resets state). */
  seedUseLimits(store: WrcUseLimitStore): void
  codes: readonly WrcTestCode[]
}

export interface WrcTestRegistryOptions {
  /** Unix seconds; catalog heads are issued at this time. */
  now?: () => number
  /** The signed-in account's SSO email, read on every directory answer. */
  ssoEmail?: () => string | null
}

// ── Test data ─────────────────────────────────────────────────────────────────

type PublisherStatus = 'active' | 'inactive' | 'revoked' | 'superseded' | 'compromised'

interface PublisherSpec {
  part: string
  domain: string
  name: string
  status: PublisherStatus
  successor?: string
}

const PUBLISHERS: readonly PublisherSpec[] = [
  { part: 'TEST01', domain: 'publisher-a.test', name: 'Test Publisher A', status: 'active' },
  { part: 'TEST02', domain: 'publisher-b.test', name: 'Test Publisher B (you)', status: 'active' },
  { part: 'TEST03', domain: 'publisher-inactive.test', name: 'Inactive Test Publisher', status: 'inactive' },
  { part: 'TEST04', domain: 'publisher-revoked.test', name: 'Revoked Test Publisher', status: 'revoked' },
  {
    part: 'TEST05',
    domain: 'publisher-superseded.test',
    name: 'Superseded Test Publisher',
    status: 'superseded',
    successor: 'TEST01',
  },
  {
    part: 'TEST06',
    domain: 'publisher-compromised.test',
    name: 'Compromised Test Publisher',
    status: 'compromised',
  },
]

interface EntrySpec {
  part: string
  cls: WrCodeClass
  /** Block 3: P local block, C responder, or combination code. */
  block: string
  /** Repository id; equals the local block for P (contract v2.0 §4.2). */
  entryId: string
  label: string
  status?: 'published' | 'suspended' | 'retired'
  platformSuspended?: boolean
  designation?: Record<string, unknown>
  oneTimeUse?: boolean
  expect: WrcTestExpectation
}

const OK: WrcTestExpectation = { ok: true }
const refused = (gate: 1 | 2 | 3 | 4 | 5 | 6, reason: string): WrcTestExpectation => ({
  ok: false,
  gate,
  reason,
})

const EXPIRED_AT = 1_700_000_000
const FAR_FUTURE = 4_000_000_000

const ENTRIES: readonly EntrySpec[] = [
  { part: 'TEST01', cls: 'P', block: '10001', entryId: '10001', label: 'Published offering', expect: OK },
  {
    part: 'TEST01',
    cls: 'P',
    block: '10005',
    entryId: '10005',
    label: 'One-time offering',
    oneTimeUse: true,
    expect: OK,
  },
  {
    part: 'TEST01',
    cls: 'P',
    block: '10002',
    entryId: '10002',
    label: 'Offering suspended by the platform',
    platformSuspended: true,
    expect: refused(3, 'entry_platform_suspended'),
  },
  {
    part: 'TEST01',
    cls: 'P',
    block: '10003',
    entryId: '10003',
    label: 'Offering suspended by the publisher',
    status: 'suspended',
    expect: refused(3, 'entry_suspended'),
  },
  {
    part: 'TEST01',
    cls: 'P',
    block: '10004',
    entryId: '10004',
    label: 'Retired offering',
    status: 'retired',
    expect: refused(3, 'entry_retired'),
  },
  {
    part: 'TEST01',
    cls: 'I',
    block: '200001',
    entryId: 'ctx-200001',
    label: 'Internal handshake addressed to you',
    designation: {
      cls: 'I',
      combination: '200001',
      receiving_party: { kind: 'principal', id: WRC_TEST_PARTY_ID },
    },
    expect: OK,
  },
  {
    part: 'TEST01',
    cls: 'I',
    block: '200002',
    entryId: 'ctx-200002',
    label: 'Internal handshake addressed to someone else',
    designation: {
      cls: 'I',
      combination: '200002',
      receiving_party: { kind: 'principal', id: 'test-party-9' },
    },
    expect: refused(4, 'NOT_FOR_YOU'),
  },
  {
    part: 'TEST01',
    cls: 'SP',
    block: '300001',
    entryId: 'sub-300001',
    label: 'Sub-handshake beneath the published offering',
    designation: {
      cls: 'SP',
      combination: '300001',
      receiving_party: { kind: 'principal', id: WRC_TEST_PARTY_ID },
      parent: { cls: 'P', publisher_part: 'TEST01', entry_id: '10001' },
    },
    expect: OK,
  },
  {
    part: 'TEST01',
    cls: 'SE',
    block: '400001',
    entryId: 'ses-400001',
    label: 'Session sub-handshake, session valid',
    designation: {
      cls: 'SE',
      combination: '400001',
      receiving_party: { kind: 'principal', id: WRC_TEST_PARTY_ID },
      parent: { cls: 'P', publisher_part: 'TEST01', entry_id: '10001' },
      session: { id: 'test-session-open', not_before: null, expires_at: FAR_FUTURE },
    },
    expect: OK,
  },
  {
    part: 'TEST01',
    cls: 'SE',
    block: '400002',
    entryId: 'ses-400002',
    label: 'Session sub-handshake, session expired',
    designation: {
      cls: 'SE',
      combination: '400002',
      receiving_party: { kind: 'principal', id: WRC_TEST_PARTY_ID },
      parent: { cls: 'P', publisher_part: 'TEST01', entry_id: '10001' },
      session: { id: 'test-session-expired', not_before: null, expires_at: EXPIRED_AT },
    },
    expect: refused(3, 'entry_expired'),
  },
  {
    part: 'TEST01',
    cls: 'C',
    block: WRC_TEST_OWN_PUBLISHER,
    entryId: 'rel-TEST02',
    label: 'Cross-organization handshake to your publisher',
    designation: { cls: 'C', initiator_part: 'TEST01', counterparty_part: WRC_TEST_OWN_PUBLISHER },
    expect: OK,
  },
  {
    part: 'TEST01',
    cls: 'SC',
    block: '500001',
    entryId: 'sub-500001',
    label: 'Sub-handshake beneath the cross-organization handshake',
    designation: {
      cls: 'SC',
      combination: '500001',
      receiving_party: { kind: 'publisher', id: WRC_TEST_OWN_PUBLISHER },
      parent: { cls: 'C', publisher_part: 'TEST01', counterparty_part: WRC_TEST_OWN_PUBLISHER },
    },
    expect: OK,
  },
  {
    part: 'TEST02',
    cls: 'P',
    block: '10001',
    entryId: '10001',
    label: "Your publisher's own offering",
    expect: OK,
  },
  ...(['TEST03', 'TEST04', 'TEST05', 'TEST06'] as const).map(
    (part): EntrySpec => ({
      part,
      cls: 'P',
      block: '10001',
      entryId: '10001',
      label: 'Offering',
      expect: refused(
        2,
        {
          TEST03: 'namespace_inactive',
          TEST04: 'namespace_revoked',
          TEST05: 'namespace_superseded',
          TEST06: 'namespace_compromised',
        }[part],
      ),
    }),
  ),
]

// ── Deterministic key material ────────────────────────────────────────────────

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const PKCS8_X25519_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex')

const b64url = (b: Buffer): string =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

interface TestKey {
  kid: string
  priv: KeyObject
  pub: string
}

function seedOf(label: string): Buffer {
  return createHash('sha256').update(`${WRC_TEST_REGISTRY_MARKER}/${label}`).digest()
}

function derivedKey(kid: string, prefix: Buffer): TestKey {
  const priv = createPrivateKey({
    key: Buffer.concat([prefix, seedOf(kid)]),
    format: 'der',
    type: 'pkcs8',
  })
  const spki = createPublicKey(priv).export({ format: 'der', type: 'spki' }) as Buffer
  return { kid, priv, pub: b64url(spki.subarray(spki.length - 32)) }
}

const signingKey = (kid: string) => derivedKey(kid, PKCS8_ED25519_PREFIX)
const boxKey = (kid: string) => derivedKey(kid, PKCS8_X25519_PREFIX)

function fingerprint(pub: string): string {
  const raw = Buffer.from(pub.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  return createHash('sha256').update(raw).digest('hex')
}

function signBytes(bytes: Buffer, key: TestKey): string {
  return b64url(cryptoSign(null, bytes, key.priv))
}

/** Contract §2: Ed25519 over the canonical object minus its `sig`. */
function signObject(unsigned: Record<string, unknown>, key: TestKey): Record<string, unknown> {
  return { ...unsigned, sig: signBytes(wrcCanonicalBytes(unsigned), key) }
}

// ── Merkle (contract §2, as the client folds it) ──────────────────────────────

function buildMerkle(leaves: readonly string[]): { root: string; proofs: Map<string, WrcInclusionStep[]> } {
  const sorted = [...new Set(leaves)].sort()
  const proofs = new Map<string, WrcInclusionStep[]>(sorted.map((l) => [l, []]))
  const toHash = (b: Buffer) => `sha256:${b64url(b)}`
  if (sorted.length === 0) return { root: toHash(createHash('sha256').digest()), proofs }
  let level = sorted.map((h) => ({ hash: wrcHashToBytes(h)!, members: [h] }))
  while (level.length > 1) {
    const next: typeof level = []
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i]!
      const right = level[i + 1]
      if (!right) {
        next.push(left)
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

// ── Wire answers ──────────────────────────────────────────────────────────────

const NOT_FOUND: WrcTransportResult = { ok: false, code: 'http_status', message: 'HTTP 404', status: 404 }

/** Serialize and re-parse, within the wire cap: the client sees exactly what HTTP would deliver. */
function answer(value: unknown, maxBytes: number): WrcTransportResult {
  const text = JSON.stringify(value)
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    return { ok: false, code: 'response_too_large', message: `response exceeds ${maxBytes} bytes` }
  }
  return { ok: true, value: JSON.parse(text) as unknown }
}

function referenceOf(cls: WrCodeClass, part: string, block: string): { canonical: string; display: string } {
  const r = buildWrCodeReference(cls, [part, block])
  if (!r.ok) throw new Error(`test registry vector ${cls}-${part}-${block}: ${r.reason}`)
  return { canonical: r.canonical, display: r.display }
}

// ── The registry ──────────────────────────────────────────────────────────────

interface BuiltPublisher {
  spec: PublisherSpec
  root: TestKey
  box: TestKey
  manifest: Record<string, unknown>
  resolveClaim: Record<string, unknown>
  head: Record<string, unknown>
  entriesByKey: Map<string, Record<string, unknown>>
}

export function createWrcTestRegistry(options: WrcTestRegistryOptions = {}): WrcTestRegistry {
  const now = options.now ?? (() => Math.floor(Date.now() / 1000))
  const ssoEmail = options.ssoEmail ?? (() => null)
  const issuedAt = now()
  const epoch = 1

  const operator = signingKey('test-directory-operator')
  const ingest = signingKey('test-ingest')
  const envelopesByHash = new Map<string, Record<string, unknown>>()
  const publishers = new Map<string, BuiltPublisher>()

  for (const spec of PUBLISHERS) {
    const root = signingKey(`test-root-${spec.part}`)
    const box = boxKey(`test-box-${spec.part}`)
    const built: Array<{ key: string; entry: Record<string, unknown>; entryHash: string; evp: Record<string, unknown>; evpHash: string; suspend: boolean }> = []

    for (const e of ENTRIES.filter((x) => x.part === spec.part)) {
      const ref = referenceOf(e.cls, spec.part, e.block)
      const statement = `${e.label}. Built-in test data from ${spec.name}; not a real publisher.`
      const evp = signObject(
        {
          type: 'wrc/evp',
          publisher_part: spec.part,
          entry_id: e.entryId,
          self_description: 'Optirando WR Code test registry. Every value here is test data.',
          value_statement: statement,
          scope_directory: [],
          preparation_view: null,
          next_steps: ['Review the test offer'],
          audit_links: false,
          epoch,
          kid: root.kid,
        },
        root,
      )
      const evpHash = wrcHashObject(evp)
      const entry = signObject(
        {
          type: 'wrc/entry',
          entry_id: e.entryId,
          publisher_part: spec.part,
          display: { name: e.label, icon: null, value_statement: statement },
          codes: [{ canonical: ref.canonical, channels: ['manual_entry'] }],
          scopes: [],
          evp_ref: evpHash,
          template_ref: null,
          status: e.status ?? 'published',
          designation: e.designation ?? null,
          epoch,
          kid: root.kid,
        },
        root,
      )
      built.push({
        key: e.block,
        entry,
        entryHash: wrcHashObject(entry),
        evp,
        evpHash,
        suspend: e.platformSuspended === true,
      })
    }

    const { root: catalogRoot, proofs } = buildMerkle(built.flatMap((b) => [b.entryHash, b.evpHash]))
    const head = signObject(
      {
        type: 'wrc/catalog-head',
        publisher_part: spec.part,
        domain: spec.domain,
        catalog_root: catalogRoot,
        epoch,
        issued_at: issuedAt,
        freshness_window_s: 30 * 86_400,
        kid: root.kid,
        delegation: null,
      },
      root,
    )
    const envelope = (object: Record<string, unknown>, hash: string, suspend: boolean) => ({
      object,
      hash,
      publisher_sig_valid_kid: root.kid,
      ingest_countersig: {
        kid: ingest.kid,
        at: issuedAt,
        sig: signBytes(Buffer.from(`${hash}${String(epoch)}`, 'utf8'), ingest),
      },
      epoch,
      inclusion_proof: proofs.get(hash)!,
      suspension: suspend ? { since: issuedAt, reason_code: 'test_platform_review', reversible: true } : null,
    })
    const entriesByKey = new Map<string, Record<string, unknown>>()
    for (const b of built) {
      const entryEnv = envelope(b.entry, b.entryHash, b.suspend)
      entriesByKey.set(b.key, entryEnv)
      envelopesByHash.set(b.entryHash, entryEnv)
      envelopesByHash.set(b.evpHash, envelope(b.evp, b.evpHash, false))
    }

    publishers.set(spec.part, {
      spec,
      root,
      box,
      manifest: signObject(
        {
          type: 'wr/manifest',
          domain: spec.domain,
          publisher_part: spec.part,
          root_kid: root.kid,
          root_pub: root.pub,
        },
        root,
      ),
      resolveClaim: {
        domain: spec.domain,
        status: spec.status,
        generation: 1,
        catalog_head: head,
        root_fingerprint: fingerprint(root.pub),
      },
      head,
      entriesByKey,
    })
  }

  const ssoDomain = (): string | null => {
    const email = ssoEmail()
    const at = email ? email.lastIndexOf('@') : -1
    return email && at > 0 ? email.slice(at + 1).toLowerCase() : null
  }

  /** §XVI.6.4 dual-signed record; the own publisher also lists the live SSO domain. */
  const directoryCache = new Map<string, Record<string, unknown>>()
  const directoryRecordOf = (p: BuiltPublisher): Record<string, unknown> => {
    const extra = p.spec.part === WRC_TEST_OWN_PUBLISHER ? ssoDomain() : null
    const domains = extra && extra !== p.spec.domain ? [p.spec.domain, extra] : [p.spec.domain]
    const cacheKey = `${p.spec.part}|${domains.join(',')}`
    const cached = directoryCache.get(cacheKey)
    if (cached) return cached
    const base: Record<string, unknown> = {
      type: 'wrc/directory-record',
      publisher_part: p.spec.part,
      keys: [{ kid: p.root.kid, pub: p.root.pub, generation: 1 }],
      encryption_pub: p.box.pub,
      resolver_endpoints: [`${WRC_TEST_REGISTRY_BASE_URL}/v1/publishers/${p.spec.part}`],
      relay_endpoints: [],
      grammar_version: '2',
      domains,
      display_origin: p.spec.domain,
      account_holder_vetted: true,
      status: p.spec.status,
      successor_publisher_part: p.spec.successor ?? null,
      generation: 1,
      expires_at: FAR_FUTURE,
      operator_kid: operator.kid,
      publisher_kid: p.root.kid,
    }
    const withOperator = { ...base, operator_sig: signBytes(wrcCanonicalBytes(base), operator) }
    const record = {
      ...withOperator,
      publisher_countersig: signBytes(wrcCanonicalBytes(withOperator), p.root),
    }
    directoryCache.set(cacheKey, record)
    return record
  }

  const byPart = (part: string) => publishers.get(part) ?? null
  const byDomain = (domain: string) =>
    [...publishers.values()].find((p) => p.spec.domain === domain.toLowerCase()) ?? null

  const transport: WrcTransport = {
    async resolve(part) {
      const p = byPart(part)
      return p ? answer(p.resolveClaim, WRC_TRANSPORT_MAX_BYTES.head) : NOT_FOUND
    },
    async catalogHead(part) {
      const p = byPart(part)
      return p ? answer(p.head, WRC_TRANSPORT_MAX_BYTES.head) : NOT_FOUND
    },
    async delegations(part) {
      return byPart(part) ? answer([], WRC_TRANSPORT_MAX_BYTES.object) : NOT_FOUND
    },
    async entry(part, key) {
      const env = byPart(part)?.entriesByKey.get(key)
      return env ? answer(env, WRC_TRANSPORT_MAX_BYTES.object) : NOT_FOUND
    },
    async object(hash) {
      const env = envelopesByHash.get(hash)
      return env ? answer(env, WRC_TRANSPORT_MAX_BYTES.object) : NOT_FOUND
    },
    async publisherManifest(domain) {
      const p = byDomain(domain)
      return p ? answer(p.manifest, WRC_TRANSPORT_MAX_BYTES.manifest) : NOT_FOUND
    },
    async wrTxtRecords(domain): Promise<WrcTxtResult> {
      const d = domain.toLowerCase()
      const own = byPart(WRC_TEST_OWN_PUBLISHER)!
      const p = byDomain(d) ?? (d === ssoDomain() ? own : null)
      if (!p) return { ok: false, code: 'dns_error', message: `ENOTFOUND _wr.${d}` }
      return { ok: true, records: [`v=wr1; part=${p.spec.part}; root=${fingerprint(p.root.pub)}`] }
    },
    async directoryRecord(part) {
      const p = byPart(part)
      return p ? answer(directoryRecordOf(p), WRC_TRANSPORT_MAX_BYTES.head) : NOT_FOUND
    },
  }

  const codes: WrcTestCode[] = []
  const listed = ENTRIES.filter((e) => e.part !== WRC_TEST_OWN_PUBLISHER)
  for (const e of listed) {
    const ref = referenceOf(e.cls, e.part, e.block)
    const publisher = byPart(e.part)!.spec
    codes.push({ ...ref, label: `${e.label} (${publisher.name})`, expect: e.expect })
  }
  const unknownEntry = referenceOf('P', 'TEST01', '19999')
  codes.push({ ...unknownEntry, label: 'Unknown offering of Test Publisher A', expect: refused(3, 'entry_unknown') })
  const unknownPublisher = referenceOf('P', 'TEST09', '10001')
  codes.push({ ...unknownPublisher, label: 'Unknown publisher', expect: refused(2, 'namespace_unknown_identifier') })
  const good = codes[0]!
  const wrongCheck = good.canonical.endsWith('0') ? '1' : '0'
  codes.push({
    canonical: good.canonical.slice(0, -1) + wrongCheck,
    display: good.display.slice(0, -1) + wrongCheck,
    label: 'Typing error: the published offering with a wrong check character',
    expect: refused(1, 'check_failed'),
  })

  const own = byPart(WRC_TEST_OWN_PUBLISHER)!
  return {
    config: {
      registryBaseUrl: WRC_TEST_REGISTRY_BASE_URL,
      ingestPublicKey: ingest.pub,
      directoryOperatorKid: operator.kid,
      directoryOperatorPub: operator.pub,
    },
    transport,
    identity: () => ({
      receiver: {
        publisher_part: WRC_TEST_OWN_PUBLISHER,
        party_id: WRC_TEST_PARTY_ID,
        device_party_id: `${WRC_TEST_PARTY_ID}:this-device`,
      },
      claimIdentity: null,
      decryptKey: own.box.priv,
    }),
    seedUseLimits(store) {
      for (const e of ENTRIES) {
        if (e.oneTimeUse) store.declare(e.part, e.entryId, defaultUseLimitProfile(1))
      }
    },
    codes,
  }
}
