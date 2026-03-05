/**
 * Context Commitment — Cryptographic Binding for Context Blocks
 *
 * Produces a single SHA-256 digest that covers all context blocks attached
 * to a handshake capsule. Each block carries its own `block_hash`; the
 * commitment is computed as SHA-256(sorted(block_hash[])).
 *
 * When no context blocks are present, `context_commitment` is `null` and
 * excluded from the capsule hash preimage.
 *
 * Verification: recompute the commitment from received context_blocks and
 * compare against the declared value. Fail closed on mismatch.
 */

import { createHash } from 'crypto'

export interface ContextBlockForCommitment {
  readonly block_id: string
  readonly block_hash: string
  readonly scope_id?: string | null
  readonly type: string
  readonly content: Record<string, unknown> | string | null
}

/**
 * Wire-safe context block — carries proof only, NEVER content.
 * This is what appears in handshake capsules sent over untrusted transport.
 */
export interface ContextBlockWireProof {
  readonly block_id: string
  readonly block_hash: string
  readonly type: string
  readonly scope_id: string | null
}

/**
 * Strip content from context blocks, producing wire-safe proof-only blocks.
 * SECURITY: content must never travel in the handshake capsule.
 */
export function stripContentFromBlocks(
  blocks: ReadonlyArray<ContextBlockForCommitment>,
): ContextBlockWireProof[] {
  return blocks.map(b => ({
    block_id: b.block_id,
    block_hash: b.block_hash,
    type: b.type,
    scope_id: b.scope_id ?? null,
  }))
}

/**
 * Compute the block_hash for a context block from its canonical JSON content.
 */
export function computeBlockHash(content: Record<string, unknown> | string): string {
  const serialized = typeof content === 'string' ? content : JSON.stringify(content)
  return createHash('sha256').update(serialized, 'utf8').digest('hex')
}

/**
 * Compute the context commitment from a list of context blocks.
 * Returns `null` if no blocks are provided.
 *
 * Algorithm: SHA-256 of the sorted, concatenated block_hash values.
 */
export function computeContextCommitment(
  blocks: ReadonlyArray<ContextBlockForCommitment> | null | undefined,
): string | null {
  if (!blocks || blocks.length === 0) return null

  const hashes = blocks.map(b => b.block_hash).sort()
  const concatenated = hashes.join('')
  return createHash('sha256').update(concatenated, 'utf8').digest('hex')
}

/**
 * Verify context commitment against received context blocks.
 * Returns `true` if the commitment matches, `false` otherwise.
 */
export function verifyContextCommitment(
  declaredCommitment: string | null,
  blocks: ReadonlyArray<ContextBlockForCommitment> | null | undefined,
): { valid: true } | { valid: false; reason: string } {
  const recomputed = computeContextCommitment(blocks)

  if (declaredCommitment === null && recomputed === null) {
    return { valid: true }
  }

  if (declaredCommitment === null && recomputed !== null) {
    return { valid: false, reason: 'context_commitment is null but context_blocks are present' }
  }

  if (declaredCommitment !== null && recomputed === null) {
    return { valid: false, reason: 'context_commitment is set but no context_blocks present' }
  }

  if (declaredCommitment !== recomputed) {
    return { valid: false, reason: 'context_commitment mismatch — context blocks have been tampered with' }
  }

  return { valid: true }
}
