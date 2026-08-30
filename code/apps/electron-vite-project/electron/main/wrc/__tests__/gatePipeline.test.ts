/**
 * §XVI.7.6 six-gate pipeline — gate-by-gate conformance fixtures.
 *
 * Authority: Annex XVI v1.95 (SHA256 064AAD6D…829F), §XVI.7.6 (gate order and
 * per-gate stop conditions), §XVI.8.1 (status effects), §XVI.8.4 (use-limit
 * postures at Gate 3/5). Every gate gets at least one passing and one failing
 * vector; the ORDER items prove the pipeline is a hard-stop sequence a caller
 * cannot reorder or skip: a failure at gate N leaves gates > N unconsulted.
 *
 * Two layers under test:
 *  - the pipeline core with stub deps (gate logic, precise reasons, claim
 *    revert on post-claim failure);
 *  - the interim adapter over the real resolution client and the
 *    contract-faithful signing double (end-to-end admission, real refusals).
 */
import { describe, expect, it } from 'vitest'
import { buildWrCodeReference, captureWrCodeReference } from '@repo/ingestion-core'
import {
  WR_CODE_GATE_ORDER,
  claimantIdOf,
  evaluateSelfMatch,
  findEmbeddedLink,
  runWrCodeGatePipeline,
  type WrCodeEntryMaterial,
  type WrCodeGateDeps,
  type WrCodeNamespaceRecord,
  type WrCodeReceiverIdentity,
} from '../gatePipeline'
import { createWrcGateDeps } from '../gatePipelineAdapter'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import { buildPublisherFixture, createFixtureTransport } from './wrcFixtures'
import type { WrcTransport } from '../wrcTransport'

// ── Vectors (Annex XVI v1.95 A.2 publisher / entry, fixture-aligned) ──────────

const P_REF = 'PWR7X4K9B2M3C' // P-WR7X4K-9B2M3C — resolves in the fixture
const P_REF_BAD_CHECK = 'P-WR7X4K-9B2M3D'
const LEGACY_12 = 'WR7X4K9B2M3P' // retired prefix-less grammar

const RECEIVER_PUB = 'RCVPBX'
const C_REF_FOR_ME = mustBuild('C', ['WR7X4K', RECEIVER_PUB])
const I_REF = mustBuild('I', ['WR7X4K', 'M3K9B2'])

function mustBuild(cls: 'C' | 'I', blocks: string[]): string {
  const r = buildWrCodeReference(cls, blocks)
  if (!r.ok) throw new Error(`vector build failed: ${r.reason}`)
  return r.canonical
}

// ── Stub deps ─────────────────────────────────────────────────────────────────

const FX = buildPublisherFixture()
const NOW = 1_754_650_100

function activeNamespace(part: string): WrCodeNamespaceRecord {
  return {
    publisher_part: part,
    domain: 'publisher.test',
    status: 'active',
    dual_signature_verified: true,
    dns_verified: true,
    account_holder_verified: true,
    successor_publisher_part: null,
  }
}

function publishedMaterial(overrides: Partial<WrCodeEntryMaterial> = {}): WrCodeEntryMaterial {
  return {
    entry_id: FX.entryId,
    catalog_status: 'published',
    suspension: null,
    kind: 'offering',
    lifecycle: null,
    recipient_binding: null,
    use_limit: null,
    successor_entry_id: null,
    entry: FX.entry,
    evp: FX.evp,
    ...overrides,
  }
}

interface StubLog {
  calls: string[]
  claimReleases: number
}

function stubDeps(
  overrides: Partial<WrCodeGateDeps> & { material?: WrCodeEntryMaterial } = {},
): { deps: WrCodeGateDeps; log: StubLog } {
  const log: StubLog = { calls: [], claimReleases: 0 }
  const material = overrides.material ?? publishedMaterial()
  const deps: WrCodeGateDeps = {
    verifyNamespace:
      overrides.verifyNamespace ??
      (async (part) => {
        log.calls.push(`namespace:${part}`)
        return { ok: true, record: activeNamespace(part) }
      }),
    verifyEntry:
      overrides.verifyEntry ??
      (async () => {
        log.calls.push('entry')
        return { ok: true, material }
      }),
    releaseMaterial:
      overrides.releaseMaterial ??
      (async ({ material: m }) => {
        log.calls.push('release')
        return { ok: true, released: { evp: m.evp } }
      }),
    admitCapsule:
      overrides.admitCapsule ??
      (async () => {
        log.calls.push('admit')
        return { ok: true }
      }),
    releaseClaim: (input) => {
      log.claimReleases += 1
      overrides.releaseClaim?.(input)
    },
  }
  return { deps, log }
}

const RECEIVER: WrCodeReceiverIdentity = {
  publisher_part: RECEIVER_PUB,
  party_id: 'party-1',
  device_party_id: 'party-1:device-A',
}

// ── Order — the pipeline is the §XVI.7.6 sequence, hard-stop ──────────────────

describe('gate order is normative and hard-stop [XVI.7.6]', () => {
  it('pins the six gates in annex order', () => {
    expect(WR_CODE_GATE_ORDER).toEqual([
      'syntax',
      'namespace',
      'entry',
      'self_match',
      'relay_release',
      'capsule_admission',
    ])
  })

  it('a full pass records all six gates in order', async () => {
    const { deps } = stubDeps()
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok, r.ok ? '' : `${r.reason}`).toBe(true)
    if (r.ok) expect(r.gatesPassed).toEqual([...WR_CODE_GATE_ORDER])
  })

  it('first failure terminates: a Gate-3 refusal never consults gates 4–6', async () => {
    const { deps, log } = stubDeps({
      verifyEntry: async () => ({ ok: false, reason: 'entry_unknown' }),
    })
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.gatesPassed).toEqual(['syntax', 'namespace'])
    expect(log.calls).not.toContain('release')
    expect(log.calls).not.toContain('admit')
  })

  it('a Gate-1 refusal touches no dependency at all — offline by construction', async () => {
    const { deps, log } = stubDeps()
    const r = await runWrCodeGatePipeline({ raw: 'not a code', receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(1)
    expect(log.calls).toEqual([])
  })
})

// ── Gate 1 — syntax (Run-1 grammar module, no second parser) ──────────────────

describe('Gate 1 — local syntax [XVI.7.6, XVI.5.8]', () => {
  it('passing vector: the A.2 P reference reaches Gate 2', async () => {
    const { deps, log } = stubDeps()
    await runWrCodeGatePipeline({ raw: ` p-wr7x4k-9b2m3c `, receiver: RECEIVER }, deps)
    expect(log.calls[0]).toBe('namespace:WR7X4K')
  })

  it.each([
    ['check failure', P_REF_BAD_CHECK, 'check_failed'],
    ['retired prefix-less code', LEGACY_12, 'unknown_prefix'],
    ['empty', '   ', 'empty'],
  ])('failing vector (%s) refuses at gate 1 on the capture-error path', async (_n, raw, reason) => {
    const { deps } = stubDeps()
    const r = await runWrCodeGatePipeline({ raw, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(1)
    expect(r.gateName).toBe('syntax')
    expect(r.reason).toBe(reason)
    expect(r.captureError).toBe(true)
    expect(r.gatesPassed).toEqual([])
  })
})

// ── Gate 2 — namespace verification, every Publisher Identifier ───────────────

describe('Gate 2 — namespace [XVI.7.6]', () => {
  it('class C verifies BOTH Publisher Identifiers, initiator first', async () => {
    const { deps, log } = stubDeps()
    const r = await runWrCodeGatePipeline({ raw: C_REF_FOR_ME, receiver: RECEIVER }, deps)
    expect(log.calls.filter((c) => c.startsWith('namespace:'))).toEqual([
      'namespace:WR7X4K',
      `namespace:${RECEIVER_PUB}`,
    ])
    // With deps that can designate the C entry, the addressed receiver admits.
    expect(r.ok).toBe(true)
  })

  it.each([
    ['inactive', 'namespace_inactive'],
    ['revoked', 'namespace_revoked'],
    ['compromised', 'namespace_compromised'],
  ] as const)('failing vector: %s publisher stops with %s', async (status, reason) => {
    const { deps } = stubDeps({
      verifyNamespace: async (part) => ({
        ok: true,
        record: { ...activeNamespace(part), status },
      }),
    })
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(2)
    expect(r.reason).toBe(reason)
    expect(r.unsuppressibleWarning ?? false).toBe(status === 'compromised')
  })

  it('superseded surfaces the successor explicitly, never a silent redirect [XVI.8.1]', async () => {
    const { deps } = stubDeps({
      verifyNamespace: async (part) => ({
        ok: true,
        record: {
          ...activeNamespace(part),
          status: 'superseded',
          successor_publisher_part: 'NEWPUB',
        },
      }),
    })
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('namespace_superseded')
    expect(r.successorPublisherPart).toBe('NEWPUB')
  })

  it('a directory leg that did not verify is a refusal even with ACTIVE status', async () => {
    const { deps } = stubDeps({
      verifyNamespace: async (part) => ({
        ok: true,
        record: { ...activeNamespace(part), dns_verified: false },
      }),
    })
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(2)
    expect(r.reason).toBe('namespace_unverified')
  })

  it('unknown identifier stays on the capture-error path [XVI.4.2]', async () => {
    const { deps } = stubDeps({
      verifyNamespace: async () => ({ ok: false, reason: 'namespace_unknown_identifier' }),
    })
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.captureError).toBe(true)
  })
})

// ── Gate 3 — entry verification ───────────────────────────────────────────────

describe('Gate 3 — entry state [XVI.7.6, XVI.8.1, XVI.8.4]', () => {
  it.each([
    ['publisher-suspended entry', { catalog_status: 'suspended' as const }, 'entry_suspended'],
    ['retired entry', { catalog_status: 'retired' as const }, 'entry_retired'],
    [
      'platform-suspended entry',
      { suspension: { since: 1, reason_code: 'platform_review', reversible: true } },
      'entry_platform_suspended',
    ],
  ])('failing vector: %s', async (_n, patch, reason) => {
    const { deps } = stubDeps({ material: publishedMaterial(patch) })
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.reason).toBe(reason)
  })

  it('CONSUMED resolves to a warning status, never an offer [XVI.8.4]', async () => {
    const { deps } = stubDeps({
      material: publishedMaterial({ use_limit: { state: 'consumed', claimed_by: null } }),
    })
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toBe('CONSUMED')
    expect(r.unsuppressibleWarning).toBe(true)
  })

  it('a claim held by ANOTHER party refuses CLAIMED_BY_OTHER; own claim passes through', async () => {
    const other = stubDeps({
      material: publishedMaterial({ use_limit: { state: 'claimed', claimed_by: 'party-9' } }),
    })
    const rOther = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, other.deps)
    expect(rOther.ok).toBe(false)
    if (!rOther.ok) expect(rOther.reason).toBe('CLAIMED_BY_OTHER')

    const mine = stubDeps({
      material: publishedMaterial({
        use_limit: { state: 'claimed', claimed_by: claimantIdOf(RECEIVER) },
      }),
    })
    const rMine = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, mine.deps)
    expect(rMine.ok, rMine.ok ? '' : rMine.reason).toBe(true)
  })
})

// ── Gate 4 — self-match ───────────────────────────────────────────────────────

describe('Gate 4 — self-match [XVI.7.6]', () => {
  it('passing vector: C whose second block is the receiver\'s own Publisher Identifier', () => {
    const ref = mustCapture(C_REF_FOR_ME)
    expect(evaluateSelfMatch(ref, publishedMaterial(), RECEIVER)).toEqual({ ok: true })
  })

  it('failing vector: C addressed to someone else → NOT_FOR_YOU, nothing follows', async () => {
    const { deps, log } = stubDeps({
      verifyEntry: async () => ({
        ok: true,
        // An invitation admits a request in PENDING (§XVI.7.6 Gate 3).
        material: publishedMaterial({ kind: 'invitation', lifecycle: 'pending' }),
      }),
    })
    const r = await runWrCodeGatePipeline(
      { raw: C_REF_FOR_ME, receiver: { publisher_part: 'ZZPUBQ' } },
      deps,
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(4)
    expect(r.reason).toBe('NOT_FOR_YOU')
    expect(log.calls).not.toContain('release')
  })

  it('recipient-bound P at principal granularity matches the Party Identifier', () => {
    const ref = mustCapture(P_REF)
    const bound = publishedMaterial({
      recipient_binding: { granularity: 'principal', party_id: 'party-1' },
    })
    expect(evaluateSelfMatch(ref, bound, RECEIVER).ok).toBe(true)
    const notMe = evaluateSelfMatch(ref, bound, { party_id: 'party-2' })
    expect(notMe.ok).toBe(false)
    if (!notMe.ok) expect(notMe.reason).toBe('NOT_FOR_YOU')
  })

  it('device-bound entry on ANOTHER device of the same principal → NOT_FOR_THIS_DEVICE', () => {
    const ref = mustCapture(P_REF)
    const bound = publishedMaterial({
      recipient_binding: { granularity: 'device', party_id: 'party-1:device-B' },
    })
    const r = evaluateSelfMatch(ref, bound, RECEIVER)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('NOT_FOR_THIS_DEVICE')
    // The bound device itself matches.
    expect(
      evaluateSelfMatch(ref, bound, { ...RECEIVER, device_party_id: 'party-1:device-B' }).ok,
    ).toBe(true)
  })

  it('I / sub-handshake self-match without combination expansion fails CLOSED', () => {
    const ref = mustCapture(I_REF)
    const r = evaluateSelfMatch(ref, publishedMaterial(), RECEIVER)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('self_match_unavailable')
  })
})

// ── Gate 5 — recipient-bound release ──────────────────────────────────────────

describe('Gate 5 — relay release [XVI.7.6, XVI.8.4]', () => {
  it('failing vector: release refusal terminates with the relay\'s reason', async () => {
    const { deps, log } = stubDeps({
      releaseMaterial: async () => ({ ok: false, reason: 'CLAIMED_BY_OTHER', detail: 'party-9' }),
    })
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(5)
    expect(r.reason).toBe('CLAIMED_BY_OTHER')
    expect(log.calls).not.toContain('admit')
  })

  it('passing vector: released material is exactly what Gate 6 admits', async () => {
    const { deps } = stubDeps()
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.released.evp).toBe(FX.evp)
  })
})

// ── Gate 6 — capsule admission ────────────────────────────────────────────────

describe('Gate 6 — capsule admission [XVI.7.6, P15]', () => {
  it('failing vector: an embedded link in released material refuses admission', async () => {
    const evilEvp = { ...FX.evp, next_steps: ['Continue at https://evil.example/x'] }
    const { deps, log } = stubDeps({ material: publishedMaterial({ evp: evilEvp }) })
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(6)
    expect(r.reason).toBe('admission_embedded_link')
    // A post-claim failure must revert the §XVI.8.4 claim.
    expect(log.claimReleases).toBe(1)
  })

  it('failing vector: the admission seam\'s refusal is terminal and reverts the claim', async () => {
    const { deps, log } = stubDeps({
      admitCapsule: async () => ({ ok: false, reason: 'admission_refused', detail: 'replayed' }),
    })
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(6)
    expect(log.claimReleases).toBe(1)
  })

  it('link scan is non-delegable: it runs even when the admission seam would pass', () => {
    expect(findEmbeddedLink(publishedMaterial(), FX.evp)).toBeNull()
    expect(
      findEmbeddedLink(publishedMaterial(), { ...FX.evp, value_statement: 'see www.evil.example' }),
    ).toContain('www.evil.example')
  })
})

// ── End-to-end over the interim adapter + contract-faithful double ────────────

function clientFor(transport: WrcTransport) {
  return new WrcResolutionClient({
    transport,
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: FX.ingest.pub,
    now: () => NOW,
  })
}

describe('interim adapter — full pipeline over the Phase-3 anchor', () => {
  it('the A.2 P reference admits end to end with real signatures', async () => {
    const deps = createWrcGateDeps(clientFor(createFixtureTransport(FX)))
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok, r.ok ? '' : `${r.reason} ${r.detail ?? ''}`).toBe(true)
    if (!r.ok) return
    expect(r.gatesPassed).toEqual([...WR_CODE_GATE_ORDER])
    expect(r.namespaces[0]?.domain).toBe(FX.domain)
    expect(r.released.evp?.value_statement).toBe('Signed value statement from the verified EVP.')
  })

  it('an unknown publisher refuses at Gate 2 on the capture-error path', async () => {
    const deps = createWrcGateDeps(
      clientFor(
        createFixtureTransport(FX, {
          resolve: { ok: false, code: 'http_status', message: 'HTTP 404', status: 404 },
        }),
      ),
    )
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(2)
    expect(r.reason).toBe('namespace_unknown_identifier')
    expect(r.captureError).toBe(true)
  })

  it('a revoked publisher part refuses at Gate 2 with the status reason', async () => {
    const deps = createWrcGateDeps(
      clientFor(
        createFixtureTransport(FX, {
          resolve: { ok: true, value: { ...FX.resolveClaim, status: 'revoked' } },
        }),
      ),
    )
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(2)
    expect(r.reason).toBe('namespace_revoked')
  })

  it('a publisher-suspended entry refuses at Gate 3, precisely', async () => {
    const fx = buildPublisherFixture({ entryStatus: 'suspended' })
    const deps = createWrcGateDeps(clientForFx(fx))
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.reason).toBe('entry_suspended')
  })

  it('a platform-suspended entry refuses at Gate 3 as the platform\'s own statement', async () => {
    const fx = buildPublisherFixture({ suspendEntry: true })
    const deps = createWrcGateDeps(clientForFx(fx))
    const r = await runWrCodeGatePipeline({ raw: P_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.reason).toBe('entry_platform_suspended')
  })

  it('an I-class reference fails CLOSED at Gate 3 until combination expansion exists', async () => {
    const deps = createWrcGateDeps(clientFor(createFixtureTransport(FX)))
    const r = await runWrCodeGatePipeline({ raw: I_REF, receiver: RECEIVER }, deps)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gate).toBe(3)
    expect(r.reason).toBe('entry_verification_unavailable')
  })
})

function clientForFx(fx: ReturnType<typeof buildPublisherFixture>) {
  return new WrcResolutionClient({
    transport: createFixtureTransport(fx),
    store: new WrcResolvedRecordStore(createMemoryPersistence()),
    ingestPublicKey: fx.ingest.pub,
    now: () => NOW,
  })
}

// ── helpers ───────────────────────────────────────────────────────────────────

function mustCapture(raw: string) {
  const r = captureWrCodeReference(raw)
  if (!r.ok) throw new Error(`vector does not capture: ${r.reason}`)
  return r
}
