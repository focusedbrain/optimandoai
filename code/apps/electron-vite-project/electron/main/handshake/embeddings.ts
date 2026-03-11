/**
 * Embedding generation and semantic search for context blocks.
 *
 * Embeddings are generated post-commit by a background worker.
 * Failure does NOT roll back block persistence.
 */

import type { ScoredContextBlock } from './types'

export interface LocalEmbeddingService {
  readonly modelId: string;
  generateEmbedding(text: string): Promise<Float32Array>;
}

// ── Ollama Embedding Service ──

const DEFAULT_EMBED_MODEL = 'nomic-embed-text'

/**
 * LocalEmbeddingService implementation using Ollama's embedding API.
 * Requires Ollama running with an embedding model (e.g. nomic-embed-text) installed.
 */
export class OllamaEmbeddingService implements LocalEmbeddingService {
  readonly modelId: string
  private baseUrl: string

  constructor(modelId: string = DEFAULT_EMBED_MODEL, baseUrl: string = 'http://127.0.0.1:11434') {
    this.modelId = modelId
    this.baseUrl = baseUrl
  }

  async generateEmbedding(text: string): Promise<Float32Array> {
    const url = `${this.baseUrl}/api/embed`
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.modelId,
        input: text || ' ',
      }),
    })
    if (!response.ok) {
      throw new Error(`Ollama embedding failed: ${response.status} ${response.statusText}`)
    }
    const data = (await response.json()) as { embedding?: number[]; embeddings?: Array<{ embedding?: number[] }> }
    const raw = data.embedding ?? data.embeddings?.[0]?.embedding ?? data.embeddings?.[0]
    if (!Array.isArray(raw)) {
      throw new Error('Ollama embedding response missing embedding array')
    }
    return new Float32Array(raw)
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      })
      return res.ok
    } catch {
      return false
    }
  }
}

let _embeddingServiceInstance: OllamaEmbeddingService | null = null

/** Get or create the singleton embedding service instance. */
export function getOrCreateEmbeddingService(): OllamaEmbeddingService {
  if (!_embeddingServiceInstance) {
    _embeddingServiceInstance = new OllamaEmbeddingService()
  }
  return _embeddingServiceInstance
}

// ── Semantic Search & Queue ──
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

/**
 * Semantic search: prefers capsule_blocks (import-time indexed).
 * Falls back to context_blocks + context_embeddings when capsule_blocks is empty.
 * At query time: only searches the index — no capsule parsing.
 */
export async function semanticSearch(
  db: any,
  query: string,
  filter: { relationship_id?: string; handshake_id?: string },
  limit: number,
  embeddingService: LocalEmbeddingService,
): Promise<ScoredContextBlock[]> {
  const queryEmbedding = await embeddingService.generateEmbedding(query)

  // Prefer capsule_blocks (import-time indexed). Join with context_blocks for governance.
  // For chunks, parent_block_id links to the originating context_block.
  let sqlCapsule = `SELECT cpb.block_id, cpb.block_hash, cpb.handshake_id, cpb.relationship_id,
      cpb.source, cpb.text, cpb.embedding, cpb.block_type, ctx.scope_id, ctx.type, ctx.data_classification,
      ctx.version, ctx.valid_until, ctx.sender_wrdesk_user_id, ctx.publisher_id, ctx.governance_json
    FROM capsule_blocks cpb
    INNER JOIN context_blocks ctx ON
      ctx.handshake_id = cpb.handshake_id
      AND ctx.block_id = COALESCE(cpb.parent_block_id, cpb.block_id)
    WHERE 1=1`
  const paramsCapsule: any[] = []
  if (filter.relationship_id) {
    sqlCapsule += ' AND cpb.relationship_id = ?'
    paramsCapsule.push(filter.relationship_id)
  }
  if (filter.handshake_id) {
    sqlCapsule += ' AND cpb.handshake_id = ?'
    paramsCapsule.push(filter.handshake_id)
  }

  const capsuleRows = db.prepare(sqlCapsule).all(...paramsCapsule) as any[]

  let rows: any[]
  let useTextAsPayload: boolean

  if (capsuleRows.length > 0) {
    rows = capsuleRows
    useTextAsPayload = true
  } else {
    // Fallback: context_blocks + context_embeddings (legacy path)
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
    rows = db.prepare(sql).all(...params) as any[]
    useTextAsPayload = false
  }

  // Filter by searchable (item-level governance)
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

  // Embedding dimension must match: stored blocks use one model (e.g. Ollama nomic).
  // If query uses different model (e.g. OpenAI), dimensions differ → return no results.
  const storedDim = searchableRows.length > 0
    ? (searchableRows[0].embedding as Buffer).byteLength / 4
    : 0
  if (storedDim > 0 && queryEmbedding.length !== storedDim) {
    return []
  }

  const scored: ScoredContextBlock[] = searchableRows.map(row => {
    const stored = new Float32Array(
      (row.embedding as Buffer).buffer,
      (row.embedding as Buffer).byteOffset,
      (row.embedding as Buffer).byteLength / 4,
    )
    const score = cosineSimilarity(queryEmbedding, stored)
    const payloadRef = useTextAsPayload ? row.text : row.payload
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
      embedding_status: 'complete',
      payload_ref: payloadRef,
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
