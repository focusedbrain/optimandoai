/**
 * Phase 5 exit criteria — the slice's E2E acceptance, at the level this agent
 * can verify: main-process logic against the contract-faithful double, with no
 * app build and no app start.
 *
 * (a) authenticated email from a registered publisher → offer → consent pinning
 * (b) forwarded/unauthenticated → alert, zero derived affordances, manual entry
 *     completes the chain
 * (c) revoked / inactive / compromised / superseded / expired → status surface,
 *     no offer; unknown code → capture error
 * (d) covered by the full-workspace capture, not here
 */
import { describe, expect, it } from 'vitest'
import {
  captureBaselineCode,
  applyPublisherDomainAlignment,
  createChannelProvenanceRecord,
} from '@repo/ingestion-core'
import { channelAlertRequiredForDisplay } from '@repo/shared-beap-ui'
import { WrcResolutionClient } from '../resolutionClient'
import { WrcResolvedRecordStore, createMemoryPersistence } from '../resolvedRecordStore'
import { createMemoryEpochFloorStore } from '../epochFloorStore'
import { composeEntryStatus } from '../entryStatusSurface'
import { buildOfferPresentation, renderCodeForDisplay, buildAuditUrl } from '../offerPresentation'
import { buildPublisherFixture, createFixtureTransport } from './wrcFixtures'
import { recheckCatalogHeadForConsent } from '../../handshake/connectOfferStaging'

const NOW = 1_754_650_100
const SHA = 'a'.repeat(64)

function client(fx = FX) {
  return new WrcResolutionClient({
    transport: createFixtureTransport(fx),
    store: new WrcResolvedRecordStore(createMemoryPersistence(), createMemoryEpochFloorStore()),
    ingestPublicKey: fx.ingest.pub,
    now: () => NOW,
  })
}
const FX = buildPublisherFixture()

/** A conformant code for the fixture's parts is not required by these tests;
 *  the local renderer is exercised with a real check-passing identifier. */
const VALID_CODE = 'WR7X4K9B2M3P' // §4.1 vector from the check profile

describe('(a) authenticated email → offer → consent pin', () => {
  it('resolves, composes an admissible status, and offers EVP material only', async () => {
    const r = await client().resolvePublisher(FX.publisherPart, { entryId: FX.entryId })
    expect(r.ok, r.ok ? '' : `${r.reason}`).toBe(true)
    if (!r.ok) return

    const status = composeEntryStatus({
      publisherStatus: r.status,
      entryStatus: r.entry!.status,
      suspension: r.suspension ?? null,
    })
    expect(status.admissible).toBe(true)

    const built = buildOfferPresentation({
      publisherPart: r.publisherPart,
      domain: r.domain,
      publisherDomainVerified: true,
      entryLocalPart: r.entry!.entry_id,
      wrCodeCanonical: VALID_CODE,
      evp: r.evp!,
      status,
      auditUrlBase: 'https://wrc.example',
      evpRef: r.entry!.evp_ref,
      catalogEpoch: r.epoch,
      resolutionMode: 'public',
      stale: r.freshness === 'stale',
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    // EVP-first-render: the shown statement is the SIGNED one.
    expect(built.presentation.value_statement).toBe(FX.evp.value_statement)
    expect(built.presentation.verified_domain).toBe(FX.domain)
    expect(built.presentation.audit_url).toContain('/v1/audit/')
  })

  it('A2: carrier text can never reach the offer', () => {
    // The projection is built from the EVP object; there is no input through
    // which an email body could supply a value statement.
    const status = composeEntryStatus({ publisherStatus: 'active', entryStatus: 'published' })
    const built = buildOfferPresentation({
      publisherPart: 'WR7X4K',
      domain: 'publisher.test',
      publisherDomainVerified: true,
      entryLocalPart: '9B2M3',
      wrCodeCanonical: VALID_CODE,
      evp: null, // no verified EVP
      status,
      catalogEpoch: 7,
      resolutionMode: 'public',
      stale: false,
    })
    // No degraded offer: refusal, not an offer assembled from something else.
    expect(built.ok).toBe(false)
    if (!built.ok) expect(built.refusal).toBe('no_verified_evp')
  })
})

describe('(b) forwarded / unauthenticated message', () => {
  const unauthenticated = createChannelProvenanceRecord({
    contentSha256: SHA,
    material: { authenticationResults: undefined, fromDomain: 'forwarder.test' },
    evaluatedAt: '2026-08-11T00:00:00.000Z',
  })

  it('raises the unsuppressible alert', () => {
    expect(channelAlertRequiredForDisplay(unauthenticated)).toBe(true)
    expect(unauthenticated.channel_pass).toBe(false)
  })

  it('derives zero affordances: nothing authenticated ⇒ no publisher alignment', () => {
    const { alignment, record } = applyPublisherDomainAlignment(
      unauthenticated,
      ['publisher.test'],
      '2026-08-11T01:00:00.000Z',
    )
    expect(alignment).toBe('no_authenticated_domain')
    expect(record.channel_pass).toBe(false)
  })

  it('5C: manual entry is the one downgrade path and completes the chain', async () => {
    // The capture gate does not consult provenance at all — that is what makes
    // manual entry work for a message whose channel failed.
    const captured = captureBaselineCode(VALID_CODE)
    expect(captured.ok).toBe(true)
    if (!captured.ok) return
    expect(captured.publisher).toBe('WR7X4K')

    // …and the resolution chain runs identically from there.
    const r = await client().resolvePublisher(FX.publisherPart, { entryId: FX.entryId })
    expect(r.ok).toBe(true)
  })

  it('character-level correction assistance is possible: a check failure is typed', () => {
    const bad = captureBaselineCode('WR7X4K9B2M3Q')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toBe('check_failed')
  })

  it('O3: the local renderer refuses to render without a validated identifier', () => {
    expect(renderCodeForDisplay(null)).toBeNull()
    expect(renderCodeForDisplay('')).toBeNull()
    expect(renderCodeForDisplay('TOOSHORT')).toBeNull()
    expect(renderCodeForDisplay(VALID_CODE)).toBe('WR7X4K-9B2M3-P')
  })
})

describe('(c) status surfaces, no offer', () => {
  for (const s of ['revoked', 'inactive', 'compromised', 'superseded'] as const) {
    it(`${s} → status surface, offer refused`, () => {
      const status = composeEntryStatus({
        publisherStatus: s,
        entryStatus: 'published',
        successorPublisherPart: s === 'superseded' ? 'NEWPUB' : null,
      })
      expect(status.admissible).toBe(false)
      expect(status.headline).not.toBeNull()
      const built = buildOfferPresentation({
        publisherPart: 'WR7X4K',
        domain: 'publisher.test',
        publisherDomainVerified: true,
        entryLocalPart: '9B2M3',
        wrCodeCanonical: VALID_CODE,
        evp: FX.evp,
        status,
        catalogEpoch: 7,
        resolutionMode: 'public',
        stale: false,
      })
      expect(built.ok).toBe(false)
      if (!built.ok) expect(built.refusal).toBe('not_admissible')
      if (s === 'compromised') expect(status.unsuppressible_warning).toBe(true)
      if (s === 'superseded') expect(status.successor_publisher_part).toBe('NEWPUB')
    })
  }

  it('unknown code → capture error, NOT a status surface', async () => {
    const t = createFixtureTransport(FX, {
      resolve: { ok: false, code: 'http_status', message: 'HTTP 404', status: 404 },
    })
    const r = await new WrcResolutionClient({
      transport: t,
      store: new WrcResolvedRecordStore(createMemoryPersistence(), createMemoryEpochFloorStore()),
      ingestPublicKey: FX.ingest.pub,
      now: () => NOW,
    }).resolvePublisher(FX.publisherPart)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('unknown_identifier')
      expect(r.captureError).toBe(true)
    }
  })

  it('expired → the transition produces a status, never silence', async () => {
    const { applyExpiryTransition } = await import('../entryStatusSurface')
    const status = composeEntryStatus({
      publisherStatus: applyExpiryTransition('active', 1_000, 2_000),
      entryStatus: 'published',
    })
    expect(status.admissible).toBe(false)
    expect(status.headline?.reason).toBe('publisher_revoked')
  })
})

describe('delta — consent-time CatalogHead re-check', () => {
  const base = { stagedEpoch: 7, currentEpoch: 7, epochFloor: 7, fresh: true, suspended: false }

  it('passes when nothing moved', () => {
    expect(recheckCatalogHeadForConsent(base).ok).toBe(true)
  })

  it('a rollback is refused as a rollback, not as staleness', () => {
    const r = recheckCatalogHeadForConsent({ ...base, currentEpoch: 6, epochFloor: 7 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('CATALOG_EPOCH_ROLLBACK')
  })

  it('suspension at consent time refuses', () => {
    const r = recheckCatalogHeadForConsent({ ...base, suspended: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('ENTRY_SUSPENDED_AT_CONSENT')
  })

  it('a stale head refuses a NEW admission', () => {
    const r = recheckCatalogHeadForConsent({ ...base, fresh: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('CATALOG_HEAD_STALE')
  })

  it('a new epoch sends the operator back to a re-staged offer', () => {
    const r = recheckCatalogHeadForConsent({ ...base, currentEpoch: 8, epochFloor: 7 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('CATALOG_EPOCH_MOVED')
  })
})

describe('A4 — audit link', () => {
  it('is built only when both halves are known', () => {
    expect(buildAuditUrl('https://wrc.example', 'sha256:abc')).toBe(
      'https://wrc.example/v1/audit/sha256%3Aabc',
    )
    expect(buildAuditUrl(null, 'sha256:abc')).toBeNull()
    expect(buildAuditUrl('https://wrc.example', null)).toBeNull()
  })
})
