/**
 * Context block persistence, dedup, and query.
 *
 * Dedup key: (sender_wrdesk_user_id, block_id, block_hash).
 * Same block_id + different hash = new version (both stored).
 * Same block_id + same hash = skip insert (dedup).
 */

import type { ContextBlockInput, ContextBlock, PersistResult } from './types'

export function persistContextBlocks(
  db: any,
  handshakeId: string,
  blocks: ContextBlockInput[],
  source: 'received' | 'sent',
  senderUserId: string,
): PersistResult {
  let inserted = 0
  let deduplicated = 0

  const stmt = db.prepare(
    `INSERT OR IGNORE INTO context_blocks (
      sender_wrdesk_user_id, block_id, block_hash,
      relationship_id, handshake_id, scope_id, type,
      data_classification, version, valid_until,
      source, payload, embedding_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  )

  const now = new Date().toISOString()

  for (const block of blocks) {
    const result = stmt.run(
      senderUserId,
      block.block_id,
      block.block_hash,
      block.relationship_id,
      handshakeId,
      block.scope_id ?? null,
      block.type,
      block.data_classification,
      block.version,
      block.valid_until ?? null,
      source,
      block.payload,
      now,
    )
    if (result.changes > 0) {
      inserted++
    } else {
      deduplicated++
    }
  }

  return { inserted, deduplicated }
}

export function queryContextBlocks(
  db: any,
  filter: {
    relationship_id?: string;
    handshake_id?: string;
    type?: string;
    scope_id?: string;
  },
): ContextBlock[] {
  let sql = `SELECT
    sender_wrdesk_user_id, block_id, block_hash,
    relationship_id, handshake_id, scope_id, type,
    data_classification, version, valid_until,
    source, payload AS payload_ref, embedding_status
  FROM context_blocks WHERE 1=1`
  const params: any[] = []

  if (filter.relationship_id) {
    sql += ' AND relationship_id = ?'
    params.push(filter.relationship_id)
  }
  if (filter.handshake_id) {
    sql += ' AND handshake_id = ?'
    params.push(filter.handshake_id)
  }
  if (filter.type) {
    sql += ' AND type = ?'
    params.push(filter.type)
  }
  if (filter.scope_id) {
    sql += ' AND scope_id = ?'
    params.push(filter.scope_id)
  }

  sql += ' ORDER BY version DESC'

  return db.prepare(sql).all(...params) as ContextBlock[]
}

export function getBlockCountForHandshake(db: any, handshakeId: string): number {
  const row = db.prepare(
    'SELECT COUNT(*) as cnt FROM context_blocks WHERE handshake_id = ?'
  ).get(handshakeId) as { cnt: number }
  return row.cnt
}

export function getPendingEmbeddingBlocks(
  db: any,
  limit: number = 50,
): Array<{ sender_wrdesk_user_id: string; block_id: string; block_hash: string; payload: string }> {
  return db.prepare(
    `SELECT sender_wrdesk_user_id, block_id, block_hash, payload
     FROM context_blocks
     WHERE embedding_status = 'pending'
     LIMIT ?`
  ).all(limit)
}

export function markEmbeddingComplete(
  db: any,
  senderUserId: string,
  blockId: string,
  blockHash: string,
): void {
  db.prepare(
    `UPDATE context_blocks SET embedding_status = 'complete'
     WHERE sender_wrdesk_user_id = ? AND block_id = ? AND block_hash = ?`
  ).run(senderUserId, blockId, blockHash)
}

export function markEmbeddingFailed(
  db: any,
  senderUserId: string,
  blockId: string,
  blockHash: string,
): void {
  db.prepare(
    `UPDATE context_blocks SET embedding_status = 'failed'
     WHERE sender_wrdesk_user_id = ? AND block_id = ? AND block_hash = ?`
  ).run(senderUserId, blockId, blockHash)
}
