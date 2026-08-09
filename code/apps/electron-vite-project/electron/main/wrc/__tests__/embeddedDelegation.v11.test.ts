/**
 * 3G — contract delta v1.1 §A: the CatalogHead carries its own delegation.
 *
 * The property under test is not just "a delegated head verifies". It is that
 * verification completes from the DNS-pinned root plus the embedded record
 * ALONE, that every way of getting that wrong has its own typed reason, and
 * that no code path reaches for the network to rescue a broken chain.
 *
 * Mutation discipline (standing rule): every negative case below either
 * substitutes a fully re-signed artifact, or mutates through a helper that
 * asserts its own semantic effect. A mutation whose effect depends on fixture
 * randomness is invalid by construction — see the Phase-3 report §3.
 */
import { describe, expect, it } from 'vitest'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import { resolveSigningKey } from '../wrcVerify'
import { decodeCatalogHead } from '../wrcContract'
import {
  buildPublisherFixture,
  createFixtureTransport,
  fingerprintOf,
  makeKeyPair,
  signObject,
  type WrcPublisherFixture,
} from './wrcFixtures'

const NOW = 1_754_650_100

function clientFor(fx: WrcPublisherFixture, overrides = {}, onCall?: (m: string) => void) {
  return new WrcResolutionClient({
    transport: createFixtureTransport(fx, { ...overrides, onCall }),
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: fx.ingest.pub,
    now: () => NOW,
  })
}

describe('v1.1 §A — embedded delegation, happy path', () => {
  it('a root-signed head carries delegation: null', () => {
    const fx = buildPublisherFixture()
    expect(fx.head.delegation).toBeNull()
    expect(fx.head.kid).toBe(fx.root.kid)
  })

  it('a delegated head embeds the record and verifies with no store and no fetch', async () => {
    const fx = buildPublisherFixture({ useDelegation: true })
    expect(fx.head.delegation).not.toBeNull()
    expect(fx.head.delegation!.delegate_kid).toBe(fx.catalogKey.kid)

    const called: string[] = []
    const r = await clientFor(fx, {}, (m) => called.push(m)).resolvePublisher(fx.publisherPart, {
      entryId: fx.entryId,
    })
    expect(r.ok, r.ok ? '' : `${r.reason} ${r.detail ?? ''}`).toBe(true)
    // The audit endpoint is never touched during verification (§B).
    expect(called).not.toContain('delegations')
  })

  it('the epoch window is inclusive at valid_from and exclusive at revoked_from', () => {
    const fx = buildPublisherFixture({
      useDelegation: true,
      epoch: 5,
      delegationValidFromEpoch: 5,
      delegationRevokedFromEpoch: 9,
    })
    const keys = {
      rootKid: fx.root.kid,
      rootPub: fx.root.pub,
      headDelegation: fx.head.delegation,
    }
    // valid_from_epoch <= epoch  AND  revoked_from_epoch > epoch
    expect(resolveSigningKey(keys, fx.catalogKey.kid, 4).ok).toBe(false)
    expect(resolveSigningKey(keys, fx.catalogKey.kid, 5).ok).toBe(true)
    expect(resolveSigningKey(keys, fx.catalogKey.kid, 8).ok).toBe(true)
    expect(resolveSigningKey(keys, fx.catalogKey.kid, 9).ok).toBe(false)
    expect(resolveSigningKey(keys, fx.catalogKey.kid, 10).ok).toBe(false)
  })
})

describe('v1.1 §A — negative cases, each with its own reason', () => {
  it('delegated kid with NO embedded record ⇒ head_delegation_missing, no fetch', async () => {
    const fx = buildPublisherFixture({ useDelegation: true, headDelegationOverride: null })
    expect(fx.head.delegation).toBeNull()
    expect(fx.head.kid).not.toBe(fx.root.kid)

    const called: string[] = []
    const r = await clientFor(fx, {}, (m) => called.push(m)).resolvePublisher(fx.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('head_delegation_missing')
    // The refusal must not be softened by reaching for the audit endpoint.
    expect(called).not.toContain('delegations')
  })

  it('delegation signed by a key other than the DNS-pinned root ⇒ invalid', async () => {
    const impostor = makeKeyPair('root-impostor')
    const fx = buildPublisherFixture({ useDelegation: true, delegationSigner: impostor })
    const r = await clientFor(fx).resolvePublisher(fx.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('head_delegation_invalid')
  })

  it('sub-delegation attempt ⇒ head_delegation_not_rooted', async () => {
    // A delegate trying to delegate onward names its own kid as root_kid.
    // `authority: catalog-signing-only` makes that unrepresentable.
    const fx = buildPublisherFixture({
      useDelegation: true,
      delegationRootKid: 'cat-b2',
    })
    const r = await clientFor(fx).resolvePublisher(fx.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('head_delegation_not_rooted')
  })

  it('revoked window ⇒ head_delegation_revoked', async () => {
    const fx = buildPublisherFixture({
      useDelegation: true,
      epoch: 7,
      delegationValidFromEpoch: 1,
      delegationRevokedFromEpoch: 7, // revoked_from == epoch ⇒ NOT valid
    })
    const r = await clientFor(fx).resolvePublisher(fx.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('head_delegation_revoked')
  })

  it('not-yet-valid window ⇒ head_delegation_not_yet_valid', async () => {
    const fx = buildPublisherFixture({
      useDelegation: true,
      epoch: 3,
      delegationValidFromEpoch: 9,
    })
    const r = await clientFor(fx).resolvePublisher(fx.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('head_delegation_not_yet_valid')
  })

  it('embedded record delegating a DIFFERENT key ⇒ head_delegation_kid_mismatch', async () => {
    // Correctly root-signed, in-window, properly rooted — the ONLY defect is
    // that it delegates some other kid than the one that signed the head. A
    // record borrowed from another publisher would fail on its signature
    // first and never reach this branch.
    const fx = buildPublisherFixture({ useDelegation: true })
    const elsewhere = makeKeyPair('cat-elsewhere')
    const mismatched = signObject(
      {
        type: 'wrc/catalog-delegation',
        publisher_part: fx.publisherPart,
        delegate_kid: elsewhere.kid,
        delegate_pub: elsewhere.pub,
        authority: 'catalog-signing-only',
        valid_from_epoch: 1,
        revoked_from_epoch: null,
        root_kid: fx.root.kid,
        sig: '',
      } as unknown as Record<string, unknown>,
      fx.root,
    ) as unknown as typeof fx.delegation

    const swapped = buildPublisherFixture({
      useDelegation: true,
      headDelegationOverride: mismatched!,
    })
    const r = await clientFor(swapped).resolvePublisher(swapped.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('head_delegation_kid_mismatch')
  })

  it('an otherwise valid record whose delegate_pub was swapped fails the signature', async () => {
    // Guards the branch order: substituting the public key must not slip
    // through as a mere "kid mismatch".
    const fx = buildPublisherFixture({ useDelegation: true })
    const attacker = makeKeyPair('cat-b2') // same kid, attacker's key
    const forged = {
      ...(fx.head.delegation as unknown as Record<string, unknown>),
      delegate_pub: attacker.pub,
    }
    const swapped = buildPublisherFixture({
      useDelegation: true,
      headDelegationOverride: forged as never,
    })
    const r = await clientFor(swapped).resolvePublisher(swapped.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('head_delegation_invalid')
  })

  it('a malformed embedded record fails the decode instead of degrading to root-signed', () => {
    const fx = buildPublisherFixture({ useDelegation: true })
    const broken = {
      ...(fx.head as unknown as Record<string, unknown>),
      delegation: { type: 'wrc/catalog-delegation', publisher_part: 'X' },
    }
    expect(decodeCatalogHead(broken)).toBeNull()
  })
})

describe('v1.1 §B — delegations endpoint is audit-only', () => {
  it('returns the append-only history', async () => {
    const fx = buildPublisherFixture({ useDelegation: true })
    const t = createFixtureTransport(fx)
    const res = await t.delegations(fx.publisherPart)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(Array.isArray(res.value)).toBe(true)
      expect((res.value as unknown[]).length).toBe(1)
    }
  })

  it('a broken audit endpoint does not affect verification', async () => {
    const fx = buildPublisherFixture({ useDelegation: true })
    const r = await clientFor(fx, {
      delegations: { ok: false, code: 'http_status', message: 'HTTP 500', status: 500 },
    }).resolvePublisher(fx.publisherPart, { entryId: fx.entryId })
    expect(r.ok, r.ok ? '' : `${r.reason} ${r.detail ?? ''}`).toBe(true)
  })

  it('the verification modules never reference the delegations endpoint', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    for (const f of ['wrcVerify.ts', 'dualChannel.ts']) {
      const src = readFileSync(join(here, '..', f), 'utf8')
      expect(src, f).not.toMatch(/delegations\s*\(/)
    }
    // The client may hold history for audit, but must not call it while resolving.
    const client = readFileSync(join(here, '..', 'resolutionClient.ts'), 'utf8')
    expect(client).not.toMatch(/transport\.delegations/)
  })
})

describe('v1.1 §C — publisher signature root or head-embedded delegation only', () => {
  it('the key resolver exposes no list and no store lookup', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const here = dirname(fileURLToPath(import.meta.url))
    const src = readFileSync(join(here, '..', 'wrcVerify.ts'), 'utf8')
    // A collection-shaped field would invite satisfying a delegated head from
    // somewhere other than the head.
    expect(src).not.toMatch(/delegations:\s*readonly/)
    expect(src).toMatch(/headDelegation:\s*WrcDelegationRecord \| null/)
    expect(src).not.toMatch(/store\./)
  })

  it('the resolved record still carries the delegation for audit', async () => {
    const fx = buildPublisherFixture({ useDelegation: true })
    const r = await clientFor(fx).resolvePublisher(fx.publisherPart)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.record.delegations).toHaveLength(1)
      expect(r.record.delegations[0]!.delegate_kid).toBe(fx.catalogKey.kid)
      expect(r.record.root_fingerprint).toBe(fingerprintOf(fx.root.pub))
    }
  })
})
