/**
 * Embedding generation and semantic search for context blocks.
 *
 * Embeddings are generated post-commit by a background worker.
 * Failure does NOT roll back block persistence.
 */

import type { ScoredContextBlock } from './types'
import {
  getPendingEmbeddingBlocks,
  markEmbeddingComplete,
  markEmbeddingFailed,
} from './contextBlocks'
import {
  parseGovernanceJson,
  resolveEffectiveGovernance,
  filterBlocksForSearch,
  baselineFromHandshake,
  type LegacyBlockInput,
} from './contextGovernance'
import { getHandshakeRecord } from './db'

export interface LocalEmbeddingService {
  readonly modelId: string;
  generateEmbedding(text: string): Promise<Float32Array>;
}

export async function processEmbeddingQueue(
  db: any,
  embeddingService: LocalEmbeddingService,
  batchSize: number = 50,
): Promise<{ processed: number; failed: number; skipped: number }> {
  const pending = getPendingEmbeddingBlocks(db, batchSize)
  let processed = 0
  let failed = 0
  let skipped = 0

  for (const block of pending) {
    const record = getHandshakeRecord(db, block.handshake_id)
    if (!record) {
      markEmbeddingFailed(db, block.sender_wrdesk_user_id, block.block_id, block.block_hash)
      failed++
      continue
    }

    const legacy: LegacyBlockInput = {
      block_id: block.block_id,
      type: block.type,
      data_classification: block.data_classification,
      scope_id: block.scope_id ?? undefined,
      sender_wrdesk_user_id: block.sender_wrdesk_user_id,
      publisher_id: block.publisher_id ?? block.sender_wrdesk_user_id,
      source: block.source,
    }
    const itemGov = parseGovernanceJson(block.governance_json)
    const governance = resolveEffectiveGovernance(itemGov, legacy, record, record.relationship_id)
    const baseline = baselineFromHandshake(record)
    const searchable = filterBlocksForSearch([{ governance }], baseline)
    if (searchable.length === 0) {
      markEmbeddingComplete(db, block.sender_wrdesk_user_id, block.block_id, block.block_hash)
      skipped++
      continue
    }

    try {
      const embedding = await embeddingService.generateEmbedding(block.payload)

      db.prepare(
        `INSERT INTO context_embeddings (sender_wrdesk_user_id, block_id, block_hash, embedding, model_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        block.sender_wrdesk_user_id,
        block.block_id,
        block.block_hash,
        Buffer.from(embedding.buffer),
        embeddingService.modelId,
        new Date().toISOString(),
      )

      markEmbeddingComplete(db, block.sender_wrdesk_user_id, block.block_id, block.block_hash)
      processed++
    } catch {
      markEmbeddingFailed(db, block.sender_wrdesk_user_id, block.block_id, block.block_hash)
      failed++
    }
  }

  return { processed, failed, skipped }
}

export async function semanticSearch(
  db: any,
  query: string,
  filter: { relationship_id?: string; handshake_id?: string },
  limit: number,
  embeddingService: LocalEmbeddingService,
): Promise<ScoredContextBlock[]> {
  const queryEmbedding = await embeddingService.generateEmbedding(query)

  let sql = `SELECT cb.*, ce.embedding, cb.governance_json
    FROM context_blocks cb
    INNER JOIN context_embeddings ce ON
      cb.sender_wrdesk_user_id = ce.sender_wrdesk_user_id
      AND cb.block_id = ce.block_id
      AND cb.block_hash = ce.block_hash
    WHERE cb.embedding_status = 'complete'`
  const params: any[] = []

  if (filter.relationship_id) {
    sql += ' AND cb.relationship_id = ?'
    params.push(filter.relationship_id)
  }
  if (filter.handshake_id) {
    sql += ' AND cb.handshake_id = ?'
    params.push(filter.handshake_id)
  }

  const rows = db.prepare(sql).all(...params) as any[]

  // Filter by searchable (item-level governance). Exclude blocks denied for search.
  const recordCache = new Map<string, ReturnType<typeof getHandshakeRecord>>()
  const searchableRows = rows.filter((row) => {
    const record = recordCache.get(row.handshake_id) ?? getHandshakeRecord(db, row.handshake_id)
    if (!record) return false
    recordCache.set(row.handshake_id, record)
    const legacy: LegacyBlockInput = {
      block_id: row.block_id,
      type: row.type,
      data_classification: row.data_classification,
      scope_id: row.scope_id ?? undefined,
      sender_wrdesk_user_id: row.sender_wrdesk_user_id,
      publisher_id: row.publisher_id ?? row.sender_wrdesk_user_id,
      source: row.source,
    }
    const itemGov = parseGovernanceJson(row.governance_json)
    const governance = resolveEffectiveGovernance(itemGov, legacy, record, record.relationship_id)
    const baseline = baselineFromHandshake(record)
    return filterBlocksForSearch([{ governance }], baseline).length > 0
  })

  // Compute cosine similarity in memory
  const scored: ScoredContextBlock[] = searchableRows.map(row => {
    const stored = new Float32Array(
      (row.embedding as Buffer).buffer,
      (row.embedding as Buffer).byteOffset,
      (row.embedding as Buffer).byteLength / 4,
    )
    const score = cosineSimilarity(queryEmbedding, stored)
    return {
      block_id: row.block_id,
      block_hash: row.block_hash,
      relationship_id: row.relationship_id,
      handshake_id: row.handshake_id,
      scope_id: row.scope_id ?? undefined,
      type: row.type,
      data_classification: row.data_classification,
      version: row.version,
      valid_until: row.valid_until ?? undefined,
      source: row.source,
      sender_wrdesk_user_id: row.sender_wrdesk_user_id,
      embedding_status: row.embedding_status,
      payload_ref: row.payload,
      score,
    }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}
