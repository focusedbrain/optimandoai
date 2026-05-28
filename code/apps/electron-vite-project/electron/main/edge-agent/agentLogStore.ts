/**
 * Local persistence for Agent log events received over P2P (PR7).
 */

import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { AgentLogEvent } from '@repo/agent-log-events'

const require = createRequire(import.meta.url)
let Database: typeof import('better-sqlite3').default | null = null
try {
  const D = require('better-sqlite3') as typeof import('better-sqlite3').default
  const probe = new D(':memory:')
  probe.close()
  Database = D
} catch {
  Database = null
}

const MAX_EVENTS_PER_AGENT = 50_000
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export interface StoredAgentLogEvent extends AgentLogEvent {
  agent_handshake_id: string
  received_at_iso: string
}

export interface AgentLogQuery {
  handshakeId: string
  limit?: number
  offset?: number
  levels?: string[]
  sources?: string[]
  eventCodeContains?: string
  sinceIso?: string
  untilIso?: string
}

function resolveDbPath(userDataDir: string): string {
  return join(userDataDir, 'agent-log-events.sqlite')
}

export function openAgentLogStore(userDataDir: string): import('better-sqlite3').Database | null {
  if (!Database) return null
  const db = new Database(resolveDbPath(userDataDir))
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_log_events (
      event_id TEXT PRIMARY KEY,
      agent_handshake_id TEXT NOT NULL,
      timestamp_iso TEXT NOT NULL,
      level TEXT NOT NULL,
      source TEXT NOT NULL,
      event_code TEXT NOT NULL,
      message TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      received_at_iso TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_log_handshake_time
      ON agent_log_events (agent_handshake_id, timestamp_iso DESC);
  `)
  return db
}

export function insertAgentLogEvents(
  db: import('better-sqlite3').Database,
  handshakeId: string,
  events: AgentLogEvent[],
): number {
  if (events.length === 0) return 0
  const receivedAt = new Date().toISOString()
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO agent_log_events (
      event_id, agent_handshake_id, timestamp_iso, level, source, event_code, message, fields_json, received_at_iso
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const tx = db.transaction((rows: AgentLogEvent[]) => {
    let n = 0
    for (const ev of rows) {
      const info = stmt.run(
        ev.event_id,
        handshakeId,
        ev.timestamp_iso,
        ev.level,
        ev.source,
        ev.event_code,
        ev.message,
        JSON.stringify(ev.fields ?? {}),
        receivedAt,
      )
      n += info.changes
    }
    return n
  })
  const inserted = tx(events)
  pruneAgentLogStore(db, handshakeId)
  return inserted
}

export function pruneAgentLogStore(
  db: import('better-sqlite3').Database,
  handshakeId: string,
): void {
  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString()
  db.prepare(
    `DELETE FROM agent_log_events WHERE agent_handshake_id = ? AND timestamp_iso < ?`,
  ).run(handshakeId, cutoff)

  const countRow = db
    .prepare(`SELECT COUNT(*) AS c FROM agent_log_events WHERE agent_handshake_id = ?`)
    .get(handshakeId) as { c: number }
  const extra = countRow.c - MAX_EVENTS_PER_AGENT
  if (extra > 0) {
    db.prepare(
      `DELETE FROM agent_log_events WHERE event_id IN (
        SELECT event_id FROM agent_log_events WHERE agent_handshake_id = ?
        ORDER BY timestamp_iso ASC LIMIT ?
      )`,
    ).run(handshakeId, extra)
  }
}

export function queryAgentLogEvents(
  db: import('better-sqlite3').Database,
  q: AgentLogQuery,
): StoredAgentLogEvent[] {
  const clauses = ['agent_handshake_id = ?']
  const params: unknown[] = [q.handshakeId]
  if (q.levels?.length) {
    clauses.push(`level IN (${q.levels.map(() => '?').join(',')})`)
    params.push(...q.levels)
  }
  if (q.sources?.length) {
    clauses.push(`source IN (${q.sources.map(() => '?').join(',')})`)
    params.push(...q.sources)
  }
  if (q.eventCodeContains?.trim()) {
    clauses.push('event_code LIKE ?')
    params.push(`%${q.eventCodeContains.trim()}%`)
  }
  if (q.sinceIso) {
    clauses.push('timestamp_iso >= ?')
    params.push(q.sinceIso)
  }
  if (q.untilIso) {
    clauses.push('timestamp_iso <= ?')
    params.push(q.untilIso)
  }
  const limit = Math.min(Math.max(q.limit ?? 100, 1), 500)
  const offset = Math.max(q.offset ?? 0, 0)
  params.push(limit, offset)
  const rows = db
    .prepare(
      `SELECT * FROM agent_log_events WHERE ${clauses.join(' AND ')}
       ORDER BY timestamp_iso DESC LIMIT ? OFFSET ?`,
    )
    .all(...params) as Array<Record<string, unknown>>

  return rows.map((r) => ({
    event_id: String(r.event_id),
    timestamp_iso: String(r.timestamp_iso),
    level: r.level as AgentLogEvent['level'],
    source: r.source as AgentLogEvent['source'],
    event_code: String(r.event_code),
    message: String(r.message),
    fields: JSON.parse(String(r.fields_json ?? '{}')) as AgentLogEvent['fields'],
    schema_version: 1,
    agent_handshake_id: String(r.agent_handshake_id),
    received_at_iso: String(r.received_at_iso),
  }))
}

export function getAgentLogPollCursor(userDataDir: string, handshakeId: string): string | null {
  const path = join(userDataDir, `agent-log-cursor-${handshakeId}.json`)
  try {
    const raw = require('node:fs').readFileSync(path, 'utf8')
    const parsed = JSON.parse(raw) as { after_event_id?: string }
    return typeof parsed.after_event_id === 'string' ? parsed.after_event_id : null
  } catch {
    return null
  }
}

export function saveAgentLogPollCursor(
  userDataDir: string,
  handshakeId: string,
  afterEventId: string | null,
): void {
  const fs = require('node:fs') as typeof import('node:fs')
  const path = join(userDataDir, `agent-log-cursor-${handshakeId}.json`)
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path, JSON.stringify({ after_event_id: afterEventId }), 'utf8')
}
