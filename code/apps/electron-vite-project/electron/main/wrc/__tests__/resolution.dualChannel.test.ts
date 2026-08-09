/**
 * Phase-3 exit criteria — resolution against a contract-faithful double.
 *
 * Two things are proven here:
 *  1. A well-formed publisher resolves end to end, with real Ed25519
 *     signatures, a real Merkle inclusion proof and a real epoch.
 *  2. EVERY divergence — registry vs DNS vs manifest vs declared part, plus
 *     each verification leg — fails closed with a DISTINCT reason. The
 *     distinctness matters: Phase 4 renders these, and a status surface that
 *     cannot tell a rollback from a forged signature is not never-fails-silently.
 */
import { describe, expect, it } from 'vitest'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import { createFixtureTransport, buildPublisherFixture, makeKeyPair, fingerprintOf } from './wrcFixtures'
import type { WrcTransport } from '../wrcTransport'

const NOW = 1_754_650_100 // inside the fixture's freshness window

function clientFor(transport: WrcTransport, fx = FX, now = NOW) {
  return new WrcResolutionClient({
    transport,
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: fx.ingest.pub,
    now: () => now,
  })
}

const FX = buildPublisherFixture()

/**
 * Corrupt a signature so the DECODED bytes definitely differ.
 *
 * Tampering the last base64url character is not enough: for a 64-byte
 * signature the final character carries only two meaningful bits and four
 * discarded padding bits, so many "flips" decode to identical bytes and the
 * test passes or fails depending on which random key was generated. The first
 * character always carries the top six bits of byte 0.
 */
function tamperSignature(sig: string): string {
  const first = sig[0]
  const replacement = first === 'A' ? 'B' : 'A'
  const tampered = replacement + sig.slice(1)
  const decode = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
  if (decode(tampered).equals(decode(sig))) {
    throw new Error('tamperSignature produced identical bytes')
  }
  return tampered
}

describe('happy path — full chain', () => {
  it('resolves publisher, entry and EVP with every leg verified', async () => {
    const r = await clientFor(createFixtureTransport(FX)).resolvePublisher(FX.publisherPart, {
      entryId: FX.entryId,
    })
    expect(r.ok, r.ok ? '' : `${r.reason} ${r.detail ?? ''}`).toBe(true)
    if (!r.ok) return
    expect(r.domain).toBe(FX.domain)
    expect(r.status).toBe('active')
    expect(r.epoch).toBe(FX.epoch)
    expect(r.freshness).toBe('fresh')
    expect(r.entry?.entry_id).toBe(FX.entryId)
    // EVP-first-render material comes from the VERIFIED EVP, not the carrier.
    expect(r.evp?.value_statement).toBe('Signed value statement from the verified EVP.')
    expect(r.record.root_fingerprint).toBe(fingerprintOf(FX.root.pub))
    expect(r.record.cache_state).toBe('validated')
  })

  it('verifies a head signed by a delegated catalog key using the embedded record', async () => {
    // Delta v1.1 §A: nothing is seeded into the store and nothing is fetched —
    // the head carries its own delegation.
    const fx = buildPublisherFixture({ useDelegation: true })
    const r = await clientFor(createFixtureTransport(fx), fx).resolvePublisher(fx.publisherPart, {
      entryId: fx.entryId,
    })
    expect(r.ok, r.ok ? '' : `${r.reason} ${r.detail ?? ''}`).toBe(true)
    if (r.ok) expect(r.record.delegation_kid).toBe(fx.catalogKey.kid)
  })
})

describe('divergence matrix — each fails closed with its own reason', () => {
  it('registry unreachable', async () => {
    const t = createFixtureTransport(FX, {
      resolve: { ok: false, code: 'network_error', message: 'boom' },
    })
    const r = await clientFor(t).resolvePublisher(FX.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('registry_unavailable')
  })

  it('unknown identifier routes to the capture-error path, not the status path', async () => {
    const t = createFixtureTransport(FX, {
      resolve: { ok: false, code: 'http_status', message: 'HTTP 404', status: 404 },
    })
    const r = await clientFor(t).resolvePublisher(FX.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('unknown_identifier')
      expect(r.captureError).toBe(true)
    }
  })

  it('DNS unavailable — nothing can be anchored', async () => {
    const t = createFixtureTransport(FX, {
      txt: { ok: false, code: 'dns_error', message: 'NXDOMAIN' },
    })
    const r = await clientFor(t).resolvePublisher(FX.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('dns_unavailable')
  })

  it('DNS record malformed', async () => {
    const t = createFixtureTransport(FX, { txt: { ok: true, records: ['v=spf1 -all'] } })
    const r = await clientFor(t).resolvePublisher(FX.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('dns_record_malformed')
  })

  it('manifest unavailable', async () => {
    const t = createFixtureTransport(FX, {
      publisherManifest: { ok: false, code: 'http_status', message: 'HTTP 500', status: 500 },
    })
    const r = await clientFor(t).resolvePublisher(FX.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('manifest_unavailable')
  })

  it('manifest signature invalid', async () => {
    const forged = { ...FX.manifest, sig: tamperSignature(FX.manifest.sig) }
    const t = createFixtureTransport(FX, { publisherManifest: { ok: true, value: forged } })
    const r = await clientFor(t).resolvePublisher(FX.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('manifest_signature_invalid')
  })

  it('DNS pins a different key than the manifest presents', async () => {
    const other = makeKeyPair('root-evil')
    const t = createFixtureTransport(FX, {
      txt: { ok: true, records: [`v=wr1; root=${fingerprintOf(other.pub)}`] },
    })
    const r = await clientFor(t).resolvePublisher(FX.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('dns_manifest_key_mismatch')
  })

  it('CROSS-CHECK: manifest declares a different publisher part → alarm', async () => {
    const fx2 = buildPublisherFixture({ publisherPart: 'OTHER1' })
    // Serve fx2's manifest (self-consistent, correctly signed) for FX's domain,
    // with DNS pinning fx2's key so only the PART differs.
    const t = createFixtureTransport(FX, {
      publisherManifest: { ok: true, value: { ...fx2.manifest, domain: FX.domain } },
      txt: { ok: true, records: [`v=wr1; root=${fingerprintOf(fx2.root.pub)}`] },
    })
    const r = await clientFor(t).resolvePublisher(FX.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('manifest_part_mismatch')
      expect(r.detail).toContain(FX.publisherPart)
    }
  })

  it('manifest names a different domain', async () => {
    const t = createFixtureTransport(FX, {
      publisherManifest: { ok: true, value: { ...FX.manifest, domain: 'elsewhere.test' } },
    })
    const r = await clientFor(t).resolvePublisher(FX.publisherPart)
    expect(r.ok).toBe(false)
    // Re-signing is not possible for the attacker, so the signature fails first.
    if (!r.ok) expect(['manifest_signature_invalid', 'manifest_domain_mismatch']).toContain(r.reason)
  })

  it('registry key diverges from the two independent channels', async () => {
    const other = makeKeyPair('root-registry-claims')
    const claim = { ...FX.resolveClaim, root_fingerprint: fingerprintOf(other.pub) }
    const t = createFixtureTransport(FX, { resolve: { ok: true, value: claim } })
    const r = await clientFor(t).resolvePublisher(FX.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('registry_key_divergence')
  })

  it('head signature invalid', async () => {
    const badHead = { ...FX.head, sig: tamperSignature(FX.head.sig) }
    const claim = { ...FX.resolveClaim, catalog_head: badHead }
    const t = createFixtureTransport(FX, { resolve: { ok: true, value: claim } })
    const r = await clientFor(t).resolvePublisher(FX.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('head_signature_invalid')
  })

  it('entry envelope countersignature invalid', async () => {
    const env = {
      ...FX.entryEnvelope,
      ingest_countersig: {
        ...FX.entryEnvelope.ingest_countersig,
        sig: tamperSignature(FX.entryEnvelope.ingest_countersig.sig),
      },
    }
    const t = createFixtureTransport(FX, { entry: { ok: true, value: env } })
    const r = await clientFor(t).resolvePublisher(FX.publisherPart, { entryId: FX.entryId })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('envelope_countersignature_invalid')
  })

  it('inclusion proof does not reach the verified catalog root', async () => {
    const env = { ...FX.entryEnvelope, inclusion_proof: [] }
    const t = createFixtureTransport(FX, { entry: { ok: true, value: env } })
    const r = await clientFor(t).resolvePublisher(FX.publisherPart, { entryId: FX.entryId })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('envelope_inclusion_proof_invalid')
  })

  it('tampered object body breaks the hash binding', async () => {
    const env = {
      ...FX.entryEnvelope,
      object: { ...FX.entryEnvelope.object, entry_id: 'TAMPERED' },
    }
    const t = createFixtureTransport(FX, { entry: { ok: true, value: env } })
    const r = await clientFor(t).resolvePublisher(FX.publisherPart, { entryId: FX.entryId })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('envelope_object_hash_mismatch')
  })

  it('a suspended entry is a visible typed state, never silent absence (A5)', async () => {
    const fx = buildPublisherFixture({ suspendEntry: true })
    const r = await clientFor(createFixtureTransport(fx), fx).resolvePublisher(fx.publisherPart, {
      entryId: fx.entryId,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('envelope_suspended')
      expect(r.detail).toBe('platform_review')
    }

    // The audit surface may see it, with the suspension attached.
    const audit = await clientFor(createFixtureTransport(fx), fx).resolvePublisher(
      fx.publisherPart,
      { entryId: fx.entryId, allowSuspended: true },
    )
    expect(audit.ok).toBe(true)
    if (audit.ok) expect(audit.suspension?.reason_code).toBe('platform_review')
  })

  it('EVP over the 64 KiB budget is a verification failure, not a truncation (3F)', async () => {
    const fx = buildPublisherFixture({ oversizedEvp: true })
    const r = await clientFor(createFixtureTransport(fx), fx).resolvePublisher(fx.publisherPart, {
      entryId: fx.entryId,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('evp_over_budget')
  })

  it('an unpublished entry status is refused', async () => {
    const fx = buildPublisherFixture({ entryStatus: 'retired' })
    const r = await clientFor(createFixtureTransport(fx), fx).resolvePublisher(fx.publisherPart, {
      entryId: fx.entryId,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('entry_not_published')
  })
})

describe('3D — epoch anti-rollback and freshness', () => {
  it('rejects a head whose epoch is below the persisted floor', async () => {
    const store = new WrcResolvedRecordStore(createMemoryPersistence())
    const mk = (fx = FX) =>
      new WrcResolutionClient({
        transport: createFixtureTransport(fx),
        store,
        ingestPublicKey: fx.ingest.pub,
        now: () => NOW,
      })

    const first = await mk(FX).resolvePublisher(FX.publisherPart)
    expect(first.ok).toBe(true)
    expect(store.lastSeenEpoch(FX.publisherPart)).toBe(FX.epoch)

    const older = buildPublisherFixture({ epoch: FX.epoch - 1 })
    const rolled = await new WrcResolutionClient({
      transport: createFixtureTransport(older),
      store,
      ingestPublicKey: older.ingest.pub,
      now: () => NOW,
    }).resolvePublisher(older.publisherPart)

    expect(rolled.ok).toBe(false)
    if (!rolled.ok) expect(rolled.reason).toBe('head_epoch_rollback')
    // The floor did not move down.
    expect(store.lastSeenEpoch(FX.publisherPart)).toBe(FX.epoch)
  })

  it('the epoch floor survives eviction of the cached record', () => {
    const p = createMemoryPersistence()
    const s1 = new WrcResolvedRecordStore(p)
    s1.noteAcceptedEpoch('WR7X4K', 12)
    // A fresh store over the same persistence still refuses a rollback.
    const s2 = new WrcResolvedRecordStore(p)
    expect(s2.get('WR7X4K')).toBeNull()
    expect(s2.lastSeenEpoch('WR7X4K')).toBe(12)
    s2.noteAcceptedEpoch('WR7X4K', 3)
    expect(s2.lastSeenEpoch('WR7X4K')).toBe(12)
  })

  it('a stale head resolves as visibly stale rather than failing', async () => {
    const past = NOW + 86_400 * 3
    const r = await clientFor(createFixtureTransport(FX), FX, past).resolvePublisher(
      FX.publisherPart,
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.freshness).toBe('stale')
      expect(r.stale_by_s).toBeGreaterThan(0)
      expect(r.record.cache_state).toBe('stale')
    }
  })

  it('a non-active publisher status demotes the cache entry', async () => {
    const claim = { ...FX.resolveClaim, status: 'revoked' }
    const t = createFixtureTransport(FX, { resolve: { ok: true, value: claim } })
    const r = await clientFor(t).resolvePublisher(FX.publisherPart)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.status).toBe('revoked')
      expect(r.record.cache_state).toBe('demoted')
    }
  })
})

describe('no production path reaches publisher trust without both channels', () => {
  it('the client consults DNS and the manifest on every resolution', async () => {
    const calls: string[] = []
    const base = createFixtureTransport(FX)
    const spy: WrcTransport = {
      resolve: async (p) => (calls.push('resolve'), base.resolve(p)),
      catalogHead: async (p) => (calls.push('head'), base.catalogHead(p)),
      entry: async (p, e) => (calls.push('entry'), base.entry(p, e)),
      object: async (h) => (calls.push('object'), base.object(h)),
      publisherManifest: async (d) => (calls.push('manifest'), base.publisherManifest(d)),
      wrTxtRecords: async (d) => (calls.push('dns'), base.wrTxtRecords(d)),
    }
    const r = await clientFor(spy).resolvePublisher(FX.publisherPart, { entryId: FX.entryId })
    expect(r.ok).toBe(true)
    expect(calls).toContain('dns')
    expect(calls).toContain('manifest')
    // DNS and manifest both precede any object fetch.
    expect(calls.indexOf('dns')).toBeLessThan(calls.indexOf('entry'))
    expect(calls.indexOf('manifest')).toBeLessThan(calls.indexOf('entry'))
  })

  it('an unconfigured deployment refuses instead of resolving', async () => {
    const { createUnconfiguredWrcTransport } = await import('../wrcTransport')
    const r = await clientFor(createUnconfiguredWrcTransport()).resolvePublisher('WR7X4K')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('registry_unavailable')
      expect(r.detail).toContain('not_configured')
    }
  })
})
