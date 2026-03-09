/**
 * Context Ingestion Pipeline — Post-Confirmation Automatic SQLite Ingestion
 *
 * When a handshake capsule carrying context_blocks is processed, this module
 * verifies the context_commitment and persists blocks into the local SQLite
 * knowledge store.
 *
 * Annex I compliance:
 *   - Blocks are versioned and hash-addressable
 *   - Deduplication by (block_id, block_hash) pair
 *   - Version supersession when block_id matches but block_hash differs
 *   - All blocks linked to handshake_id for per-handshake retrieval
 */

import { verifyContextCommitment, computeBlockHash, type ContextBlockForCommitment } from './contextCommitment'
import { upsertContextBlockVersion, getHandshakeRecord } from './db'
import { inferGovernanceFromLegacy, type LegacyBlockInput } from './contextGovernance'

export interface ContextIngestionInput {
  handshake_id: string
  relationship_id: string
  context_commitment: string | null
  context_blocks: ReadonlyArray<ContextBlockForCommitment & {
    block_id: string
    block_hash: string
    scope_id?: string
    type: string
    content: Record<string, unknown> | string | null
    data_classification?: string
    version?: number
    valid_until?: string
  }>
  publisher_id: string
}

export interface ContextIngestionResult {
  inserted: number
  deduplicated: number
  superseded: number
}

/**
 * Verify context_commitment and persist context blocks into SQLite.
 * Throws on commitment mismatch (fail closed).
 */
export function ingestContextBlocks(
  db: any,
  input: ContextIngestionInput,
): ContextIngestionResult {
  // Step 1: Verify context_commitment (root hash of sorted block_hash values)
  if (input.context_commitment !== null) {
    const commitmentCheck = verifyContextCommitment(
      input.context_commitment,
      input.context_blocks,
    )
    if (!commitmentCheck.valid) {
      throw new Error(`Context commitment verification failed: ${commitmentCheck.reason}`)
    }
  }

  // Step 2: Verify each block_hash matches SHA-256(canonical content)
  // Skip blocks with null content — these are hash-only proof blocks from
  // initiate capsules where the sender intentionally omits the content.
  // The block_hash is the proof itself; content arrives later in a BEAP-Capsule.
  for (const block of input.context_blocks) {
    if (block.content === null || block.content === undefined) continue
    const recomputed = computeBlockHash(block.content)
    if (recomputed !== block.block_hash) {
      throw new Error(
        `Context block hash mismatch for ${block.block_id}: ` +
        `declared ${block.block_hash}, computed ${recomputed}`
      )
    }
  }

  let inserted = 0
  let deduplicated = 0
  let superseded = 0

  const record = getHandshakeRecord(db, input.handshake_id)

  const insertStmt = db.prepare(
    `INSERT OR IGNORE INTO context_blocks (
      sender_wrdesk_user_id, block_id, block_hash,
      relationship_id, handshake_id, scope_id, type,
      data_classification, version, valid_until,
      source, payload, embedding_status, created_at, governance_json, publisher_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, 'pending', ?, ?, ?)`
  )

  const checkExistingStmt = db.prepare(
    `SELECT block_hash, version FROM context_blocks
     WHERE sender_wrdesk_user_id = ? AND block_id = ?
     ORDER BY version DESC LIMIT 1`
  )

  const now = new Date().toISOString()

  for (const block of input.context_blocks) {
    // Skip hash-only proof blocks — no content to store yet
    if (block.content === null || block.content === undefined) {
      continue
    }

    const existing = checkExistingStmt.get(
      input.publisher_id,
      block.block_id,
    ) as { block_hash: string; version: number } | undefined

    if (existing && existing.block_hash === block.block_hash) {
      deduplicated++
      continue
    }

    if (existing && existing.block_hash !== block.block_hash) {
      superseded++
    }

    const serializedContent = typeof block.content === 'string'
      ? block.content
      : JSON.stringify(block.content)

    const version = block.version ?? (existing ? existing.version + 1 : 1)

    const legacy: LegacyBlockInput = {
      block_id: block.block_id,
      type: block.type,
      data_classification: block.data_classification,
      scope_id: block.scope_id,
      sender_wrdesk_user_id: input.publisher_id,
      publisher_id: input.publisher_id,
      source: 'received',
    }
    const governance = record
      ? inferGovernanceFromLegacy(legacy, record, input.relationship_id)
      : inferGovernanceFromLegacy(legacy, {
          effective_policy: { allowsCloudEscalation: false, allowsExport: false, allowedScopes: ['*'] } as any,
          policy_selections: undefined,
        } as any, input.relationship_id)
    const governanceJson = JSON.stringify(governance)

    const result = insertStmt.run(
      input.publisher_id,
      block.block_id,
      block.block_hash,
      input.relationship_id,
      input.handshake_id,
      block.scope_id ?? null,
      block.type,
      block.data_classification ?? 'public',
      version,
      block.valid_until ?? null,
      serializedContent,
      now,
      governanceJson,
      input.publisher_id,
    )

    if (result.changes > 0) {
      inserted++
      upsertContextBlockVersion(db, input.publisher_id, block.block_id, version)
    } else {
      deduplicated++
    }
  }

  return { inserted, deduplicated, superseded }
}
