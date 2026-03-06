/**
 * SQLite storage for relay capsules and handshake registry.
 */

import Database from 'better-sqlite3'
import type { RelayConfig } from './config.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS relay_capsules (
  id TEXT PRIMARY KEY,
  handshake_id TEXT NOT NULL,
  capsule_json TEXT NOT NULL,
  sender_ip TEXT,
  received_at TEXT NOT NULL,
  acknowledged_at TEXT,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_relay_capsules_handshake ON relay_capsules(handshake_id);
CREATE INDEX IF NOT EXISTS idx_relay_capsules_unacked ON relay_capsules(acknowledged_at) WHERE acknowledged_at IS NULL;

CREATE TABLE IF NOT EXISTS relay_handshake_registry (
  handshake_id TEXT PRIMARY KEY,
  expected_token TEXT NOT NULL,
  counterparty_email TEXT,
  created_at TEXT NOT NULL
);
`

let db: Database.Database | null = null

export function initStore(config: RelayConfig): void {
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

export function getDb(): Database.Database {
  if (!db) throw new Error('Store not initialized')
  return db
}

function generateId(): string {
  const hex = '0123456789abcdef'
  let id = 'relay-msg-'
  for (let i = 0; i < 16; i++) {
    id += hex[Math.floor(Math.random() * 16)]
  }
  return id
}

export function storeCapsule(
  handshakeId: string,
  capsuleJson: string,
  senderIp: string | null,
  maxAgeDays: number,
  expiresAt?: string,
): string {
  const d = getDb()
  const id = generateId()
  const now = new Date().toISOString()
  const expires = expiresAt ?? new Date(Date.now() + maxAgeDays * 24 * 60 * 60 * 1000).toISOString()
  d.prepare(
    `INSERT INTO relay_capsules (id, handshake_id, capsule_json, sender_ip, received_at, acknowledged_at, expires_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
  ).run(id, handshakeId, capsuleJson, senderIp ?? null, now, expires)
  return id
}

export interface RelayCapsuleRow {
  id: string
  handshake_id: string
  capsule_json: string
  sender_ip: string | null
  received_at: string
  acknowledged_at: string | null
  expires_at: string
}

export function getUnacknowledgedCapsules(): RelayCapsuleRow[] {
  const d = getDb()
  const rows = d.prepare(
    `SELECT id, handshake_id, capsule_json, sender_ip, received_at, acknowledged_at, expires_at
     FROM relay_capsules WHERE acknowledged_at IS NULL ORDER BY received_at ASC`,
  ).all() as RelayCapsuleRow[]
  return rows
}

export function acknowledgeCapsules(ids: string[]): number {
  if (ids.length === 0) return 0
  const d = getDb()
  const now = new Date().toISOString()
  const stmt = d.prepare(`UPDATE relay_capsules SET acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL`)
  let count = 0
  for (const id of ids) {
    const r = stmt.run(now, id)
    count += r.changes
  }
  return count
}

export function cleanupExpired(): number {
  const d = getDb()
  const now = new Date().toISOString()
  const r = d.prepare(`DELETE FROM relay_capsules WHERE expires_at < ?`).run(now)
  return r.changes
}

export function registerHandshake(
  handshakeId: string,
  expectedToken: string,
  counterpartyEmail?: string | null,
): void {
  const d = getDb()
  const now = new Date().toISOString()
  d.prepare(
    `INSERT INTO relay_handshake_registry (handshake_id, expected_token, counterparty_email, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(handshake_id) DO UPDATE SET expected_token = excluded.expected_token, counterparty_email = excluded.counterparty_email`,
  ).run(handshakeId, expectedToken, counterpartyEmail ?? null, now)
}

export function lookupHandshakeToken(handshakeId: string): string | null {
  const d = getDb()
  const row = d.prepare(`SELECT expected_token FROM relay_handshake_registry WHERE handshake_id = ?`).get(handshakeId) as { expected_token: string } | undefined
  return row?.expected_token ?? null
}

export function countUnacknowledged(): number {
  const d = getDb()
  const row = d.prepare(`SELECT COUNT(*) as c FROM relay_capsules WHERE acknowledged_at IS NULL`).get() as { c: number }
  return row?.c ?? 0
}
