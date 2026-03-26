/**
 * Handshake RPC Types (Extension-Side)
 *
 * Read-only projections of the backend HandshakeRecord.
 * Only includes fields the UI needs.
 */

// ── Handshake record as returned by the backend ──

/** Mirrors backend `HandshakeState` (electron/main/handshake/types.ts). */
export type HandshakeState =
  | 'DRAFT'
  | 'PENDING_ACCEPT'
  | 'PENDING_REVIEW'
  | 'ACCEPTED'
  | 'ACTIVE'
  | 'EXPIRED'
  | 'REVOKED'

export interface HandshakeRecord {
  readonly handshake_id: string
  readonly state: HandshakeState
  readonly local_role: 'initiator' | 'acceptor'
  readonly counterparty_email: string
  readonly counterparty_user_id: string
  readonly relationship_id: string
  readonly sharing_mode?: 'receive-only' | 'reciprocal'
  readonly created_at: string
  readonly activated_at?: string
  /** Handshake lifetime end (ISO), when set by backend */
  readonly expires_at?: string | null
  /** Peer's X25519 public key (base64) for qBEAP key agreement */
  readonly peerX25519PublicKey?: string
  /** Peer's ML-KEM-768 public key (base64) for post-quantum key agreement */
  readonly peerPQPublicKey?: string
  /** Counterparty's P2P endpoint (for P2P delivery) */
  readonly p2pEndpoint?: string | null
}

// ── Context block proof (hash-only, no content in handshake capsules) ──

export interface ContextBlockProof {
  readonly block_id: string
  readonly block_hash: string
}

// ── Selected recipient for the builder ──

export interface SelectedHandshakeRecipient {
  readonly handshake_id: string
  readonly counterparty_email: string
  readonly counterparty_user_id: string
  readonly sharing_mode: 'receive-only' | 'reciprocal'
  readonly receiver_email_list?: string[]
  readonly receiver_fingerprint_short?: string
  readonly receiver_fingerprint_full?: string
  readonly receiver_display_name?: string
  readonly receiver_organization?: string
  /** Peer's X25519 public key (base64) for ECDH key agreement */
  readonly peerX25519PublicKey?: string
  /** Peer's ML-KEM-768 public key (base64) for post-quantum key agreement */
  readonly peerPQPublicKey?: string
  /** Counterparty's P2P endpoint (for P2P delivery) */
  readonly p2pEndpoint?: string | null
}

/**
 * Checks if handshake has full key material for qBEAP (both X25519 and PQ).
 * No upgrade path — handshakes without keys are invalid. User must delete and re-establish.
 */
export function hasHandshakeKeyMaterial(
  record: Pick<HandshakeRecord | SelectedHandshakeRecipient, 'peerX25519PublicKey' | 'peerPQPublicKey'>
): boolean {
  return !!(record.peerX25519PublicKey && record.peerPQPublicKey)
}

// ── RPC response types ──

export interface HandshakeListResponse {
  type: 'handshake-list'
  records: HandshakeRecord[]
}

export interface HandshakeInitiateResponse {
  handshake_id: string
  status: string
}

export interface HandshakeAcceptResponse {
  handshake_id: string
  status: string
}

export interface HandshakeRefreshResponse {
  handshake_id: string
  capsule_hash: string
  status: string
}

export interface HandshakeBuildForDownloadResponse {
  success: boolean
  handshake_id: string
  capsule_json: string
  error?: string
}
