/**
 * Guard — consent evidence never fabricates a capture method (Phase 1C;
 * report contradiction G4-3).
 *
 * `ingressCaptureMethodForOffer` used to fall back to `'assisted_email'` for
 * any ingress path missing from `SOURCE_INGRESS_MAP`. The capture method is
 * written into the Hash-Pinned consent record as evidence of how the user
 * actually received the invitation, so that default attested to an email
 * capture for offers that never touched mail — and it silently swallowed the
 * exact case this slice is about: `wr_code_public` is a registered, recordable
 * ingress path with no mapping, so a WR-Code capture would have been recorded
 * as an assisted email.
 *
 * Fail-closed now: an unmapped path fails the consent with a distinct,
 * diagnosable reason rather than inventing provenance.
 *
 * Run under Electron's Node ABI when available: `pnpm test:native-db <thisFile>`.
 */

import { createRequire } from 'module'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isRegisteredIngressPath, isRecordableIngressPath } from '@repo/ingestion-core'

const require = createRequire(import.meta.url)
let Database: typeof import('better-sqlite3').default | null = null
try {
  const D = require('better-sqlite3') as typeof import('better-sqlite3').default
  const d = new D(':memory:')
  d.close()
  Database = D
} catch {
  Database = null
}

const CAPSULE = {
  capsule_type: 'handshake-initiate',
  handshake_id: 'hs-1c',
  context_scopes: ['availability'],
  external_processing: 'none',
  reciprocal_allowed: true,
}

describe.skipIf(!Database)('capture method is derived, never defaulted', () => {
  let stagingDb: import('better-sqlite3').Database
  let formation: typeof import('../formationPipeline')
  let staging: typeof import('../connectOfferStaging')

  beforeEach(async () => {
    formation = await import('../formationPipeline')
    staging = await import('../connectOfferStaging')
    stagingDb = new Database!(':memory:')
    formation.setConnectOfferDbProvider(() => stagingDb)
  })

  afterEach(() => {
    formation.setConnectOfferDbProvider(null)
    try { stagingDb.close() } catch { /* noop */ }
  })

  function stageOn(ingressPath: string): string {
    const r = staging.stageConnectOffer(stagingDb, {
      handshake_id: `hs-${ingressPath}`,
      capsule: CAPSULE,
      capsule_hash: `hash-${ingressPath}`,
      profile_id: 'private_personal',
      ingress_path: ingressPath,
      verification: { ok: true },
    })
    expect(r.staged).toBe(true)
    return (r as { staged: true; offerId: string }).offerId
  }

  it('a mapped ingress path consents and records the mapped capture method', () => {
    const offerId = stageOn('beap_invitation')
    const prep = formation.prepareFormationConsent({ offerId, actorWrdeskUserId: 'me' })
    expect(prep.ok).toBe(true)
    if (prep.ok) {
      expect(prep.consentRef.formation.capture_method).toBe('assisted_email')
      expect(prep.consent.capture_method).toBe('assisted_email')
    }
  })

  it('the file-import path records manual entry, not email', () => {
    const offerId = stageOn('optirando.ingress.file_import')
    const prep = formation.prepareFormationConsent({ offerId, actorWrdeskUserId: 'me' })
    expect(prep.ok).toBe(true)
    if (prep.ok) expect(prep.consentRef.formation.capture_method).toBe('manual_entry')
  })

  it('an unmapped but recordable path fails closed instead of claiming an email capture', () => {
    // Precondition: this really is a registered, recordable path — the failure
    // below is the missing mapping, not an unknown identifier.
    expect(isRegisteredIngressPath('wr_code_public')).toBe(true)
    expect(isRecordableIngressPath('wr_code_public')).toBe(true)

    const offerId = stageOn('wr_code_public')
    const prep = formation.prepareFormationConsent({ offerId, actorWrdeskUserId: 'me' })
    expect(prep.ok).toBe(false)
    if (!prep.ok) expect(prep.reason).toMatch(/^INGRESS_PATH_HAS_NO_CAPTURE_METHOD:/)
  })

  it('the failed consent wrote no consent record and left the offer consentable', () => {
    const offerId = stageOn('wr_code_public')
    formation.prepareFormationConsent({ offerId, actorWrdeskUserId: 'me' })
    const consents = stagingDb
      .prepare('SELECT COUNT(*) AS c FROM wr_consent_records WHERE offer_id = ?')
      .get(offerId) as { c: number }
    expect(consents.c).toBe(0)
    expect(staging.getConsentableOffer(stagingDb, offerId)).not.toBeNull()
  })

  it('an entirely unknown path also fails closed', () => {
    const offerId = stageOn('not_a_registered_path')
    const prep = formation.prepareFormationConsent({ offerId, actorWrdeskUserId: 'me' })
    expect(prep.ok).toBe(false)
    if (!prep.ok) expect(prep.reason).not.toMatch(/^OK/)
  })
})

describe('source: no capture-method fallback survives', () => {
  const source = readFileSync(resolve(__dirname, '..', 'formationPipeline.ts'), 'utf8')
  const fn = source.slice(
    source.indexOf('function ingressCaptureMethodForOffer'),
    source.indexOf('// ── Initiator-side formation'),
  )

  it('the resolver is scoped and returns null rather than a default method', () => {
    expect(fn.length).toBeGreaterThan(0)
    expect(fn).toContain('return null')
    expect(fn).not.toMatch(/return\s+['"]assisted_email['"]/)
  })

  it('the consent path rejects the null before it can reach the consent record', () => {
    const consentFn = source.slice(
      source.indexOf('export function prepareFormationConsent'),
      source.indexOf('/** Mark the offer consumed'),
    )
    const resolverCall = consentFn.indexOf('ingressCaptureMethodForOffer(offer)')
    const nullCheck = consentFn.indexOf('captureMethodId === null')
    const consentWrite = consentFn.indexOf('insertConsentRecord(')
    expect(resolverCall).toBeGreaterThan(-1)
    expect(nullCheck).toBeGreaterThan(resolverCall)
    expect(consentWrite).toBeGreaterThan(nullCheck)
  })
})
