/**
 * Temporary key-binding debug — logs only, for tracing counterparty_public_key source of truth.
 * Prefix: [HANDSHAKE][KEY_BINDING]
 */
import type { HandshakeRecord } from './types'

function f16(k: string | null | undefined): string {
  if (k == null || k === undefined) return '(null)'
  if (typeof k !== 'string' || k.length === 0) return '(empty)'
  return k.slice(0, 16)
}

function peerX25519Split(record: HandshakeRecord | null | undefined): { peer_initiator_first16: string; peer_acceptor_first16: string } {
  const px = f16(record?.peer_x25519_public_key_b64)
  if (!record?.local_role) {
    return { peer_initiator_first16: px, peer_acceptor_first16: px }
  }
  if (record.local_role === 'acceptor') {
    return { peer_initiator_first16: px, peer_acceptor_first16: '(n/a: local_role acceptor, peer is initiator keys)' }
  }
  if (record.local_role === 'initiator') {
    return { peer_initiator_first16: '(n/a: local_role initiator, peer is acceptor keys)', peer_acceptor_first16: px }
  }
  return { peer_initiator_first16: px, peer_acceptor_first16: px }
}

export type KeyBindingLogInput = {
  source_function: string
  handshake_id: string
  local_role?: string | null
  capsule_type?: string | null
  old_counterparty?: string | null
  new_counterparty?: string | null
  /** Capsule / wire sender_public_key (Ed25519) when available */
  sender_public_key?: string | null
  record?: HandshakeRecord | null
}

/**
 * Single structured line: only the fields requested for key-binding triage
 * (handshake_id, local_role, capsule_type, source_function, *first16 fields).
 */
export function logHandshakeKeyBinding(i: KeyBindingLogInput): void {
  const rec = i.record
  const { peer_initiator_first16, peer_acceptor_first16 } = peerX25519Split(rec ?? null)
  const payload = {
    handshake_id: i.handshake_id,
    local_role: i.local_role ?? rec?.local_role ?? null,
    capsule_type: i.capsule_type ?? null,
    source_function: i.source_function,
    old_counterparty_first16: f16(i.old_counterparty),
    new_counterparty_first16: f16(i.new_counterparty),
    sender_public_first16: f16(i.sender_public_key),
    peer_initiator_first16,
    peer_acceptor_first16,
  }
  console.log('[HANDSHAKE][KEY_BINDING]', JSON.stringify(payload))
}

/**
 * Defensive: log if a code path would change an already-stored remote Ed25519 key to a different
 * non-empty value (typical sign of a bad assignment). Does not throw — visibility only.
 *
 * Do **not** call this from `updateHandshakeCounterpartyKey` — that API exists to intentionally
 * replace the column (see comment there).
 */
export function warnIfCounterpartyKeySuspiciousOverwrite(
  handshakeId: string,
  source: string,
  oldKey: string | null | undefined,
  newKey: string | null | undefined,
): void {
  const o = typeof oldKey === 'string' ? oldKey.trim() : ''
  const n = typeof newKey === 'string' ? newKey.trim() : ''
  if (o.length === 0 || n.length === 0 || o === n) {
    return
  }
  console.warn(
    '[HANDSHAKE][KEY_BINDING][OVERWRITE_ATTEMPT]',
    JSON.stringify({
      handshake_id: handshakeId,
      source,
      old_counterparty_first16: o.slice(0, 16),
      new_counterparty_first16: n.slice(0, 16),
    }),
  )
}
