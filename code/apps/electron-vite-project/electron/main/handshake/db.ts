/**
 * Handshake persistence layer.
 *
 * All handshake tables live in the existing vault SQLCipher database.
 * Migrations are additive — safe to call on every open.
 *
 * STORAGE SEMANTICS (per FINE_GRAINED_GOVERNANCE):
 * - Private key (local_private_key): Vault-bound. Handshake tables live in vault DB.
 * - Signatures / verification artifacts: May live in ledger/capsule; no inner vault needed for verify.
 * - Metadata / hashes / ledger entries: Visible without inner vault unlock.
 * - Sensitive profiles / HS context: Vault-only.
 */

import { parsePolicyToMode, serializePolicyForDb, type AiProcessingMode } from '../../../../../packages/shared/src/handshake/policyUtils'
import type {
  HandshakeRecord,
  AuditLogEntry,
  HandshakeState,
} from './types'

// ── Migration ──

const HANDSHAKE_MIGRATIONS: Array<{
  version: number;
  description: string;
  sql: string[];
}> = [
  {
    version: 1,
    description: 'Initial handshake schema',
    sql: [
      `CREATE TABLE IF NOT EXISTS handshakes (
        handshake_id TEXT PRIMARY KEY,
        relationship_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('DRAFT','PENDING_ACCEPT','ACCEPTED','ACTIVE','EXPIRED','REVOKED')),
        initiator_json TEXT NOT NULL,
        acceptor_json TEXT,
        local_role TEXT NOT NULL CHECK (local_role IN ('initiator','acceptor')),
        sharing_mode TEXT CHECK (sharing_mode IN ('receive-only','reciprocal')),
        reciprocal_allowed INTEGER NOT NULL DEFAULT 1,
        tier_snapshot_json TEXT NOT NULL,
        current_tier_signals_json TEXT NOT NULL,
        last_seq_sent INTEGER NOT NULL DEFAULT 0,
        last_seq_received INTEGER NOT NULL DEFAULT 0,
        last_capsule_hash_sent TEXT NOT NULL DEFAULT '',
        last_capsule_hash_received TEXT NOT NULL DEFAULT '',
        effective_policy_json TEXT NOT NULL,
        external_processing TEXT NOT NULL DEFAULT 'none',
        created_at TEXT NOT NULL,
        activated_at TEXT,
        expires_at TEXT,
        revoked_at TEXT,
        revocation_source TEXT CHECK (revocation_source IN ('local-user','remote-capsule')),
        initiator_wrdesk_policy_hash TEXT NOT NULL DEFAULT '',
        initiator_wrdesk_policy_version TEXT NOT NULL DEFAULT '',
        acceptor_wrdesk_policy_hash TEXT,
        acceptor_wrdesk_policy_version TEXT
      )`,

      `CREATE INDEX IF NOT EXISTS idx_hs_relationship ON handshakes(relationship_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hs_state ON handshakes(state)`,
      `CREATE INDEX IF NOT EXISTS idx_hs_expires ON handshakes(expires_at)`,

      `CREATE TABLE IF NOT EXISTS context_blocks (
        sender_wrdesk_user_id TEXT NOT NULL,
        block_id TEXT NOT NULL,
        block_hash TEXT NOT NULL,
        relationship_id TEXT NOT NULL,
        handshake_id TEXT NOT NULL,
        scope_id TEXT,
        type TEXT NOT NULL,
        data_classification TEXT NOT NULL CHECK (data_classification IN
          ('public','business-confidential','personal-data','sensitive-personal-data')),
        version INTEGER NOT NULL,
        valid_until TEXT,
        source TEXT NOT NULL CHECK (source IN ('received','sent')),
        payload TEXT NOT NULL,
        embedding_status TEXT NOT NULL DEFAULT 'pending' CHECK (embedding_status IN ('pending','complete','failed')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (sender_wrdesk_user_id, block_id, block_hash)
      )`,

      `CREATE INDEX IF NOT EXISTS idx_blocks_relationship ON context_blocks(relationship_id)`,
      `CREATE INDEX IF NOT EXISTS idx_blocks_type ON context_blocks(type)`,
      `CREATE INDEX IF NOT EXISTS idx_blocks_handshake ON context_blocks(handshake_id)`,
      `CREATE INDEX IF NOT EXISTS idx_blocks_valid ON context_blocks(valid_until)`,
      `CREATE INDEX IF NOT EXISTS idx_blocks_sender ON context_blocks(sender_wrdesk_user_id, block_id)`,
      `CREATE INDEX IF NOT EXISTS idx_blocks_embedding ON context_blocks(embedding_status)`,
      `CREATE INDEX IF NOT EXISTS idx_blocks_classification ON context_blocks(data_classification)`,

      `CREATE TABLE IF NOT EXISTS context_block_versions (
        sender_wrdesk_user_id TEXT NOT NULL,
        block_id TEXT NOT NULL,
        last_version INTEGER NOT NULL,
        PRIMARY KEY (sender_wrdesk_user_id, block_id)
      )`,

      `CREATE TABLE IF NOT EXISTS context_embeddings (
        sender_wrdesk_user_id TEXT NOT NULL,
        block_id TEXT NOT NULL,
        block_hash TEXT NOT NULL,
        embedding BLOB NOT NULL,
        model_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (sender_wrdesk_user_id, block_id, block_hash)
          REFERENCES context_blocks(sender_wrdesk_user_id, block_id, block_hash)
          ON DELETE CASCADE
      )`,

      `CREATE TABLE IF NOT EXISTS seen_capsule_hashes (
        handshake_id TEXT NOT NULL,
        capsule_hash TEXT NOT NULL,
        seen_at TEXT NOT NULL,
        PRIMARY KEY (handshake_id, capsule_hash)
      )`,

      `CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        action TEXT NOT NULL,
        handshake_id TEXT,
        capsule_type TEXT,
        reason_code TEXT,
        failed_step TEXT,
        pipeline_duration_ms INTEGER,
        actor_wrdesk_user_id TEXT,
        metadata TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_handshake ON audit_log(handshake_id)`,

      `CREATE TABLE IF NOT EXISTS handshake_schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL,
        description TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 2,
    description: 'Schema v2: receiver_email binding, context_commitment, publisher_id',
    sql: [
      `ALTER TABLE context_blocks ADD COLUMN publisher_id TEXT`,
      `ALTER TABLE context_blocks ADD COLUMN ingested_at TEXT`,
      `ALTER TABLE context_blocks ADD COLUMN active INTEGER NOT NULL DEFAULT 1`,
      `CREATE INDEX IF NOT EXISTS idx_blocks_active ON context_blocks(active)`,
      `CREATE INDEX IF NOT EXISTS idx_blocks_publisher ON context_blocks(publisher_id)`,
    ],
  },
  {
    version: 3,
    description: 'Schema v3: context_store for 3-phase content delivery lifecycle',
    sql: [
      `CREATE TABLE IF NOT EXISTS context_store (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        block_id         TEXT NOT NULL,
        block_hash       TEXT NOT NULL,
        handshake_id     TEXT NOT NULL REFERENCES handshakes(handshake_id),
        relationship_id  TEXT NOT NULL,
        scope_id         TEXT,
        publisher_id     TEXT NOT NULL,
        type             TEXT NOT NULL DEFAULT 'plaintext',
        content          TEXT,
        status           TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','pending_delivery','delivered','received')),
        valid_until      TEXT,
        ingested_at      TEXT,
        superseded       INTEGER NOT NULL DEFAULT 0,
        UNIQUE(block_id, block_hash, handshake_id)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_ctx_store_hs ON context_store(handshake_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ctx_store_rel ON context_store(relationship_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ctx_store_active ON context_store(handshake_id, superseded) WHERE superseded=0`,
      `CREATE INDEX IF NOT EXISTS idx_ctx_store_status ON context_store(handshake_id, status)`,
    ],
  },
  {
    version: 4,
    description: 'Schema v4: context commitment hashes on handshake record',
    sql: [
      `ALTER TABLE handshakes ADD COLUMN initiator_context_commitment TEXT`,
      `ALTER TABLE handshakes ADD COLUMN acceptor_context_commitment TEXT`,
    ],
  },
  {
    version: 5,
    description: 'Schema v5: P2P endpoint for counterparty (context-sync delivery)',
    sql: [
      `ALTER TABLE handshakes ADD COLUMN p2p_endpoint TEXT`,
    ],
  },
  {
    version: 6,
    description: 'Schema v6: outbound capsule queue for P2P context-sync delivery',
    sql: [
      `CREATE TABLE IF NOT EXISTS outbound_capsule_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        handshake_id TEXT NOT NULL,
        target_endpoint TEXT NOT NULL,
        capsule_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        max_retries INTEGER NOT NULL DEFAULT 10,
        last_attempt_at TEXT,
        created_at TEXT NOT NULL,
        error TEXT
      )`,
      `CREATE INDEX IF NOT EXISTS idx_outbound_queue_status ON outbound_capsule_queue(status)`,
      `CREATE INDEX IF NOT EXISTS idx_outbound_queue_handshake ON outbound_capsule_queue(handshake_id)`,
      `CREATE INDEX IF NOT EXISTS idx_outbound_queue_created ON outbound_capsule_queue(created_at)`,
    ],
  },
  {
    version: 7,
    description: 'Schema v7: counterparty_p2p_token for P2P auth, p2p_config table',
    sql: [
      `ALTER TABLE handshakes ADD COLUMN counterparty_p2p_token TEXT`,
      `CREATE TABLE IF NOT EXISTS p2p_config (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 0,
        port INTEGER NOT NULL DEFAULT 51249,
        bind_address TEXT NOT NULL DEFAULT '0.0.0.0',
        tls_enabled INTEGER NOT NULL DEFAULT 0,
        tls_cert_path TEXT,
        tls_key_path TEXT,
        local_p2p_endpoint TEXT
      )`,
      `INSERT OR IGNORE INTO p2p_config (id, enabled, port, bind_address, tls_enabled) VALUES (1, 1, 51249, '0.0.0.0', 0)`,
    ],
  },
  {
    version: 8,
    description: 'Schema v8: P2P default-on (enabled=1 for existing installs)',
    sql: [
      `UPDATE p2p_config SET enabled = 1 WHERE id = 1`,
    ],
  },
  {
    version: 9,
    description: 'Schema v9: Relay config columns for p2p_config',
    sql: [
      `ALTER TABLE p2p_config ADD COLUMN relay_mode TEXT DEFAULT 'local'`,
      `ALTER TABLE p2p_config ADD COLUMN relay_url TEXT`,
      `ALTER TABLE p2p_config ADD COLUMN relay_pull_url TEXT`,
      `ALTER TABLE p2p_config ADD COLUMN relay_auth_secret TEXT`,
      `ALTER TABLE p2p_config ADD COLUMN remote_relay_host TEXT`,
      `ALTER TABLE p2p_config ADD COLUMN remote_relay_mtls_cert TEXT`,
      `ALTER TABLE p2p_config ADD COLUMN remote_relay_mtls_key TEXT`,
    ],
  },
  {
    version: 10,
    description: 'Schema v10: relay_cert_fingerprint for self-signed cert pinning (future)',
    sql: [
      `ALTER TABLE p2p_config ADD COLUMN relay_cert_fingerprint TEXT`,
    ],
  },
  {
    version: 11,
    description: 'Schema v11: Coordination service config (wrdesk.com relay for Free tier)',
    sql: [
      `ALTER TABLE p2p_config ADD COLUMN coordination_url TEXT DEFAULT 'https://coordination.wrdesk.com'`,
      `ALTER TABLE p2p_config ADD COLUMN coordination_ws_url TEXT DEFAULT 'wss://coordination.wrdesk.com/beap/ws'`,
      `ALTER TABLE p2p_config ADD COLUMN coordination_enabled INTEGER DEFAULT 1`,
    ],
  },
  {
    version: 12,
    description: 'Schema v12: Update coordination URLs to relay.wrdesk.com (live service)',
    sql: [
      `UPDATE p2p_config SET coordination_url = 'https://relay.wrdesk.com' WHERE coordination_url = 'https://coordination.wrdesk.com' OR coordination_url IS NULL`,
      `UPDATE p2p_config SET coordination_ws_url = 'wss://relay.wrdesk.com/beap/ws' WHERE coordination_ws_url = 'wss://coordination.wrdesk.com/beap/ws' OR coordination_ws_url IS NULL`,
    ],
  },
  {
    version: 13,
    description: 'Schema v13: Ed25519 handshake signature keys',
    sql: [
      `ALTER TABLE handshakes ADD COLUMN local_public_key TEXT`,
      `ALTER TABLE handshakes ADD COLUMN local_private_key TEXT`,
      `ALTER TABLE handshakes ADD COLUMN counterparty_public_key TEXT`,
    ],
  },
  {
    version: 14,
    description: 'Schema v14: receiver_email for initiator pending (intended recipient)',
    sql: [
      `ALTER TABLE handshakes ADD COLUMN receiver_email TEXT`,
    ],
  },
  {
    version: 15,
    description: 'Schema v15: ACCEPTED state (accept→ACCEPTED, context_sync→ACTIVE)',
    sql: [
      `CREATE TABLE IF NOT EXISTS handshakes_new (
        handshake_id TEXT PRIMARY KEY,
        relationship_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('DRAFT','PENDING_ACCEPT','ACCEPTED','ACTIVE','EXPIRED','REVOKED')),
        initiator_json TEXT NOT NULL,
        acceptor_json TEXT,
        local_role TEXT NOT NULL CHECK (local_role IN ('initiator','acceptor')),
        sharing_mode TEXT CHECK (sharing_mode IN ('receive-only','reciprocal')),
        reciprocal_allowed INTEGER NOT NULL DEFAULT 1,
        tier_snapshot_json TEXT NOT NULL,
        current_tier_signals_json TEXT NOT NULL,
        last_seq_sent INTEGER NOT NULL DEFAULT 0,
        last_seq_received INTEGER NOT NULL DEFAULT 0,
        last_capsule_hash_sent TEXT NOT NULL DEFAULT '',
        last_capsule_hash_received TEXT NOT NULL DEFAULT '',
        effective_policy_json TEXT NOT NULL,
        external_processing TEXT NOT NULL DEFAULT 'none',
        created_at TEXT NOT NULL,
        activated_at TEXT,
        expires_at TEXT,
        revoked_at TEXT,
        revocation_source TEXT CHECK (revocation_source IN ('local-user','remote-capsule')),
        initiator_wrdesk_policy_hash TEXT NOT NULL DEFAULT '',
        initiator_wrdesk_policy_version TEXT NOT NULL DEFAULT '',
        acceptor_wrdesk_policy_hash TEXT,
        acceptor_wrdesk_policy_version TEXT,
        initiator_context_commitment TEXT,
        acceptor_context_commitment TEXT,
        p2p_endpoint TEXT,
        counterparty_p2p_token TEXT,
        local_public_key TEXT,
        local_private_key TEXT,
        counterparty_public_key TEXT,
        receiver_email TEXT
      )`,
      `INSERT INTO handshakes_new SELECT handshake_id, relationship_id, state, initiator_json, acceptor_json, local_role, sharing_mode, reciprocal_allowed, tier_snapshot_json, current_tier_signals_json, last_seq_sent, last_seq_received, last_capsule_hash_sent, last_capsule_hash_received, effective_policy_json, external_processing, created_at, activated_at, expires_at, revoked_at, revocation_source, initiator_wrdesk_policy_hash, initiator_wrdesk_policy_version, acceptor_wrdesk_policy_hash, acceptor_wrdesk_policy_version, initiator_context_commitment, acceptor_context_commitment, p2p_endpoint, counterparty_p2p_token, local_public_key, local_private_key, counterparty_public_key, receiver_email FROM handshakes`,
      `DROP TABLE handshakes`,
      `ALTER TABLE handshakes_new RENAME TO handshakes`,
      `CREATE INDEX IF NOT EXISTS idx_hs_relationship ON handshakes(relationship_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hs_state ON handshakes(state)`,
      `CREATE INDEX IF NOT EXISTS idx_hs_expires ON handshakes(expires_at)`,
    ],
  },
  {
    version: 16,
    description: 'Schema v16: PENDING_REVIEW state for file-import flow',
    sql: [
      `CREATE TABLE IF NOT EXISTS handshakes_new (
        handshake_id TEXT PRIMARY KEY,
        relationship_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('DRAFT','PENDING_ACCEPT','PENDING_REVIEW','ACCEPTED','ACTIVE','EXPIRED','REVOKED')),
        initiator_json TEXT NOT NULL,
        acceptor_json TEXT,
        local_role TEXT NOT NULL CHECK (local_role IN ('initiator','acceptor')),
        sharing_mode TEXT CHECK (sharing_mode IN ('receive-only','reciprocal')),
        reciprocal_allowed INTEGER NOT NULL DEFAULT 1,
        tier_snapshot_json TEXT NOT NULL,
        current_tier_signals_json TEXT NOT NULL,
        last_seq_sent INTEGER NOT NULL DEFAULT 0,
        last_seq_received INTEGER NOT NULL DEFAULT 0,
        last_capsule_hash_sent TEXT NOT NULL DEFAULT '',
        last_capsule_hash_received TEXT NOT NULL DEFAULT '',
        effective_policy_json TEXT NOT NULL,
        external_processing TEXT NOT NULL DEFAULT 'none',
        created_at TEXT NOT NULL,
        activated_at TEXT,
        expires_at TEXT,
        revoked_at TEXT,
        revocation_source TEXT CHECK (revocation_source IN ('local-user','remote-capsule')),
        initiator_wrdesk_policy_hash TEXT NOT NULL DEFAULT '',
        initiator_wrdesk_policy_version TEXT NOT NULL DEFAULT '',
        acceptor_wrdesk_policy_hash TEXT,
        acceptor_wrdesk_policy_version TEXT,
        initiator_context_commitment TEXT,
        acceptor_context_commitment TEXT,
        p2p_endpoint TEXT,
        counterparty_p2p_token TEXT,
        local_public_key TEXT,
        local_private_key TEXT,
        counterparty_public_key TEXT,
        receiver_email TEXT
      )`,
      `INSERT INTO handshakes_new SELECT * FROM handshakes`,
      `DROP TABLE handshakes`,
      `ALTER TABLE handshakes_new RENAME TO handshakes`,
      `CREATE INDEX IF NOT EXISTS idx_hs_relationship ON handshakes(relationship_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hs_state ON handshakes(state)`,
      `CREATE INDEX IF NOT EXISTS idx_hs_expires ON handshakes(expires_at)`,
    ],
  },
  {
    version: 17,
    description: 'Schema v17: context_sync_pending for vault-deferred completion',
    sql: [
      `ALTER TABLE handshakes ADD COLUMN context_sync_pending INTEGER DEFAULT 0`,
    ],
  },
  {
    version: 18,
    description: 'Schema v18: policy_selections for advanced policy storage',
    sql: [
      `ALTER TABLE handshakes ADD COLUMN policy_selections TEXT DEFAULT '{}'`,
    ],
  },
  {
    version: 19,
    description: 'Schema v19: fine-grained context governance (governance_json, default_policy)',
    sql: [
      `ALTER TABLE context_blocks ADD COLUMN governance_json TEXT`,
      `ALTER TABLE context_store ADD COLUMN governance_json TEXT`,
      `ALTER TABLE handshakes ADD COLUMN default_policy_json TEXT`,
    ],
  },
  {
    version: 20,
    description: 'Schema v20: Repair state CHECK constraint to include PENDING_REVIEW (defensive rebuild)',
    sql: [
      // Ensure policy_selections and default_policy_json exist before the table rebuild,
      // guarding against DBs where v18/v19 were skipped or partially applied.
      `ALTER TABLE handshakes ADD COLUMN policy_selections TEXT DEFAULT '{}'`,
      `ALTER TABLE handshakes ADD COLUMN default_policy_json TEXT`,
      // Rebuild handshakes table unconditionally to ensure the CHECK constraint is current.
      // Guards against DBs where v16 was skipped or partially applied.
      `CREATE TABLE IF NOT EXISTS handshakes_v20 (
        handshake_id TEXT PRIMARY KEY,
        relationship_id TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN ('DRAFT','PENDING_ACCEPT','PENDING_REVIEW','ACCEPTED','ACTIVE','EXPIRED','REVOKED')),
        initiator_json TEXT NOT NULL,
        acceptor_json TEXT,
        local_role TEXT NOT NULL CHECK (local_role IN ('initiator','acceptor')),
        sharing_mode TEXT CHECK (sharing_mode IN ('receive-only','reciprocal')),
        reciprocal_allowed INTEGER NOT NULL DEFAULT 1,
        tier_snapshot_json TEXT NOT NULL,
        current_tier_signals_json TEXT NOT NULL,
        last_seq_sent INTEGER NOT NULL DEFAULT 0,
        last_seq_received INTEGER NOT NULL DEFAULT 0,
        last_capsule_hash_sent TEXT NOT NULL DEFAULT '',
        last_capsule_hash_received TEXT NOT NULL DEFAULT '',
        effective_policy_json TEXT NOT NULL,
        external_processing TEXT NOT NULL DEFAULT 'none',
        created_at TEXT NOT NULL,
        activated_at TEXT,
        expires_at TEXT,
        revoked_at TEXT,
        revocation_source TEXT CHECK (revocation_source IN ('local-user','remote-capsule')),
        initiator_wrdesk_policy_hash TEXT NOT NULL DEFAULT '',
        initiator_wrdesk_policy_version TEXT NOT NULL DEFAULT '',
        acceptor_wrdesk_policy_hash TEXT,
        acceptor_wrdesk_policy_version TEXT,
        initiator_context_commitment TEXT,
        acceptor_context_commitment TEXT,
        p2p_endpoint TEXT,
        counterparty_p2p_token TEXT,
        local_public_key TEXT,
        local_private_key TEXT,
        counterparty_public_key TEXT,
        receiver_email TEXT,
        context_sync_pending INTEGER DEFAULT 0,
        policy_selections TEXT DEFAULT '{}',
        default_policy_json TEXT
      )`,
      `INSERT INTO handshakes_v20
        SELECT
          handshake_id, relationship_id, state, initiator_json, acceptor_json,
          local_role, sharing_mode, reciprocal_allowed,
          tier_snapshot_json, current_tier_signals_json,
          last_seq_sent, last_seq_received,
          last_capsule_hash_sent, last_capsule_hash_received,
          effective_policy_json, external_processing,
          created_at, activated_at, expires_at, revoked_at, revocation_source,
          initiator_wrdesk_policy_hash, initiator_wrdesk_policy_version,
          acceptor_wrdesk_policy_hash, acceptor_wrdesk_policy_version,
          initiator_context_commitment, acceptor_context_commitment,
          p2p_endpoint, counterparty_p2p_token,
          local_public_key, local_private_key, counterparty_public_key,
          receiver_email,
          COALESCE(context_sync_pending, 0),
          COALESCE(policy_selections, '{}'),
          default_policy_json
        FROM handshakes`,
      `DROP TABLE handshakes`,
      `ALTER TABLE handshakes_v20 RENAME TO handshakes`,
      `CREATE INDEX IF NOT EXISTS idx_hs_relationship ON handshakes(relationship_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hs_state ON handshakes(state)`,
      `CREATE INDEX IF NOT EXISTS idx_hs_expires ON handshakes(expires_at)`,
    ],
  },
  {
    version: 21,
    description: 'Schema v21: capsule_blocks index for import-time embedding (query-time search only)',
    sql: [
      `CREATE TABLE IF NOT EXISTS capsule_blocks (
        block_id TEXT NOT NULL,
        capsule_id TEXT NOT NULL,
        block_type TEXT NOT NULL,
        title TEXT NOT NULL,
        text TEXT NOT NULL,
        embedding BLOB NOT NULL,
        model_id TEXT NOT NULL,
        handshake_id TEXT NOT NULL,
        relationship_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('received','sent')),
        block_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (capsule_id, block_id, block_hash)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_capsule_blocks_capsule ON capsule_blocks(capsule_id)`,
      `CREATE INDEX IF NOT EXISTS idx_capsule_blocks_handshake ON capsule_blocks(handshake_id)`,
      `CREATE INDEX IF NOT EXISTS idx_capsule_blocks_relationship ON capsule_blocks(relationship_id)`,
      `CREATE INDEX IF NOT EXISTS idx_capsule_blocks_type ON capsule_blocks(block_type)`,
    ],
  },
  {
    version: 22,
    description: 'Schema v22: RAG query cache for frequently asked questions',
    sql: [
      `CREATE TABLE IF NOT EXISTS rag_query_cache (
        capsule_id TEXT NOT NULL,
        normalized_query TEXT NOT NULL,
        answer TEXT NOT NULL,
        sources_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (capsule_id, normalized_query)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_rag_cache_capsule ON rag_query_cache(capsule_id)`,
      `CREATE INDEX IF NOT EXISTS idx_rag_cache_created ON rag_query_cache(created_at)`,
    ],
  },
  {
    version: 23,
    description: 'Schema v23: capsule_blocks source_path, chunk_index, parent_block_id for traceability',
    sql: [
      `ALTER TABLE capsule_blocks ADD COLUMN source_path TEXT`,
      `ALTER TABLE capsule_blocks ADD COLUMN chunk_index INTEGER DEFAULT 0`,
      `ALTER TABLE capsule_blocks ADD COLUMN parent_block_id TEXT`,
      `UPDATE capsule_blocks SET parent_block_id = block_id, source_path = 'context_blocks.' || block_id, chunk_index = 0 WHERE parent_block_id IS NULL`,
      `CREATE INDEX IF NOT EXISTS idx_capsule_blocks_source_path ON capsule_blocks(source_path)`,
      `CREATE INDEX IF NOT EXISTS idx_capsule_blocks_parent ON capsule_blocks(handshake_id, parent_block_id)`,
    ],
  },
  {
    version: 24,
    description: 'Schema v24: context_blocks visibility (public/private) for vault-lock filtering',
    sql: [
      `ALTER TABLE context_blocks ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private'))`,
      `CREATE INDEX IF NOT EXISTS idx_blocks_visibility ON context_blocks(visibility)`,
    ],
  },
  {
    version: 25,
    description: 'Schema v25: X25519 and ML-KEM key agreement for qBEAP',
    sql: [
      `ALTER TABLE handshakes ADD COLUMN peer_x25519_public_key_b64 TEXT`,
      `ALTER TABLE handshakes ADD COLUMN peer_mlkem768_public_key_b64 TEXT`,
    ],
  },
  {
    version: 26,
    description: 'Schema v26: p2p_pending_beap for P2P BEAP message package ingestion',
    sql: [
      `CREATE TABLE IF NOT EXISTS p2p_pending_beap (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        handshake_id TEXT NOT NULL,
        package_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_p2p_pending_beap_handshake ON p2p_pending_beap(handshake_id)`,
      `CREATE INDEX IF NOT EXISTS idx_p2p_pending_beap_created ON p2p_pending_beap(created_at)`,
    ],
  },
  {
    version: 27,
    description: 'Schema v27: p2p_pending_beap processed flag for ingestion tracking',
    sql: [
      `ALTER TABLE p2p_pending_beap ADD COLUMN processed INTEGER NOT NULL DEFAULT 0`,
      `CREATE INDEX IF NOT EXISTS idx_p2p_pending_beap_processed ON p2p_pending_beap(processed)`,
    ],
  },
]

export function migrateHandshakeTables(db: any): void {
  // Ensure migrations table exists first
  try {
    db.prepare(`CREATE TABLE IF NOT EXISTS handshake_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    )`).run()
  } catch (e: any) {
    console.warn('[HANDSHAKE DB] Could not create migrations table:', e?.message)
  }

  for (const migration of HANDSHAKE_MIGRATIONS) {
    // Check if already applied
    try {
      const row = db.prepare(
        'SELECT version FROM handshake_schema_migrations WHERE version = ?'
      ).get(migration.version) as { version: number } | undefined
      if (row) continue
    } catch {
      // Table may not exist yet — proceed
    }

    // Apply migration
    const tx = db.transaction(() => {
      for (const sql of migration.sql) {
        try {
          db.prepare(sql).run()
        } catch (e: any) {
          const msg = e?.message ?? ''
          // Ignore "already exists" / "duplicate column" for additive migrations (ALTER TABLE ADD COLUMN, CREATE INDEX IF NOT EXISTS, etc.)
          if (msg.includes('already exists') || msg.includes('duplicate') || msg.includes('duplicate column name')) continue
          // Rethrow so transaction rolls back — do not mark migration as applied on failure
          throw e
        }
      }
      db.prepare(
        'INSERT OR REPLACE INTO handshake_schema_migrations (version, applied_at, description) VALUES (?, ?, ?)'
      ).run(migration.version, new Date().toISOString(), migration.description)
    })
    tx()
    console.log(`[HANDSHAKE DB] Applied migration ${migration.version}: ${migration.description}`)
  }
}

// ── CRUD Operations ──

export function serializeHandshakeRecord(record: HandshakeRecord): any {
  return {
    handshake_id: record.handshake_id,
    relationship_id: record.relationship_id,
    state: record.state,
    initiator_json: JSON.stringify(record.initiator),
    acceptor_json: record.acceptor ? JSON.stringify(record.acceptor) : null,
    local_role: record.local_role,
    sharing_mode: record.sharing_mode,
    reciprocal_allowed: record.reciprocal_allowed ? 1 : 0,
    tier_snapshot_json: JSON.stringify(record.tier_snapshot),
    current_tier_signals_json: JSON.stringify(record.current_tier_signals),
    last_seq_sent: record.last_seq_sent,
    last_seq_received: record.last_seq_received,
    last_capsule_hash_sent: record.last_capsule_hash_sent,
    last_capsule_hash_received: record.last_capsule_hash_received,
    effective_policy_json: JSON.stringify(record.effective_policy),
    external_processing: record.external_processing,
    created_at: record.created_at,
    activated_at: record.activated_at,
    expires_at: record.expires_at,
    revoked_at: record.revoked_at,
    revocation_source: record.revocation_source,
    initiator_wrdesk_policy_hash: record.initiator_wrdesk_policy_hash,
    initiator_wrdesk_policy_version: record.initiator_wrdesk_policy_version,
    acceptor_wrdesk_policy_hash: record.acceptor_wrdesk_policy_hash,
    acceptor_wrdesk_policy_version: record.acceptor_wrdesk_policy_version,
    initiator_context_commitment: record.initiator_context_commitment ?? null,
    acceptor_context_commitment: record.acceptor_context_commitment ?? null,
    p2p_endpoint: record.p2p_endpoint ?? null,
    counterparty_p2p_token: record.counterparty_p2p_token ?? null,
    local_public_key: record.local_public_key ?? null,
    local_private_key: record.local_private_key ?? null,
    counterparty_public_key: record.counterparty_public_key ?? null,
    receiver_email: record.receiver_email ?? null,
    peer_x25519_public_key_b64: record.peer_x25519_public_key_b64 ?? null,
    peer_mlkem768_public_key_b64: record.peer_mlkem768_public_key_b64 ?? null,
  }
}

export function deserializeHandshakeRecord(row: any): HandshakeRecord {
  return {
    handshake_id: row.handshake_id,
    relationship_id: row.relationship_id,
    state: row.state,
    initiator: JSON.parse(row.initiator_json),
    acceptor: row.acceptor_json ? JSON.parse(row.acceptor_json) : null,
    local_role: row.local_role,
    sharing_mode: row.sharing_mode ?? null,
    reciprocal_allowed: !!row.reciprocal_allowed,
    tier_snapshot: JSON.parse(row.tier_snapshot_json),
    current_tier_signals: JSON.parse(row.current_tier_signals_json),
    last_seq_sent: row.last_seq_sent,
    last_seq_received: row.last_seq_received,
    last_capsule_hash_sent: row.last_capsule_hash_sent,
    last_capsule_hash_received: row.last_capsule_hash_received,
    effective_policy: JSON.parse(row.effective_policy_json),
    external_processing: row.external_processing,
    created_at: row.created_at,
    activated_at: row.activated_at ?? null,
    expires_at: row.expires_at ?? null,
    revoked_at: row.revoked_at ?? null,
    revocation_source: row.revocation_source ?? null,
    initiator_wrdesk_policy_hash: row.initiator_wrdesk_policy_hash,
    initiator_wrdesk_policy_version: row.initiator_wrdesk_policy_version,
    acceptor_wrdesk_policy_hash: row.acceptor_wrdesk_policy_hash ?? null,
    acceptor_wrdesk_policy_version: row.acceptor_wrdesk_policy_version ?? null,
    initiator_context_commitment: row.initiator_context_commitment ?? null,
    acceptor_context_commitment: row.acceptor_context_commitment ?? null,
    p2p_endpoint: row.p2p_endpoint ?? null,
    counterparty_p2p_token: row.counterparty_p2p_token ?? null,
    local_public_key: row.local_public_key ?? null,
    local_private_key: row.local_private_key ?? null,
    counterparty_public_key: row.counterparty_public_key ?? null,
    receiver_email: row.receiver_email ?? null,
    peer_x25519_public_key_b64: row.peer_x25519_public_key_b64 ?? null,
    peer_mlkem768_public_key_b64: row.peer_mlkem768_public_key_b64 ?? null,
    context_sync_pending: !!(row.context_sync_pending),
    policy_selections: parsePolicySelections(row.policy_selections),
  }
}

function parsePolicySelections(json: string | null | undefined): Record<string, unknown> | undefined {
  if (!json || json === '{}') return undefined
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return undefined
  }
}

export function updateHandshakeContextSyncPending(db: any, handshakeId: string, pending: boolean): void {
  db.prepare('UPDATE handshakes SET context_sync_pending = ? WHERE handshake_id = ?').run(pending ? 1 : 0, handshakeId)
}

export function updateHandshakePolicySelections(
  db: any,
  handshakeId: string,
  policies: { ai_processing_mode?: AiProcessingMode } | { cloud_ai?: boolean; internal_ai?: boolean },
): void {
  const mode = (policies as { ai_processing_mode?: AiProcessingMode }).ai_processing_mode
    ?? parsePolicyToMode(policies)
  const json = serializePolicyForDb(mode)
  try {
    db.prepare('UPDATE handshakes SET policy_selections = ? WHERE handshake_id = ?').run(json, handshakeId)
  } catch (e: any) {
    if (!e?.message?.includes('no such column')) throw e
  }
}

export function updateHandshakeSigningKeys(
  db: any,
  handshakeId: string,
  keys: { local_public_key: string; local_private_key: string },
): void {
  db.prepare(
    'UPDATE handshakes SET local_public_key = ?, local_private_key = ? WHERE handshake_id = ?',
  ).run(keys.local_public_key, keys.local_private_key, handshakeId)
}

export function updateHandshakeCounterpartyKey(
  db: any,
  handshakeId: string,
  counterparty_public_key: string,
): void {
  db.prepare(
    'UPDATE handshakes SET counterparty_public_key = ? WHERE handshake_id = ?',
  ).run(counterparty_public_key, handshakeId)
}

export function insertHandshakeRecord(db: any, record: HandshakeRecord): void {
  const s = serializeHandshakeRecord(record)
  db.prepare(`INSERT INTO handshakes (
    handshake_id, relationship_id, state, initiator_json, acceptor_json,
    local_role, sharing_mode, reciprocal_allowed,
    tier_snapshot_json, current_tier_signals_json,
    last_seq_sent, last_seq_received, last_capsule_hash_sent, last_capsule_hash_received,
    effective_policy_json, external_processing,
    created_at, activated_at, expires_at, revoked_at, revocation_source,
    initiator_wrdesk_policy_hash, initiator_wrdesk_policy_version,
    acceptor_wrdesk_policy_hash, acceptor_wrdesk_policy_version,
    initiator_context_commitment, acceptor_context_commitment, p2p_endpoint, counterparty_p2p_token,
    local_public_key, local_private_key, counterparty_public_key, receiver_email,
    peer_x25519_public_key_b64, peer_mlkem768_public_key_b64
  ) VALUES (
    @handshake_id, @relationship_id, @state, @initiator_json, @acceptor_json,
    @local_role, @sharing_mode, @reciprocal_allowed,
    @tier_snapshot_json, @current_tier_signals_json,
    @last_seq_sent, @last_seq_received, @last_capsule_hash_sent, @last_capsule_hash_received,
    @effective_policy_json, @external_processing,
    @created_at, @activated_at, @expires_at, @revoked_at, @revocation_source,
    @initiator_wrdesk_policy_hash, @initiator_wrdesk_policy_version,
    @acceptor_wrdesk_policy_hash, @acceptor_wrdesk_policy_version,
    @initiator_context_commitment, @acceptor_context_commitment, @p2p_endpoint, @counterparty_p2p_token,
    @local_public_key, @local_private_key, @counterparty_public_key, @receiver_email,
    @peer_x25519_public_key_b64, @peer_mlkem768_public_key_b64
  )`).run(s)
}

export function updateHandshakeRecord(db: any, record: HandshakeRecord): void {
  const s = serializeHandshakeRecord(record)
  db.prepare(`UPDATE handshakes SET
    relationship_id = @relationship_id, state = @state,
    initiator_json = @initiator_json, acceptor_json = @acceptor_json,
    local_role = @local_role, sharing_mode = @sharing_mode, reciprocal_allowed = @reciprocal_allowed,
    tier_snapshot_json = @tier_snapshot_json, current_tier_signals_json = @current_tier_signals_json,
    last_seq_sent = @last_seq_sent, last_seq_received = @last_seq_received,
    last_capsule_hash_sent = @last_capsule_hash_sent, last_capsule_hash_received = @last_capsule_hash_received,
    effective_policy_json = @effective_policy_json, external_processing = @external_processing,
    created_at = @created_at, activated_at = @activated_at, expires_at = @expires_at,
    revoked_at = @revoked_at, revocation_source = @revocation_source,
    initiator_wrdesk_policy_hash = @initiator_wrdesk_policy_hash,
    initiator_wrdesk_policy_version = @initiator_wrdesk_policy_version,
    acceptor_wrdesk_policy_hash = @acceptor_wrdesk_policy_hash,
    acceptor_wrdesk_policy_version = @acceptor_wrdesk_policy_version,
    initiator_context_commitment = @initiator_context_commitment,
    acceptor_context_commitment = @acceptor_context_commitment,
    p2p_endpoint = @p2p_endpoint,
    counterparty_p2p_token = @counterparty_p2p_token,
    local_public_key = @local_public_key,
    local_private_key = @local_private_key,
    counterparty_public_key = @counterparty_public_key,
    receiver_email = @receiver_email,
    peer_x25519_public_key_b64 = @peer_x25519_public_key_b64,
    peer_mlkem768_public_key_b64 = @peer_mlkem768_public_key_b64
  WHERE handshake_id = @handshake_id`).run(s)
}

export function getHandshakeRecord(db: any, handshakeId: string): HandshakeRecord | null {
  const row = db.prepare('SELECT * FROM handshakes WHERE handshake_id = ?').get(handshakeId) as any
  return row ? deserializeHandshakeRecord(row) : null
}

export function listHandshakeRecords(
  db: any,
  filter?: { state?: HandshakeState; relationship_id?: string },
): HandshakeRecord[] {
  let sql = 'SELECT * FROM handshakes WHERE 1=1'
  const params: any[] = []

  if (filter?.state) {
    sql += ' AND state = ?'
    params.push(filter.state)
  }
  if (filter?.relationship_id) {
    sql += ' AND relationship_id = ?'
    params.push(filter.relationship_id)
  }

  sql += ' ORDER BY created_at DESC'
  const rows = db.prepare(sql).all(...params) as any[]
  return rows.map(deserializeHandshakeRecord)
}

export function getExistingHandshakesForLookup(db: any): HandshakeRecord[] {
  const rows = db.prepare(
    "SELECT * FROM handshakes WHERE state IN ('PENDING_ACCEPT','ACCEPTED','ACTIVE')"
  ).all() as any[]
  return rows.map(deserializeHandshakeRecord)
}

// ── Seen Capsule Hashes ──

export function getSeenCapsuleHashes(db: any, handshakeId: string): Set<string> {
  const rows = db.prepare(
    'SELECT capsule_hash FROM seen_capsule_hashes WHERE handshake_id = ?'
  ).all(handshakeId) as Array<{ capsule_hash: string }>
  return new Set(rows.map(r => `${handshakeId}:${r.capsule_hash}`))
}

export function insertSeenCapsuleHash(db: any, handshakeId: string, capsuleHash: string): void {
  db.prepare(
    'INSERT OR IGNORE INTO seen_capsule_hashes (handshake_id, capsule_hash, seen_at) VALUES (?, ?, ?)'
  ).run(handshakeId, capsuleHash, new Date().toISOString())
}

// ── Context Block Versions ──

export function getContextBlockVersions(
  db: any,
  handshakeId: string,
): Map<string, number> {
  const rows = db.prepare(
    `SELECT cbv.sender_wrdesk_user_id, cbv.block_id, cbv.last_version
     FROM context_block_versions cbv
     INNER JOIN context_blocks cb ON cb.sender_wrdesk_user_id = cbv.sender_wrdesk_user_id
       AND cb.block_id = cbv.block_id
     WHERE cb.handshake_id = ?`
  ).all(handshakeId) as Array<{ sender_wrdesk_user_id: string; block_id: string; last_version: number }>

  const map = new Map<string, number>()
  for (const r of rows) {
    map.set(`${r.sender_wrdesk_user_id}:${r.block_id}`, r.last_version)
  }
  return map
}

export function upsertContextBlockVersion(
  db: any,
  senderUserId: string,
  blockId: string,
  version: number,
): void {
  db.prepare(
    `INSERT INTO context_block_versions (sender_wrdesk_user_id, block_id, last_version)
     VALUES (?, ?, ?)
     ON CONFLICT(sender_wrdesk_user_id, block_id) DO UPDATE SET last_version = excluded.last_version`
  ).run(senderUserId, blockId, version)
}

// ── Audit Log ──

export function insertAuditLogEntry(db: any, entry: AuditLogEntry): void {
  db.prepare(
    `INSERT INTO audit_log (timestamp, action, handshake_id, capsule_type, reason_code, failed_step, pipeline_duration_ms, actor_wrdesk_user_id, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.timestamp,
    entry.action,
    entry.handshake_id ?? null,
    entry.capsule_type ?? null,
    entry.reason_code,
    entry.failed_step ?? null,
    entry.pipeline_duration_ms ?? null,
    entry.actor_wrdesk_user_id ?? null,
    entry.metadata ? JSON.stringify(entry.metadata) : null,
  )
}

// ── P2P Pending BEAP ──

export function insertPendingP2PBeap(db: any, handshakeId: string, packageJson: string): void {
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO p2p_pending_beap (handshake_id, package_json, created_at) VALUES (?, ?, ?)'
  ).run(handshakeId, packageJson, now)
}

export interface PendingP2PBeapEntry {
  id: number
  handshake_id: string
  package_json: string
  created_at: string
}

export function getPendingP2PBeapMessages(db: any): PendingP2PBeapEntry[] {
  if (!db) return []
  try {
    const rows = db.prepare(
      'SELECT id, handshake_id, package_json, created_at FROM p2p_pending_beap WHERE processed = 0 ORDER BY created_at ASC'
    ).all() as Array<{ id: number; handshake_id: string; package_json: string; created_at: string }>
    return rows.map(r => ({
      id: r.id,
      handshake_id: r.handshake_id,
      package_json: r.package_json,
      created_at: r.created_at,
    }))
  } catch {
    return []
  }
}

export function markP2PPendingBeapProcessed(db: any, id: number): void {
  if (!db) return
  try {
    db.prepare('UPDATE p2p_pending_beap SET processed = 1 WHERE id = ?').run(id)
  } catch { /* non-fatal */ }
}

export function deletePendingP2PBeap(db: any, id: number): void {
  if (!db) return
  try {
    db.prepare('DELETE FROM p2p_pending_beap WHERE id = ?').run(id)
  } catch { /* non-fatal */ }
}

// ── Expiry Helpers ──

export function expirePendingHandshakes(db: any, now: Date): number {
  const result = db.prepare(
    `UPDATE handshakes SET state = 'EXPIRED'
     WHERE state = 'PENDING_ACCEPT' AND expires_at IS NOT NULL AND expires_at < ?`
  ).run(now.toISOString())
  return result.changes
}

export function expireActiveHandshakes(db: any, now: Date): number {
  const result = db.prepare(
    `UPDATE handshakes SET state = 'EXPIRED'
     WHERE state = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at < ?`
  ).run(now.toISOString())
  return result.changes
}

export function softDeleteExpiredBlocks(db: any, now: Date): number {
  const result = db.prepare(
    `DELETE FROM context_blocks WHERE valid_until IS NOT NULL AND valid_until < ?`
  ).run(now.toISOString())
  return result.changes
}

export function markContextBlocksInactiveByHandshake(db: any, handshakeId: string): number {
  let changes = 0
  try {
    const result = db.prepare(
      `UPDATE context_blocks SET active = 0 WHERE handshake_id = ? AND active = 1`
    ).run(handshakeId)
    changes = result.changes
  } catch {
    const result = db.prepare(
      `UPDATE context_blocks SET embedding_status = 'failed'
       WHERE handshake_id = ? AND embedding_status != 'failed'`
    ).run(handshakeId)
    changes = result.changes
  }
  if (changes > 0) {
    try {
      const { invalidateByHandshake } = require('./queryCache') as typeof import('./queryCache')
      invalidateByHandshake(db, handshakeId)
    } catch { /* cache may not exist */ }
  }
  return changes
}

export function deleteBlocksByHandshake(db: any, handshakeId: string): number {
  const result = db.prepare(
    'DELETE FROM context_blocks WHERE handshake_id = ?'
  ).run(handshakeId)
  if (result.changes > 0) {
    try {
      const { invalidateByHandshake } = require('./queryCache') as typeof import('./queryCache')
      invalidateByHandshake(db, handshakeId)
    } catch { /* cache may not exist */ }
  }
  return result.changes
}

export function deleteEmbeddingsByHandshake(db: any, handshakeId: string): number {
  const result = db.prepare(
    `DELETE FROM context_embeddings WHERE (sender_wrdesk_user_id, block_id, block_hash) IN (
      SELECT sender_wrdesk_user_id, block_id, block_hash FROM context_blocks WHERE handshake_id = ?
    )`
  ).run(handshakeId)
  return result.changes
}

/**
 * Permanently delete a handshake and all related data.
 * Allowed for: REVOKED, EXPIRED, or PENDING_ACCEPT when local_role is initiator (cancel request).
 */
export function deleteHandshakeRecord(db: any, handshakeId: string): { success: boolean; error?: string } {
  const record = getHandshakeRecord(db, handshakeId)
  if (!record) return { success: false, error: 'Handshake not found' }
  const canDelete =
    record.state === 'REVOKED' ||
    record.state === 'EXPIRED' ||
    (record.state === 'PENDING_ACCEPT' && record.local_role === 'initiator')
  if (!canDelete) {
    return { success: false, error: 'Only revoked, expired, or your own pending requests can be deleted' }
  }
  try {
    deleteEmbeddingsByHandshake(db, handshakeId)
    deleteBlocksByHandshake(db, handshakeId)
    db.prepare('DELETE FROM context_store WHERE handshake_id = ?').run(handshakeId)
    db.prepare('DELETE FROM seen_capsule_hashes WHERE handshake_id = ?').run(handshakeId)
    db.prepare('DELETE FROM outbound_capsule_queue WHERE handshake_id = ?').run(handshakeId)
    db.prepare('DELETE FROM audit_log WHERE handshake_id = ?').run(handshakeId)
    db.prepare('DELETE FROM handshakes WHERE handshake_id = ?').run(handshakeId)
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Delete failed' }
  }
}

// ── Context Store (3-phase content delivery) ──

export interface ContextStoreEntry {
  block_id: string
  block_hash: string
  handshake_id: string
  relationship_id: string
  scope_id: string | null
  publisher_id: string
  type: string
  content: string | null
  status: 'pending' | 'pending_delivery' | 'delivered' | 'received'
  valid_until: string | null
  ingested_at: string | null
  superseded: number
  governance_json?: string | null
}

export function insertContextStoreEntry(db: any, entry: ContextStoreEntry): void {
  db.prepare(`INSERT OR IGNORE INTO context_store
    (block_id, block_hash, handshake_id, relationship_id, scope_id,
     publisher_id, type, content, status, valid_until, ingested_at, superseded, governance_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.block_id, entry.block_hash, entry.handshake_id, entry.relationship_id,
    entry.scope_id, entry.publisher_id, entry.type,
    entry.content, entry.status, entry.valid_until, entry.ingested_at,
    entry.superseded, entry.governance_json ?? null,
  )
}

export function updateContextStoreGovernance(
  db: any,
  handshakeId: string,
  blockId: string,
  blockHash: string,
  governanceJson: string,
): void {
  db.prepare(
    `UPDATE context_store SET governance_json = ? WHERE handshake_id = ? AND block_id = ? AND block_hash = ?`
  ).run(governanceJson, handshakeId, blockId, blockHash)
}

export function updateContextBlockGovernance(
  db: any,
  senderUserId: string,
  blockId: string,
  blockHash: string,
  governanceJson: string,
): void {
  db.prepare(
    `UPDATE context_blocks SET governance_json = ? WHERE sender_wrdesk_user_id = ? AND block_id = ? AND block_hash = ?`
  ).run(governanceJson, senderUserId, blockId, blockHash)
}

export function getContextStoreByHandshake(
  db: any,
  handshakeId: string,
  status?: string,
): ContextStoreEntry[] {
  let sql = 'SELECT * FROM context_store WHERE handshake_id = ?'
  const params: any[] = [handshakeId]
  if (status) {
    sql += ' AND status = ?'
    params.push(status)
  }
  return db.prepare(sql).all(...params) as ContextStoreEntry[]
}

export function updateContextStoreStatus(
  db: any,
  blockId: string,
  handshakeId: string,
  newStatus: string,
  content?: string | null,
): void {
  if (content !== undefined) {
    db.prepare(
      `UPDATE context_store SET status = ?, content = ?, ingested_at = ?
       WHERE block_id = ? AND handshake_id = ?`
    ).run(newStatus, content, new Date().toISOString(), blockId, handshakeId)
  } else {
    db.prepare(
      `UPDATE context_store SET status = ? WHERE block_id = ? AND handshake_id = ?`
    ).run(newStatus, blockId, handshakeId)
  }
}

export function updateContextStoreStatusBulk(
  db: any,
  handshakeId: string,
  fromStatus: string,
  toStatus: string,
): number {
  const result = db.prepare(
    `UPDATE context_store SET status = ? WHERE handshake_id = ? AND status = ?`
  ).run(toStatus, handshakeId, fromStatus)
  return result.changes
}
