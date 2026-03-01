/**
 * Handshake Refresh Helper
 *
 * Sends a message via handshake.refresh RPC.
 * Replaces the old email-dispatch flow for handshake-based messages.
 *
 * The backend handles: capsule building, hash computation, chain state,
 * email transport, and local pipeline submission.
 */

import { refreshHandshake } from '../handshake/handshakeRpc'
import type { ContextBlockInput } from '../handshake/rpcTypes'

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

export async function buildContextBlocks(message: UserMessage): Promise<ContextBlockInput[]> {
  const blockHash = await computeBlockHash(message.text)
  return [
    {
      block_id: generateBlockId(),
      block_type: message.type ?? 'text',
      content: message.text,
      version: 1,
      block_hash: blockHash,
      scope_id: message.scope_id,
    },
  ]
}

export async function sendViaHandshakeRefresh(
  handshakeId: string,
  message: UserMessage,
  fromAccountId: string,
): Promise<HandshakeRefreshResult> {
  try {
    const contextBlocks = await buildContextBlocks(message)
    const result = await refreshHandshake(handshakeId, contextBlocks, fromAccountId)
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
