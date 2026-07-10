/**
 * context_sync content sealing — E2E encryption of `context_blocks[].content`
 * before it reaches the coordination relay.
 *
 * Reuses the audited `sealServiceRpcPayload` / `openServiceRpcPayloadResolvingLocalKey`
 * primitive (X25519 ECDH + HKDF-SHA256 + AES-256-GCM) from `serviceRpc/sealedServiceRpc.ts`.
 * No new cryptography here — this module only shapes the context_sync-specific
 * plaintext (the block array) and wires it through that primitive.
 *
 * Wire shape: the capsule's `context_blocks` field stays content-free (proof-only:
 * block_id/block_hash/type/scope_id — unchanged from `stripContentFromBlocks`), and a
 * sibling `context_blocks_sealed` field carries the ciphertext of the content-bearing
 * block array as one `SealedServiceRpcEnvelope` blob. Sealing the whole array as a single
 * blob (rather than per-block) was chosen because the receive path can unseal it in one
 * call and re-merge by `block_id` — no per-block envelope bookkeeping on the wire.
 *
 * Fail-closed: sealing/unsealing errors never fall back to plaintext.
 */

import type { HandshakeRecord } from './types'
import type { ContextBlockForCommitment } from './contextCommitment'
import {
  sealServiceRpcPayload,
  openServiceRpcPayloadResolvingLocalKey,
  type SealedServiceRpcEnvelope,
} from '../serviceRpc/sealedServiceRpc'

/** Local role drives the AAD sender/receiver labels — context_sync has no per-handshake "device id" for standard (cross-user) pairs, so we bind to role instead. */
export type ContextSyncLocalRole = 'initiator' | 'acceptor'

export type SealContextSyncResult =
  | { readonly ok: true; readonly envelope: SealedServiceRpcEnvelope }
  | { readonly ok: false; readonly code: string; readonly message: string }

export type OpenContextSyncResult =
  | { readonly ok: true; readonly blocks: ReadonlyArray<{ block_id: string; content: Record<string, unknown> | string | null }> }
  | { readonly ok: false; readonly code: string; readonly message: string }

function roleLabels(localRole: ContextSyncLocalRole): { sender_device_id: string; receiver_device_id: string } {
  return localRole === 'initiator'
    ? { sender_device_id: 'context_sync:initiator', receiver_device_id: 'context_sync:acceptor' }
    : { sender_device_id: 'context_sync:acceptor', receiver_device_id: 'context_sync:initiator' }
}

/**
 * Seal `context_blocks[].content` for the peer using `peer_x25519_public_key_b64`.
 * Mirrors the sealed_service_rpc_v1 send path (`sealServiceRpcPayload`) — same
 * key resolution, same AEAD. Fails closed (never returns plaintext) when the
 * peer's X25519 key is missing or sealing otherwise fails.
 */
export function sealContextSyncBlocks(input: {
  handshakeId: string
  peerX25519PublicKeyB64: string | null | undefined
  localRole: ContextSyncLocalRole
  blocks: ReadonlyArray<ContextBlockForCommitment>
}): SealContextSyncResult {
  const { sender_device_id, receiver_device_id } = roleLabels(input.localRole)

  // Minimal record shape — sealServiceRpcPayload only reads handshake_id + peer_x25519_public_key_b64.
  const pseudoRecord = {
    handshake_id: input.handshakeId,
    peer_x25519_public_key_b64: input.peerX25519PublicKeyB64 ?? null,
  } as unknown as HandshakeRecord

  const plaintextBlocks = input.blocks.map((b) => ({
    block_id: b.block_id,
    block_hash: b.block_hash,
    type: b.type,
    scope_id: b.scope_id ?? null,
    content: b.content,
  }))

  const sealed = sealServiceRpcPayload(pseudoRecord, {
    handshake_id: input.handshakeId,
    sender_device_id,
    receiver_device_id,
    plaintextJson: JSON.stringify(plaintextBlocks),
  })

  if (!sealed.ok) {
    return { ok: false, code: sealed.code, message: sealed.message }
  }
  return { ok: true, envelope: sealed.envelope }
}

/**
 * Open a sealed `context_blocks_sealed` envelope using the local device's X25519
 * private key, resolved the same way the sealed_service_rpc_v1 receive path does
 * (record field, else orchestrator device-key store). Fail-closed: any decrypt /
 * shape failure returns `ok: false` — callers must reject the capsule, never
 * process it as if content were absent.
 */
export async function openContextSyncBlocks(
  record: HandshakeRecord,
  envelope: SealedServiceRpcEnvelope,
): Promise<OpenContextSyncResult> {
  const opened = await openServiceRpcPayloadResolvingLocalKey(record, envelope)
  if (!opened.ok) {
    return { ok: false, code: opened.code, message: opened.message }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(opened.plaintextJson)
  } catch (err: any) {
    return { ok: false, code: 'E_CONTEXT_SYNC_SEALED_PAYLOAD_MALFORMED', message: err?.message ?? 'sealed context_sync payload is not valid JSON' }
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, code: 'E_CONTEXT_SYNC_SEALED_PAYLOAD_MALFORMED', message: 'sealed context_sync payload is not an array' }
  }

  const blocks: Array<{ block_id: string; content: Record<string, unknown> | string | null }> = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || typeof (item as any).block_id !== 'string') {
      return { ok: false, code: 'E_CONTEXT_SYNC_SEALED_PAYLOAD_MALFORMED', message: 'sealed context_sync block missing block_id' }
    }
    const content = (item as any).content
    blocks.push({
      block_id: (item as any).block_id,
      content: content === null || content === undefined ? null : content,
    })
  }
  return { ok: true, blocks }
}

/**
 * Shared receive-side gate: given a canonically-rebuilt `context_sync` capsule
 * (post Gate-2 `canonicalRebuild`), verify no plaintext content slipped through,
 * unseal `context_blocks_sealed` when present, and merge the recovered content
 * back into `context_blocks` (matched by `block_id`) for downstream
 * `ingestContextBlocks`. Fail-closed on any violation — never returns a capsule
 * with unverified content.
 *
 * No-op (returns the capsule unchanged) for every other `capsule_type`.
 */
export async function unsealContextSyncCapsuleIfNeeded(
  db: any,
  getHandshakeRecordFn: (db: any, handshakeId: string) => HandshakeRecord | null,
  capsule: Record<string, unknown>,
): Promise<
  | { readonly ok: true; readonly capsule: Record<string, unknown> }
  | { readonly ok: false; readonly code: 'CONTEXT_SYNC_UNSEALED_REJECTED' | 'CONTEXT_SYNC_UNSEAL_FAILED'; readonly message: string }
> {
  if (capsule.capsule_type !== 'context_sync') {
    return { ok: true, capsule }
  }

  const rawBlocks = Array.isArray(capsule.context_blocks) ? (capsule.context_blocks as Array<Record<string, unknown>>) : []
  const hasPlaintextContent = rawBlocks.some((b) => b && b.content !== null && b.content !== undefined)
  if (hasPlaintextContent) {
    return {
      ok: false,
      code: 'CONTEXT_SYNC_UNSEALED_REJECTED',
      message: 'context_sync capsule carries plaintext context_blocks[].content — rejected (blind-courier invariant)',
    }
  }

  const sealedEnvelope = capsule.context_blocks_sealed as SealedServiceRpcEnvelope | undefined
  if (!sealedEnvelope) {
    // No plaintext content (checked above) and nothing sealed — a legitimate proof-only
    // context_sync (block_id/block_hash/type metadata, no content). `ingestContextBlocks`
    // already treats null/undefined content as a no-op (hash-only proof), same as it does
    // for initiate/accept/refresh — nothing to unseal, nothing to reject.
    return { ok: true, capsule }
  }

  const handshakeId = typeof capsule.handshake_id === 'string' ? capsule.handshake_id : ''
  const record = handshakeId ? getHandshakeRecordFn(db, handshakeId) : null
  if (!record) {
    return { ok: false, code: 'CONTEXT_SYNC_UNSEAL_FAILED', message: 'handshake record not found — cannot resolve local X25519 key to open context_sync content' }
  }

  const opened = await openContextSyncBlocks(record, sealedEnvelope)
  if (!opened.ok) {
    return { ok: false, code: 'CONTEXT_SYNC_UNSEAL_FAILED', message: `${opened.code}: ${opened.message}` }
  }

  const contentByBlockId = new Map(opened.blocks.map((b) => [b.block_id, b.content]))
  const mergedBlocks = rawBlocks.map((b) => ({
    ...b,
    content: contentByBlockId.has(b.block_id as string) ? contentByBlockId.get(b.block_id as string) ?? null : null,
  }))

  return { ok: true, capsule: { ...capsule, context_blocks: mergedBlocks } }
}
