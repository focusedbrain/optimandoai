/**
 * Coordination Service — Capsule storage (SQLite)
 * Fail-close: throws when storage is unavailable.
 */

import Database from 'better-sqlite3'
import type { CoordinationConfig } from './config.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS coordination_capsules (
  id TEXT PRIMARY KEY,
  handshake_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  capsule_json TEXT NOT NULL,
  received_at TEXT NOT NULL,
  pushed_at TEXT,
  acknowledged_at TEXT,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_coord_recipient ON coordination_capsules(recipient_user_id, acknowledged_at);
CREATE INDEX IF NOT EXISTS idx_coord_expires ON coordination_capsules(expires_at);

CREATE TABLE IF NOT EXISTS coordination_handshake_registry (
  handshake_id TEXT PRIMARY KEY,
  initiator_user_id TEXT NOT NULL,
  acceptor_user_id TEXT NOT NULL,
  initiator_email TEXT,
  acceptor_email TEXT,
  initiator_device_id TEXT,
  acceptor_device_id TEXT,
  initiator_device_role TEXT,
  acceptor_device_role TEXT,
  initiator_device_name TEXT,
  acceptor_device_name TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS coordination_token_cache (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  tier TEXT NOT NULL,
  validated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`

function applyHandshakeRegistryMigrations(db: Database.Database): void {
  const cols = db
    .prepare(`PRAGMA table_info(coordination_handshake_registry)`)
    .all() as Array<{ name: string }>
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('initiator_device_id')) {
    db.exec(
      'ALTER TABLE coordination_handshake_registry ADD COLUMN initiator_device_id TEXT DEFAULT NULL',
    )
  }
  if (!names.has('acceptor_device_id')) {
    db.exec(
      'ALTER TABLE coordination_handshake_registry ADD COLUMN acceptor_device_id TEXT DEFAULT NULL',
    )
  }
  for (const col of [
    'initiator_device_role',
    'acceptor_device_role',
    'initiator_device_name',
    'acceptor_device_name',
  ] as const) {
    if (!names.has(col)) {
      db.exec(
        `ALTER TABLE coordination_handshake_registry ADD COLUMN ${col} TEXT DEFAULT NULL`,
      )
    }
  }
}

export interface StoreAdapter {
  init(): void
  close(): void
  checkHealth(): Promise<boolean>
  storeCapsule(
    id: string,
    handshakeId: string,
    senderUserId: string,
    recipientUserId: string,
    capsuleJson: string,
    retentionDays: number,
  ): void
  getPendingCapsules(userId: string, email?: string | null): Array<{ id: string; capsule_json: string }>
  markPushed(id: string): void
  acknowledgeCapsules(ids: string[], userId: string, email?: string | null): number
  countPending(): number
  countPendingForRecipient(recipientUserId: string): number
  cleanupExpired(): number
  cleanupAcknowledged(): number
  cleanupStaleHandshakes(ttlSeconds: number): number
  getDb(): Database.Database
}

export function createStore(config: CoordinationConfig): StoreAdapter {
  let db: Database.Database | null = null

  function ensureDb(): Database.Database {
    if (!db) throw new Error('Storage unavailable')
    return db
  }

  return {
    init() {
      if (db) return
      db = new Database(config.db_path)
      db.exec(SCHEMA)
      applyHandshakeRegistryMigrations(db)
    },

    close() {
      if (db) {
        db.close()
        db = null
      }
    },

    async checkHealth(): Promise<boolean> {
      if (!db) return false
      try {
        db.prepare('SELECT 1').get()
        return true
      } catch {
        return false
      }
    },

    storeCapsule(
      id: string,
      handshakeId: string,
      senderUserId: string,
      recipientUserId: string,
      capsuleJson: string,
      retentionDays: number,
    ): void {
      const d = ensureDb()
      const now = new Date().toISOString()
      const expires = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString()
      d.prepare(
        `INSERT INTO coordination_capsules (id, handshake_id, sender_user_id, recipient_user_id, capsule_json, received_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, handshakeId, senderUserId, recipientUserId, capsuleJson, now, expires)
    },

    getPendingCapsules(userId: string, email?: string | null): Array<{ id: string; capsule_json: string }> {
      const d = ensureDb()
      const now = new Date().toISOString()
      if (email?.includes('@')) {
        const rows = d.prepare(
          `SELECT id, capsule_json FROM coordination_capsules
           WHERE (recipient_user_id = ? OR recipient_user_id = ?) AND acknowledged_at IS NULL AND expires_at > ?
           ORDER BY received_at ASC`,
        ).all(userId, email, now) as Array<{ id: string; capsule_json: string }>
        return rows
      }
      const rows = d.prepare(
        `SELECT id, capsule_json FROM coordination_capsules
         WHERE recipient_user_id = ? AND acknowledged_at IS NULL AND expires_at > ?
         ORDER BY received_at ASC`,
      ).all(userId, now) as Array<{ id: string; capsule_json: string }>
      return rows
    },

    markPushed(id: string): void {
      const d = ensureDb()
      const now = new Date().toISOString()
      d.prepare(`UPDATE coordination_capsules SET pushed_at = ? WHERE id = ?`).run(now, id)
    },

    acknowledgeCapsules(ids: string[], userId: string, email?: string | null): number {
      const d = ensureDb()
      if (ids.length === 0) return 0
      const now = new Date().toISOString()
      const allowedRecipients = email?.includes('@') ? [userId, email] : [userId]
      let acknowledged = 0
      for (const id of ids) {
        for (const recipient of allowedRecipients) {
          const r = d.prepare(
            `UPDATE coordination_capsules SET acknowledged_at = ? WHERE id = ? AND recipient_user_id = ?`,
          ).run(now, id, recipient)
          if (r.changes > 0) {
            acknowledged++
            break
          }
        }
      }
      const unauthorized = ids.length - acknowledged
      if (unauthorized > 0) {
        console.warn('[Coordination] ACK_UNAUTHORIZED', { user_id: userId, capsule_ids: ids, unauthorized })
      }
      return acknowledged
    },

    countPending(): number {
      const d = ensureDb()
      const row = d.prepare(
        `SELECT COUNT(*) as cnt FROM coordination_capsules WHERE acknowledged_at IS NULL AND expires_at > ?`,
      ).get(new Date().toISOString()) as { cnt: number }
      return row?.cnt ?? 0
    },

    countPendingForRecipient(recipientUserId: string): number {
      const d = ensureDb()
      const row = d.prepare(
        `SELECT COUNT(*) as cnt FROM coordination_capsules
         WHERE recipient_user_id = ? AND acknowledged_at IS NULL AND expires_at > ?`,
      ).get(recipientUserId, new Date().toISOString()) as { cnt: number }
      return row?.cnt ?? 0
    },

    cleanupExpired(): number {
      const d = ensureDb()
      const now = new Date().toISOString()
      const r = d.prepare(`DELETE FROM coordination_capsules WHERE expires_at < ?`).run(now)
      return r.changes
    },

    cleanupAcknowledged(): number {
      const d = ensureDb()
      const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()
      const r = d.prepare(`DELETE FROM coordination_capsules WHERE acknowledged_at IS NOT NULL AND acknowledged_at < ?`).run(cutoff)
      return r.changes
    },

    cleanupStaleHandshakes(ttlSeconds: number): number {
      const d = ensureDb()
      const cutoff = new Date(Date.now() - ttlSeconds * 1000).toISOString()
      const r = d.prepare(`DELETE FROM coordination_handshake_registry WHERE created_at < ?`).run(cutoff)
      return r.changes
    },

    getDb(): Database.Database {
      return ensureDb()
    },
  }
}
