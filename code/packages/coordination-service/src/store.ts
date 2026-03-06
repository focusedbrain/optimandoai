/**
 * Coordination Service — Capsule storage (SQLite)
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

let db: Database.Database | null = null

export function initStore(config: CoordinationConfig): void {
  if (db) return
  db = new Database(config.db_path)
  db.exec(SCHEMA)
}

export function closeStore(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function getDb(): Database.Database | null {
  return db
}

export function storeCapsule(
  id: string,
  handshakeId: string,
  senderUserId: string,
  recipientUserId: string,
  capsuleJson: string,
  retentionDays: number,
): void {
  if (!db) return
  const now = new Date().toISOString()
  const expires = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000).toISOString()
  db.prepare(
    `INSERT INTO coordination_capsules (id, handshake_id, sender_user_id, recipient_user_id, capsule_json, received_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, handshakeId, senderUserId, recipientUserId, capsuleJson, now, expires)
}

export function getPendingCapsules(userId: string): Array<{ id: string; capsule_json: string }> {
  if (!db) return []
  const rows = db.prepare(
    `SELECT id, capsule_json FROM coordination_capsules
     WHERE recipient_user_id = ? AND acknowledged_at IS NULL AND expires_at > ?
     ORDER BY received_at ASC`,
  ).all(userId, new Date().toISOString()) as Array<{ id: string; capsule_json: string }>
  return rows
}

export function markPushed(id: string): void {
  if (!db) return
  const now = new Date().toISOString()
  db.prepare(`UPDATE coordination_capsules SET pushed_at = ? WHERE id = ?`).run(now, id)
}

/**
 * Acknowledge capsules for the given recipient. Only capsules where recipient_user_id = userId
 * are updated. Returns the count of actually acknowledged rows.
 * Logs ACK_UNAUTHORIZED if user tries to ACK capsules that don't belong to them.
 */
export function acknowledgeCapsules(ids: string[], userId: string): number {
  if (!db || ids.length === 0) return 0
  const now = new Date().toISOString()
  const stmt = db.prepare(
    `UPDATE coordination_capsules SET acknowledged_at = ? WHERE id = ? AND recipient_user_id = ?`,
  )
  let acknowledged = 0
  for (const id of ids) {
    const r = stmt.run(now, id, userId)
    if (r.changes > 0) acknowledged++
  }
  const unauthorized = ids.length - acknowledged
  if (unauthorized > 0) {
    console.warn('[Coordination] ACK_UNAUTHORIZED', { user_id: userId, capsule_ids: ids, unauthorized })
  }
  return acknowledged
}

export function countPending(): number {
  if (!db) return 0
  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM coordination_capsules WHERE acknowledged_at IS NULL AND expires_at > ?`,
  ).get(new Date().toISOString()) as { cnt: number }
  return row?.cnt ?? 0
}

export function countPendingForRecipient(recipientUserId: string): number {
  if (!db) return 0
  const row = db.prepare(
    `SELECT COUNT(*) as cnt FROM coordination_capsules
     WHERE recipient_user_id = ? AND acknowledged_at IS NULL AND expires_at > ?`,
  ).get(recipientUserId, new Date().toISOString()) as { cnt: number }
  return row?.cnt ?? 0
}

export function cleanupExpired(): number {
  if (!db) return 0
  const now = new Date().toISOString()
  const r = db.prepare(`DELETE FROM coordination_capsules WHERE expires_at < ?`).run(now)
  return r.changes
}

export function cleanupAcknowledged(): number {
  if (!db) return 0
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const r = db.prepare(`DELETE FROM coordination_capsules WHERE acknowledged_at IS NOT NULL AND acknowledged_at < ?`).run(cutoff)
  return r.changes
}
