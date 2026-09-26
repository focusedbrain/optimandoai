/**
 * Phase 5 — Grants & Evidence acceptance tests.
 *
 *  1. No execution without consent tap + structural absence (no standing
 *     granted-tools set, no bypass API, no auto-accept control)
 *  2. Intent-Hash validity [IX.19.2] — covered in depth in
 *     execution/__tests__/executeToolRequest.test.ts; deviation re-asserted here
 *  3. Receiver-enforced scoping [VII.10.2–10.3]
 *  4. Limit-extension criticality [VII.10.8.3]
 *  5. Tier-L chain [IX.19.1]
 *  7. Revocation history (Q8)
 *
 * (6 — token forward-compatibility — lives in
 *  packages/ingestion-core/__tests__/capabilityToken.test.ts.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import Database from 'better-sqlite3'
import { migrateHandshakeTables, insertHandshakeRecord, deleteHandshakeRecord } from '../db'
import { admitInboundDelivery } from '../ingressAdmission'
import {
  createGrant,
  listGrants,
  resolveActiveDeliveryGrant,
  resolveDeliveryGrantAt,
  offScopeRevokeOfferDue,
  countOffScopeEvents,
  OFFSCOPE_REVOKE_OFFER_THRESHOLD,
} from '../grants'
import {
  setEvidenceDbProvider,
  appendEvidenceRecord,
  listEvidenceRecords,
  verifyEvidenceChain,
} from '../evidenceChain'
import { revokeHandshake, deleteRevokedRelationshipContent } from '../revocation'
import { HandshakeState } from '../types'
import { buildActiveHandshakeRecord, buildEffectivePolicy } from './helpers'

const HS = 'hs-001'

let db: InstanceType<typeof Database>

beforeEach(() => {
  db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrateHandshakeTables(db)
  setEvidenceDbProvider(() => db)
})

afterEach(() => {
  setEvidenceDbProvider(null)
  try { db.close() } catch { /* noop */ }
})

function insertActive(scopes: string[] = ['*']): void {
  insertHandshakeRecord(
    db,
    buildActiveHandshakeRecord({ effective_policy: buildEffectivePolicy({ allowedScopes: scopes }) }),
  )
}

// ── Shared production-source scanner ─────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..', '..')
const PRODUCTION_ROOTS = [
  join(REPO_ROOT, 'apps', 'electron-vite-project', 'electron'),
  join(REPO_ROOT, 'apps', 'electron-vite-project', 'src'),
  join(REPO_ROOT, 'apps', 'extension-chromium', 'src'),
  join(REPO_ROOT, 'packages'),
]

function* productionSources(): Generator<{ rel: string; text: string }> {
  const walk = function* (dir: string): Generator<string> {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
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
      yield { rel: p.split(sep).join('/').slice(REPO_ROOT.length + 1), text: readFileSync(p, 'utf8') }
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Acceptance 1 — no execution without consent tap [VII.10.1 / VII.14.6]
// ═════════════════════════════════════════════════════════════════════════════

describe('acceptance 1 — execution grants deleted, per-tap consent only', () => {
  it('structural absence: no standing granted-tools set anywhere in production code', () => {
    const offenders: string[] = []
    for (const f of productionSources()) {
      if (/GRANTED_TOOLS/.test(f.text)) offenders.push(f.rel)
    }
    expect(offenders).toEqual([])
  })

  it('structural absence: no auto-accept / bypass control on the consent path', () => {
    const offenders: string[] = []
    for (const f of productionSources()) {
      const lines = f.text.split('\n')
      lines.forEach((line, i) => {
        if (/skipConsent|auto_?accept|autoApprove|batch_?approve/i.test(line)) {
          offenders.push(`${f.rel}:${i + 1}: ${line.trim()}`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  it('structural: the consent store has a single writer (executionConsent.ts) and a single consumer (executeToolRequest.ts)', () => {
    for (const f of productionSources()) {
      if (f.text.includes('wr_execution_consents')) {
        expect(f.rel).toBe('apps/electron-vite-project/electron/main/execution/executionConsent.ts')
      }
      if (/consumeExecutionConsent\s*\(/.test(f.text) && !f.rel.endsWith('execution/executionConsent.ts')) {
        expect(f.rel).toBe('apps/electron-vite-project/electron/main/execution/executeToolRequest.ts')
      }
    }
  })

  it('every execution path requires a fresh consent record with Intent Hash and produces a PoAE record', async () => {
    // Behavioral depth lives in executeToolRequest.test.ts; assert the gate
    // shape here: no consent_ref → CONSENT_REQUIRED before any handler lookup.
    insertActive()
    const { executeToolRequest } = await import('../../execution/executeToolRequest')
    const refused = await executeToolRequest(db, {
      request_id: 'req-a1',
      handshake_id: HS,
      tool_name: 'anything',
      parameters: {},
      requested_at: new Date().toISOString(),
      origin: 'local_ui',
    })
    expect(refused.success).toBe(false)
    if (!refused.success) expect(refused.reason).toBe('CONSENT_REQUIRED')
    expect(listEvidenceRecords(db, HS).filter((r) => r.record_type === 'poae')).toEqual([])
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Acceptance 3 — receiver-enforced scoping [VII.10.2–10.3]
// ═════════════════════════════════════════════════════════════════════════════

describe('acceptance 3 — receiver-enforced grant scoping', () => {
  it('off-scope delivery is blocked pre-visibility, logged, and surfaces a revoke offer after repetition', () => {
    insertActive(['availability'])
    const g = createGrant(db, {
      handshakeId: HS,
      grantType: 'delivery',
      direction: 'inbound',
      scopes: ['availability'],
      consentId: 'consent-g1',
    })
    expect(g.ok).toBe(true)

    for (let i = 0; i < OFFSCOPE_REVOKE_OFFER_THRESHOLD; i++) {
      const r = admitInboundDelivery(db, {
        handshakeId: HS,
        kind: 'beap_message',
        source: 'relay_pull',
        scope: 'finances',
      })
      expect(r.admitted).toBe(false)
      if (!r.admitted) expect(r.reason).toBe('grant_scope_violation')
    }

    // Pre-visibility death leaves a logged record …
    const blocked = db
      .prepare(`SELECT COUNT(*) AS n FROM audit_log WHERE action = 'INGRESS_ADMISSION_BLOCKED' AND handshake_id = ?`)
      .get(HS) as { n: number }
    expect(blocked.n).toBe(OFFSCOPE_REVOKE_OFFER_THRESHOLD)
    // … evidence records for the blocked admissions …
    const poacBlocks = listEvidenceRecords(db, HS)
      .filter((r) => r.record_type === 'poac')
      .filter((r) => JSON.parse(r.payload_json).kind === 'admission')
    expect(poacBlocks.length).toBe(OFFSCOPE_REVOKE_OFFER_THRESHOLD)
    // … and repetition surfaces the one-tap revoke offer [VII.10.2].
    expect(countOffScopeEvents(db, HS)).toBe(OFFSCOPE_REVOKE_OFFER_THRESHOLD)
    expect(offScopeRevokeOfferDue(db, HS)).toBe(true)
  })

  it('in-scope delivery is admitted and carries the grant reference [VII.10.3]', () => {
    insertActive(['availability'])
    const g = createGrant(db, {
      handshakeId: HS,
      grantType: 'delivery',
      direction: 'inbound',
      scopes: ['availability'],
      consentId: 'consent-g1',
    })
    expect(g.ok).toBe(true)
    if (!g.ok) return

    const r = admitInboundDelivery(db, {
      handshakeId: HS,
      kind: 'beap_message',
      source: 'relay_pull',
      scope: 'availability',
    })
    expect(r.admitted).toBe(true)
    if (r.admitted) expect(r.grantRef).toBe(g.grant.grant_id)

    // Every delivered item resolves its grant reference (read-time resolver
    // for rows without a stored ref).
    const resolved = resolveDeliveryGrantAt(db, HS, new Date().toISOString())
    expect(resolved?.grant_id).toBe(g.grant.grant_id)
  })

  it('legacy relationships are lazily backfilled from the flattened policy — never a fabricated consent', () => {
    insertActive(['availability', 'projects'])
    // No grant rows yet (pre-Phase-5 relationship).
    expect(listGrants(db, HS)).toEqual([])

    const r = admitInboundDelivery(db, { handshakeId: HS, kind: 'beap_message', source: 'email' })
    expect(r.admitted).toBe(true)

    const grants = listGrants(db, HS)
    expect(grants.length).toBe(1)
    expect(grants[0].backfilled).toBe(1)
    expect(grants[0].consent_id).toBeNull()
    expect(JSON.parse(grants[0].scopes_json)).toEqual(['availability', 'projects'])
  })

  it('a consented formation creates the initial delivery grant behind the consent event', () => {
    insertHandshakeRecord(db, buildActiveHandshakeRecord(), {
      profile_id: 'private_personal',
      profile_version: 1,
      ingress_path: 'beap_invitation',
      capture_method: 'assisted_email',
      source_reference: null,
      consent_id: 'consent-form-1',
      nonce: 'n-1',
    })
    const grants = listGrants(db, HS)
    expect(grants.length).toBe(1)
    expect(grants[0].grant_type).toBe('delivery')
    expect(grants[0].consent_id).toBe('consent-form-1')
    expect(grants[0].backfilled).toBe(0)

    // PoAC evidence: formation + grant creation on the contract chain.
    const kinds = listEvidenceRecords(db, HS).map((r) => ({
      type: r.record_type,
      kind: JSON.parse(r.payload_json).kind ?? JSON.parse(r.payload_json).note?.slice(0, 7),
    }))
    expect(kinds.some((k) => k.type === 'poac' && k.kind === 'formation')).toBe(true)
    expect(kinds.some((k) => k.type === 'poac' && k.kind === 'grant_created')).toBe(true)
  })

  it('the grant type system has no execute variant (structural)', () => {
    const src = readFileSync(join(__dirname, '..', 'grants.ts'), 'utf8')
    expect(src).toMatch(/GrantType = 'delivery' \| 'preparation'/)
    expect(src.includes("'execute'")).toBe(false)
    const bad = createGrant(db, {
      handshakeId: HS,
      grantType: 'execute' as any,
      scopes: [],
      consentId: 'c',
    })
    expect(bad.ok).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Acceptance 4 — limit-extension criticality [VII.10.8.3]
// ═════════════════════════════════════════════════════════════════════════════

describe('acceptance 4 — limit-extension criticality', () => {
  it('a grant carrying an ununderstood limit extension is refused, never accepted as unlimited', () => {
    insertActive()
    const r = createGrant(db, {
      handshakeId: HS,
      grantType: 'delivery',
      scopes: ['availability'],
      limitExtensions: [{ ns: 'optirando.grant.max_invocations', payload: { n: 3 } }],
      consentId: 'consent-x',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('ununderstood_limit_extension')
    expect(listGrants(db, HS)).toEqual([])
  })

  it('absence of limit extensions = unlimited-until-revoke ground state', () => {
    insertActive()
    const r = createGrant(db, {
      handshakeId: HS,
      grantType: 'delivery',
      scopes: ['availability'],
      consentId: 'consent-y',
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.grant.limit_extensions_json).toBeNull()
      expect(r.grant.revoked_at).toBeNull()
    }
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Acceptance 5 — Tier-L chain [IX.19.1]
// ═════════════════════════════════════════════════════════════════════════════

describe('acceptance 5 — Tier-L evidence chain', () => {
  function seedChain(n: number): void {
    for (let i = 0; i < n; i++) {
      appendEvidenceRecord(db, {
        chainId: HS,
        recordType: 'poac',
        payload: { kind: 'admission', i },
      })
    }
  }

  it('chain starts with an explicit genesis record referencing the cutover timestamp', () => {
    seedChain(1)
    const rows = listEvidenceRecords(db, HS)
    expect(rows[0].seq).toBe(0)
    expect(rows[0].record_type).toBe('genesis')
    const genesis = JSON.parse(rows[0].payload_json)
    expect(typeof genesis.cutover_at).toBe('string')
    expect(genesis.note).toContain('no continuity is claimed for pre-cutover records')
    expect(verifyEvidenceChain(db, HS)).toEqual({ valid: true, length: 2 })
  })

  it('per-contract sequence is strictly monotonic and contiguous', () => {
    seedChain(5)
    const rows = listEvidenceRecords(db, HS)
    expect(rows.map((r) => r.seq)).toEqual([0, 1, 2, 3, 4, 5])
    expect(verifyEvidenceChain(db, HS).valid).toBe(true)
  })

  it('the store is append-only: UPDATE and DELETE are aborted by trigger', () => {
    seedChain(2)
    expect(() =>
      db.prepare(`UPDATE wr_evidence_chain SET payload_json = '{}' WHERE chain_id = ? AND seq = 1`).run(HS),
    ).toThrow(/append-only/)
    expect(() =>
      db.prepare(`DELETE FROM wr_evidence_chain WHERE chain_id = ? AND seq = 1`).run(HS),
    ).toThrow(/append-only/)
  })

  // Note: verifyEvidenceChain re-ensures the schema (and thus the guard
  // triggers), so an attacker simulation must re-drop them before each
  // tampering step — exactly what raw file access would allow.
  const dropGuards = (): void => {
    db.exec(
      'DROP TRIGGER IF EXISTS trg_wr_evidence_no_update; DROP TRIGGER IF EXISTS trg_wr_evidence_no_delete;',
    )
  }

  it('removal, reorder, or insertion of a post-genesis record is detected', () => {
    seedChain(4)

    // Removal → sequence gap.
    dropGuards()
    db.prepare(`DELETE FROM wr_evidence_chain WHERE chain_id = ? AND seq = 2`).run(HS)
    let v = verifyEvidenceChain(db, HS)
    expect(v.valid).toBe(false)
    if (!v.valid) expect(v.reason).toBe('sequence_gap')

    // Insertion (re-adding a forged record in the gap) → hash mismatch.
    dropGuards()
    db.prepare(
      `INSERT INTO wr_evidence_chain (chain_id, seq, record_type, payload_json, prev_hash, record_hash, created_at)
       VALUES (?, 2, 'poac', '{"forged":true}', ?, ?, '2026-01-01T00:00:00Z')`,
    ).run(HS, 'f'.repeat(64), 'deadbeef'.repeat(8))
    v = verifyEvidenceChain(db, HS)
    expect(v.valid).toBe(false)
    if (!v.valid) expect(['prev_hash_mismatch', 'record_hash_mismatch']).toContain(v.reason)

    // Reorder (swap payloads of two records) → hash mismatch.
    dropGuards()
    db.prepare(`DELETE FROM wr_evidence_chain WHERE chain_id = ? AND seq = 2`).run(HS)
    const r3 = db.prepare(`SELECT * FROM wr_evidence_chain WHERE chain_id = ? AND seq = 3`).get(HS) as any
    const r4 = db.prepare(`SELECT * FROM wr_evidence_chain WHERE chain_id = ? AND seq = 4`).get(HS) as any
    dropGuards()
    db.prepare(`UPDATE wr_evidence_chain SET payload_json = ? WHERE chain_id = ? AND seq = 3`).run(r4.payload_json, HS)
    db.prepare(`UPDATE wr_evidence_chain SET payload_json = ? WHERE chain_id = ? AND seq = 4`).run(r3.payload_json, HS)
    v = verifyEvidenceChain(db, HS)
    expect(v.valid).toBe(false)
  })

  it('tampering with a record body is detected (record hash covers payload)', () => {
    seedChain(3)
    dropGuards()
    db.prepare(`UPDATE wr_evidence_chain SET payload_json = '{"kind":"admission","i":999}' WHERE chain_id = ? AND seq = 2`).run(HS)
    const v = verifyEvidenceChain(db, HS)
    expect(v.valid).toBe(false)
    if (!v.valid) expect(v.reason).toBe('record_hash_mismatch')
  })

  it('audit_log rows are read-only: UPDATE and DELETE are refused (forensic freeze)', () => {
    insertActive()
    db.prepare(
      `INSERT INTO audit_log (timestamp, action, handshake_id) VALUES (?, 'TEST_ROW', ?)`,
    ).run(new Date().toISOString(), HS)
    expect(() => db.prepare(`UPDATE audit_log SET action = 'TAMPERED' WHERE handshake_id = ?`).run(HS)).toThrow(
      /read-only/,
    )
    expect(() => db.prepare(`DELETE FROM audit_log WHERE handshake_id = ?`).run(HS)).toThrow(/read-only/)
  })

  it('pre-cutover audit_log rows are outside the chain and survive relationship deletion', async () => {
    insertActive()
    seedChain(2)
    await revokeHandshake(db, HS, 'local-user', 'local-user-001')
    const auditBefore = (db.prepare(`SELECT COUNT(*) AS n FROM audit_log`).get() as { n: number }).n
    expect(auditBefore).toBeGreaterThan(0)

    const del = deleteHandshakeRecord(db, HS)
    expect(del.success).toBe(true)

    // H1 hygiene: audit rows are NEVER deleted with the relationship.
    const auditAfter = (db.prepare(`SELECT COUNT(*) AS n FROM audit_log`).get() as { n: number }).n
    expect(auditAfter).toBe(auditBefore)
    // Evidence chain untouched by relationship deletion.
    expect(verifyEvidenceChain(db, HS).valid).toBe(true)
  })

  it('structural: retention has an explicit carve-out excluding the chain (H5)', async () => {
    const { RETENTION_TABLES, RETENTION_EXCLUDED_TABLES } = await import('../../retention/retentionJob')
    expect(RETENTION_EXCLUDED_TABLES).toContain('wr_evidence_chain')
    expect(RETENTION_EXCLUDED_TABLES).toContain('audit_log')
    expect(RETENTION_TABLES).not.toContain('wr_evidence_chain')
    const src = readFileSync(
      join(__dirname, '..', '..', 'retention', 'retentionJob.ts'),
      'utf8',
    )
    expect(src.includes('DELETE FROM wr_evidence_chain')).toBe(false)
    expect(src.includes('DELETE FROM audit_log')).toBe(false)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Acceptance 7 — revocation history (Q8)
// ═════════════════════════════════════════════════════════════════════════════

describe('acceptance 7 — revocation kills rights, evidence survives', () => {
  it('revoke → all grants dead via receiver filter; evidence + digests intact', async () => {
    insertActive(['availability'])
    const g = createGrant(db, {
      handshakeId: HS,
      grantType: 'delivery',
      scopes: ['availability'],
      consentId: 'consent-g1',
    })
    expect(g.ok).toBe(true)

    await revokeHandshake(db, HS, 'local-user', 'local-user-001')

    // Rights dead: no active grant remains.
    expect(resolveActiveDeliveryGrant(db, HS)).toBeNull()
    const grants = listGrants(db, HS)
    expect(grants.every((x) => x.revoked_at !== null)).toBe(true)

    // Receiver filter blocks (relationship_revoked precedes grant checks).
    const r = admitInboundDelivery(db, { handshakeId: HS, kind: 'beap_message', source: 'relay_pull' })
    expect(r.admitted).toBe(false)

    // Evidence: grant_created + grant_revoked PoAC records on an intact chain.
    const kinds = listEvidenceRecords(db, HS)
      .filter((x) => x.record_type === 'poac')
      .map((x) => JSON.parse(x.payload_json).kind)
    expect(kinds).toContain('grant_created')
    expect(kinds).toContain('grant_revoked')
    expect(verifyEvidenceChain(db, HS).valid).toBe(true)
  })

  it('separate content-deletion action exists and is PoAC-recorded', async () => {
    insertActive()
    db.prepare(
      `INSERT INTO context_blocks
         (sender_wrdesk_user_id, block_id, block_hash, relationship_id, handshake_id,
          type, data_classification, version, source, payload, created_at)
       VALUES ('sender-user-001', 'blk-1', 'hash-1', 'rel-001', ?, 'note', 'public', 1,
               'received', '{"t":"payload"}', '2025-01-01T00:00:00.000Z')`,
    ).run(HS)

    await revokeHandshake(db, HS, 'local-user', 'local-user-001')
    const r = deleteRevokedRelationshipContent(db, HS, 'local-user-001')
    expect(r.ok).toBe(true)

    const kinds = listEvidenceRecords(db, HS)
      .filter((x) => x.record_type === 'poac')
      .map((x) => JSON.parse(x.payload_json).kind)
    expect(kinds).toContain('revoked_content_deleted')
    expect(verifyEvidenceChain(db, HS).valid).toBe(true)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// Ledger repurposing (Q10) — structural
// ═════════════════════════════════════════════════════════════════════════════

describe('Q10 — ledger as Tier-L evidence home', () => {
  it('the evidence store is the only production writer on wr_evidence_chain', () => {
    for (const f of productionSources()) {
      if (/INSERT INTO wr_evidence_chain/.test(f.text)) {
        expect(f.rel).toBe('apps/electron-vite-project/electron/main/handshake/evidenceChain.ts')
      }
    }
  })

  it('BER record class is representable now; writers arrive in Phase 6', () => {
    const r = appendEvidenceRecord(db, {
      chainId: 'wr:local',
      recordType: 'ber',
      payload: {
        kind: 'boundary_crossing',
        governing_ref: 'esa-placeholder',
        governing_version: 1,
        direction: 'egress',
        capability: 'test',
        data_class_digests: [],
        counterparty: 'svc',
        channel: 'https',
        decision_ref: 'dec-1',
      },
    })
    expect(r.ok).toBe(true)
    expect(verifyEvidenceChain(db, 'wr:local').valid).toBe(true)
    // No production BER writer yet (Phase 6).
    for (const f of productionSources()) {
      if (/recordType:\s*'ber'/.test(f.text)) {
        expect(f.rel).toBe('apps/electron-vite-project/electron/main/handshake/evidenceChain.ts')
      }
    }
  })
})
