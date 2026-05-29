/**
 * Regression: migration v71 must copy 22-column inbox_attachments (post-v64 seal columns)
 * into inbox_attachments_v71 without column-count mismatch.
 */

import { describe, test, expect } from 'vitest'
import { createRequire } from 'module'
import { randomUUID } from 'node:crypto'
import {
  getHandshakeMigration,
  migrateHandshakeTables,
  migrateHandshakeTablesUpTo,
} from '../db'

const _require = createRequire(import.meta.url)
let Database: any
let sqliteAvailable = false

try {
  Database = _require('better-sqlite3')
  const probe = new Database(':memory:')
  probe.close()
  sqliteAvailable = true
} catch {
  console.warn('[inboxAttachmentsV71.migration] better-sqlite3 not available — tests skipped')
}

const V71_COPY_COLUMNS = [
  'id',
  'message_id',
  'filename',
  'content_type',
  'size_bytes',
  'content_id',
  'storage_path',
  'extracted_text',
  'text_extraction_status',
  'raster_path',
  'embedding_status',
  'created_at',
  'text_extraction_error',
  'content_sha256',
  'extracted_text_sha256',
  'encryption_key',
  'encryption_iv',
  'encryption_tag',
  'storage_encrypted',
  'page_count',
  'seal',
  'seal_input_json',
] as const

const V71_TEXT_EXTRACTION_CHECK_VALUES = [
  'pending',
  'done',
  'failed',
  'skipped',
  'partial',
  'consent_required',
  'edge_extracted',
  'host_extracted_with_consent',
] as const

function parseInsertColumns(sql: string): string[] {
  const match = sql.match(/INSERT INTO inbox_attachments_v71\s*\(([\s\S]*?)\)\s*SELECT/i)
  if (!match) throw new Error('v71 INSERT column list not found')
  return match[1]
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
}

function parseSelectColumns(sql: string): string[] {
  const match = sql.match(/\)\s*SELECT\s*([\s\S]*?)\s*FROM inbox_attachments/i)
  if (!match) throw new Error('v71 SELECT column list not found')
  return match[1]
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
}

describe.skipIf(!sqliteAvailable)('handshake migration v71 — inbox_attachments', () => {
  test('INSERT/SELECT explicit columns match CREATE target count (22)', () => {
    const migration = getHandshakeMigration(71)
    expect(migration).toBeDefined()
    const insertSql = migration!.sql[1]
    const createSql = migration!.sql[0]

    const insertCols = parseInsertColumns(insertSql)
    const selectCols = parseSelectColumns(insertSql)
    expect(insertCols).toEqual([...V71_COPY_COLUMNS])
    expect(selectCols).toEqual([...V71_COPY_COLUMNS])
    expect(insertCols.length).toBe(22)
    expect(selectCols.length).toBe(22)

    const db = new Database(':memory:')
    db.exec(createSql)
    const tableCols = db
      .prepare(`PRAGMA table_info(inbox_attachments_v71)`)
      .all() as Array<{ name: string }>
    expect(tableCols.map((c) => c.name)).toEqual([...V71_COPY_COLUMNS])
    db.close()
  })

  test('preserves widened text_extraction_status CHECK values', () => {
    const migration = getHandshakeMigration(71)
    const createSql = migration!.sql[0]
    for (const value of V71_TEXT_EXTRACTION_CHECK_VALUES) {
      expect(createSql).toContain(`'${value}'`)
    }
  })

  test('applies v71 on a DB migrated through v64 (22-column source)', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')

    migrateHandshakeTablesUpTo(db, 70)

    const preCols = db
      .prepare(`PRAGMA table_info(inbox_attachments)`)
      .all() as Array<{ name: string }>
    expect(preCols.length).toBe(22)
    expect(preCols.map((c) => c.name)).toContain('seal')
    expect(preCols.map((c) => c.name)).toContain('seal_input_json')

    const pre71 = db
      .prepare(`SELECT version FROM handshake_schema_migrations WHERE version = 71`)
      .get()
    expect(pre71).toBeUndefined()

    const messageId = randomUUID()
    db.prepare(
      `INSERT INTO inbox_messages (id, source_type, subject, body_text) VALUES (?, 'email_plain', 't', 'b')`,
    ).run(messageId)
    db.prepare(
      `INSERT INTO inbox_attachments (
        id, message_id, filename, text_extraction_status, seal, seal_input_json
      ) VALUES (?, ?, 'f.pdf', 'pending', 'seal-val', '{"row":"x"}')`,
    ).run(randomUUID(), messageId)

    migrateHandshakeTables(db)

    const applied71 = db
      .prepare(`SELECT version FROM handshake_schema_migrations WHERE version = 71`)
      .get() as { version: number }
    expect(applied71?.version).toBe(71)

    const postCols = db
      .prepare(`PRAGMA table_info(inbox_attachments)`)
      .all() as Array<{ name: string }>
    expect(postCols.length).toBe(22)
    expect(postCols.map((c) => c.name)).toContain('seal')

    const row = db
      .prepare(`SELECT seal, seal_input_json FROM inbox_attachments WHERE message_id = ?`)
      .get(messageId) as { seal: string; seal_input_json: string }
    expect(row.seal).toBe('seal-val')
    expect(row.seal_input_json).toBe('{"row":"x"}')

    db.close()
  })
})
