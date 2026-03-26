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
  {
    version: 28,
    description: 'Schema v28: plain_email_inbox for depackaged plain emails (Canon §6)',
    sql: [
      `CREATE TABLE IF NOT EXISTS plain_email_inbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_json TEXT NOT NULL,
        account_id TEXT NOT NULL,
        email_message_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        processed INTEGER NOT NULL DEFAULT 0
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_plain_email_inbox_dedup ON plain_email_inbox(account_id, email_message_id)`,
      `CREATE INDEX IF NOT EXISTS idx_plain_email_inbox_processed ON plain_email_inbox(processed)`,
    ],
  },
  {
    version: 29,
    description: 'Schema v29: Email inbox feature — inbox_messages, inbox_attachments, inbox_embeddings, email_sync_state, deletion_queue',
    sql: [
      `CREATE TABLE IF NOT EXISTS inbox_messages (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL CHECK(source_type IN ('direct_beap','email_beap','email_plain')),
        handshake_id TEXT,
        account_id TEXT,
        email_message_id TEXT,
        from_address TEXT,
        from_name TEXT,
        to_addresses TEXT,
        cc_addresses TEXT,
        subject TEXT,
        body_text TEXT,
        body_html TEXT,
        beap_package_json TEXT,
        depackaged_json TEXT,
        has_attachments INTEGER DEFAULT 0,
        attachment_count INTEGER DEFAULT 0,
        received_at TEXT NOT NULL,
        ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
        read_status INTEGER DEFAULT 0,
        starred INTEGER DEFAULT 0,
        archived INTEGER DEFAULT 0,
        deleted INTEGER DEFAULT 0,
        deleted_at TEXT,
        purge_after TEXT,
        remote_deleted INTEGER DEFAULT 0,
        remote_deleted_at TEXT,
        batch_id TEXT,
        sort_category TEXT,
        ai_summary TEXT,
        ai_draft_response TEXT,
        embedding_status TEXT DEFAULT 'pending' CHECK(embedding_status IN ('pending','done','failed'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_inbox_messages_source_type ON inbox_messages(source_type)`,
      `CREATE INDEX IF NOT EXISTS idx_inbox_messages_handshake_id ON inbox_messages(handshake_id)`,
      `CREATE INDEX IF NOT EXISTS idx_inbox_messages_account_id ON inbox_messages(account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_inbox_messages_deleted_purge ON inbox_messages(deleted, purge_after)`,
      `CREATE INDEX IF NOT EXISTS idx_inbox_messages_read_status ON inbox_messages(read_status)`,
      `CREATE INDEX IF NOT EXISTS idx_inbox_messages_received_at ON inbox_messages(received_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_inbox_messages_sort_category ON inbox_messages(sort_category)`,
      `CREATE INDEX IF NOT EXISTS idx_inbox_messages_archived ON inbox_messages(archived)`,

      `CREATE TABLE IF NOT EXISTS inbox_attachments (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        content_type TEXT,
        size_bytes INTEGER,
        content_id TEXT,
        storage_path TEXT,
        extracted_text TEXT,
        text_extraction_status TEXT DEFAULT 'pending' CHECK(text_extraction_status IN ('pending','done','failed','skipped')),
        raster_path TEXT,
        embedding_status TEXT DEFAULT 'pending' CHECK(embedding_status IN ('pending','done','failed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
      `CREATE INDEX IF NOT EXISTS idx_inbox_attachments_message_id ON inbox_attachments(message_id)`,

      `CREATE TABLE IF NOT EXISTS inbox_embeddings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
        chunk_index INTEGER NOT NULL,
        chunk_text TEXT NOT NULL,
        embedding BLOB NOT NULL,
        source TEXT NOT NULL CHECK(source IN ('body','attachment','subject','ai_summary')),
        attachment_id TEXT,
        UNIQUE(message_id, chunk_index, source)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_inbox_embeddings_message_id ON inbox_embeddings(message_id)`,

      `CREATE TABLE IF NOT EXISTS email_sync_state (
        account_id TEXT PRIMARY KEY,
        last_sync_at TEXT,
        last_uid TEXT,
        sync_cursor TEXT,
        auto_sync_enabled INTEGER DEFAULT 0,
        sync_interval_ms INTEGER DEFAULT 30000,
        total_synced INTEGER DEFAULT 0,
        last_error TEXT,
        last_error_at TEXT
      )`,

      `CREATE TABLE IF NOT EXISTS deletion_queue (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES inbox_messages(id),
        account_id TEXT NOT NULL,
        email_message_id TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        queued_at TEXT NOT NULL DEFAULT (datetime('now')),
        grace_period_ends TEXT NOT NULL,
        executed INTEGER DEFAULT 0,
        executed_at TEXT,
        execution_error TEXT,
        cancelled INTEGER DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS idx_deletion_queue_grace_exec_cancel ON deletion_queue(grace_period_ends, executed, cancelled)`,
    ],
  },
  {
    version: 30,
    description: 'Schema v30: AI Auto-Sort — pending_delete, pending_delete_at, sort_reason',
    sql: [
      `ALTER TABLE inbox_messages ADD COLUMN pending_delete INTEGER DEFAULT 0`,
      `ALTER TABLE inbox_messages ADD COLUMN pending_delete_at TEXT`,
      `ALTER TABLE inbox_messages ADD COLUMN sort_reason TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_inbox_messages_pending_delete ON inbox_messages(pending_delete)`,
    ],
  },
  {
    version: 31,
    description: 'Schema v31: Inbox AI settings — inbox_settings key-value table',
    sql: [
      `CREATE TABLE IF NOT EXISTS inbox_settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL DEFAULT 'null',
        updated_at INTEGER NOT NULL DEFAULT 0
      )`,
    ],
  },
  {
    version: 32,
    description: 'Schema v32: AI Auto-Sort — urgency_score, needs_reply for sorting',
    sql: [
      `ALTER TABLE inbox_messages ADD COLUMN urgency_score INTEGER DEFAULT 5`,
      `ALTER TABLE inbox_messages ADD COLUMN needs_reply INTEGER DEFAULT 0`,
    ],
  },
  {
    version: 33,
    description: 'Schema v33: Pending Review — pending_review_at for 14-day grace',
    sql: [
      `ALTER TABLE inbox_messages ADD COLUMN pending_review_at TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_inbox_messages_sort_category ON inbox_messages(sort_category)`,
    ],
  },
  {
    version: 34,
    description: 'Schema v34: Persist AI analysis for sorted messages',
    sql: [
      `ALTER TABLE inbox_messages ADD COLUMN ai_analysis_json TEXT`,
    ],
  },
  {
    version: 35,
    description:
      'Schema v35: Remote orchestrator mutation queue + per-message last remote error (mirrors local lifecycle to mailbox)',
    sql: [
      `CREATE TABLE IF NOT EXISTS remote_orchestrator_mutation_queue (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        email_message_id TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        operation TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','processing','completed','failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(message_id, operation)
      )`,
      `CREATE INDEX IF NOT EXISTS idx_remote_orch_queue_status ON remote_orchestrator_mutation_queue(status, updated_at)`,
      `ALTER TABLE inbox_messages ADD COLUMN remote_orchestrator_last_error TEXT`,
    ],
  },
  {
    version: 36,
    description:
      'Schema v36: Lifecycle audit columns — review exit + final-delete queue timestamps (UTC ISO)',
    sql: [
      `ALTER TABLE inbox_messages ADD COLUMN lifecycle_exited_review_utc TEXT`,
      `ALTER TABLE inbox_messages ADD COLUMN lifecycle_final_delete_queued_utc TEXT`,
    ],
  },
  {
    version: 37,
    description:
      'Schema v37: IMAP remote mirror — last known mailbox + RFC Message-ID for chained MOVE / reconcile',
    sql: [
      `ALTER TABLE inbox_messages ADD COLUMN imap_remote_mailbox TEXT`,
      `ALTER TABLE inbox_messages ADD COLUMN imap_rfc_message_id TEXT`,
    ],
  },
  {
    version: 38,
    description:
      'Schema v38: p2p_pending_beap.package_json — repair DBs where table existed without column (CREATE IF NOT EXISTS skipped full DDL)',
    sql: [
      `ALTER TABLE p2p_pending_beap ADD COLUMN package_json TEXT`,
    ],
  },
  {
    version: 39,
    description:
      'Schema v39: Reset forced auto-sync — clear auto_sync_enabled previously turned on by onAccountConnected (user opts in via Inbox)',
    sql: [
      `UPDATE email_sync_state SET auto_sync_enabled = 0 WHERE auto_sync_enabled = 1`,
    ],
  },
  {
    version: 40,
    description:
      'Schema v40: Auto-sync off by default — one-time reset of all email_sync_state rows (user opts in per account)',
    sql: [`UPDATE email_sync_state SET auto_sync_enabled = 0`],
  },
  {
    version: 41,
    description:
      'Schema v41: IMAP one-time legacy lifecycle folder consolidation flag (email_sync_state.imap_folders_consolidated)',
    sql: [`ALTER TABLE email_sync_state ADD COLUMN imap_folders_consolidated INTEGER NOT NULL DEFAULT 0`],
  },
  {
    version: 42,
    description:
      'Schema v42: Repair swapped IMAP identifiers — email_message_id held RFC Message-ID while imap_rfc_message_id held UID',
    sql: [
      `UPDATE inbox_messages
       SET email_message_id = imap_rfc_message_id,
           imap_rfc_message_id = email_message_id
       WHERE email_message_id LIKE '<%'
         AND imap_rfc_message_id IS NOT NULL
         AND imap_rfc_message_id NOT LIKE '<%'`,
    ],
  },
  {
    version: 43,
    description: 'Schema v43: inbox_attachments.text_extraction_error for PDF ingest failures',
    sql: [`ALTER TABLE inbox_attachments ADD COLUMN text_extraction_error TEXT DEFAULT NULL`],
  },
  {
    version: 44,
    description:
      'Schema v44: inbox_attachments content_sha256 + extracted_text_sha256 (link blob to extracted text)',
    sql: [
      `ALTER TABLE inbox_attachments ADD COLUMN content_sha256 TEXT DEFAULT NULL`,
      `ALTER TABLE inbox_attachments ADD COLUMN extracted_text_sha256 TEXT DEFAULT NULL`,
    ],
  },
  {
    version: 45,
    description:
      'Schema v45: inbox_attachments AES-GCM at rest — encryption_key/iv/tag + storage_encrypted',
    sql: [
      `ALTER TABLE inbox_attachments ADD COLUMN encryption_key TEXT DEFAULT NULL`,
      `ALTER TABLE inbox_attachments ADD COLUMN encryption_iv TEXT DEFAULT NULL`,
      `ALTER TABLE inbox_attachments ADD COLUMN encryption_tag TEXT DEFAULT NULL`,
      `ALTER TABLE inbox_attachments ADD COLUMN storage_encrypted INTEGER NOT NULL DEFAULT 0`,
    ],
  },
  {
    version: 46,
    description: 'Schema v46: inbox_attachments.page_count for PDF page count (pdfjs extraction)',
    sql: [`ALTER TABLE inbox_attachments ADD COLUMN page_count INTEGER DEFAULT NULL`],
  },
  {
    version: 47,
    description:
      "Schema v47: inbox_attachments.text_extraction_status allows 'partial' (sparse PDF text vs page count)",
    sql: [
      `CREATE TABLE IF NOT EXISTS inbox_attachments_v47 (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES inbox_messages(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        content_type TEXT,
        size_bytes INTEGER,
        content_id TEXT,
        storage_path TEXT,
        extracted_text TEXT,
        text_extraction_status TEXT DEFAULT 'pending' CHECK(text_extraction_status IN ('pending','done','failed','skipped','partial')),
        raster_path TEXT,
        embedding_status TEXT DEFAULT 'pending' CHECK(embedding_status IN ('pending','done','failed')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        text_extraction_error TEXT DEFAULT NULL,
        content_sha256 TEXT DEFAULT NULL,
        extracted_text_sha256 TEXT DEFAULT NULL,
        encryption_key TEXT DEFAULT NULL,
        encryption_iv TEXT DEFAULT NULL,
        encryption_tag TEXT DEFAULT NULL,
        storage_encrypted INTEGER NOT NULL DEFAULT 0,
        page_count INTEGER DEFAULT NULL
      )`,
      `INSERT INTO inbox_attachments_v47 (
        id, message_id, filename, content_type, size_bytes, content_id, storage_path,
        extracted_text, text_extraction_status, raster_path, embedding_status, created_at,
        text_extraction_error, content_sha256, extracted_text_sha256,
        encryption_key, encryption_iv, encryption_tag, storage_encrypted, page_count
      ) SELECT
        id, message_id, filename, content_type, size_bytes, content_id, storage_path,
        extracted_text, text_extraction_status, raster_path, embedding_status, created_at,
        text_extraction_error, content_sha256, extracted_text_sha256,
        encryption_key, encryption_iv, encryption_tag, storage_encrypted, page_count
      FROM inbox_attachments`,
      `DROP TABLE inbox_attachments`,
      `ALTER TABLE inbox_attachments_v47 RENAME TO inbox_attachments`,
      `CREATE INDEX IF NOT EXISTS idx_inbox_attachments_message_id ON inbox_attachments(message_id)`,
    ],
  },
  {
    version: 48,
    description:
      'Schema v48: autosort_sessions (Auto-Sort run metadata) + inbox_messages.last_autosort_session_id',
    sql: [
      `CREATE TABLE IF NOT EXISTS autosort_sessions (
        id                      TEXT PRIMARY KEY,
        started_at              TEXT NOT NULL,
        completed_at            TEXT,
        total_messages          INTEGER NOT NULL DEFAULT 0,
        urgent_count            INTEGER NOT NULL DEFAULT 0,
        pending_review_count  INTEGER NOT NULL DEFAULT 0,
        pending_delete_count    INTEGER NOT NULL DEFAULT 0,
        archived_count          INTEGER NOT NULL DEFAULT 0,
        error_count             INTEGER NOT NULL DEFAULT 0,
        duration_ms             INTEGER,
        ai_summary_json         TEXT,
        status                  TEXT NOT NULL DEFAULT 'running'
      )`,
      `CREATE INDEX IF NOT EXISTS idx_autosort_sessions_started
        ON autosort_sessions(started_at)`,
      `ALTER TABLE inbox_messages ADD COLUMN last_autosort_session_id TEXT`,
    ],
  },
]

/**
 * Canonical columns for the email / inbox / sync pipeline. Repairs partial tables where
 * `CREATE TABLE IF NOT EXISTS` skipped full DDL (legacy or manual DB). Each ALTER is
 * attempted only if the table exists and `PRAGMA table_info` lacks the column.
 *
 * Types/default match `HANDSHAKE_MIGRATIONS` + messageRouter / ipc / syncOrchestrator usage.
 */
const EMAIL_PIPELINE_COLUMN_REPAIRS: ReadonlyArray<{ table: string; column: string; ddl: string }> = [
  // ── p2p_pending_beap (BEAP queue — insertPendingP2PBeap, beapEmailIngestion) ──
  { table: 'p2p_pending_beap', column: 'handshake_id', ddl: 'TEXT' },
  { table: 'p2p_pending_beap', column: 'package_json', ddl: 'TEXT' },
  { table: 'p2p_pending_beap', column: 'created_at', ddl: "TEXT DEFAULT (datetime('now'))" },
  { table: 'p2p_pending_beap', column: 'processed', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  // ── plain_email_inbox (plainEmailIngestion, insertPendingPlainEmail) ──
  { table: 'plain_email_inbox', column: 'message_json', ddl: 'TEXT' },
  { table: 'plain_email_inbox', column: 'account_id', ddl: 'TEXT' },
  { table: 'plain_email_inbox', column: 'email_message_id', ddl: 'TEXT' },
  { table: 'plain_email_inbox', column: 'created_at', ddl: "TEXT DEFAULT (datetime('now'))" },
  { table: 'plain_email_inbox', column: 'processed', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  // ── inbox_messages (v29 + v30–v37) ──
  { table: 'inbox_messages', column: 'source_type', ddl: "TEXT DEFAULT 'email_plain'" },
  { table: 'inbox_messages', column: 'handshake_id', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'account_id', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'email_message_id', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'from_address', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'from_name', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'to_addresses', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'cc_addresses', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'subject', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'body_text', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'body_html', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'beap_package_json', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'depackaged_json', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'has_attachments', ddl: 'INTEGER DEFAULT 0' },
  { table: 'inbox_messages', column: 'attachment_count', ddl: 'INTEGER DEFAULT 0' },
  { table: 'inbox_messages', column: 'received_at', ddl: "TEXT DEFAULT (datetime('now'))" },
  { table: 'inbox_messages', column: 'ingested_at', ddl: "TEXT DEFAULT (datetime('now'))" },
  { table: 'inbox_messages', column: 'read_status', ddl: 'INTEGER DEFAULT 0' },
  { table: 'inbox_messages', column: 'starred', ddl: 'INTEGER DEFAULT 0' },
  { table: 'inbox_messages', column: 'archived', ddl: 'INTEGER DEFAULT 0' },
  { table: 'inbox_messages', column: 'deleted', ddl: 'INTEGER DEFAULT 0' },
  { table: 'inbox_messages', column: 'deleted_at', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'purge_after', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'remote_deleted', ddl: 'INTEGER DEFAULT 0' },
  { table: 'inbox_messages', column: 'remote_deleted_at', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'batch_id', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'sort_category', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'ai_summary', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'ai_draft_response', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'embedding_status', ddl: "TEXT DEFAULT 'pending'" },
  { table: 'inbox_messages', column: 'pending_delete', ddl: 'INTEGER DEFAULT 0' },
  { table: 'inbox_messages', column: 'pending_delete_at', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'sort_reason', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'urgency_score', ddl: 'INTEGER DEFAULT 5' },
  { table: 'inbox_messages', column: 'needs_reply', ddl: 'INTEGER DEFAULT 0' },
  { table: 'inbox_messages', column: 'pending_review_at', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'ai_analysis_json', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'remote_orchestrator_last_error', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'lifecycle_exited_review_utc', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'lifecycle_final_delete_queued_utc', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'imap_remote_mailbox', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'imap_rfc_message_id', ddl: 'TEXT' },
  { table: 'inbox_messages', column: 'last_autosort_session_id', ddl: 'TEXT' },
  // ── inbox_attachments (messageRouter, ipc) ──
  { table: 'inbox_attachments', column: 'message_id', ddl: 'TEXT' },
  { table: 'inbox_attachments', column: 'filename', ddl: 'TEXT' },
  { table: 'inbox_attachments', column: 'content_type', ddl: 'TEXT' },
  { table: 'inbox_attachments', column: 'size_bytes', ddl: 'INTEGER' },
  { table: 'inbox_attachments', column: 'content_id', ddl: 'TEXT' },
  { table: 'inbox_attachments', column: 'storage_path', ddl: 'TEXT' },
  { table: 'inbox_attachments', column: 'extracted_text', ddl: 'TEXT' },
  { table: 'inbox_attachments', column: 'text_extraction_status', ddl: "TEXT DEFAULT 'pending'" },
  { table: 'inbox_attachments', column: 'text_extraction_error', ddl: 'TEXT' },
  { table: 'inbox_attachments', column: 'content_sha256', ddl: 'TEXT' },
  { table: 'inbox_attachments', column: 'extracted_text_sha256', ddl: 'TEXT' },
  { table: 'inbox_attachments', column: 'encryption_key', ddl: 'TEXT' },
  { table: 'inbox_attachments', column: 'encryption_iv', ddl: 'TEXT' },
  { table: 'inbox_attachments', column: 'encryption_tag', ddl: 'TEXT' },
  { table: 'inbox_attachments', column: 'storage_encrypted', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'inbox_attachments', column: 'raster_path', ddl: 'TEXT' },
  { table: 'inbox_attachments', column: 'embedding_status', ddl: "TEXT DEFAULT 'pending'" },
  { table: 'inbox_attachments', column: 'page_count', ddl: 'INTEGER DEFAULT NULL' },
  { table: 'inbox_attachments', column: 'created_at', ddl: "TEXT DEFAULT (datetime('now'))" },
  // ── email_sync_state (syncOrchestrator, ipc) ──
  { table: 'email_sync_state', column: 'last_sync_at', ddl: 'TEXT' },
  { table: 'email_sync_state', column: 'last_uid', ddl: 'TEXT' },
  { table: 'email_sync_state', column: 'sync_cursor', ddl: 'TEXT' },
  { table: 'email_sync_state', column: 'auto_sync_enabled', ddl: 'INTEGER DEFAULT 0' },
  { table: 'email_sync_state', column: 'sync_interval_ms', ddl: 'INTEGER DEFAULT 30000' },
  { table: 'email_sync_state', column: 'total_synced', ddl: 'INTEGER DEFAULT 0' },
  { table: 'email_sync_state', column: 'last_error', ddl: 'TEXT' },
  { table: 'email_sync_state', column: 'last_error_at', ddl: 'TEXT' },
  { table: 'email_sync_state', column: 'imap_folders_consolidated', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  // ── deletion_queue (remoteDeletion) ──
  { table: 'deletion_queue', column: 'message_id', ddl: 'TEXT' },
  { table: 'deletion_queue', column: 'account_id', ddl: 'TEXT' },
  { table: 'deletion_queue', column: 'email_message_id', ddl: 'TEXT' },
  { table: 'deletion_queue', column: 'provider_type', ddl: 'TEXT' },
  { table: 'deletion_queue', column: 'queued_at', ddl: "TEXT DEFAULT (datetime('now'))" },
  { table: 'deletion_queue', column: 'grace_period_ends', ddl: 'TEXT' },
  { table: 'deletion_queue', column: 'executed', ddl: 'INTEGER DEFAULT 0' },
  { table: 'deletion_queue', column: 'executed_at', ddl: 'TEXT' },
  { table: 'deletion_queue', column: 'execution_error', ddl: 'TEXT' },
  { table: 'deletion_queue', column: 'cancelled', ddl: 'INTEGER DEFAULT 0' },
  // ── remote_orchestrator_mutation_queue (inboxOrchestratorRemoteQueue) ──
  { table: 'remote_orchestrator_mutation_queue', column: 'message_id', ddl: 'TEXT' },
  { table: 'remote_orchestrator_mutation_queue', column: 'account_id', ddl: 'TEXT' },
  { table: 'remote_orchestrator_mutation_queue', column: 'email_message_id', ddl: 'TEXT' },
  { table: 'remote_orchestrator_mutation_queue', column: 'provider_type', ddl: 'TEXT' },
  { table: 'remote_orchestrator_mutation_queue', column: 'operation', ddl: 'TEXT' },
  { table: 'remote_orchestrator_mutation_queue', column: 'status', ddl: "TEXT DEFAULT 'pending'" },
  { table: 'remote_orchestrator_mutation_queue', column: 'attempts', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'remote_orchestrator_mutation_queue', column: 'last_error', ddl: 'TEXT' },
  { table: 'remote_orchestrator_mutation_queue', column: 'created_at', ddl: 'TEXT' },
  { table: 'remote_orchestrator_mutation_queue', column: 'updated_at', ddl: 'TEXT' },
  // ── inbox_embeddings (referenced by future embedding pipeline) ──
  { table: 'inbox_embeddings', column: 'message_id', ddl: 'TEXT' },
  { table: 'inbox_embeddings', column: 'chunk_index', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'inbox_embeddings', column: 'chunk_text', ddl: "TEXT DEFAULT ''" },
  { table: 'inbox_embeddings', column: 'embedding', ddl: "BLOB DEFAULT X''" },
  { table: 'inbox_embeddings', column: 'source', ddl: "TEXT DEFAULT 'body'" },
  { table: 'inbox_embeddings', column: 'attachment_id', ddl: 'TEXT' },
  // ── inbox_settings (ipc) ──
  { table: 'inbox_settings', column: 'value_json', ddl: "TEXT NOT NULL DEFAULT 'null'" },
  { table: 'inbox_settings', column: 'updated_at', ddl: 'INTEGER NOT NULL DEFAULT 0' },
]

/** Indexes that may be missing if the table predates them; all use IF NOT EXISTS. */
const EMAIL_PIPELINE_INDEX_REPAIRS: ReadonlyArray<string> = [
  `CREATE INDEX IF NOT EXISTS idx_p2p_pending_beap_handshake ON p2p_pending_beap(handshake_id)`,
  `CREATE INDEX IF NOT EXISTS idx_p2p_pending_beap_created ON p2p_pending_beap(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_p2p_pending_beap_processed ON p2p_pending_beap(processed)`,
  `CREATE INDEX IF NOT EXISTS idx_plain_email_inbox_processed ON plain_email_inbox(processed)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_plain_email_inbox_dedup ON plain_email_inbox(account_id, email_message_id)`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_messages_source_type ON inbox_messages(source_type)`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_messages_handshake_id ON inbox_messages(handshake_id)`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_messages_account_id ON inbox_messages(account_id)`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_messages_deleted_purge ON inbox_messages(deleted, purge_after)`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_messages_read_status ON inbox_messages(read_status)`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_messages_received_at ON inbox_messages(received_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_messages_sort_category ON inbox_messages(sort_category)`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_messages_archived ON inbox_messages(archived)`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_messages_pending_delete ON inbox_messages(pending_delete)`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_attachments_message_id ON inbox_attachments(message_id)`,
  `CREATE INDEX IF NOT EXISTS idx_inbox_embeddings_message_id ON inbox_embeddings(message_id)`,
  `CREATE INDEX IF NOT EXISTS idx_deletion_queue_grace_exec_cancel ON deletion_queue(grace_period_ends, executed, cancelled)`,
  `CREATE INDEX IF NOT EXISTS idx_remote_orch_queue_status ON remote_orchestrator_mutation_queue(status, updated_at)`,
]

function tableExistsInDb(db: any, name: string): boolean {
  try {
    const row = db
      .prepare(`SELECT 1 AS x FROM sqlite_master WHERE type='table' AND name=?`)
      .get(name) as { x: number } | undefined
    return !!row
  } catch {
    return false
  }
}

function getColumnNames(db: any, table: string): Set<string> {
  try {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return new Set(rows.map((r) => r.name))
  } catch {
    return new Set()
  }
}

/**
 * Idempotent repairs after versioned migrations — fixes `CREATE IF NOT EXISTS` gaps.
 */
export function ensureEmailPipelineSchemaRepairs(db: any): void {
  if (!db) return

  const columnCache = new Map<string, Set<string>>()
  const colsFor = (table: string): Set<string> => {
    let s = columnCache.get(table)
    if (!s) {
      s = getColumnNames(db, table)
      columnCache.set(table, s)
    }
    return s
  }

  for (const { table, column, ddl } of EMAIL_PIPELINE_COLUMN_REPAIRS) {
    if (!tableExistsInDb(db, table)) continue
    const cols = colsFor(table)
    if (cols.has(column)) continue
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`)
      cols.add(column)
      console.log(`[HANDSHAKE DB] Repaired missing column ${table}.${column}`)
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      if (msg.includes('duplicate column') || msg.includes('duplicate column name')) continue
      console.warn(`[HANDSHAKE DB] Could not add column ${table}.${column}:`, msg)
    }
  }

  for (const sql of EMAIL_PIPELINE_INDEX_REPAIRS) {
    if (!sql) continue
    try {
      db.prepare(sql).run()
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      if (msg.includes('already exists') || msg.includes('duplicate')) continue
      console.warn('[HANDSHAKE DB] Index repair skipped:', msg)
    }
  }
}

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

  ensureEmailPipelineSchemaRepairs(db)
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
    // Align with isHandshakeActive(): ACTIVE rows past expires_at are not listable as active.
    if (filter.state === 'ACTIVE') {
      sql += ' AND (expires_at IS NULL OR expires_at > ?)'
      params.push(new Date().toISOString())
    }
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

// ── Plain Email Inbox (Canon §6 depackaged emails) ──

export interface PendingPlainEmailEntry {
  id: number
  message_json: string
  account_id: string
  email_message_id: string
  created_at: string
}

export function insertPendingPlainEmail(
  db: any,
  accountId: string,
  emailMessageId: string,
  messageJson: string,
): void {
  if (!db) return
  try {
    const now = new Date().toISOString()
    db.prepare(
      `INSERT OR IGNORE INTO plain_email_inbox (message_json, account_id, email_message_id, created_at, processed)
       VALUES (?, ?, ?, ?, 0)`
    ).run(messageJson, accountId, emailMessageId, now)
  } catch (e) {
    console.warn('[DB] insertPendingPlainEmail error:', (e as Error)?.message)
  }
}

export function getPendingPlainEmails(db: any): PendingPlainEmailEntry[] {
  if (!db) return []
  try {
    const rows = db.prepare(
      'SELECT id, message_json, account_id, email_message_id, created_at FROM plain_email_inbox WHERE processed = 0 ORDER BY created_at ASC'
    ).all() as PendingPlainEmailEntry[]
    return rows
  } catch {
    return []
  }
}

export function markPlainEmailProcessed(db: any, id: number): void {
  if (!db) return
  try {
    db.prepare('UPDATE plain_email_inbox SET processed = 1 WHERE id = ?').run(id)
  } catch { /* non-fatal */ }
}

// ── Expiry Helpers ──

/**
 * Expires handshakes past their expires_at deadline.
 *
 * Only PENDING_ACCEPT and ACTIVE states are expired by this job:
 * - PENDING_ACCEPT: initiator waiting for acceptor response
 * - ACTIVE: fully established handshake past its validity window
 *
 * States NOT expired by this job (by design):
 * - ACCEPTED: roundtrip (context exchange) not yet complete — these
 *   should not be silently expired while negotiation is in progress.
 *   Consider a separate cleanup for long-stale ACCEPTED rows if needed.
 * - PENDING_REVIEW: acceptor reviewing imported capsule — same rationale.
 * - DRAFT: local-only, not yet transmitted.
 * - EXPIRED / REVOKED: terminal states, no further transition needed.
 */
export function expirePendingHandshakes(db: any, now: Date): number {
  const result = db.prepare(
    `UPDATE handshakes SET state = 'EXPIRED'
     WHERE state = 'PENDING_ACCEPT' AND expires_at IS NOT NULL AND expires_at < ?`
  ).run(now.toISOString())
  return result.changes
}

/** Companion to {@link expirePendingHandshakes}: transitions ACTIVE → EXPIRED when past expires_at. See module comment above for states intentionally excluded. */
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
