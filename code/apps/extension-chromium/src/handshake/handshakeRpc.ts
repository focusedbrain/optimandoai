/**
 * Handshake RPC Client
 *
 * Sends handshake.* RPC calls through the Chrome background script → WebSocket → Electron.
 * Uses the existing VAULT_RPC message channel which is already wired up.
 */

import { getDeviceX25519PublicKey } from '../beap-messages/services/x25519KeyAgreement'
import { pqKemGenerateKeyPair, pqKemSupportedAsync } from '../beap-messages/services/beapCrypto'
import type {
  HandshakeRecord,
  HandshakeListResponse,
  HandshakeInitiateResponse,
  HandshakeAcceptResponse,
  HandshakeRefreshResponse,
  HandshakeBuildForDownloadResponse,
} from './rpcTypes'
import type { PolicySelectionInput } from '@shared/handshake/policyUtils'

let _rpcIdCounter = 0

function nextRpcId(): string {
  return `hs-rpc-${Date.now()}-${++_rpcIdCounter}`
}

async function sendHandshakeRpc<T = unknown>(
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 15_000,
): Promise<T> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    throw new Error('Chrome runtime not available')
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Handshake RPC timeout: ${method}`))
    }, timeoutMs + 2_000)

    chrome.runtime.sendMessage(
      {
        type: 'VAULT_RPC',
        id: nextRpcId(),
        method,
        params,
      },
      (response: any) => {
        clearTimeout(timer)
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        if (!response) {
          reject(new Error('Empty response from background'))
          return
        }
        // Handshake / vault RPCs use `{ success: boolean, error?: string }` for business failures.
        // Do not reject when `error` is present if `success` is explicitly set (e.g. BACKOFF_WAIT).
        if (typeof (response as { success?: unknown }).success === 'boolean') {
          resolve(response as T)
          return
        }
        if ((response as { error?: unknown }).error) {
          const err = (response as { error: unknown }).error
          reject(
            new Error(typeof err === 'string' ? err : (err as { reason?: string })?.reason ?? 'RPC error'),
          )
          return
        }
        resolve(response as T)
      },
    )
  })
}

/** Get X25519 + ML-KEM public keys for handshake key agreement. Uses device X25519; generates ML-KEM if PQ available. */
async function getKeyAgreementForHandshake(): Promise<{
  x25519PublicKeyB64: string
  mlkem768PublicKeyB64: string | undefined
}> {
  const x25519PublicKeyB64 = await getDeviceX25519PublicKey()
  let mlkem768PublicKeyB64: string | undefined
  try {
    if (await pqKemSupportedAsync()) {
      const kp = await pqKemGenerateKeyPair()
      mlkem768PublicKeyB64 = kp.publicKeyB64
      // TODO: Store kp.secretKeyB64 per handshake for qBEAP decapsulation when receiving
    }
  } catch {
    // PQ not available — Electron will generate fallback
  }
  return { x25519PublicKeyB64, mlkem768PublicKeyB64 }
}

// ── Public API ──

export async function listHandshakes(
  filter?: 'active' | 'pending' | 'all',
): Promise<HandshakeRecord[]> {
  const stateMap: Record<string, string | undefined> = {
    active: 'ACTIVE',
    pending: 'PENDING_ACCEPT',
    all: undefined,
  }
  const state = filter ? stateMap[filter] : undefined
  const res = await sendHandshakeRpc<HandshakeListResponse>(
    'handshake.list',
    state ? { filter: { state } } : {},
  )

  const records = res.records ?? []
  // Derive counterparty fields for the UI projection
  return records.map(normalizeRecord)
}

export async function getHandshake(handshakeId: string): Promise<HandshakeRecord> {
  const res = await sendHandshakeRpc<{ record: HandshakeRecord }>(
    'handshake.get',
    { handshake_id: handshakeId },
  )
  return normalizeRecord(res.record ?? (res as any))
}

export async function initiateHandshake(
  receiverUserId: string,
  receiverEmail: string,
  fromAccountId: string,
  options?: {
    skipVaultContext?: boolean
    message?: string
    context_blocks?: Array<{ block_id: string; block_hash: string; type: string; content: string | Record<string, unknown>; scope_id?: string; policy_mode?: 'inherit' | 'override'; policy?: PolicySelectionInput }>
    profile_ids?: string[]
    profile_items?: Array<{ profile_id: string; policy_mode?: 'inherit' | 'override'; policy?: PolicySelectionInput }>
    policy_selections?: PolicySelectionInput
  },
): Promise<HandshakeInitiateResponse> {
  const keyAgreement = await getKeyAgreementForHandshake()
  return sendHandshakeRpc<HandshakeInitiateResponse>('handshake.initiate', {
    receiverUserId,
    receiverEmail,
    fromAccountId,
    senderX25519PublicKeyB64: keyAgreement.x25519PublicKeyB64,
    senderMlkem768PublicKeyB64: keyAgreement.mlkem768PublicKeyB64,
    ...(options?.skipVaultContext ? { skipVaultContext: true } : {}),
    ...(options?.message ? { message: options.message } : {}),
    ...(options?.context_blocks && options.context_blocks.length > 0 ? { context_blocks: options.context_blocks } : {}),
    ...(options?.profile_ids?.length ? { profile_ids: options.profile_ids } : {}),
    ...(options?.profile_items?.length ? { profile_items: options.profile_items } : {}),
    ...(options?.policy_selections ? { policy_selections: options.policy_selections } : {}),
  })
}

export async function buildHandshakeForDownload(
  receiverEmail: string,
  fromAccountId: string,
  options?: {
    skipVaultContext?: boolean
    message?: string
    context_blocks?: Array<{ block_id: string; block_hash: string; type: string; content: string | Record<string, unknown>; scope_id?: string; policy_mode?: 'inherit' | 'override'; policy?: PolicySelectionInput }>
    profile_ids?: string[]
    profile_items?: Array<{ profile_id: string; policy_mode?: 'inherit' | 'override'; policy?: PolicySelectionInput }>
    policy_selections?: PolicySelectionInput
  },
): Promise<HandshakeBuildForDownloadResponse> {
  const keyAgreement = await getKeyAgreementForHandshake()
  return sendHandshakeRpc<HandshakeBuildForDownloadResponse>('handshake.buildForDownload', {
    receiverUserId: receiverEmail,
    receiverEmail,
    senderX25519PublicKeyB64: keyAgreement.x25519PublicKeyB64,
    senderMlkem768PublicKeyB64: keyAgreement.mlkem768PublicKeyB64,
    ...(options?.skipVaultContext ? { skipVaultContext: true } : {}),
    ...(options?.message ? { message: options.message } : {}),
    ...(options?.context_blocks && options.context_blocks.length > 0 ? { context_blocks: options.context_blocks } : {}),
    ...(options?.profile_ids?.length ? { profile_ids: options.profile_ids } : {}),
    ...(options?.profile_items?.length ? { profile_items: options.profile_items } : {}),
    ...(options?.policy_selections ? { policy_selections: options.policy_selections } : {}),
  })
}

export async function acceptHandshake(
  handshakeId: string,
  sharingMode: 'receive-only' | 'reciprocal',
  fromAccountId: string,
  contextOpts?: {
    context_blocks?: Array<{ block_id: string; block_hash: string; type: string; content: string | Record<string, unknown>; scope_id?: string; policy_mode?: 'inherit' | 'override'; policy?: PolicySelectionInput }>
    profile_ids?: string[]
    profile_items?: Array<{ profile_id: string; policy_mode?: 'inherit' | 'override'; policy?: PolicySelectionInput }>
    policy_selections?: PolicySelectionInput
  },
): Promise<HandshakeAcceptResponse> {
  const keyAgreement = await getKeyAgreementForHandshake()
  return sendHandshakeRpc<HandshakeAcceptResponse>('handshake.accept', {
    handshake_id: handshakeId,
    sharing_mode: sharingMode,
    fromAccountId,
    senderX25519PublicKeyB64: keyAgreement.x25519PublicKeyB64,
    senderMlkem768PublicKeyB64: keyAgreement.mlkem768PublicKeyB64,
    ...(contextOpts?.context_blocks?.length ? { context_blocks: contextOpts.context_blocks } : {}),
    ...(contextOpts?.profile_ids?.length ? { profile_ids: contextOpts.profile_ids } : {}),
    ...(contextOpts?.profile_items?.length ? { profile_items: contextOpts.profile_items } : {}),
    ...(contextOpts?.policy_selections ? { policy_selections: contextOpts.policy_selections } : {}),
  })
}

export async function refreshHandshake(
  handshakeId: string,
  fromAccountId: string,
  contextBlockProofs?: Array<{ block_id: string; block_hash: string }>,
): Promise<HandshakeRefreshResponse> {
  return sendHandshakeRpc<HandshakeRefreshResponse>('handshake.refresh', {
    handshake_id: handshakeId,
    fromAccountId,
    ...(contextBlockProofs && contextBlockProofs.length > 0
      ? { context_block_proofs: contextBlockProofs }
      : {}),
  })
}

export async function revokeHandshake(handshakeId: string): Promise<{ status: string }> {
  return sendHandshakeRpc<{ status: string }>('handshake.initiateRevocation', {
    handshakeId,
  })
}

export async function deleteHandshake(handshakeId: string): Promise<{ success: boolean; error?: string }> {
  return sendHandshakeRpc<{ success: boolean; error?: string }>('handshake.delete', {
    handshakeId,
  })
}

/**
 * Fetch pending P2P BEAP message packages (received via P2P, awaiting ingestion).
 */
export interface PendingP2PBeapEntry {
  id: number
  handshake_id: string
  package_json: string
  created_at: string
}

export async function getPendingP2PBeapMessages(): Promise<PendingP2PBeapEntry[]> {
  const res = await sendHandshakeRpc<{ type: string; items: PendingP2PBeapEntry[] }>(
    'handshake.getPendingP2PBeapMessages',
    {}
  )
  return res?.items ?? []
}

/**
 * Acknowledge a pending P2P BEAP message as processed (marks it in DB).
 */
export async function ackPendingP2PBeap(id: number): Promise<void> {
  await sendHandshakeRpc<{ success: boolean; error?: string }>(
    'handshake.ackPendingP2PBeap',
    { id }
  )
}

/**
 * Pending plain email entry (Canon §6 depackaged emails).
 */
export interface PendingPlainEmailEntry {
  id: number
  message_json: string
  account_id: string
  email_message_id: string
  created_at: string
}

/**
 * Fetch pending plain emails for inbox ingestion.
 */
export async function getPendingPlainEmails(): Promise<PendingPlainEmailEntry[]> {
  const res = await sendHandshakeRpc<{ type: string; items: PendingPlainEmailEntry[] }>(
    'handshake.getPendingPlainEmails',
    {}
  )
  return res?.items ?? []
}

/**
 * Acknowledge a pending plain email as ingested.
 */
export async function ackPendingPlainEmail(id: number): Promise<void> {
  await sendHandshakeRpc<{ success: boolean; error?: string }>(
    'handshake.ackPendingPlainEmail',
    { id }
  )
}

/**
 * Send a BEAP package via P2P relay to the handshake counterparty.
 * @param handshakeId - Handshake ID for the recipient
 * @param packageJson - JSON string of the BEAP package
 */
/**
 * Client-side send failure detail (no secrets) — same DEBUG affordance as transport diagnostics.
 */
export type ClientSendFailureDebug = {
  kind: 'client_send_failure'
  phase:
    | 'package_build'
    | 'preflight'
    | 'send_exception'
    | 'transport_exception'
    | 'p2p_transport'
    | 'ui_validation'
  /** Short, user-safe summary (may repeat toast message). */
  message: string
}

/**
 * Sanitized P2P outbound diagnostics (mirrors Electron `OutboundRequestDebugSnapshot` in `p2pTransport.ts`).
 */
export type OutboundRequestDebugSnapshot = {
  route: 'coordination' | 'direct'
  url: string
  method: 'POST'
  content_type: string
  content_length_bytes: number
  body_type: 'json_string'
  top_level_keys: string[]
  body_looks_double_encoded: boolean
  request_shape: {
    value_kind: 'object' | 'other'
    top_level_keys: string[]
    has_top_level_handshake_id: boolean
    has_capsule_type_key: boolean
    looks_like_beap_message_package: boolean
    looks_like_relay_capsule_envelope: boolean
    has_message_header_receiver_binding_handshake_id: boolean
  }
  http_status: number
  response_body_snippet?: string
  transport_error?: string
  canon_chunking_summary?: {
    payload_enc_chunk_count?: number
    artefact_encrypted_chunk_total?: number
    note?: string
  }
  coordination_single_post_json?: boolean
  expected_coordination_routing_keys?: string[]
  missing_coordination_top_level_fields?: string[]
  coordination_source_format?: 'beap_wire_message_package' | 'handshake_relay_envelope'
  coordination_normalized_shape?: 'relay_native_beap_wire' | 'relay_handshake_capsule'
  derived_relay_capsule_type?: string | null
  relay_envelope_matches_expectations?: boolean
  relay_allowed_types_from_response?: string
  relay_capsule_type_field_name?: 'capsule_type'
  serialized_capsule_type_field_present?: boolean
  serialized_capsule_type_value?: string | null
  relay_validator_contract_matches?: boolean
}

/** Matches Electron `handshake.sendBeapViaP2P` response (additive fields). */
export type SendBeapViaP2PResult = {
  success: boolean
  error?: string
  queued?: boolean
  code?:
    | 'BACKOFF_WAIT'
    | 'DELIVERED'
    | 'PREFLIGHT_FAILED'
    | 'TRANSPORT_FAILED'
    | 'AUTH_REQUIRED'
    | 'FAILED_MAX_RETRIES'
    | 'REQUEST_INVALID'
    | 'RELAY_TYPE_NOT_ALLOWED'
    | 'OUT_OF_BAND_REQUIRED'
    | 'PAYLOAD_TOO_LARGE'
  last_queue_error?: string | null
  retry_count?: number
  max_retries?: number
  remaining_ms?: number
  next_retry_at?: string
  failure_class?:
    | 'AUTH_RECOVERABLE'
    | 'TRANSIENT_TRANSPORT'
    | 'THROTTLED'
    | 'STALE_ROUTE'
    | 'CONFIG_PERMANENT'
    | 'PAYLOAD_PERMANENT'
    | 'SCHEMA_PERMANENT'
    | 'SIZE_RECOVERABLE'
  healing_status?:
    | 'idle'
    | 'scheduled'
    | 'auth_refreshing'
    | 'route_refreshing'
    | 'terminal_non_recoverable'
    | 'STOPPED_REQUIRES_FIX'
    | 'RETRY_WITH_CHUNKING'
  http_status?: number
  response_body_snippet?: string
  outbound_debug?: OutboundRequestDebugSnapshot
  derived_outgoing_relay_capsule_type?: string | null
  /** Coordination relay: live push (200) vs stored while recipient offline (202). */
  coordinationRelayDelivery?: 'pushed_live' | 'queued_recipient_offline'
}

export async function sendBeapViaP2P(
  handshakeId: string,
  packageJson: string
): Promise<SendBeapViaP2PResult> {
  return sendHandshakeRpc<SendBeapViaP2PResult>('handshake.sendBeapViaP2P', { handshakeId, packageJson })
}

/**
 * Lightweight pre-check before building a BEAP package for P2P send.
 * Aligns with handshake.sendBeapViaP2P gates (active + P2P endpoint) without building ciphertext.
 */
export async function checkHandshakeSendReady(
  handshakeId: string,
): Promise<{ ready: boolean; error?: string }> {
  return sendHandshakeRpc<{ ready: boolean; error?: string }>(
    'handshake.checkSendReady',
    { handshakeId },
  )
}

/**
 * Normalize a backend HandshakeRecord into the extension-side projection.
 * The backend stores initiator/acceptor as nested objects; we flatten to
 * counterparty_email / counterparty_user_id for the UI.
 */
function normalizeRecord(raw: any): HandshakeRecord {
  if (raw.counterparty_email !== undefined) return raw as HandshakeRecord

  const isInitiator = raw.local_role === 'initiator'
  const counterparty = isInitiator ? raw.acceptor : raw.initiator

  return {
    handshake_id: raw.handshake_id,
    state: raw.state,
    local_role: raw.local_role,
    counterparty_email: counterparty?.email ?? '',
    counterparty_user_id: counterparty?.wrdesk_user_id ?? '',
    relationship_id: raw.relationship_id,
    sharing_mode: raw.sharing_mode ?? undefined,
    created_at: raw.created_at,
    activated_at: raw.activated_at ?? undefined,
    expires_at: raw.expires_at ?? null,
    peerX25519PublicKey: raw.peer_x25519_public_key_b64 ?? undefined,
    peerPQPublicKey: raw.peer_mlkem768_public_key_b64 ?? undefined,
    p2pEndpoint: raw.p2p_endpoint ?? undefined,
  }
}

// ── Exported for testing ──
export { sendHandshakeRpc as _sendHandshakeRpc }
