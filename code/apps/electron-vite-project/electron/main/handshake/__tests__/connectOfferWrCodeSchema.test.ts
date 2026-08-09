/**
 * Phase 4 / 4B exit criteria — offer schema, preview-hash coverage, consent gate.
 *
 * The preview hash is what the operator's consent is pinned to. If two offers
 * that differ in something the operator was shown produce the same hash, the
 * consent record does not actually bind what was consented to — so the coverage
 * assertions below are the substance of this suite, not paperwork.
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import {
  buildConnectOfferPreview,
  ensureConnectOfferSchema,
  insertConsentRecord,
  stageConnectOffer,
  type ConnectOfferRow,
  type WrCodeOfferResolution,
} from '../connectOfferStaging'
import { revalidateOfferStatusForConsent } from '../ipc'

const _require = createRequire(import.meta.url)
let Database: any = null
try {
  Database = _require('better-sqlite3')
  const probe = new Database(':memory:')
  probe.close()
} catch {
  Database = null
}

function db(): any {
  const d = new Database(':memory:')
  ensureConnectOfferSchema(d)
  return d
}

const RESOLUTION: WrCodeOfferResolution = {
  wr_code_canonical: 'WR7X4K9B2M3PC',
  publisher_part: 'WR7X4K',
  entry_local_part: '9B2M3',
  umbrella_handshake_id: 'hs-umbrella',
  entry_status: 'published',
  resolution_mode: 'public',
  session_bound_expires_at: null,
  evp_ref: 'sha256:' + 'a'.repeat(43),
  value_statement: 'Signed value statement',
  catalog_epoch: 7,
  audit_url: 'https://wrc.example/v1/audit/sha256:aaa',
  publisher_domain_verified: true,
}

function baseOfferRow(over: Partial<ConnectOfferRow> = {}): ConnectOfferRow {
  return {
    offer_id: 'off-1',
    handshake_id: 'hs-1',
    capsule_json: JSON.stringify({ context_scopes: ['a'], external_processing: 'none' }),
    capsule_hash: 'cap-hash',
    sender_email: 's@example.com',
    sender_iss: 'iss',
    sender_sub: 'sub',
    sender_wrdesk_user_id: 'u-1',
    receiver_email: 'r@example.com',
    profile_id: 'p-1',
    ingress_path: 'assisted_email',
    invitation_class: 'public_bearer',
    verification_status: 'verified',
    verification_reason: null,
    suppressed: 0,
    staged_at: '2026-08-09T00:00:00.000Z',
    expires_at: '2026-08-16T00:00:00.000Z',
    consumed_at: null,
    consumed_action: null,
    consent_id: null,
    wr_code_canonical: RESOLUTION.wr_code_canonical,
    publisher_part: RESOLUTION.publisher_part,
    entry_local_part: RESOLUTION.entry_local_part,
    umbrella_handshake_id: RESOLUTION.umbrella_handshake_id,
    entry_status: RESOLUTION.entry_status,
    resolution_mode: RESOLUTION.resolution_mode,
    session_bound_expires_at: null,
    evp_ref: RESOLUTION.evp_ref,
    value_statement: RESOLUTION.value_statement,
    catalog_epoch: RESOLUTION.catalog_epoch,
    audit_url: RESOLUTION.audit_url,
    ...over,
  }
}

describe.skipIf(!Database)('4B — offer schema carries resolution output', () => {
  it('stages and reads back every resolution field', () => {
    const d = db()
    try {
      const res = stageConnectOffer(d, {
        handshake_id: 'hs-1',
        capsule: { context_scopes: ['a'] },
        capsule_hash: 'cap-1',
        profile_id: 'p-1',
        ingress_path: 'assisted_email',
        verification: { ok: true },
        wr_code: RESOLUTION,
      })
      expect(res.staged).toBe(true)
      const row = d
        .prepare('SELECT * FROM wr_connect_offers WHERE handshake_id = ?')
        .get('hs-1') as ConnectOfferRow
      expect(row.wr_code_canonical).toBe(RESOLUTION.wr_code_canonical)
      expect(row.publisher_part).toBe('WR7X4K')
      expect(row.entry_local_part).toBe('9B2M3')
      expect(row.umbrella_handshake_id).toBe('hs-umbrella')
      expect(row.entry_status).toBe('published')
      expect(row.resolution_mode).toBe('public')
      expect(row.evp_ref).toBe(RESOLUTION.evp_ref)
      expect(row.value_statement).toBe('Signed value statement')
      expect(row.catalog_epoch).toBe(7)
      expect(row.audit_url).toBe(RESOLUTION.audit_url)
    } finally {
      d.close()
    }
  })

  it('a non-WR-code offer stages with nulls, not defaults', () => {
    const d = db()
    try {
      stageConnectOffer(d, {
        handshake_id: 'hs-2',
        capsule: {},
        capsule_hash: 'cap-2',
        profile_id: 'p-1',
        ingress_path: 'link',
        verification: { ok: true },
      })
      const row = d.prepare('SELECT * FROM wr_connect_offers WHERE handshake_id = ?').get('hs-2') as ConnectOfferRow
      expect(row.publisher_part).toBeNull()
      expect(row.resolution_mode).toBeNull()
    } finally {
      d.close()
    }
  })

  it('the column migration is idempotent on an existing table', () => {
    const d = new Database(':memory:')
    try {
      // Simulate a pre-Phase-4 database.
      d.exec(`CREATE TABLE wr_connect_offers (
        offer_id TEXT PRIMARY KEY, handshake_id TEXT NOT NULL, capsule_json TEXT NOT NULL,
        capsule_hash TEXT NOT NULL, sender_email TEXT, sender_iss TEXT, sender_sub TEXT,
        sender_wrdesk_user_id TEXT, receiver_email TEXT, profile_id TEXT NOT NULL,
        ingress_path TEXT NOT NULL, invitation_class TEXT NOT NULL DEFAULT 'public_bearer',
        verification_status TEXT NOT NULL, verification_reason TEXT, suppressed INTEGER NOT NULL DEFAULT 0,
        staged_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, consumed_action TEXT, consent_id TEXT)`)
      ensureConnectOfferSchema(d)
      ensureConnectOfferSchema(d) // twice — must not throw
      const cols = (d.prepare('PRAGMA table_info(wr_connect_offers)').all() as Array<{ name: string }>).map(
        (c) => c.name,
      )
      for (const c of ['wr_code_canonical', 'publisher_part', 'resolution_mode', 'evp_ref', 'value_statement', 'catalog_epoch', 'audit_url']) {
        expect(cols, c).toContain(c)
      }
    } finally {
      d.close()
    }
  })
})

describe('4B — preview hash coverage', () => {
  it('two offers differing ONLY in resolution_mode hash differently', () => {
    const a = buildConnectOfferPreview(baseOfferRow({ resolution_mode: 'public' }))
    const b = buildConnectOfferPreview(baseOfferRow({ resolution_mode: 'session_bound' }))
    expect(a.preview_hash).not.toBe(b.preview_hash)
  })

  it('two offers differing ONLY in the entry hash differently', () => {
    const a = buildConnectOfferPreview(baseOfferRow({ entry_local_part: '9B2M3' }))
    const b = buildConnectOfferPreview(baseOfferRow({ entry_local_part: 'OTHER' }))
    expect(a.preview_hash).not.toBe(b.preview_hash)
  })

  it('O2 extension: evp_ref and value_statement are covered', () => {
    const base = baseOfferRow()
    const diffRef = buildConnectOfferPreview(baseOfferRow({ evp_ref: 'sha256:' + 'b'.repeat(43) }))
    const diffStatement = buildConnectOfferPreview(
      baseOfferRow({ value_statement: 'A DIFFERENT promise' }),
    )
    const same = buildConnectOfferPreview(base)
    expect(diffRef.preview_hash).not.toBe(same.preview_hash)
    // What the operator consents to includes the value promise they were shown.
    expect(diffStatement.preview_hash).not.toBe(same.preview_hash)
  })

  it('catalog_epoch and publisher part are covered', () => {
    const same = buildConnectOfferPreview(baseOfferRow())
    expect(buildConnectOfferPreview(baseOfferRow({ catalog_epoch: 8 })).preview_hash).not.toBe(
      same.preview_hash,
    )
    expect(buildConnectOfferPreview(baseOfferRow({ publisher_part: 'OTHER1' })).preview_hash).not.toBe(
      same.preview_hash,
    )
  })

  it('boundDefinition gains publisher_domain_verified', () => {
    const verified = buildConnectOfferPreview(baseOfferRow())
    const unverified = buildConnectOfferPreview(baseOfferRow({ publisher_part: null }))
    expect(verified.bound_definition_hash).not.toBe(unverified.bound_definition_hash)
    expect(verified.preview.bound_definition).toMatchObject({ publisher_domain_verified: true })
  })

  it('identical offers hash identically (the check is not just nondeterminism)', () => {
    expect(buildConnectOfferPreview(baseOfferRow()).preview_hash).toBe(
      buildConnectOfferPreview(baseOfferRow()).preview_hash,
    )
  })
})

describe.skipIf(!Database)('4B — consent records resolution_mode', () => {
  it('persists the mode with the consent it belongs to', () => {
    const d = db()
    try {
      const rec = insertConsentRecord(d, {
        offer_id: 'off-1',
        handshake_id: 'hs-1',
        role: 'acceptor',
        preview_hash: 'ph',
        bound_definition_hash: 'bh',
        contract_state_hash: 'ch',
        capture_method: 'assisted_email',
        ingress_path: 'assisted_email',
        actor_wrdesk_user_id: 'u-1',
        resolution_mode: 'session_bound',
      })
      const row = d
        .prepare('SELECT resolution_mode FROM wr_consent_records WHERE consent_id = ?')
        .get(rec.consent_id) as { resolution_mode: string }
      expect(row.resolution_mode).toBe('session_bound')
    } finally {
      d.close()
    }
  })
})

describe.skipIf(!Database)('O6 — consent-time re-validation', () => {
  function stage(d: any, over: Partial<WrCodeOfferResolution> = {}) {
    stageConnectOffer(d, {
      handshake_id: 'hs-o6',
      capsule: {},
      capsule_hash: 'cap-o6',
      profile_id: 'p-1',
      ingress_path: 'assisted_email',
      verification: { ok: true },
      wr_code: { ...RESOLUTION, ...over },
    })
    return (d.prepare('SELECT offer_id FROM wr_connect_offers WHERE handshake_id = ?').get('hs-o6') as {
      offer_id: string
    }).offer_id
  }

  it('passes while the entry is still published', () => {
    const d = db()
    try {
      expect(revalidateOfferStatusForConsent(d, stage(d)).ok).toBe(true)
    } finally {
      d.close()
    }
  })

  it('fails on a mid-window transition away from published', () => {
    const d = db()
    try {
      const id = stage(d)
      d.prepare('UPDATE wr_connect_offers SET entry_status = ? WHERE offer_id = ?').run('suspended', id)
      const r = revalidateOfferStatusForConsent(d, id)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('ENTRY_NOT_PUBLISHED')
    } finally {
      d.close()
    }
  })

  it('fails when a session-bound resolution has expired', () => {
    const d = db()
    try {
      const id = stage(d, {
        resolution_mode: 'session_bound',
        session_bound_expires_at: new Date(Date.now() - 60_000).toISOString(),
      })
      const r = revalidateOfferStatusForConsent(d, id)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toBe('OFFER_RESOLUTION_EXPIRED')
    } finally {
      d.close()
    }
  })

  it('non-WR-code offers are unaffected', () => {
    const d = db()
    try {
      stageConnectOffer(d, {
        handshake_id: 'hs-plain',
        capsule: {},
        capsule_hash: 'cap-plain',
        profile_id: 'p-1',
        ingress_path: 'link',
        verification: { ok: true },
      })
      const id = (
        d.prepare('SELECT offer_id FROM wr_connect_offers WHERE handshake_id = ?').get('hs-plain') as {
          offer_id: string
        }
      ).offer_id
      expect(revalidateOfferStatusForConsent(d, id).ok).toBe(true)
    } finally {
      d.close()
    }
  })
})
