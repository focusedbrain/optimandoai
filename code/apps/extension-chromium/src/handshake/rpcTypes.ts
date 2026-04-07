/**
 * Handshake RPC Types (Extension-Side)
 *
 * Read-only projections of the backend HandshakeRecord.
 * Only includes fields the UI needs.
 */

// ── Handshake record as returned by the backend ──

/**
 * Mirrors backend `HandshakeState` (`electron/main/handshake/types.ts`).
 * Keep in sync with the server enum — all seven values may appear at runtime.
 */
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

/** Prefix shown next to the status label in detail panels (exhaustive over HandshakeState). */
export function handshakeDetailsStatusPrefix(state: HandshakeState): string {
  switch (state) {
    case 'ACTIVE':
      return '✓'
    case 'ACCEPTED':
      return '◐'
    case 'PENDING_ACCEPT':
    case 'PENDING_REVIEW':
      return '⏳'
    case 'DRAFT':
      return '📝'
    case 'EXPIRED':
      return '⏱'
    case 'REVOKED':
      return '⛔'
  }
}

/** Leading icon for handshake list rows (ACTIVE respects key material). */
export function handshakeListRowIcon(record: HandshakeRecord): string {
  switch (record.state) {
    case 'ACTIVE':
      return hasHandshakeKeyMaterial(record) ? '🔒' : '⚠️'
    case 'PENDING_ACCEPT':
    case 'PENDING_REVIEW':
      return '⏳'
    case 'ACCEPTED':
      return '🔄'
    case 'DRAFT':
      return '📝'
    case 'EXPIRED':
      return '⏱'
    case 'REVOKED':
      return '🚫'
  }
}

// ── RPC response types ──

export interface HandshakeListResponse {
  type: 'handshake-list'
  records: HandshakeRecord[]
}

export interface HandshakeInitiateResponse {
  handshake_id: string
  status: string
  /** Same semantics as HandshakeAcceptResponse.electronGeneratedMlkemSecret — see that field for docs. */
  electronGeneratedMlkemSecret?: string | null
}

export interface HandshakeAcceptResponse {
  handshake_id: string
  status: string
  /**
   * Present (non-null) only when Electron generated the ML-KEM keypair as a fallback because
   * the extension did not provide senderMlkem768PublicKeyB64 (e.g. PQ service was unavailable).
   * The extension MUST call storeLocalMlkemSecret(handshake_id, electronGeneratedMlkemSecret)
   * immediately after receiving this response. Without it, inbound hybrid qBEAP cannot decrypt.
   *
   * Null when the extension provided its own ML-KEM public key (normal path) — the extension
   * already has the matching secret in chrome.storage.local from getKeyAgreementForHandshake().
   */
  electronGeneratedMlkemSecret?: string | null
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
  /**
   * Present (non-null) only when Electron generated the ML-KEM keypair as a fallback because
   * the extension did not provide senderMlkem768PublicKeyB64 (PQ service was unavailable at build time).
   * The extension MUST call storeLocalMlkemSecret(handshake_id, electronGeneratedMlkemSecret) immediately.
   * Null on the normal path — extension already has the matching secret from getKeyAgreementForHandshake().
   */
  electronGeneratedMlkemSecret?: string | null
}
