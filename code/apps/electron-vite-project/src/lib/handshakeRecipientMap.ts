/**
 * Map dashboard `HandshakeRecord` to BeapPackageBuilder `SelectedHandshakeRecipient`.
 */

import { formatInternalBeapTargetSummary, isInternalHandshake } from '@shared/handshake/internalIdentityUi'
import type { HandshakeRecord, SelectedHandshakeRecipient } from '@ext/handshake/rpcTypes'

export function handshakeRecordToSelectedRecipient(h: HandshakeRecord): SelectedHandshakeRecipient {
  const email = h.counterparty_email ?? ''

  return {
    handshake_id: h.handshake_id,
    counterparty_email: email,
    counterparty_user_id: h.counterparty_user_id,
    sharing_mode: h.sharing_mode === 'reciprocal' ? 'reciprocal' : 'receive-only',
    receiver_email_list: email ? [email] : [],
    receiver_display_name: email ? email.split('@')[0] : 'Peer',
    peerX25519PublicKey: h.peerX25519PublicKey,
    peerPQPublicKey: h.peerPQPublicKey,
    p2pEndpoint: h.p2pEndpoint ?? null,
    localX25519PublicKey: h.localX25519PublicKey,
    internal_target_summary: isInternalHandshake(h) ? formatInternalBeapTargetSummary(h) : null,
  }
}
