/**
 * Handshake Refresh Helper
 *
 * Sends a refresh via handshake.refresh RPC with proof-only context references.
 * Content is never included in handshake capsules — only SHA-256 hashes
 * of context blocks are sent as proof. Actual content enters only through
 * the full BEAP-Capsule pipeline.
 */

import { refreshHandshake } from '../handshake/handshakeRpc'
import type { ContextBlockProof } from '../handshake/rpcTypes'

export interface UserMessage {
  text: string
  type?: string
  scope_id?: string
}

export interface HandshakeRefreshResult {
  success: boolean
  handshake_id: string
  capsule_hash?: string
  error?: string
}

function generateBlockId(): string {
  return `blk_${crypto.randomUUID().slice(0, 12)}`
}

async function computeBlockHash(content: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(content)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

export async function buildContextBlockProofs(message: UserMessage): Promise<ContextBlockProof[]> {
  const blockHash = await computeBlockHash(message.text)
  return [
    {
      block_id: generateBlockId(),
      block_hash: blockHash,
    },
  ]
}

/** @deprecated Use buildContextBlockProofs — kept for backward compat */
export const buildContextBlocks = buildContextBlockProofs

export async function sendViaHandshakeRefresh(
  handshakeId: string,
  message: UserMessage,
  fromAccountId: string,
): Promise<HandshakeRefreshResult> {
  try {
    const proofs = await buildContextBlockProofs(message)
    const result = await refreshHandshake(handshakeId, fromAccountId, proofs)
    return {
      success: true,
      handshake_id: result.handshake_id,
      capsule_hash: result.capsule_hash,
    }
  } catch (err) {
    return {
      success: false,
      handshake_id: handshakeId,
      error: err instanceof Error ? err.message : 'Send failed',
    }
  }
}
