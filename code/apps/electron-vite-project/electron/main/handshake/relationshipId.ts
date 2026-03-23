/**
 * Relationship ID Derivation
 *
 * A `relationship_id` uniquely identifies the bilateral trust relationship
 * between two BEAP participants. Both sender and receiver must independently
 * arrive at the same string from the same two identities.
 *
 * Convention:
 *   relationship_id = "rel:" + SHA-256( sort([userIdA, userIdB]).join(":") ) [first 32 chars]
 *
 * Properties:
 *   - Deterministic: same pair of IDs always produces the same relationship_id
 *   - Symmetric: deriveRelationshipId(A, B) === deriveRelationshipId(B, A)
 *   - Collision-resistant: different pairs produce different IDs with very high probability
 *   - Human-readable prefix: "rel:" makes it identifiable in logs
 *   - Bounded length: 36 chars total ("rel:" + 32 hex chars)
 *
 * The `ownership` step uses relationship_id only as a duplicate-handshake
 * guard key — it does NOT need to be globally unique across all users, only
 * unique per pair. The SHA-256 prefix provides sufficient collision resistance.
 */

import { createHash } from 'crypto'

/**
 * Derive a stable, symmetric relationship ID from two wrdesk user IDs.
 *
 * @param userIdA - First participant's wrdesk_user_id
 * @param userIdB - Second participant's wrdesk_user_id
 * @returns A 36-character string starting with "rel:"
 */
export function deriveRelationshipId(userIdA: string, userIdB: string): string {
  if (!userIdA || !userIdB) throw new Error('Both user IDs are required to derive a relationship_id')
  if (userIdA === userIdB) throw new Error('Cannot derive a relationship_id between a user and themselves')

  const sorted = [userIdA, userIdB].sort()
  const input = sorted.join(':')
  const hash = createHash('sha256').update(input, 'utf8').digest('hex')
  return `rel:${hash.slice(0, 32)}`
}
