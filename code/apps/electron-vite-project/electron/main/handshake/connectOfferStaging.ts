/**
 * Connect-offer staging store (Phase 4 — V2, Q1) [IX.3.1]
 *
 * Inbound invitations (email / relay / WS initiate capsules, .beap file
 * imports) NO LONGER create relationship rows. They land here — a staging
 * store that is deliberately NOT the relationship store — until:
 *
 *   verification chain → client-generated Connect offer → consent
 *   → only then does the ONE formation pipeline create a core record.
 *
 * Rules [IX.3.1 rules 1–4]:
 *  - Failed verification SUPPRESSES the offer entirely: the row is kept as a
 *    logged record but is never listable and can never be consented to.
 *    There is no "connect anyway".
 *  - The Connect-offer preview is CLIENT-GENERATED from verified capsule
 *    material — never counterparty free text — and canonically hashable at
 *    presentation time (Intent-Hash substrate for Phase 5).
 *  - Staged offers keep the 7-day timeout (Q7).
 *
 * Consent records are Hash-Pinned [IX.3.4]: preview hash + bound-definition
 * hash + contract-state hash. A consent record whose hashes do not resolve
 * against the staged material is invalid.
 *
 * Persistence: this store lives in its OWN SQLite file (connect-offers.db),
 * outside the handshake migration chain. The handshake ledger is frozen at
 * v74 (Phase 3) and the staging store must exist regardless of which
 * relationship DB handle is active, so it never shares either handle.
 */

import { createHash, randomUUID } from 'node:crypto'
import { canonicalJsonString, domainTag, type CanonicalJsonValue } from '@repo/ingestion-core'
import { INPUT_LIMITS } from './types'

// ── Schema ────────────────────────────────────────────────────────────────────

export const CONNECT_OFFER_SCHEMA_VERSION = 1

export function ensureConnectOfferSchema(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS wr_connect_offers (
      offer_id TEXT PRIMARY KEY,
      handshake_id TEXT NOT NULL,
      capsule_json TEXT NOT NULL,
      capsule_hash TEXT NOT NULL,
      sender_email TEXT,
      sender_iss TEXT,
      sender_sub TEXT,
      sender_wrdesk_user_id TEXT,
      receiver_email TEXT,
      profile_id TEXT NOT NULL,
      ingress_path TEXT NOT NULL,
      invitation_class TEXT NOT NULL DEFAULT 'public_bearer',
      verification_status TEXT NOT NULL CHECK (verification_status IN ('verified', 'failed')),
      verification_reason TEXT,
      suppressed INTEGER NOT NULL DEFAULT 0,
      staged_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      consumed_action TEXT CHECK (consumed_action IN ('consented', 'declined', 'expired')),
      consent_id TEXT,
      -- Phase 4 (4B): WR-code resolution output. Every one of these is sourced
      -- from the resolved, dual-channel-validated material, NEVER from carrier
      -- bytes -- the carrier may say anything and is not a party to the offer.
      wr_code_canonical TEXT,
      publisher_part TEXT,
      entry_local_part TEXT,
      umbrella_handshake_id TEXT,
      entry_status TEXT,
      resolution_mode TEXT CHECK (resolution_mode IS NULL OR resolution_mode IN ('public', 'session_bound')),
      session_bound_expires_at TEXT,
      -- Delta v1.1 Phase-4 additions: EVP-first-render material + audit link.
      evp_ref TEXT,
      value_statement TEXT,
      catalog_epoch INTEGER,
      audit_url TEXT,
      UNIQUE (handshake_id, capsule_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_wr_connect_offers_pending
      ON wr_connect_offers (suppressed, consumed_at, expires_at);

    CREATE TABLE IF NOT EXISTS wr_consent_records (
      consent_id TEXT PRIMARY KEY,
      offer_id TEXT,
      handshake_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('initiator', 'acceptor')),
      preview_hash TEXT NOT NULL,
      bound_definition_hash TEXT NOT NULL,
      contract_state_hash TEXT NOT NULL,
      capture_method TEXT NOT NULL,
      ingress_path TEXT NOT NULL,
      source_reference TEXT,
      actor_wrdesk_user_id TEXT NOT NULL,
      consented_at TEXT NOT NULL,
      -- Phase 4 (4B): what the operator consented to includes HOW it resolved.
      resolution_mode TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wr_consent_records_handshake
      ON wr_consent_records (handshake_id);

    CREATE TABLE IF NOT EXISTS wr_connect_offer_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  // `CREATE TABLE IF NOT EXISTS` does nothing for a database that already has
  // the table, so Phase-4 columns are added explicitly and idempotently.
  addMissingColumns(db, 'wr_connect_offers', [
    ['wr_code_canonical', 'TEXT'],
    ['publisher_part', 'TEXT'],
    ['entry_local_part', 'TEXT'],
    ['umbrella_handshake_id', 'TEXT'],
    ['entry_status', 'TEXT'],
    // No CHECK on the added column: SQLite cannot add a constrained column to
    // an existing table, and the value is written only from resolution output.
    ['resolution_mode', 'TEXT'],
    ['session_bound_expires_at', 'TEXT'],
    ['evp_ref', 'TEXT'],
    ['value_statement', 'TEXT'],
    ['catalog_epoch', 'INTEGER'],
    ['audit_url', 'TEXT'],
  ])
  addMissingColumns(db, 'wr_consent_records', [['resolution_mode', 'TEXT']])

  db.prepare(
    `INSERT OR IGNORE INTO wr_connect_offer_meta (key, value) VALUES ('schema_version', ?)`,
  ).run(String(CONNECT_OFFER_SCHEMA_VERSION))
}

function addMissingColumns(db: any, table: string, columns: Array<[string, string]>): void {
  let existing: Set<string>
  try {
    const info = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: string }>
    existing = new Set(info.map((c) => String(c.name)))
  } catch {
    return
  }
  for (const [name, type] of columns) {
    if (existing.has(name)) continue
    try {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`).run()
    } catch {
      /* another process added it concurrently — idempotent by intent */
    }
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ConnectOfferRow {
  offer_id: string
  handshake_id: string
  capsule_json: string
  capsule_hash: string
  sender_email: string | null
  sender_iss: string | null
  sender_sub: string | null
  sender_wrdesk_user_id: string | null
  receiver_email: string | null
  profile_id: string
  ingress_path: string
  invitation_class: string
  verification_status: 'verified' | 'failed'
  verification_reason: string | null
  suppressed: number
  staged_at: string
  expires_at: string
  consumed_at: string | null
  consumed_action: 'consented' | 'declined' | 'expired' | null
  consent_id: string | null
  // Phase 4 (4B) — resolution output. Null on offers staged before Phase 4 and
  // on any offer that did not come from a WR code.
  wr_code_canonical?: string | null
  publisher_part?: string | null
  entry_local_part?: string | null
  umbrella_handshake_id?: string | null
  entry_status?: string | null
  resolution_mode?: WrResolutionMode | null
  session_bound_expires_at?: string | null
  evp_ref?: string | null
  value_statement?: string | null
  catalog_epoch?: number | null
  audit_url?: string | null
}

/** How the entry resolved. Part of what the operator consents to (4B). */
export type WrResolutionMode = 'public' | 'session_bound'

/**
 * Resolution-derived offer material. Every field here comes from the verified
 * resolution chain — the registry claim after dual-channel validation, the
 * verified head, and the verified EVP. None of it may be read off the carrier.
 */
export interface WrCodeOfferResolution {
  wr_code_canonical: string
  publisher_part: string
  entry_local_part: string
  umbrella_handshake_id?: string | null
  entry_status: string
  resolution_mode: WrResolutionMode
  session_bound_expires_at?: string | null
  /** Delta v1.1: EVP-first-render material. */
  evp_ref?: string | null
  value_statement?: string | null
  catalog_epoch?: number | null
  audit_url?: string | null
  /** Whether the publisher domain completed dual-channel validation. */
  publisher_domain_verified: boolean
}

export interface StageConnectOfferInput {
  handshake_id: string
  /** Full initiate capsule as validated (verified material only). */
  capsule: Record<string, unknown>
  capsule_hash: string
  sender_email?: string | null
  sender_iss?: string | null
  sender_sub?: string | null
  sender_wrdesk_user_id?: string | null
  receiver_email?: string | null
  profile_id: string
  ingress_path: string
  invitation_class?: string
  /** Verification chain verdict. `ok: false` suppresses the offer entirely. */
  verification: { ok: true } | { ok: false; reason: string }
  /** Phase 4 (4B): resolution output for WR-code offers. Absent otherwise. */
  wr_code?: WrCodeOfferResolution
}

export interface ConsentRecordRow {
  consent_id: string
  offer_id: string | null
  handshake_id: string
  role: 'initiator' | 'acceptor'
  preview_hash: string
  bound_definition_hash: string
  contract_state_hash: string
  capture_method: string
  ingress_path: string
  source_reference: string | null
  actor_wrdesk_user_id: string
  consented_at: string
}

// ── Staging ───────────────────────────────────────────────────────────────────

export type StageConnectOfferResult =
  | { staged: true; offerId: string; suppressed: boolean }
  | { staged: false; reason: 'duplicate'; offerId: string }

/**
 * Stage an inbound invitation. Failed verification stores a SUPPRESSED row
 * (logged record [VII.2.7-adjacent]; never listable, never consentable).
 */
export function stageConnectOffer(db: any, input: StageConnectOfferInput): StageConnectOfferResult {
  ensureConnectOfferSchema(db)
  const existing = db
    .prepare(`SELECT offer_id FROM wr_connect_offers WHERE handshake_id = ? AND capsule_hash = ?`)
    .get(input.handshake_id, input.capsule_hash) as { offer_id: string } | undefined
  if (existing) {
    return { staged: false, reason: 'duplicate', offerId: existing.offer_id }
  }
  const offerId = randomUUID()
  const now = Date.now()
  const suppressed = input.verification.ok ? 0 : 1
  db.prepare(
    `INSERT INTO wr_connect_offers (
       offer_id, handshake_id, capsule_json, capsule_hash,
       sender_email, sender_iss, sender_sub, sender_wrdesk_user_id, receiver_email,
       profile_id, ingress_path, invitation_class,
       verification_status, verification_reason, suppressed,
       staged_at, expires_at,
       wr_code_canonical, publisher_part, entry_local_part, umbrella_handshake_id,
       entry_status, resolution_mode, session_bound_expires_at,
       evp_ref, value_statement, catalog_epoch, audit_url
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    offerId,
    input.handshake_id,
    JSON.stringify(input.capsule),
    input.capsule_hash,
    input.sender_email ?? null,
    input.sender_iss ?? null,
    input.sender_sub ?? null,
    input.sender_wrdesk_user_id ?? null,
    input.receiver_email ?? null,
    input.profile_id,
    input.ingress_path,
    input.invitation_class ?? 'public_bearer',
    input.verification.ok ? 'verified' : 'failed',
    input.verification.ok ? null : input.verification.reason,
    suppressed,
    new Date(now).toISOString(),
    new Date(now + INPUT_LIMITS.PENDING_TIMEOUT_MS).toISOString(),
    input.wr_code?.wr_code_canonical ?? null,
    input.wr_code?.publisher_part ?? null,
    input.wr_code?.entry_local_part ?? null,
    input.wr_code?.umbrella_handshake_id ?? null,
    input.wr_code?.entry_status ?? null,
    input.wr_code?.resolution_mode ?? null,
    input.wr_code?.session_bound_expires_at ?? null,
    input.wr_code?.evp_ref ?? null,
    input.wr_code?.value_statement ?? null,
    input.wr_code?.catalog_epoch ?? null,
    input.wr_code?.audit_url ?? null,
  )
  if (suppressed) {
    console.warn('[CONNECT_OFFER] Offer suppressed (verification failed):', {
      offer_id: offerId,
      handshake_id: input.handshake_id,
      reason: (input.verification as { reason: string }).reason,
    })
  } else {
    console.log('[CONNECT_OFFER] Offer staged:', {
      offer_id: offerId,
      handshake_id: input.handshake_id,
      ingress_path: input.ingress_path,
    })
  }
  return { staged: true, offerId, suppressed: suppressed === 1 }
}

/**
 * Pending = verified, not suppressed, not consumed, not expired. Suppressed
 * rows are structurally unreachable from here — the ONLY read surface for
 * offer listings.
 */
export function listPendingConnectOffers(db: any, now: Date = new Date()): ConnectOfferRow[] {
  ensureConnectOfferSchema(db)
  return db
    .prepare(
      `SELECT * FROM wr_connect_offers
       WHERE suppressed = 0 AND verification_status = 'verified'
         AND consumed_at IS NULL AND expires_at > ?
       ORDER BY staged_at DESC`,
    )
    .all(now.toISOString()) as ConnectOfferRow[]
}

/** Consentable = same predicate as listPendingConnectOffers, single row. */
export function getConsentableOffer(db: any, offerId: string, now: Date = new Date()): ConnectOfferRow | null {
  ensureConnectOfferSchema(db)
  const row = db
    .prepare(
      `SELECT * FROM wr_connect_offers
       WHERE offer_id = ? AND suppressed = 0 AND verification_status = 'verified'
         AND consumed_at IS NULL AND expires_at > ?`,
    )
    .get(offerId, now.toISOString()) as ConnectOfferRow | undefined
  return row ?? null
}

export function findPendingOfferByHandshakeId(
  db: any,
  handshakeId: string,
  now: Date = new Date(),
): ConnectOfferRow | null {
  ensureConnectOfferSchema(db)
  const row = db
    .prepare(
      `SELECT * FROM wr_connect_offers
       WHERE handshake_id = ? AND suppressed = 0 AND verification_status = 'verified'
         AND consumed_at IS NULL AND expires_at > ?
       ORDER BY staged_at DESC LIMIT 1`,
    )
    .get(handshakeId, now.toISOString()) as ConnectOfferRow | undefined
  return row ?? null
}

export function markOfferConsumed(
  db: any,
  offerId: string,
  action: 'consented' | 'declined',
  consentId?: string,
): void {
  db.prepare(
    `UPDATE wr_connect_offers SET consumed_at = ?, consumed_action = ?, consent_id = ? WHERE offer_id = ?`,
  ).run(new Date().toISOString(), action, consentId ?? null, offerId)
}

/** Q7: sweep past-timeout offers into consumed_action='expired' (idempotent). */
export function expireStaleOffers(db: any, now: Date = new Date()): number {
  ensureConnectOfferSchema(db)
  const res = db
    .prepare(
      `UPDATE wr_connect_offers
       SET consumed_at = ?, consumed_action = 'expired'
       WHERE consumed_at IS NULL AND expires_at <= ?`,
    )
    .run(now.toISOString(), now.toISOString())
  return res.changes as number
}

// ── Client-generated preview + Hash-Pinned consent [IX.3.4] ──────────────────

const PREVIEW_DOMAIN = 'wr.connect_offer.preview'
const BOUND_DEF_DOMAIN = 'wr.handshake.bound_definition'

function sha256Hex(domain: string, canonical: string): string {
  return createHash('sha256').update(domainTag(domain, 1)).update(canonical, 'utf8').digest('hex')
}

export interface ConnectOfferPreview {
  /** Canonical preview object — built ONLY from verified capsule material. */
  preview: Record<string, CanonicalJsonValue>
  preview_hash: string
  bound_definition_hash: string
  /** Contract state at presentation time = the staged capsule hash. */
  contract_state_hash: string
}

/**
 * Build the client-generated Connect-offer preview from a staged offer.
 * The preview never contains counterparty free text — only the verified,
 * structured identity/profile/scope material — and is canonically hashable
 * at presentation time (this is the Intent-Hash substrate Phase 5 reuses).
 */
export function buildConnectOfferPreview(offer: ConnectOfferRow): ConnectOfferPreview {
  const capsule = JSON.parse(offer.capsule_json) as Record<string, any>
  const scopes = Array.isArray(capsule?.context_scopes)
    ? capsule.context_scopes.filter((s: unknown) => typeof s === 'string')
    : []
  const boundDefinition: Record<string, CanonicalJsonValue> = {
    sender_email: offer.sender_email ?? '',
    sender_iss: offer.sender_iss ?? '',
    sender_sub: offer.sender_sub ?? '',
    sender_wrdesk_user_id: offer.sender_wrdesk_user_id ?? '',
    receiver_email: offer.receiver_email ?? '',
    profile_id: offer.profile_id,
    // 4B: whether the publisher domain completed dual-channel validation is
    // part of WHO this offer binds, not decoration around it.
    publisher_domain_verified: offer.publisher_part != null,
  }

  // 4B + delta O2 extension: the preview hash covers the resolved entry, the
  // resolution mode, and the EVP material the operator is shown. Consenting to
  // a value promise the publisher signed means the hash has to cover that
  // promise; otherwise two offers showing different value statements would be
  // indistinguishable at consent time.
  const entryContext: Record<string, CanonicalJsonValue> = {
    wr_code_canonical: offer.wr_code_canonical ?? '',
    publisher_part: offer.publisher_part ?? '',
    entry_local_part: offer.entry_local_part ?? '',
    entry_status: offer.entry_status ?? '',
    umbrella_handshake_id: offer.umbrella_handshake_id ?? '',
    catalog_epoch: typeof offer.catalog_epoch === 'number' ? offer.catalog_epoch : 0,
    evp_ref: offer.evp_ref ?? '',
    value_statement: offer.value_statement ?? '',
  }
  const preview: Record<string, CanonicalJsonValue> = {
    offer_id: offer.offer_id,
    handshake_id: offer.handshake_id,
    bound_definition: boundDefinition,
    scopes: [...scopes].sort(),
    external_processing: typeof capsule?.external_processing === 'string' ? capsule.external_processing : 'none',
    reciprocal_allowed: capsule?.reciprocal_allowed === true,
    ingress_path: offer.ingress_path,
    staged_at: offer.staged_at,
    expires_at: offer.expires_at,
    entry: entryContext,
    resolution_mode: offer.resolution_mode ?? '',
    session_bound_expires_at: offer.session_bound_expires_at ?? '',
  }
  const previewHash = sha256Hex(PREVIEW_DOMAIN, canonicalJsonString(preview))
  const boundDefinitionHash = sha256Hex(BOUND_DEF_DOMAIN, canonicalJsonString(boundDefinition))
  return {
    preview,
    preview_hash: previewHash,
    bound_definition_hash: boundDefinitionHash,
    contract_state_hash: offer.capsule_hash,
  }
}

export interface InsertConsentInput {
  offer_id: string | null
  handshake_id: string
  role: 'initiator' | 'acceptor'
  preview_hash: string
  bound_definition_hash: string
  contract_state_hash: string
  capture_method: string
  ingress_path: string
  source_reference?: string | null
  actor_wrdesk_user_id: string
  /** 4B: how the entry resolved, recorded with the consent it belongs to. */
  resolution_mode?: WrResolutionMode | null
}

export function insertConsentRecord(db: any, input: InsertConsentInput): ConsentRecordRow {
  ensureConnectOfferSchema(db)
  const row: ConsentRecordRow = {
    consent_id: randomUUID(),
    offer_id: input.offer_id,
    handshake_id: input.handshake_id,
    role: input.role,
    preview_hash: input.preview_hash,
    bound_definition_hash: input.bound_definition_hash,
    contract_state_hash: input.contract_state_hash,
    capture_method: input.capture_method,
    ingress_path: input.ingress_path,
    source_reference: input.source_reference ?? null,
    actor_wrdesk_user_id: input.actor_wrdesk_user_id,
    consented_at: new Date().toISOString(),
  }
  db.prepare(
    `INSERT INTO wr_consent_records (
       consent_id, offer_id, handshake_id, role,
       preview_hash, bound_definition_hash, contract_state_hash,
       capture_method, ingress_path, source_reference,
       actor_wrdesk_user_id, consented_at, resolution_mode
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.consent_id,
    row.offer_id,
    row.handshake_id,
    row.role,
    row.preview_hash,
    row.bound_definition_hash,
    row.contract_state_hash,
    row.capture_method,
    row.ingress_path,
    row.source_reference,
    row.actor_wrdesk_user_id,
    row.consented_at,
    input.resolution_mode ?? null,
  )
  return row
}

export function getConsentRecordForHandshake(db: any, handshakeId: string): ConsentRecordRow | null {
  ensureConnectOfferSchema(db)
  const row = db
    .prepare(`SELECT * FROM wr_consent_records WHERE handshake_id = ? ORDER BY consented_at ASC LIMIT 1`)
    .get(handshakeId) as ConsentRecordRow | undefined
  return row ?? null
}

/**
 * Hash-Pinned validity [IX.3.4]: a consent record is valid only if all three
 * hashes resolve against the material it claims to bind. For acceptor-side
 * consents the offer must still exist (suppressed offers cannot resolve —
 * they were never presentable).
 */
export function consentRecordResolves(
  db: any,
  consent: ConsentRecordRow,
): { valid: true } | { valid: false; reason: string } {
  if (consent.offer_id) {
    const offer = db
      .prepare(`SELECT * FROM wr_connect_offers WHERE offer_id = ?`)
      .get(consent.offer_id) as ConnectOfferRow | undefined
    if (!offer) return { valid: false, reason: 'offer_not_found' }
    if (offer.suppressed) return { valid: false, reason: 'offer_suppressed' }
    const rebuilt = buildConnectOfferPreview(offer)
    if (rebuilt.preview_hash !== consent.preview_hash) {
      return { valid: false, reason: 'preview_hash_mismatch' }
    }
    if (rebuilt.bound_definition_hash !== consent.bound_definition_hash) {
      return { valid: false, reason: 'bound_definition_hash_mismatch' }
    }
    if (rebuilt.contract_state_hash !== consent.contract_state_hash) {
      return { valid: false, reason: 'contract_state_hash_mismatch' }
    }
    return { valid: true }
  }
  // Initiator-side self-consent: hashes bind the outgoing contract; nothing
  // staged to resolve against beyond non-empty pins.
  if (!consent.preview_hash || !consent.bound_definition_hash || !consent.contract_state_hash) {
    return { valid: false, reason: 'missing_hash_pin' }
  }
  return { valid: true }
}
