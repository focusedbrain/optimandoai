/**
 * WR Handshake core store + runtime split (Phase 3 — G1–G3) [XI.LB§6 seam]
 *
 * Two new tables via the existing migration runner (v75, NEVER applied to a
 * frozen ledger handle — see LEDGER_SCHEMA_FREEZE_VERSION in db.ts):
 *
 *  - `wr_handshake_core`   — APPEND-ONLY, immutable, hash-stable. One row per
 *    relationship: the frozen signed core (canonical JSON + detached
 *    signature list). SQLite triggers abort every UPDATE/DELETE, so
 *    immutability is enforced by the store itself, not by writer discipline.
 *  - `wr_handshake_runtime` — mutable operational state (seq counters,
 *    tokens, endpoints, policy resolution, repair flags), keyed by
 *    handshake and referencing the core row by hash.
 *
 * Transition window (documented rollback plan in phase-3 report):
 *  - The legacy `handshakes` table REMAINS THE READ AUTHORITY. Existing
 *    dialects keep writing it; a thin adapter (called from the single
 *    insert/update writers in db.ts) dual-writes the core + runtime rows
 *    whenever this store exists on the handle. Eliminating the dialects and
 *    flipping the read authority is Phase 4+.
 *  - Rollback = stop consulting the new tables; `handshakes` never stopped
 *    being complete. The core store is additive and append-only, so rolling
 *    back loses nothing and corrupts nothing.
 *
 * Backfill (G2): one synthetic core record per existing row, marked
 * `legacy_v0` (Q2), `ingress_path = null`, capture provenance
 * `unknown_legacy` — NEVER fabricated signatures, countersignatures, or
 * provenance (the signature list is empty; `backfilled = 1`).
 *
 * Anti-rollback (Phase 2 → Phase 3 consumer): every core insert passes the
 * generic high-water gate under object class 'wr.handshake.core'.
 */

import { createHash } from 'node:crypto'
import { canonicalJsonString, canonicalJsonBytes } from '@repo/ingestion-core'
import type { CanonicalJsonValue, CorePartyId, CoreSignature, WrHandshakeCore } from '@repo/ingestion-core'
import { enforceHighWater } from './antiRollback'
import type { HandshakeRecord, PartyIdentity } from './types'

export const WR_CORE_OBJECT_CLASS = 'wr.handshake.core'

/** Non-critical declaration namespace marking a backfilled legacy core. */
export const LEGACY_BACKFILL_NS = 'optirando.decl.legacy_backfill'

// ── Store presence ────────────────────────────────────────────────────────────

/** True when the core store exists on this handle (post-v75, non-frozen). */
export function hasWrCoreStore(db: any): boolean {
  try {
    const row = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'wr_handshake_core'")
      .get()
    return !!row
  } catch {
    return false
  }
}

// ── Hash-stable identity ──────────────────────────────────────────────────────

/** sha256(canonical bytes) — the store key; stable across restarts/migrations. */
export function computeCoreStoreHash(core: WrHandshakeCore): string {
  return createHash('sha256')
    .update(canonicalJsonBytes(core as unknown as CanonicalJsonValue))
    .digest('hex')
}

// ── Synthetic legacy core (backfill + transition adapter) ─────────────────────

function partyToCoreId(party: PartyIdentity | null | undefined): CorePartyId | null {
  if (!party) return null
  return {
    sub: party.sub ?? '',
    iss: party.iss ?? '',
    email: party.email ?? '',
    wrdesk_user_id: party.wrdesk_user_id ?? '',
  }
}

/**
 * Build the synthetic `legacy_v0` core for an existing relationship row.
 * Deterministic over the row's IMMUTABLE identity fields only (parties,
 * relationship id, creation instant) so the hash is stable across re-runs;
 * mutable state lives in the runtime row. `nonce` is empty — a legacy row
 * has no recorded formation nonce and none is fabricated.
 */
export function buildSyntheticLegacyCore(record: HandshakeRecord): WrHandshakeCore {
  return {
    profile: { id: 'legacy_v0', version: 1 },
    initiator_id: partyToCoreId(record.initiator),
    responder_id: partyToCoreId(record.acceptor),
    ingress_path: null,
    declarations: [
      {
        ns: LEGACY_BACKFILL_NS,
        version: 1,
        critical: false,
        payload: {
          handshake_id: record.handshake_id,
          relationship_id: record.relationship_id,
          created_at: record.created_at,
        },
      },
    ],
    extensions: [],
    created_at: record.created_at,
    nonce: '',
  } as unknown as WrHandshakeCore
}

// ── Formation core (Phase 4 — the one pipeline) ──────────────────────────────

/** Declaration namespace carrying capture provenance [IX.3.1 rule 5]. */
export const CAPTURE_PROVENANCE_NS = 'optirando.decl.capture_provenance'

/**
 * Formation metadata recorded by the ONE pipeline on NEW formations only.
 * Backfilled rows keep `unknown_legacy` provenance and a null ingress path —
 * provenance is never fabricated.
 */
export interface FormationMeta {
  profile_id: string
  profile_version: number
  /** Recordable ingress registry identifier (Q4 mapping; log-only downstream). */
  ingress_path: string
  capture_method: string
  source_reference?: string | null
  /** Hash-pinned consent record id [IX.3.4]. */
  consent_id?: string | null
  nonce?: string
}

/**
 * Build the REAL core for a new formation: profile from the registry,
 * ingress_path recorded (log-only), capture provenance as a signed contract
 * declaration rendered in the consent preview and recorded in evidence.
 */
export function buildFormationCore(record: HandshakeRecord, formation: FormationMeta): WrHandshakeCore {
  return {
    profile: { id: formation.profile_id, version: formation.profile_version },
    initiator_id: partyToCoreId(record.initiator),
    responder_id: partyToCoreId(record.acceptor),
    ingress_path: formation.ingress_path,
    declarations: [
      {
        ns: CAPTURE_PROVENANCE_NS,
        version: 1,
        critical: false,
        payload: {
          method: formation.capture_method,
          source_reference: formation.source_reference ?? null,
          handshake_id: record.handshake_id,
          relationship_id: record.relationship_id,
          created_at: record.created_at,
          ...(formation.consent_id ? { consent_id: formation.consent_id } : {}),
        },
      },
    ],
    extensions: [],
    created_at: record.created_at,
    nonce: formation.nonce ?? '',
  } as unknown as WrHandshakeCore
}

// ── Writers (single entry, called from db.ts) ────────────────────────────────

export interface InsertCoreArgs {
  core: WrHandshakeCore
  handshakeId: string
  signatures: CoreSignature[]
  captureProvenance: string
  backfilled: boolean
  /** Monotonic core version for the anti-rollback gate; 1 until supersession exists. */
  coreVersion?: number
}

export type InsertCoreResult =
  | { ok: true; coreHash: string; inserted: boolean }
  | { ok: false; reason: 'rollback'; highWater: number }

/**
 * Append a core record. Idempotent per handshake: if a core row already
 * exists for the handshake it is NEVER touched (append-only; re-insertion of
 * the identical core is a no-op, a differing core for the same handshake is
 * refused — cores are immutable, "convert" means a new handshake [VII.3.3]).
 */
export function insertCoreRecord(db: any, args: InsertCoreArgs): InsertCoreResult {
  const coreVersion = args.coreVersion ?? 1
  const gate = enforceHighWater(db, WR_CORE_OBJECT_CLASS, args.handshakeId, coreVersion)
  if (!gate.ok) return { ok: false, reason: 'rollback', highWater: gate.highWater }

  const existing = db
    .prepare('SELECT core_hash FROM wr_handshake_core WHERE handshake_id = ?')
    .get(args.handshakeId) as { core_hash: string } | undefined
  const coreHash = computeCoreStoreHash(args.core)
  if (existing) {
    if (existing.core_hash !== coreHash) {
      console.warn('[WR-CORE] Refusing differing core for existing handshake (immutable):', {
        handshake_id: args.handshakeId,
      })
    }
    return { ok: true, coreHash: existing.core_hash, inserted: false }
  }

  db.prepare(
    `INSERT INTO wr_handshake_core (
       core_hash, handshake_id, profile_id, profile_version, core_version,
       core_json, signatures_json, capture_provenance, backfilled, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    coreHash,
    args.handshakeId,
    args.core.profile.id,
    args.core.profile.version,
    coreVersion,
    canonicalJsonString(args.core as unknown as CanonicalJsonValue),
    JSON.stringify(args.signatures),
    args.captureProvenance,
    args.backfilled ? 1 : 0,
    args.core.created_at,
  )
  return { ok: true, coreHash, inserted: true }
}

/** Mirror the mutable runtime slice of a relationship row (upsert). */
export function upsertRuntimeFromRecord(db: any, record: HandshakeRecord, coreHash: string): void {
  db.prepare(
    `INSERT INTO wr_handshake_runtime (
       handshake_id, core_hash, state, sharing_mode,
       last_seq_sent, last_seq_received, last_capsule_hash_sent, last_capsule_hash_received,
       p2p_endpoint, local_p2p_auth_token, counterparty_p2p_token,
       effective_policy_json, repair_flags_json, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(handshake_id) DO UPDATE SET
       state = excluded.state,
       sharing_mode = excluded.sharing_mode,
       last_seq_sent = excluded.last_seq_sent,
       last_seq_received = excluded.last_seq_received,
       last_capsule_hash_sent = excluded.last_capsule_hash_sent,
       last_capsule_hash_received = excluded.last_capsule_hash_received,
       p2p_endpoint = excluded.p2p_endpoint,
       local_p2p_auth_token = excluded.local_p2p_auth_token,
       counterparty_p2p_token = excluded.counterparty_p2p_token,
       effective_policy_json = excluded.effective_policy_json,
       repair_flags_json = excluded.repair_flags_json,
       updated_at = excluded.updated_at`,
  ).run(
    record.handshake_id,
    coreHash,
    record.state,
    record.sharing_mode ?? null,
    record.last_seq_sent ?? 0,
    record.last_seq_received ?? 0,
    record.last_capsule_hash_sent ?? null,
    record.last_capsule_hash_received ?? null,
    record.p2p_endpoint ?? null,
    record.local_p2p_auth_token ?? null,
    record.counterparty_p2p_token ?? null,
    record.effective_policy ? JSON.stringify(record.effective_policy) : null,
    (record as any).internal_coordination_repair_needed !== undefined
      ? JSON.stringify({ internal_coordination_repair_needed: (record as any).internal_coordination_repair_needed })
      : null,
    new Date().toISOString(),
  )
}

/**
 * Transition adapter — the ONE hook the legacy writers call. Produces the
 * core (if absent) + mirrors runtime state. No-op on handles without the
 * store (frozen ledger, pre-v75, mock DBs).
 */
export function adaptRecordToCoreStore(
  db: any,
  record: HandshakeRecord,
  opts?: { backfilled?: boolean; formation?: FormationMeta },
): void {
  if (!hasWrCoreStore(db)) return
  try {
    // New formations through the one pipeline carry real formation metadata;
    // everything else (updates, legacy writers) produces/keeps the synthetic
    // legacy core with unfabricated provenance.
    const formation = opts?.formation
    const core = formation ? buildFormationCore(record, formation) : buildSyntheticLegacyCore(record)
    const result = insertCoreRecord(db, {
      core,
      handshakeId: record.handshake_id,
      signatures: [],
      captureProvenance: formation
        ? JSON.stringify({
            method: formation.capture_method,
            source_reference: formation.source_reference ?? null,
            ingress_path: formation.ingress_path,
          })
        : 'unknown_legacy',
      backfilled: opts?.backfilled ?? false,
      coreVersion: 1,
    })
    if (result.ok) upsertRuntimeFromRecord(db, record, result.coreHash)
  } catch (e: any) {
    // The legacy store remains the read authority during the transition —
    // a core-store failure must not fail the relationship write.
    console.warn('[WR-CORE] adapter write failed (legacy store unaffected):', e?.message)
  }
}

/** Delete the runtime mirror (operator delete of a relationship). Core rows survive. */
export function deleteRuntimeRow(db: any, handshakeId: string): void {
  if (!hasWrCoreStore(db)) return
  try {
    db.prepare('DELETE FROM wr_handshake_runtime WHERE handshake_id = ?').run(handshakeId)
  } catch { /* runtime mirror only */ }
}

// ── Readers ───────────────────────────────────────────────────────────────────

export interface WrCoreRow {
  core_hash: string
  handshake_id: string
  profile_id: string
  profile_version: number
  core_version: number
  core_json: string
  signatures_json: string
  capture_provenance: string
  backfilled: number
  created_at: string
}

export function getCoreRow(db: any, handshakeId: string): WrCoreRow | null {
  try {
    return (
      (db.prepare('SELECT * FROM wr_handshake_core WHERE handshake_id = ?').get(handshakeId) as WrCoreRow | undefined) ??
      null
    )
  } catch {
    return null
  }
}

export function getRuntimeRow(db: any, handshakeId: string): Record<string, unknown> | null {
  try {
    return (
      (db.prepare('SELECT * FROM wr_handshake_runtime WHERE handshake_id = ?').get(handshakeId) as
        | Record<string, unknown>
        | undefined) ?? null
    )
  } catch {
    return null
  }
}

/** Recompute a stored core row's hash from its canonical JSON (integrity check). */
export function verifyCoreRowHash(row: WrCoreRow): boolean {
  try {
    const core = JSON.parse(row.core_json) as WrHandshakeCore
    return computeCoreStoreHash(core) === row.core_hash
  } catch {
    return false
  }
}

// ── Backfill (G2) ─────────────────────────────────────────────────────────────

export interface BackfillSummary {
  scanned: number
  backfilled: number
  alreadyPresent: number
  failed: number
}

/**
 * One synthetic `legacy_v0` core + runtime row per existing relationship row
 * that has none. Idempotent — re-runs skip existing cores. Runs inside one
 * transaction (single-writer discipline; WAL checkpoint is the migration
 * runner's job).
 */
export function backfillWrCoreStore(
  db: any,
  listRecords: (db: any) => HandshakeRecord[],
): BackfillSummary {
  const summary: BackfillSummary = { scanned: 0, backfilled: 0, alreadyPresent: 0, failed: 0 }
  if (!hasWrCoreStore(db)) return summary
  const tx = db.transaction(() => {
    for (const record of listRecords(db)) {
      summary.scanned++
      try {
        if (getCoreRow(db, record.handshake_id)) {
          summary.alreadyPresent++
          continue
        }
        const core = buildSyntheticLegacyCore(record)
        const result = insertCoreRecord(db, {
          core,
          handshakeId: record.handshake_id,
          signatures: [],
          captureProvenance: 'unknown_legacy',
          backfilled: true,
          coreVersion: 1,
        })
        if (result.ok) {
          upsertRuntimeFromRecord(db, record, result.coreHash)
          summary.backfilled++
        } else {
          summary.failed++
        }
      } catch (e: any) {
        summary.failed++
        console.warn('[WR-CORE] backfill failed for row:', record.handshake_id, e?.message)
      }
    }
  })
  tx()
  return summary
}
