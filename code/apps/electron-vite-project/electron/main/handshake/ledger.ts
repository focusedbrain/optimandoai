/**
 * Handshake Ledger — Tier 1 storage for handshake metadata.
 *
 * A separate SQLite database that stores only hashes, identifiers, and
 * cryptographic commitments from handshake capsules. It never stores
 * plaintext context data, so it does NOT require the vault to be unlocked.
 *
 * Lifecycle:
 *   - Opens when the SSO session becomes available (user logs in)
 *   - Stays open across vault lock/unlock cycles
 *   - Closes on SSO logout (key discarded from memory)
 *
 * Protection model:
 *   - Encrypted at rest with a key derived from the SSO session token
 *   - Key is held in memory only while the session is active
 *   - Even if the file is compromised, no plaintext context is exposed
 *     (only hashes, which are non-reversible)
 */

import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { createRequire } from 'module'
import { homedir } from 'os'
import { createHash, createHmac } from 'crypto'
import { migrateHandshakeTables } from './db'

const _require = createRequire(import.meta.url)

// ── SQLite loader (same pattern as orchestrator-db) ──────────────────────────

let _DatabaseConstructor: any = null

async function loadSQLite(): Promise<any> {
  if (_DatabaseConstructor) return _DatabaseConstructor
  try {
    try {
      _DatabaseConstructor = _require('better-sqlite3')
    } catch {
      const path = _require('path')
      // Try app-local node_modules first (pnpm workspace — not in flat node_modules)
      try {
        _DatabaseConstructor = _require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'))
      } catch {
        const { app } = _require('electron')
        const resourcesPath = path.dirname(app.getAppPath())
        try {
          _DatabaseConstructor = _require(
            path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'better-sqlite3'),
          )
        } catch {
          _DatabaseConstructor = _require(
            path.join(resourcesPath, 'node_modules', 'better-sqlite3'),
          )
        }
      }
    }
    if (typeof _DatabaseConstructor !== 'function') {
      throw new Error('Could not find Database constructor in better-sqlite3')
    }
    return _DatabaseConstructor
  } catch (err: any) {
    throw new Error(`[LEDGER] better-sqlite3 not available: ${err?.message}`)
  }
}

// ── Key derivation ────────────────────────────────────────────────────────────

/**
 * Derive a 32-byte AES key from the SSO session token using HMAC-SHA256.
 * The fixed context string binds the key to this specific use case.
 */
function deriveKeyFromSessionToken(sessionToken: string): Buffer {
  return createHmac('sha256', sessionToken)
    .update('beap-handshake-ledger-v1')
    .digest()
}

// ── DB path ───────────────────────────────────────────────────────────────────

function getLedgerPath(): string {
  const dir = join(homedir(), '.opengiraffe', 'electron-data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'handshake-ledger.db')
}

// ── Schema ────────────────────────────────────────────────────────────────────

const SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS ledger_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  // ledger_handshakes: lightweight summary table for ledger-native queries.
  // The full handshake state is managed by the vault-schema tables
  // (handshakes, context_blocks, etc.) which migrateHandshakeTables() applies
  // to this DB so the handshake pipeline can run without vault access.
  `CREATE TABLE IF NOT EXISTS ledger_handshakes (
    handshake_id       TEXT PRIMARY KEY,
    relationship_id    TEXT NOT NULL,
    status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','accepted','established','rejected','expired','revoked')),
    capsule_type       TEXT NOT NULL,
    sender_id          TEXT NOT NULL,
    sender_email       TEXT,
    receiver_id        TEXT,
    receiver_email     TEXT,
    local_role         TEXT NOT NULL CHECK (local_role IN ('initiator','acceptor')),
    sharing_mode       TEXT CHECK (sharing_mode IN ('receive-only','reciprocal')),
    capsule_hash       TEXT NOT NULL,
    context_hash       TEXT,
    context_commitment TEXT,
    nonce              TEXT,
    policy_hash        TEXT,
    policy_version     TEXT,
    tier_signals       TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
  )`,

  `CREATE INDEX IF NOT EXISTS idx_lhs_relationship ON ledger_handshakes(relationship_id)`,
  `CREATE INDEX IF NOT EXISTS idx_lhs_status ON ledger_handshakes(status)`,
  `CREATE INDEX IF NOT EXISTS idx_lhs_sender ON ledger_handshakes(sender_id)`,

  `CREATE TABLE IF NOT EXISTS ledger_context_blocks (
    block_id      TEXT NOT NULL,
    handshake_id  TEXT NOT NULL,
    block_hash    TEXT NOT NULL,
    block_type    TEXT NOT NULL,
    scope_id      TEXT,
    created_at    TEXT NOT NULL,
    PRIMARY KEY (block_id, handshake_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_lcb_handshake ON ledger_context_blocks(handshake_id)`,

  `CREATE TABLE IF NOT EXISTS ledger_schema_migrations (
    version     INTEGER PRIMARY KEY,
    applied_at  TEXT NOT NULL,
    description TEXT NOT NULL
  )`,
]

function applySchema(db: any): void {
  for (const sql of SCHEMA_SQL) {
    try {
      db.prepare(sql).run()
    } catch (err: any) {
      if (!err?.message?.includes('already exists') && !err?.message?.includes('duplicate')) {
        console.warn('[LEDGER] Schema statement warning:', err?.message)
      }
    }
  }
  // Record schema version
  db.prepare(
    `INSERT OR IGNORE INTO ledger_meta (key, value) VALUES ('schema_version', '1')`
  ).run()
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _ledgerDb: any = null
let _ledgerSessionId: string | null = null

/**
 * Open the handshake ledger, keyed to the given SSO session token.
 * If the ledger is already open for the same session, returns the existing instance.
 * If the session has changed, closes the old DB and reopens with the new key.
 */
export async function openLedger(sessionToken: string): Promise<any> {
  // Already open for this session — reuse
  if (_ledgerDb && _ledgerSessionId === sessionToken) {
    return _ledgerDb
  }

  // Session changed or first open — close old connection
  closeLedger()

  const dbPath = getLedgerPath()
  const key = deriveKeyFromSessionToken(sessionToken)
  const hexKey = key.toString('hex')

  const Database = await loadSQLite()
  const db = new Database(dbPath)

  db.pragma(`key = "x'${hexKey}'"`)
  db.pragma('cipher_page_size = 4096')
  db.pragma('kdf_iter = 64000')
  db.pragma('cipher_hmac_algorithm = HMAC_SHA512')
  db.pragma('cipher_kdf_algorithm = PBKDF2_HMAC_SHA512')
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
  db.pragma('foreign_keys = ON')
  db.pragma('cache_size = -4000')
  db.pragma('temp_store = MEMORY')

  // Verify the key is correct (catches wrong-session re-opens)
  try {
    db.prepare('SELECT count(*) FROM sqlite_master').get()
  } catch {
    db.close()
    // Key mismatch — likely a different user on the same machine.
    // Remove the stale file and create a fresh ledger for this session.
    console.warn('[LEDGER] Key mismatch on existing ledger file — recreating for new session')
    try {
      const { unlinkSync } = await import('fs')
      unlinkSync(dbPath)
    } catch { /* if we can't delete, the new DB open below will fail too */ }
    const db2 = new Database(dbPath)
    db2.pragma(`key = "x'${hexKey}'"`)
    db2.pragma('cipher_page_size = 4096')
    db2.pragma('kdf_iter = 64000')
    db2.pragma('cipher_hmac_algorithm = HMAC_SHA512')
    db2.pragma('cipher_kdf_algorithm = PBKDF2_HMAC_SHA512')
    db2.pragma('journal_mode = WAL')
    db2.pragma('synchronous = NORMAL')
    db2.pragma('foreign_keys = ON')
    db2.pragma('cache_size = -4000')
    db2.pragma('temp_store = MEMORY')
    applySchema(db2)
    try { migrateHandshakeTables(db2) } catch (err: any) {
      console.warn('[LEDGER] Handshake schema migration warning (recreated):', err?.message)
    }
    _ledgerDb = db2
    _ledgerSessionId = sessionToken
    console.log('[LEDGER] Handshake ledger recreated for new session')
    return db2
  }

  applySchema(db)

  // Apply the full vault-schema handshake tables so processHandshakeCapsule
  // can run against the ledger DB without vault access.
  try {
    migrateHandshakeTables(db)
  } catch (err: any) {
    console.warn('[LEDGER] Handshake schema migration warning:', err?.message)
  }

  // Drain any WAL left by the previous session so reads stay fast.
  // PASSIVE: copies WAL frames that have no readers blocking them; safe to ignore errors.
  try { db.pragma('wal_checkpoint(PASSIVE)') } catch { /* ignore — non-critical */ }

  _ledgerDb = db
  _ledgerSessionId = sessionToken
  console.log('[LEDGER] Handshake ledger opened')
  return db
}

/**
 * Close the ledger and discard the session key from memory.
 * Must be called on SSO logout so the next `openLedger` uses the new account key;
 * `handshakeAccountIsolation` also filters rows, but a stale open DB + old session
 * must never occur across account switches.
 */
export function closeLedger(): void {
  if (_ledgerDb) {
    try { _ledgerDb.close() } catch { /* ignore */ }
    _ledgerDb = null
    _ledgerSessionId = null
    console.log('[LEDGER] Handshake ledger closed (session key discarded)')
  }
}

/**
 * Return the open ledger DB, or null if not available.
 * Does NOT throw — callers must check the return value.
 */
export function getLedgerDb(): any {
  return _ledgerDb ?? null
}

/**
 * Build a stable session token from SSO claims.
 * Uses a hash of the user ID + issuer so the token itself isn't stored.
 */
export function buildLedgerSessionToken(wrdesk_user_id: string, iss: string): string {
  return createHash('sha256')
    .update(`${wrdesk_user_id}:${iss}:beap-ledger`)
    .digest('hex')
}

// ── CRUD helpers ──────────────────────────────────────────────────────────────

export interface LedgerHandshake {
  handshake_id: string
  relationship_id: string
  status: 'pending' | 'accepted' | 'established' | 'rejected' | 'expired' | 'revoked'
  capsule_type: string
  sender_id: string
  sender_email: string | null
  receiver_id: string | null
  receiver_email: string | null
  local_role: 'initiator' | 'acceptor'
  sharing_mode: 'receive-only' | 'reciprocal' | null
  capsule_hash: string
  context_hash: string | null
  context_commitment: string | null
  nonce: string | null
  policy_hash: string | null
  policy_version: string | null
  tier_signals: string | null
  created_at: string
  updated_at: string
}

export interface LedgerContextBlock {
  block_id: string
  handshake_id: string
  block_hash: string
  block_type: string
  scope_id: string | null
  created_at: string
}

export function insertLedgerHandshake(db: any, hs: LedgerHandshake): void {
  db.prepare(`
    INSERT OR IGNORE INTO ledger_handshakes (
      handshake_id, relationship_id, status, capsule_type,
      sender_id, sender_email, receiver_id, receiver_email,
      local_role, sharing_mode,
      capsule_hash, context_hash, context_commitment, nonce,
      policy_hash, policy_version, tier_signals,
      created_at, updated_at
    ) VALUES (
      @handshake_id, @relationship_id, @status, @capsule_type,
      @sender_id, @sender_email, @receiver_id, @receiver_email,
      @local_role, @sharing_mode,
      @capsule_hash, @context_hash, @context_commitment, @nonce,
      @policy_hash, @policy_version, @tier_signals,
      @created_at, @updated_at
    )
  `).run(hs)
}

export function updateLedgerHandshakeStatus(
  db: any,
  handshakeId: string,
  status: LedgerHandshake['status'],
  extra?: Partial<Pick<LedgerHandshake, 'sharing_mode' | 'receiver_id' | 'receiver_email'>>,
): void {
  const now = new Date().toISOString()
  if (extra && Object.keys(extra).length > 0) {
    const fields = Object.keys(extra).map(k => `${k} = @${k}`).join(', ')
    db.prepare(
      `UPDATE ledger_handshakes SET status = @status, updated_at = @now, ${fields}
       WHERE handshake_id = @handshake_id`
    ).run({ status, now, handshake_id: handshakeId, ...extra })
  } else {
    db.prepare(
      `UPDATE ledger_handshakes SET status = @status, updated_at = @now
       WHERE handshake_id = @handshake_id`
    ).run({ status, now, handshake_id: handshakeId })
  }
}

export function getLedgerHandshake(db: any, handshakeId: string): LedgerHandshake | null {
  return db.prepare('SELECT * FROM ledger_handshakes WHERE handshake_id = ?').get(handshakeId) ?? null
}

export function listLedgerHandshakes(
  db: any,
  filter?: { status?: string; sender_id?: string },
): LedgerHandshake[] {
  let sql = 'SELECT * FROM ledger_handshakes WHERE 1=1'
  const params: any[] = []
  if (filter?.status) { sql += ' AND status = ?'; params.push(filter.status) }
  if (filter?.sender_id) { sql += ' AND sender_id = ?'; params.push(filter.sender_id) }
  sql += ' ORDER BY created_at DESC'
  return db.prepare(sql).all(...params) as LedgerHandshake[]
}

export function insertLedgerContextBlock(db: any, block: LedgerContextBlock): void {
  db.prepare(`
    INSERT OR IGNORE INTO ledger_context_blocks
      (block_id, handshake_id, block_hash, block_type, scope_id, created_at)
    VALUES
      (@block_id, @handshake_id, @block_hash, @block_type, @scope_id, @created_at)
  `).run(block)
}

export function getLedgerContextBlocks(db: any, handshakeId: string): LedgerContextBlock[] {
  return db.prepare(
    'SELECT * FROM ledger_context_blocks WHERE handshake_id = ?'
  ).all(handshakeId) as LedgerContextBlock[]
}
