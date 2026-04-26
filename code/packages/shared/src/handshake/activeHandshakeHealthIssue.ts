/** JSON-serializable active-handshake health row for UI + IPC (main ↔ renderer). */

export type HandshakeHealthTier = 'BROKEN' | 'DEGRADED' | 'SUBOPTIMAL'

export type HandshakeHealthReason =
  | 'coordination_incomplete'
  | 'endpoint_invalid'
  | 'missing_self_token'
  | 'missing_counterparty_token'
  | 'endpoint_repair_pending'

export type ActiveHandshakeHealthIssue = {
  handshake_id: string
  health: HandshakeHealthTier
  reason: HandshakeHealthReason
  peer_name: string
  /** Six digits when present on the ledger row; otherwise null. */
  pairing_code_6: string | null
}
