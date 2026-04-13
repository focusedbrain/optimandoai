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
  /**
   * Our own (local/sender) X25519 public key bound to this handshake (base64).
   * This is the key that was exchanged during handshake setup and stored as
   * local_x25519_public_key_b64 in the Electron DB.  The qBEAP builder MUST
   * use this as header.senderX25519PublicKeyB64 — NOT the current device key —
   * so that the receiver's ECDH uses the same key the handshake was established with.
   *
   * MISSING KEY SEMANTICS:
   * - If this field is undefined/null the handshake was created before schema v50
   *   (local key binding persistence). P2P send MUST be rejected with
   *   ERR_HANDSHAKE_LOCAL_KEY_MISSING. The user must delete and re-establish.
   * - If this field is present but differs from the current device key, send MUST
   *   be rejected with ERR_HANDSHAKE_LOCAL_KEY_MISMATCH (device key regenerated).
   * - Only when this field equals the current device key should send proceed.
   */
  readonly localX25519PublicKey?: string
  /** Intended recipient email from the initiate capsule (acceptor-side); same as initiator email for internal handshakes. */
  readonly receiver_email?: string | null
  readonly handshake_type?: 'internal' | 'standard' | null
  readonly initiator_device_name?: string | null
  readonly acceptor_device_name?: string | null
  readonly initiator_device_role?: 'host' | 'sandbox' | null
  readonly acceptor_device_role?: 'host' | 'sandbox' | null
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
  /**
   * Our own (local/sender) X25519 public key bound to this handshake (base64).
   * Set from HandshakeRecord.localX25519PublicKey (= DB local_x25519_public_key_b64).
   *
   * MISSING KEY SEMANTICS (see HandshakeRecord.localX25519PublicKey for full docs):
   * - Undefined/null  → ERR_HANDSHAKE_LOCAL_KEY_MISSING (pre-v50 handshake; re-establish)
   * - Present but ≠ current device key → ERR_HANDSHAKE_LOCAL_KEY_MISMATCH
   * - Present and = current device key → proceed with send
   *
   * The qBEAP builder MUST fail hard (not bypass) when this field is missing
   * in a P2P send context.
   */
  readonly localX25519PublicKey?: string
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
  /** Kept for diagnostic logging. Secret is persisted in the Electron DB; use beap.getMlkemSecret IPC to read it. */
  electronGeneratedMlkemSecret?: string | null
}

export interface HandshakeAcceptResponse {
  handshake_id: string
  status: string
  /**
   * Present (non-null) only when Electron generated the ML-KEM keypair as a fallback because
   * the extension did not provide senderMlkem768PublicKeyB64 (e.g. PQ service was unavailable).
   * The secret is already persisted in the Electron DB (local_mlkem768_secret_key_b64) and
   * accessible via beap.getMlkemSecret IPC. This field is kept for diagnostic logging only.
   *
   * Null when the extension provided its own ML-KEM public key (normal path).
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
   * Kept for diagnostic logging. Secret is persisted in the Electron DB (local_mlkem768_secret_key_b64)
   * and accessible via beap.getMlkemSecret IPC. Null on the normal path (extension provided the key).
   */
  electronGeneratedMlkemSecret?: string | null
}
