/**
 * Capsule Block Indexer — Import-Time Indexing
 *
 * All indexing (parse, extract, embed, store) happens during capsule import.
 * At query time, only capsule_blocks is searched — no parsing.
 *
 * Supports:
 * - Deterministic vault profiles (opening_hours, contact, company, etc.)
 * - Large unstructured attachments (chunked 500–800 tokens)
 * - Full traceability via source_path, chunk_index
 */

import { extractBlocks } from './blockExtraction'

export interface LocalEmbeddingService {
  readonly modelId: string
  generateEmbedding(text: string): Promise<Float32Array>
}

export interface IndexCapsuleBlocksResult {
  indexed: number
  skipped: number
  failed: number
}

/** Known block type prefixes (top-level before first dot). */
const BLOCK_TYPE_PREFIXES = ['company', 'contact', 'opening_hours', 'services', 'user_manual', 'manual'] as const

/** Derive block_type from block_id (e.g. "opening_hours.schedule" → "opening_hours"). */
function blockIdToBlockType(blockId: string): string {
  if (!blockId) return 'other'
  const base = blockId.replace(/\.chunk_\d+$/, '')
  const top = base.split('.')[0]?.toLowerCase() ?? ''
  if (BLOCK_TYPE_PREFIXES.includes(top as any)) return top
  return top || 'other'
}

/** Derive human-readable title from block_id. */
function blockIdToTitle(blockId: string): string {
  if (!blockId) return 'Block'
  return blockId
    .replace(/\.chunk_\d+$/, '')
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

/**
 * Index blocks from context_blocks into capsule_blocks.
 * Uses blockExtraction for structured profiles (deterministic) and chunking (large docs).
 * Only processes blocks not yet in capsule_blocks (idempotent).
 */
export async function indexCapsuleBlocks(
  db: any,
  handshakeId: string,
  relationshipId: string,
  embeddingService: LocalEmbeddingService,
): Promise<IndexCapsuleBlocksResult> {
  const capsuleId = handshakeId

  // Unindexed: no capsule_block with matching block_id or block_id.chunk_N
  const unindexed = db.prepare(
    `SELECT cb.block_id, cb.block_hash, cb.payload, cb.source
     FROM context_blocks cb
     WHERE cb.handshake_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM capsule_blocks cpb
         WHERE cpb.capsule_id = cb.handshake_id
           AND (cpb.block_id = cb.block_id OR cpb.block_id LIKE cb.block_id || '.chunk_%')
       )`
  ).all(handshakeId) as Array<{ block_id: string; block_hash: string; payload: string; source: string }>

  if (unindexed.length === 0) {
    return { indexed: 0, skipped: 0, failed: 0 }
  }

  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO capsule_blocks (
      block_id, capsule_id, block_type, title, text,
      embedding, model_id, handshake_id, relationship_id, source, block_hash, created_at,
      source_path, chunk_index, parent_block_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  let indexed = 0
  let skipped = 0
  let failed = 0
  const now = new Date().toISOString()

  for (const row of unindexed) {
    const sourcePath = `context_blocks.${row.block_id}`
    const extracted = extractBlocks(row.block_id, row.payload, row.block_hash, sourcePath)

    if (extracted.length === 0) {
      skipped++
      continue
    }

    for (const block of extracted) {
      try {
        const embedding = await embeddingService.generateEmbedding(block.text)
        const blockType = blockIdToBlockType(block.block_id)
        const title = blockIdToTitle(block.block_id)

        insertStmt.run(
          block.block_id,
          capsuleId,
          blockType,
          title,
          block.text,
          Buffer.from(embedding.buffer),
          embeddingService.modelId,
          handshakeId,
          relationshipId,
          row.source ?? 'received',
          block.block_hash,
          now,
          block.source_path,
          block.chunk_index,
          block.parent_block_id,
        )
        indexed++
      } catch (err) {
        console.warn('[CAPSULE_INDEXER] Embedding failed for', block.block_id, err)
        failed++
      }
    }
  }

  return { indexed, skipped, failed }
}

/**
 * Backfill capsule_blocks from existing context_blocks.
 * Call after migration to index blocks that were ingested before capsule_blocks existed.
 */
export async function backfillCapsuleBlocks(
  db: any,
  embeddingService: LocalEmbeddingService,
  batchSize: number = 20,
): Promise<IndexCapsuleBlocksResult> {
  const handshakes = db.prepare(
    `SELECT DISTINCT handshake_id, relationship_id FROM context_blocks`
  ).all() as Array<{ handshake_id: string; relationship_id: string }>

  let totalIndexed = 0
  let totalSkipped = 0
  let totalFailed = 0

  for (const { handshake_id, relationship_id } of handshakes) {
    const r = await indexCapsuleBlocks(db, handshake_id, relationship_id, embeddingService)
    totalIndexed += r.indexed
    totalSkipped += r.skipped
    totalFailed += r.failed
    if (totalIndexed + totalSkipped + totalFailed >= batchSize * 5) break
  }

  return { indexed: totalIndexed, skipped: totalSkipped, failed: totalFailed }
}

/**
 * Re-index a handshake: clear capsule_blocks and rebuild with new extraction.
 * Use for migration when existing blocks need chunking or structured formatting.
 */
export async function reindexHandshakeCapsule(
  db: any,
  handshakeId: string,
  relationshipId: string,
  embeddingService: LocalEmbeddingService,
): Promise<IndexCapsuleBlocksResult> {
  db.prepare('DELETE FROM capsule_blocks WHERE handshake_id = ?').run(handshakeId)
  const { invalidateByHandshake } = await import('./queryCache')
  invalidateByHandshake(db, handshakeId)
  return indexCapsuleBlocks(db, handshakeId, relationshipId, embeddingService)
}
