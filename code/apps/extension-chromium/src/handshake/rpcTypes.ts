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
  readonly initiator_coordination_device_id?: string | null
  readonly acceptor_coordination_device_id?: string | null
  readonly internal_peer_device_id?: string | null
  readonly internal_peer_device_role?: 'host' | 'sandbox' | null
  readonly internal_peer_computer_name?: string | null
  /**
   * 6-digit pairing code from the initiate capsule's `receiver_pairing_code` (no dash).
   * Present on internal handshakes created with the pairing-code routing model;
   * legacy internal handshakes omit this field and fall back to UUID-equality on
   * `internal_peer_device_id` for the acceptance check.
   */
  readonly internal_peer_pairing_code?: string | null
  /** Canonical internal pair key when both coordination device ids are known */
  readonly internal_routing_key?: string | null
  /** False for degraded legacy / incomplete internal rows — coordination relay must not send */
  readonly internal_coordination_identity_complete?: boolean
  /** True when device ids or routing are inconsistent — user should repair pairing */
  readonly internal_coordination_repair_needed?: boolean
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
  /**
   * Internal handshake only: one line describing peer orchestrator + device (for BEAP delivery / picker).
   */
  readonly internal_target_summary?: string | null
}

/**
 * Checks if handshake has full key material for qBEAP (both X25519 and PQ).
 * No upgrade path — handshakes without keys are invalid. User must delete and re-establish.
 */
export function hasHandshakeKeyMaterial(
  record: Pick<HandshakeRecord | SelectedHandshakeRecipient, 'peerX25519PublicKey' | 'peerPQPublicKey'>,
): boolean {
  return !!(record.peerX25519PublicKey && record.peerPQPublicKey)
}

function nzString(s: unknown): string | undefined {
  if (typeof s !== 'string') return undefined
  const t = s.trim()
  return t.length > 0 ? t : undefined
}

/**
 * Maps ledger / IPC rows (`peer_x25519_public_key_b64`, `peer_mlkem768_public_key_b64`) and optional
 * camelCased copies onto UI key fields. Trims; empty string → undefined (so `hasHandshakeKeyMaterial` is false).
 * Use for every list/get DTO path so key material is never dropped when payloads mix shapes.
 */
export function peerKeyMaterialFromBackendRow(raw: Record<string, unknown>): {
  peerX25519PublicKey?: string
  peerPQPublicKey?: string
  localX25519PublicKey?: string
} {
  return {
    peerX25519PublicKey: nzString(raw.peerX25519PublicKey ?? raw.peer_x25519_public_key_b64),
    peerPQPublicKey: nzString(raw.peerPQPublicKey ?? raw.peer_mlkem768_public_key_b64),
    localX25519PublicKey: nzString(raw.localX25519PublicKey ?? raw.local_x25519_public_key_b64),
  }
}

export type HandshakeKeyMaterialStatus = 'complete' | 'missing_x25519' | 'missing_pq' | 'missing_both'

export function handshakeKeyMaterialStatus(
  record: Pick<HandshakeRecord, 'peerX25519PublicKey' | 'peerPQPublicKey'>,
): HandshakeKeyMaterialStatus {
  const x = !!record.peerX25519PublicKey
  const p = !!record.peerPQPublicKey
  if (x && p) return 'complete'
  if (!x && !p) return 'missing_both'
  if (!x) return 'missing_x25519'
  return 'missing_pq'
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
  /**
   * Phase 3: outcome of the coordination relay push for internal handshakes.
   * - 'pushed_live'              — relay accepted and pushed to the peer's WS.
   * - 'queued_recipient_offline' — relay stored for later pickup (peer offline).
   * - 'coordination_unavailable' — relay push failed; caller should fall back to file download.
   * - 'skipped'                  — internal handshake but coordination is not configured.
   * - null / undefined           — external handshake (no relay push in this phase).
   */
  relay_delivery?:
    | 'pushed_live'
    | 'queued_recipient_offline'
    | 'coordination_unavailable'
    | 'skipped'
    | null
  /** Present when relay_delivery === 'coordination_unavailable'. User-safe message. */
  relay_error?: string
  /** Backend sets this to false when an RPC-level failure occurs — business failures stay true. */
  success?: boolean
  /** Optional user-safe error message when `success === false`. */
  error?: string
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
