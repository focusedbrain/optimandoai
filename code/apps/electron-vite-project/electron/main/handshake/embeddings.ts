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

export interface LocalEmbeddingService {
  readonly modelId: string;
  generateEmbedding(text: string): Promise<Float32Array>;
}

export async function processEmbeddingQueue(
  db: any,
  embeddingService: LocalEmbeddingService,
  batchSize: number = 50,
): Promise<{ processed: number; failed: number }> {
  const pending = getPendingEmbeddingBlocks(db, batchSize)
  let processed = 0
  let failed = 0

  for (const block of pending) {
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

  return { processed, failed }
}

export async function semanticSearch(
  db: any,
  query: string,
  filter: { relationship_id?: string; handshake_id?: string },
  limit: number,
  embeddingService: LocalEmbeddingService,
): Promise<ScoredContextBlock[]> {
  const queryEmbedding = await embeddingService.generateEmbedding(query)

  let sql = `SELECT cb.*, ce.embedding
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

  // Compute cosine similarity in memory
  const scored: ScoredContextBlock[] = rows.map(row => {
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
