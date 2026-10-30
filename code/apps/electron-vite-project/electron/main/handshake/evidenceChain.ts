/**
 * Append-only hash-chained evidence store (Phase 5 — H1–H4) [IX.19.1, X.10.1]
 *
 * A NEW parallel store — never a retrofit of `audit_log` (which is deletable
 * and incomplete). Tier L in the Annex IX sense: removal, reorder, or
 * insertion of a post-genesis record is detectable.
 *
 * Record classes:
 *  - PoAC  — Proof of Authorized Change: formation, grant creation /
 *            modification / revocation, admissions, content deletion.
 *  - PoAE  — Proof of Authorized Execution: executions, with Intent Hash and
 *            consent reference [IX.19.2].
 *  - BER   — Boundary Event Records: SCHEMA lands here; writers arrive in
 *            Phase 6 [X.10].
 *
 * Chain discipline:
 *  - One chain per contract (`chain_id` = handshake_id; `wr:local` for
 *    non-contract-scoped events).
 *  - Monotonic per-chain sequence, starting with an explicit GENESIS record
 *    (seq 0) that references the cutover timestamp. Continuity is NEVER
 *    claimed for pre-cutover rows [X.0.1] — the old `audit_log` stays outside
 *    the chain, read-only for forensics.
 *  - Every record's hash covers domainTag('wr.evidence.record', 1) + the
 *    canonical form of {chain_id, seq, record_type, payload, prev_hash,
 *    created_at}; `prev_hash` is the previous record's hash.
 *
 * Home (Q10): the frozen-and-swept `handshake-ledger.db` is the Tier-L chain
 * home. The tables here are LEDGER-NATIVE schema (applied by `ledger.ts`),
 * not part of the frozen handshake migration chain. Tests inject an
 * in-memory DB via `setEvidenceDbProvider`.
 */

import { createHash } from 'node:crypto'
import { canonicalJsonString, domainTag, type CanonicalJsonValue } from '@repo/ingestion-core'

// ── Schema ────────────────────────────────────────────────────────────────────

export const EVIDENCE_RECORD_TYPES = Object.freeze(['genesis', 'poac', 'poae', 'ber'] as const)
export type EvidenceRecordType = (typeof EVIDENCE_RECORD_TYPES)[number]

/** Chain id for local events not scoped to a single contract. */
export const LOCAL_EVIDENCE_CHAIN = 'wr:local'

export const EVIDENCE_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS wr_evidence_chain (
      chain_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      record_type TEXT NOT NULL CHECK (record_type IN ('genesis', 'poac', 'poae', 'ber')),
      payload_json TEXT NOT NULL,
      prev_hash TEXT NOT NULL,
      record_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (chain_id, seq)
    );
    CREATE TRIGGER IF NOT EXISTS trg_wr_evidence_no_update
      BEFORE UPDATE ON wr_evidence_chain
      BEGIN
        SELECT RAISE(ABORT, 'wr_evidence_chain is append-only');
      END;
    CREATE TRIGGER IF NOT EXISTS trg_wr_evidence_no_delete
      BEFORE DELETE ON wr_evidence_chain
      BEGIN
        SELECT RAISE(ABORT, 'wr_evidence_chain is append-only');
      END;
`

export function ensureEvidenceSchema(db: any): void {
  db.exec(EVIDENCE_SCHEMA_SQL)
}

// ── DB handle (Q10: the ledger is the Tier-L home) ───────────────────────────

let _evidenceDbProvider: (() => any) | null = null

export function setEvidenceDbProvider(provider: (() => any) | null): void {
  _evidenceDbProvider = provider
}

function getEvidenceDb(): any | null {
  if (_evidenceDbProvider) {
    const db = _evidenceDbProvider()
    ensureEvidenceSchema(db)
    return db
  }
  try {
    // Lazy import avoids a module cycle (ledger.ts imports db.ts helpers).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getLedgerDb } = require('./ledger')
    const db = getLedgerDb()
    if (!db) return null
    ensureEvidenceSchema(db)
    return db
  } catch {
    return null
  }
}

// ── Hashing ───────────────────────────────────────────────────────────────────

export const GENESIS_PREV_HASH = '0'.repeat(64)

function recordHash(args: {
  chain_id: string
  seq: number
  record_type: EvidenceRecordType
  payload_json: string
  prev_hash: string
  created_at: string
}): string {
  const canonical = canonicalJsonString({
    chain_id: args.chain_id,
    seq: args.seq,
    record_type: args.record_type,
    payload_json: args.payload_json,
    prev_hash: args.prev_hash,
    created_at: args.created_at,
  })
  const h = createHash('sha256')
  h.update(domainTag('wr.evidence.record', 1))
  h.update(Buffer.from(canonical, 'utf8'))
  return h.digest('hex')
}

// ── Append ────────────────────────────────────────────────────────────────────

export interface EvidenceRecordRow {
  chain_id: string
  seq: number
  record_type: EvidenceRecordType
  payload_json: string
  prev_hash: string
  record_hash: string
  created_at: string
}

export interface AppendEvidenceResult {
  ok: true
  seq: number
  record_hash: string
}

/**
 * Append one record to a chain, creating the explicit genesis record first if
 * the chain does not exist yet. The genesis payload references the cutover
 * timestamp — pre-cutover `audit_log` rows are outside the chain [X.0.1].
 */
export function appendEvidenceRecord(
  db: any,
  args: {
    chainId: string
    recordType: Exclude<EvidenceRecordType, 'genesis'>
    payload: CanonicalJsonValue
    now?: Date
  },
): AppendEvidenceResult {
  ensureEvidenceSchema(db)
  const now = (args.now ?? new Date()).toISOString()

  let result: AppendEvidenceResult | null = null
  const tx = db.transaction(() => {
    const tip = db
      .prepare(
        `SELECT seq, record_hash FROM wr_evidence_chain WHERE chain_id = ? ORDER BY seq DESC LIMIT 1`,
      )
      .get(args.chainId) as { seq: number; record_hash: string } | undefined

    let prevSeq: number
    let prevHash: string
    if (!tip) {
      // Explicit genesis referencing the cutover timestamp.
      const genesisPayload = canonicalJsonString({
        note: 'wr evidence chain genesis — no continuity is claimed for pre-cutover records',
        cutover_at: now,
      })
      const gHash = recordHash({
        chain_id: args.chainId,
        seq: 0,
        record_type: 'genesis',
        payload_json: genesisPayload,
        prev_hash: GENESIS_PREV_HASH,
        created_at: now,
      })
      db.prepare(
        `INSERT INTO wr_evidence_chain
           (chain_id, seq, record_type, payload_json, prev_hash, record_hash, created_at)
         VALUES (?, 0, 'genesis', ?, ?, ?, ?)`,
      ).run(args.chainId, genesisPayload, GENESIS_PREV_HASH, gHash, now)
      prevSeq = 0
      prevHash = gHash
    } else {
      prevSeq = tip.seq
      prevHash = tip.record_hash
    }

    const seq = prevSeq + 1
    const payloadJson = canonicalJsonString(args.payload)
    const hash = recordHash({
      chain_id: args.chainId,
      seq,
      record_type: args.recordType,
      payload_json: payloadJson,
      prev_hash: prevHash,
      created_at: now,
    })
    db.prepare(
      `INSERT INTO wr_evidence_chain
         (chain_id, seq, record_type, payload_json, prev_hash, record_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(args.chainId, seq, args.recordType, payloadJson, prevHash, hash, now)
    result = { ok: true, seq, record_hash: hash }
  })
  tx()
  return result!
}

/**
 * Best-effort production append: resolves the ledger handle (or the injected
 * provider). Evidence failure must never break the underlying operation —
 * metadata-only warn, no payload in logs.
 */
export function appendEvidenceBestEffort(args: {
  chainId: string
  recordType: Exclude<EvidenceRecordType, 'genesis'>
  payload: CanonicalJsonValue
}): AppendEvidenceResult | null {
  try {
    const db = getEvidenceDb()
    if (!db) return null
    return appendEvidenceRecord(db, args)
  } catch (e) {
    console.warn(
      `[EVIDENCE] append failed chain=${args.chainId} type=${args.recordType}: ${(e as Error)?.message}`,
    )
    return null
  }
}

// ── Read / verify ─────────────────────────────────────────────────────────────

export function listEvidenceRecords(db: any, chainId: string): EvidenceRecordRow[] {
  ensureEvidenceSchema(db)
  return db
    .prepare(`SELECT * FROM wr_evidence_chain WHERE chain_id = ? ORDER BY seq ASC`)
    .all(chainId) as EvidenceRecordRow[]
}

export type ChainVerdict =
  | { valid: true; length: number }
  | {
      valid: false
      reason:
        | 'missing_genesis'
        | 'sequence_gap'
        | 'sequence_duplicate'
        | 'prev_hash_mismatch'
        | 'record_hash_mismatch'
      at_seq: number
    }

/**
 * Verify a chain end-to-end: genesis at seq 0, strictly contiguous monotonic
 * sequence, every prev-hash link intact, every record hash recomputable.
 * Removal, reorder, and insertion of post-genesis records are all detected.
 */
export function verifyEvidenceChain(db: any, chainId: string): ChainVerdict {
  const rows = listEvidenceRecords(db, chainId)
  if (rows.length === 0 || rows[0].seq !== 0 || rows[0].record_type !== 'genesis') {
    return { valid: false, reason: 'missing_genesis', at_seq: rows.length > 0 ? rows[0].seq : 0 }
  }
  let prevHash = GENESIS_PREV_HASH
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.seq !== i) {
      return { valid: false, reason: row.seq < i ? 'sequence_duplicate' : 'sequence_gap', at_seq: row.seq }
    }
    if (row.prev_hash !== prevHash) {
      return { valid: false, reason: 'prev_hash_mismatch', at_seq: row.seq }
    }
    const expected = recordHash({
      chain_id: row.chain_id,
      seq: row.seq,
      record_type: row.record_type,
      payload_json: row.payload_json,
      prev_hash: row.prev_hash,
      created_at: row.created_at,
    })
    if (expected !== row.record_hash) {
      return { valid: false, reason: 'record_hash_mismatch', at_seq: row.seq }
    }
    prevHash = row.record_hash
  }
  return { valid: true, length: rows.length }
}

// ── Payload builders (typed record classes) ──────────────────────────────────

/** PoAC — formation of a relationship (written by the one pipeline). */
export function poacFormationPayload(args: {
  handshake_id: string
  profile_id: string
  consent_id: string
  capture_method: string
  ingress_path: string
}): CanonicalJsonValue {
  return { kind: 'formation', ...args }
}

/** PoAC — grant lifecycle (creation / modification / revocation). */
export function poacGrantPayload(args: {
  event: 'grant_created' | 'grant_modified' | 'grant_revoked'
  grant_id: string
  handshake_id: string
  grant_type: string
  scopes: string[]
  consent_id?: string | null
  actor_wrdesk_user_id?: string | null
}): CanonicalJsonValue {
  return {
    kind: args.event,
    grant_id: args.grant_id,
    handshake_id: args.handshake_id,
    grant_type: args.grant_type,
    scopes: args.scopes,
    consent_id: args.consent_id ?? null,
    actor_wrdesk_user_id: args.actor_wrdesk_user_id ?? null,
  }
}

/** PoAC — blocked/admitted ingress decisions worth evidencing. */
export function poacAdmissionPayload(args: {
  handshake_id: string
  decision: 'blocked'
  reason: string
  kind: string
  source: string
}): CanonicalJsonValue {
  return {
    kind: 'admission',
    handshake_id: args.handshake_id,
    decision: args.decision,
    reason: args.reason,
    delivery_kind: args.kind,
    source: args.source,
  }
}

/** PoAC — explicit operator content deletion of a revoked relationship (Q8). */
export function poacContentDeletionPayload(args: {
  handshake_id: string
  blocks_deleted: number
  embeddings_deleted: number
  actor_wrdesk_user_id?: string | null
}): CanonicalJsonValue {
  return {
    kind: 'revoked_content_deleted',
    handshake_id: args.handshake_id,
    blocks_deleted: args.blocks_deleted,
    embeddings_deleted: args.embeddings_deleted,
    actor_wrdesk_user_id: args.actor_wrdesk_user_id ?? null,
  }
}

/**
 * PoAE — execution record with Intent Hash + consent reference [IX.19.2].
 * Never contains prompt/parameter content — digests only.
 */
export function poaeExecutionPayload(args: {
  handshake_id: string
  request_id: string
  tool_name: string
  intent_hash: string
  consent_id: string
  outcome: 'success' | 'failure' | 'refused_deviation'
  params_digest: string
}): CanonicalJsonValue {
  return { kind: 'execution', ...args }
}

/**
 * BER — Boundary Event Record SCHEMA (writers arrive in Phase 6) [X.10.2].
 * Where the crossing is a consequential effect, BER and execution receipt are
 * ONE record, not two.
 */
export function berCrossingPayload(args: {
  governing_ref: string
  governing_version: number
  direction: 'ingress' | 'egress'
  capability: string
  data_class_digests: string[]
  counterparty: string
  channel: string
  decision_ref: string
}): CanonicalJsonValue {
  return { kind: 'boundary_crossing', ...args }
}
