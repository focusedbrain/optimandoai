/**
 * Phase 4 — One formation pipeline — acceptance tests 1, 2, 3, 4, 6.
 *
 *  1. No formation outside capture + consent [IX.12.1]: inbound initiates
 *     produce staging entries only; the relationship store has a single
 *     consent-gated writer (structural).
 *  2. Offer suppression [IX.3.1 rule 2]: verification failure → no Connect
 *     offer reachable, no override control exists (structural absence).
 *  3. Ingress-path neutrality [VII.4.6]: no semantic branch on `ingress_path`
 *     or capture-method values; different paths yield semantically identical
 *     relationships (same profile → same rights).
 *  4. `handshake_type` elimination: the discriminator is gone from the record
 *     model and no production code branches on it outside the declared wire
 *     compat boundaries (grep-level structural absence).
 *  6. Provenance + Hash-Pinned Consent [IX.3.1 rule 5, IX.3.4]: new formations
 *     carry capture provenance in the signed contract; consent records resolve
 *     to their three hashes; a consent whose preview hash does not resolve is
 *     invalid.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import Database from 'better-sqlite3'
import {
  setConnectOfferDbProvider,
  stageInboundInitiate,
  listConnectOffers,
  prepareFormationConsent,
  ingressMappingForSource,
} from '../formationPipeline'
import {
  stageConnectOffer,
  getConsentableOffer,
  listPendingConnectOffers,
  buildConnectOfferPreview,
  consentRecordResolves,
  expireStaleOffers,
  type ConnectOfferRow,
} from '../connectOfferStaging'
import { buildFormationCore, CAPTURE_PROVENANCE_NS, type FormationMeta } from '../coreStore'
import { buildActiveHandshakeRecord } from './helpers'

// ── Shared source scanner ─────────────────────────────────────────────────────

// Repo root: .../electron/main/handshake/__tests__ → up 6.
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..', '..')
const PRODUCTION_ROOTS = [
  join(REPO_ROOT, 'apps', 'electron-vite-project', 'electron'),
  join(REPO_ROOT, 'apps', 'electron-vite-project', 'src'),
  join(REPO_ROOT, 'apps', 'extension-chromium', 'src'),
  join(REPO_ROOT, 'packages'),
]

function* productionSources(): Generator<{ path: string; rel: string; text: string }> {
  const walk = function* (dir: string): Generator<string> {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (
        entry === 'node_modules' || entry === 'dist' || entry === 'dist-electron' ||
        entry === '__tests__' || entry === '.git' || entry === 'coverage'
      ) continue
      const p = join(dir, entry)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { yield* walk(p); continue }
      if (!/\.(ts|tsx)$/.test(entry) || /\.(test|spec)\./.test(entry) || entry.endsWith('.d.ts')) continue
      yield p
    }
  }
  for (const root of PRODUCTION_ROOTS) {
    for (const p of walk(root)) {
      yield { path: p, rel: p.split(sep).join('/').slice(REPO_ROOT.length + 1), text: readFileSync(p, 'utf8') }
    }
  }
}

// ── Staging DB fixture ────────────────────────────────────────────────────────

let stagingDb: InstanceType<typeof Database>

beforeEach(() => {
  stagingDb = new Database(':memory:')
  setConnectOfferDbProvider(() => stagingDb)
})

afterEach(() => {
  setConnectOfferDbProvider(null)
  try { stagingDb.close() } catch { /* noop */ }
})

const CAPSULE = {
  capsule_type: 'handshake-initiate',
  handshake_id: 'hs-p4-01',
  context_scopes: ['availability', 'projects'],
  external_processing: 'none',
  reciprocal_allowed: true,
}

function stage(overrides?: Partial<Parameters<typeof stageInboundInitiate>[0]>) {
  return stageInboundInitiate({
    handshake_id: 'hs-p4-01',
    capsule: CAPSULE,
    capsule_hash: 'hash-p4-01',
    sender_email: 'peer@example.com',
    sender_iss: 'https://auth.wrdesk.com',
    sender_sub: 'sub-peer',
    sender_wrdesk_user_id: 'peer-user',
    receiver_email: 'me@example.com',
    source_type: 'email',
    ...overrides,
  })
}

// ── 1. No formation outside capture + consent ────────────────────────────────

describe('acceptance 1 — no formation outside capture + consent [IX.12.1]', () => {
  it('inbound initiate produces a staging entry only — relationship store untouched', () => {
    const relDb = new Database(':memory:')
    try {
      // stageInboundInitiate does not even receive a relationship DB handle —
      // it writes exclusively to the staging store.
      const r = stage()
      expect(r.staged).toBe(true)
      expect(listPendingConnectOffers(stagingDb).length).toBe(1)
      const tables = relDb
        .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
        .all() as Array<{ name: string }>
      expect(tables.length).toBe(0)
    } finally {
      relDb.close()
    }
  })

  it('structural: the relationship store has consent-gated writers only', () => {
    // insertHandshakeRecord is THE single write entry point for new
    // relationship rows. Its production callers are exactly the one pipeline
    // (initiator consent) and the consent-gated enforcement ingest.
    const allowed = new Set([
      'apps/electron-vite-project/electron/main/handshake/db.ts', // definition
      'apps/electron-vite-project/electron/main/handshake/formationPipeline.ts',
      'apps/electron-vite-project/electron/main/handshake/enforcement.ts',
    ])
    const offenders: string[] = []
    for (const f of productionSources()) {
      if (/insertHandshakeRecord\s*\(/.test(f.text) && !allowed.has(f.rel)) offenders.push(f.rel)
    }
    expect(offenders).toEqual([])
  })

  it('structural: deleted dialects stay deleted', () => {
    for (const f of productionSources()) {
      expect(f.rel.endsWith('initiatorPersist.ts'), `${f.rel} must not exist`).toBe(false)
      expect(f.rel.endsWith('recipientPersist.ts'), `${f.rel} must not exist`).toBe(false)
    }
  })
})

// ── 2. Offer suppression ──────────────────────────────────────────────────────

describe('acceptance 2 — offer suppression [IX.3.1 rule 2]', () => {
  it('verification failure → offer unreachable from every read surface', () => {
    const r = stageConnectOffer(stagingDb, {
      handshake_id: 'hs-p4-bad',
      capsule: CAPSULE,
      capsule_hash: 'hash-p4-bad',
      profile_id: 'private_personal',
      ingress_path: 'beap_invitation',
      verification: { ok: false, reason: 'signature_invalid' },
    })
    expect(r.staged).toBe(true)
    if (r.staged) {
      expect(r.suppressed).toBe(true)

      // Not listable, not consentable — structurally unreachable.
      expect(listPendingConnectOffers(stagingDb).length).toBe(0)
      expect(listConnectOffers().length).toBe(0)
      expect(getConsentableOffer(stagingDb, r.offerId)).toBeNull()
      const prep = prepareFormationConsent({ offerId: r.offerId, actorWrdeskUserId: 'me' })
      expect(prep.ok).toBe(false)
      if (!prep.ok) expect(prep.reason).toBe('OFFER_NOT_CONSENTABLE')

      // But it IS a logged record: the row persists with the failure reason.
      const row = stagingDb
        .prepare(`SELECT verification_status, verification_reason, suppressed FROM wr_connect_offers WHERE offer_id = ?`)
        .get(r.offerId) as { verification_status: string; verification_reason: string; suppressed: number }
      expect(row.verification_status).toBe('failed')
      expect(row.verification_reason).toBe('signature_invalid')
      expect(row.suppressed).toBe(1)
    }
  })

  it('structural absence: no override control, single staging read surface', () => {
    for (const f of productionSources()) {
      // Documentation phrases like `there is no "connect anyway"` are fine;
      // an affirmative control name/label is not.
      const overrideLines = f.text
        .split('\n')
        .filter((l) => /connect[\s_-]?anyway/i.test(l) && !/no\s+["'“`]?connect/i.test(l))
      expect(overrideLines, `${f.rel} must not offer a "connect anyway" override`).toEqual([])
      // The staging tables have exactly one production read/write surface;
      // no second module can build an alternate (unsuppressed) listing.
      if (f.text.includes('wr_connect_offers')) {
        expect(f.rel).toBe('apps/electron-vite-project/electron/main/handshake/connectOfferStaging.ts')
      }
    }
  })
})

// ── 3. Ingress-path neutrality ────────────────────────────────────────────────

describe('acceptance 3 — ingress-path neutrality [VII.4.6]', () => {
  it('lint: no production code compares ingress_path or capture_method to a literal value', () => {
    const forbidden = /(ingress_path|capture_method)\s*[!=]==?\s*['"`]/
    const offenders: string[] = []
    for (const f of productionSources()) {
      const lines = f.text.split('\n')
      lines.forEach((line, i) => {
        if (forbidden.test(line)) offenders.push(`${f.rel}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(offenders).toEqual([])
  })

  it('formation via different paths yields semantically identical relationships', () => {
    const record = buildActiveHandshakeRecord()
    const mk = (ingress: string, capture: string): FormationMeta => ({
      profile_id: 'private_personal',
      profile_version: 1,
      ingress_path: ingress,
      capture_method: capture,
      source_reference: null,
      consent_id: 'c-1',
      nonce: 'n-1',
    })
    const viaEmail = buildFormationCore(record, mk('beap_invitation', 'assisted_email'))
    const viaFile = buildFormationCore(record, mk('optirando.ingress.file_import', 'manual_entry'))

    // Same profile → same rights: everything except the log-only ingress path
    // and the capture-provenance declaration payload is identical.
    expect(viaEmail.profile).toEqual(viaFile.profile)
    expect(viaEmail.initiator_id).toEqual(viaFile.initiator_id)
    expect(viaEmail.responder_id).toEqual(viaFile.responder_id)
    expect(viaEmail.declarations.map((d) => d.ns)).toEqual(viaFile.declarations.map((d) => d.ns))
    expect(viaEmail.ingress_path).not.toBe(viaFile.ingress_path)
  })

  it('Q4 mapping is total: every transport source resolves to a recordable pair', () => {
    for (const source of ['email', 'file_upload', 'internal', 'p2p', 'relay_pull', 'coordination_ws', 'never_seen_before']) {
      const m = ingressMappingForSource(source)
      expect(typeof m.ingress_path).toBe('string')
      expect(typeof m.capture_method).toBe('string')
    }
  })
})

// ── 4. handshake_type elimination ─────────────────────────────────────────────

describe('acceptance 4 — handshake_type elimination (grep-level structural absence)', () => {
  it('the record model no longer declares handshake_type', () => {
    const typesSrc = readFileSync(
      join(REPO_ROOT, 'apps', 'electron-vite-project', 'electron', 'main', 'handshake', 'types.ts'),
      'utf8',
    )
    const recordBlock = typesSrc.slice(typesSrc.indexOf('interface HandshakeRecord'))
    const firstClose = recordBlock.indexOf('\n}\n')
    expect(recordBlock.slice(0, firstClose)).not.toMatch(/^\s*handshake_type/m)
  })

  it('no production code branches on handshake_type outside the wire compat boundaries', () => {
    // Every remaining comparison is a WIRE/COLUMN boundary, not record logic:
    //  - samePrincipalWire.ts    — THE single legacy-wire reader
    //  - db.ts                   — frozen legacy column read/write
    //  - p2pTransport.ts         — internal relay envelope field parse (wire)
    //  - coordination-service    — relay-server wire parse/log (separate svc)
    const allowed = new Set([
      'apps/electron-vite-project/electron/main/handshake/samePrincipalWire.ts',
      'apps/electron-vite-project/electron/main/handshake/db.ts',
      'apps/electron-vite-project/electron/main/handshake/p2pTransport.ts',
      'packages/coordination-service/src/server.ts',
    ])
    const branchPattern = /[.?]\s*handshake_type\s*(?:[!=]==?|\.trim\(\)\s*[!=]==?)/
    const offenders: string[] = []
    for (const f of productionSources()) {
      const lines = f.text.split('\n')
      lines.forEach((line, i) => {
        if (branchPattern.test(line) && !allowed.has(f.rel)) {
          offenders.push(`${f.rel}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it("no production code writes handshake_type: 'standard' anywhere", () => {
    const offenders: string[] = []
    for (const f of productionSources()) {
      if (/handshake_type\s*:\s*'standard'/.test(f.text)) {
        // Type unions ("'internal' | 'standard'") are declarations, not writes.
        const lines = f.text.split('\n')
        lines.forEach((line, i) => {
          if (/handshake_type\s*:\s*'standard'/.test(line) && !line.includes('|')) {
            offenders.push(`${f.rel}:${i + 1}: ${line.trim()}`)
          }
        })
      }
    }
    expect(offenders).toEqual([])
  })
})

// ── 6. Provenance + Hash-Pinned Consent ───────────────────────────────────────

describe('acceptance 6 — provenance + hash-pinned consent [IX.3.1 rule 5, IX.3.4]', () => {
  it('new formations carry capture provenance in the signed contract', () => {
    const record = buildActiveHandshakeRecord()
    const core = buildFormationCore(record, {
      profile_id: 'private_personal',
      profile_version: 1,
      ingress_path: 'beap_invitation',
      capture_method: 'assisted_email',
      source_reference: 'imap:msg-42',
      consent_id: 'consent-42',
      nonce: 'nonce-42',
    })
    const prov = core.declarations.find((d) => d.ns === CAPTURE_PROVENANCE_NS)
    expect(prov).toBeDefined()
    expect((prov!.payload as any).method).toBe('assisted_email')
    expect((prov!.payload as any).source_reference).toBe('imap:msg-42')
    expect((prov!.payload as any).consent_id).toBe('consent-42')
  })

  it('consent resolves to its three hashes; tampered staged material invalidates it', () => {
    const r = stage()
    expect(r.staged).toBe(true)
    const offerId = (r as { offerId: string }).offerId

    const prep = prepareFormationConsent({ offerId, actorWrdeskUserId: 'me', sourceReference: 'email:inbox' })
    expect(prep.ok).toBe(true)
    if (!prep.ok) return

    expect(prep.consent.preview_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(prep.consent.bound_definition_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(prep.consent.contract_state_hash).toBe('hash-p4-01')
    expect(prep.consentRef.formation.capture_method).toBe('assisted_email')
    expect(prep.consentRef.formation.ingress_path).toBe('beap_invitation')

    // Valid while the staged material matches what was presented …
    expect(consentRecordResolves(stagingDb, prep.consent)).toEqual({ valid: true })

    // … and INVALID the moment the staged material differs from the pin.
    stagingDb
      .prepare(`UPDATE wr_connect_offers SET capsule_json = ? WHERE offer_id = ?`)
      .run(JSON.stringify({ ...CAPSULE, context_scopes: ['everything'] }), offerId)
    const tampered = consentRecordResolves(stagingDb, prep.consent)
    expect(tampered.valid).toBe(false)
    if (!tampered.valid) expect(tampered.reason).toBe('preview_hash_mismatch')
  })

  it('consent is refused when the user saw a different preview (presentation pin)', () => {
    const r = stage()
    const offerId = (r as { offerId: string }).offerId
    const prep = prepareFormationConsent({
      offerId,
      actorWrdeskUserId: 'me',
      expectedPreviewHash: 'f'.repeat(64),
    })
    expect(prep.ok).toBe(false)
    if (!prep.ok) expect(prep.reason).toBe('PREVIEW_HASH_MISMATCH')
  })

  it('Q7: staged offers expire after the 7-day window and stop being consentable', () => {
    const r = stage()
    const offerId = (r as { offerId: string }).offerId
    const row = stagingDb
      .prepare(`SELECT staged_at, expires_at FROM wr_connect_offers WHERE offer_id = ?`)
      .get(offerId) as { staged_at: string; expires_at: string }
    const windowMs = Date.parse(row.expires_at) - Date.parse(row.staged_at)
    expect(windowMs).toBe(7 * 24 * 60 * 60 * 1000)

    const after = new Date(Date.parse(row.expires_at) + 1000)
    expect(expireStaleOffers(stagingDb, after)).toBe(1)
    expect(getConsentableOffer(stagingDb, offerId)).toBeNull()
    const prep = prepareFormationConsent({ offerId, actorWrdeskUserId: 'me' })
    expect(prep.ok).toBe(false)
  })

  it('preview is client-generated from verified material only (no counterparty free text)', () => {
    const r = stageConnectOffer(stagingDb, {
      handshake_id: 'hs-p4-ft',
      capsule: {
        ...CAPSULE,
        handshake_id: 'hs-p4-ft',
        free_text_message: 'CLICK HERE — totally trustworthy counterparty prose',
      },
      capsule_hash: 'hash-p4-ft',
      sender_email: 'peer@example.com',
      profile_id: 'private_personal',
      ingress_path: 'beap_invitation',
      verification: { ok: true },
    })
    const offer = getConsentableOffer(stagingDb, (r as { offerId: string }).offerId) as ConnectOfferRow
    const preview = buildConnectOfferPreview(offer)
    expect(JSON.stringify(preview.preview)).not.toContain('CLICK HERE')
  })
})
