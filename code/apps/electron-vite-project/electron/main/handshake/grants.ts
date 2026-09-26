/**
 * Grant objects (Phase 5 — E2–E4, E9) [VII.10.x, VII.2.7]
 *
 * Distinct, receiver-enforced right objects replacing the flattened
 * `effective_policy` + one-bit `sharing_mode` as the enforcement authority:
 *
 *  - DELIVERY rights: scope-bound; enforced by the Phase-1 receiver-side
 *    ingress filter, which consumes grant scopes — off-scope transmissions
 *    are blocked pre-visibility and logged; repeated off-scope delivery
 *    surfaces a one-tap revoke offer [VII.10.2]. Every delivered item
 *    carries a reference to the grant it was delivered under [VII.10.3].
 *  - PREPARATION rights: representable as a type; standing action scopes
 *    (pinned template hashes, effect vocabulary) are NOT built here — the
 *    scope slot stays open [VII.10.1, VII.10.5].
 *
 * There is deliberately NO `execute` grant type. Execution is never a
 * standing right — every execution is a distinct human consent tap (V4, see
 * `execution/`).
 *
 * Lifecycle:
 *  - Created only behind an explicit consent screen (`consent_id` →
 *    Hash-Pinned consent record from the Phase-4 staging store).
 *  - Unlimited-until-revoke ground state (no implicit expiry).
 *  - Limit extensions (`single_use`, `ttl`) are parse-level CRITICAL:
 *    present-but-not-understood → grant refused, never accepted as
 *    unlimited [VII.10.8.3] (see ingestion-core `capabilityToken.ts`).
 *  - Revocation kills all rights of the counterparty via the receiver
 *    filter, silently.
 *
 * Legacy backfill (mirrors `legacy_v0` core discipline): pre-Phase-5
 * relationships get one synthetic delivery grant derived from their
 * flattened `sharing_mode` / `effective_policy.allowedScopes`, marked
 * `backfilled = 1` with no consent_id — never a fabricated consent record.
 *
 * Store: `wr_grants` on the relationship-DB handle (migration v76 on the
 * vault chain; `ensureGrantSchema` covers the frozen ledger handle, which
 * transitionally still runs the pipeline).
 */

import { randomUUID } from 'node:crypto'
import { UNDERSTOOD_LIMIT_EXTENSIONS } from '@repo/ingestion-core'
import { HandshakeState, type HandshakeRecord } from './types'
import { appendEvidenceBestEffort, poacGrantPayload } from './evidenceChain'

// ── Model ─────────────────────────────────────────────────────────────────────

/** No `execute` variant exists [VII.10.1]. */
export type GrantType = 'delivery' | 'preparation'

export interface GrantRow {
  grant_id: string
  handshake_id: string
  grant_type: GrantType
  direction: 'inbound' | 'outbound'
  scopes_json: string
  limit_extensions_json: string | null
  consent_id: string | null
  backfilled: number
  created_at: string
  revoked_at: string | null
  revoke_reason: string | null
}

/** Wildcard scope: the grant covers every scope (ground state for legacy). */
export const GRANT_SCOPE_ALL = '*'

// ── Schema (frozen-handle fallback) ──────────────────────────────────────────

export function ensureGrantSchema(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wr_grants (
      grant_id TEXT PRIMARY KEY,
      handshake_id TEXT NOT NULL,
      grant_type TEXT NOT NULL CHECK (grant_type IN ('delivery', 'preparation')),
      direction TEXT NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
      scopes_json TEXT NOT NULL,
      limit_extensions_json TEXT,
      consent_id TEXT,
      backfilled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      revoke_reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wr_grants_handshake ON wr_grants (handshake_id, grant_type, revoked_at);
    CREATE TABLE IF NOT EXISTS wr_grant_offscope_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      handshake_id TEXT NOT NULL,
      grant_id TEXT,
      scope TEXT,
      kind TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wr_grant_offscope_handshake ON wr_grant_offscope_events (handshake_id);
  `)
}

// ── Create / list / revoke ────────────────────────────────────────────────────

export type CreateGrantResult =
  | { ok: true; grant: GrantRow }
  | { ok: false; reason: 'ununderstood_limit_extension' | 'invalid_grant_type'; detail?: string }

/**
 * Create a grant behind an explicit consent event. Limit extensions are
 * parse-level critical: an ununderstood extension refuses the grant — it is
 * never accepted as unlimited [VII.10.8.3].
 */
export function createGrant(
  db: any,
  args: {
    handshakeId: string
    grantType: GrantType
    direction?: 'inbound' | 'outbound'
    scopes: readonly string[]
    limitExtensions?: ReadonlyArray<{ ns: string; payload?: unknown }>
    consentId: string | null
    actorWrdeskUserId?: string | null
    backfilled?: boolean
    now?: Date
  },
): CreateGrantResult {
  ensureGrantSchema(db)
  if (args.grantType !== 'delivery' && args.grantType !== 'preparation') {
    return { ok: false, reason: 'invalid_grant_type', detail: String(args.grantType) }
  }
  for (const ext of args.limitExtensions ?? []) {
    if (!UNDERSTOOD_LIMIT_EXTENSIONS.has(ext.ns)) {
      return { ok: false, reason: 'ununderstood_limit_extension', detail: ext.ns }
    }
  }

  const grant: GrantRow = {
    grant_id: randomUUID(),
    handshake_id: args.handshakeId,
    grant_type: args.grantType,
    direction: args.direction ?? 'inbound',
    scopes_json: JSON.stringify(args.scopes.length > 0 ? args.scopes : [GRANT_SCOPE_ALL]),
    limit_extensions_json:
      args.limitExtensions && args.limitExtensions.length > 0
        ? JSON.stringify(args.limitExtensions)
        : null,
    consent_id: args.consentId,
    backfilled: args.backfilled ? 1 : 0,
    created_at: (args.now ?? new Date()).toISOString(),
    revoked_at: null,
    revoke_reason: null,
  }
  db.prepare(
    `INSERT INTO wr_grants
       (grant_id, handshake_id, grant_type, direction, scopes_json, limit_extensions_json,
        consent_id, backfilled, created_at, revoked_at, revoke_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(
    grant.grant_id,
    grant.handshake_id,
    grant.grant_type,
    grant.direction,
    grant.scopes_json,
    grant.limit_extensions_json,
    grant.consent_id,
    grant.backfilled,
    grant.created_at,
  )

  // PoAC — grant creation is an authorized change [IX.19.1]. Backfilled
  // legacy grants are evidence too (their payload says so via consent_id null).
  appendEvidenceBestEffort({
    chainId: args.handshakeId,
    recordType: 'poac',
    payload: poacGrantPayload({
      event: 'grant_created',
      grant_id: grant.grant_id,
      handshake_id: grant.handshake_id,
      grant_type: grant.grant_type,
      scopes: JSON.parse(grant.scopes_json),
      consent_id: grant.consent_id,
      actor_wrdesk_user_id: args.actorWrdeskUserId ?? null,
    }),
  })

  return { ok: true, grant }
}

export function listGrants(db: any, handshakeId: string): GrantRow[] {
  ensureGrantSchema(db)
  return db
    .prepare(`SELECT * FROM wr_grants WHERE handshake_id = ? ORDER BY created_at ASC`)
    .all(handshakeId) as GrantRow[]
}

/**
 * Revocation kills ALL rights of the counterparty [VII.10.8]. Called from
 * `revokeHandshake`; silent (receiver-filter enforcement, no capsule).
 */
export function revokeGrantsForHandshake(
  db: any,
  handshakeId: string,
  reason: string,
  actorWrdeskUserId?: string | null,
  now: Date = new Date(),
): number {
  ensureGrantSchema(db)
  const active = db
    .prepare(`SELECT * FROM wr_grants WHERE handshake_id = ? AND revoked_at IS NULL`)
    .all(handshakeId) as GrantRow[]
  if (active.length === 0) return 0
  const ts = now.toISOString()
  const stmt = db.prepare(`UPDATE wr_grants SET revoked_at = ?, revoke_reason = ? WHERE grant_id = ?`)
  for (const g of active) {
    stmt.run(ts, reason, g.grant_id)
    appendEvidenceBestEffort({
      chainId: handshakeId,
      recordType: 'poac',
      payload: poacGrantPayload({
        event: 'grant_revoked',
        grant_id: g.grant_id,
        handshake_id: handshakeId,
        grant_type: g.grant_type,
        scopes: JSON.parse(g.scopes_json),
        consent_id: g.consent_id,
        actor_wrdesk_user_id: actorWrdeskUserId ?? null,
      }),
    })
  }
  return active.length
}

// ── Resolution (receiver-filter consumption) ─────────────────────────────────

/**
 * Legacy backfill: a pre-Phase-5 relationship without any grant row gets one
 * synthetic inbound delivery grant derived from its flattened policy —
 * scopes from `effective_policy.allowedScopes` (or the wildcard ground
 * state), `backfilled = 1`, no consent_id (never fabricated).
 */
export function ensureLegacyDeliveryGrant(db: any, record: HandshakeRecord): GrantRow | null {
  ensureGrantSchema(db)
  const existing = db
    .prepare(
      `SELECT * FROM wr_grants WHERE handshake_id = ? AND grant_type = 'delivery' AND direction = 'inbound'
       ORDER BY created_at ASC LIMIT 1`,
    )
    .get(record.handshake_id) as GrantRow | undefined
  if (existing) return existing
  // Only live relationships are backfilled — a revoked one gets no rights.
  if (record.state === HandshakeState.REVOKED || record.state === HandshakeState.EXPIRED) {
    return null
  }
  const scopes =
    Array.isArray(record.effective_policy?.allowedScopes) &&
    record.effective_policy.allowedScopes.length > 0
      ? record.effective_policy.allowedScopes
      : [GRANT_SCOPE_ALL]
  const r = createGrant(db, {
    handshakeId: record.handshake_id,
    grantType: 'delivery',
    direction: 'inbound',
    scopes,
    consentId: null,
    backfilled: true,
  })
  return r.ok ? r.grant : null
}

/** Active (non-revoked) inbound delivery grant for a relationship, if any. */
export function resolveActiveDeliveryGrant(db: any, handshakeId: string): GrantRow | null {
  ensureGrantSchema(db)
  const row = db
    .prepare(
      `SELECT * FROM wr_grants
       WHERE handshake_id = ? AND grant_type = 'delivery' AND direction = 'inbound' AND revoked_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(handshakeId) as GrantRow | undefined
  return row ?? null
}

/**
 * Resolve the grant a delivered item was admitted under [VII.10.3]: the
 * inbound delivery grant active at the item's ingestion time. Deterministic
 * for admitted items (grants are unlimited-until-revoke, per relationship).
 * Used to render provenance for rows that predate the stored `grant_ref`.
 */
export function resolveDeliveryGrantAt(db: any, handshakeId: string, atIso: string): GrantRow | null {
  ensureGrantSchema(db)
  const row = db
    .prepare(
      `SELECT * FROM wr_grants
       WHERE handshake_id = ? AND grant_type = 'delivery' AND direction = 'inbound'
         AND created_at <= ?
         AND (revoked_at IS NULL OR revoked_at > ?)
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get(handshakeId, atIso, atIso) as GrantRow | undefined
  return row ?? null
}

export function grantScopeAllows(grant: GrantRow, scope: string): boolean {
  let scopes: string[]
  try {
    scopes = JSON.parse(grant.scopes_json)
  } catch {
    return false
  }
  return scopes.includes(GRANT_SCOPE_ALL) || scopes.includes(scope)
}

// ── Off-scope tracking → one-tap revoke offer [VII.10.2] ─────────────────────

/** Repetition threshold after which the one-tap revoke offer is surfaced. */
export const OFFSCOPE_REVOKE_OFFER_THRESHOLD = 3

export function recordOffScopeEvent(
  db: any,
  args: { handshakeId: string; grantId: string | null; scope: string | null; kind: string; source: string },
  now: Date = new Date(),
): void {
  ensureGrantSchema(db)
  db.prepare(
    `INSERT INTO wr_grant_offscope_events (handshake_id, grant_id, scope, kind, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(args.handshakeId, args.grantId, args.scope, args.kind, args.source, now.toISOString())
}

export function countOffScopeEvents(db: any, handshakeId: string): number {
  ensureGrantSchema(db)
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM wr_grant_offscope_events WHERE handshake_id = ?`)
    .get(handshakeId) as { n: number }
  return row.n
}

/**
 * True once repeated off-scope delivery should surface the one-tap revoke
 * offer [VII.10.2]. Read by the UI/IPC layer; the offer itself is a render
 * concern — no auto-revoke happens here.
 */
export function offScopeRevokeOfferDue(db: any, handshakeId: string): boolean {
  return countOffScopeEvents(db, handshakeId) >= OFFSCOPE_REVOKE_OFFER_THRESHOLD
}
