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
        if (response.error) {
          reject(new Error(typeof response.error === 'string' ? response.error : response.error.reason ?? 'RPC error'))
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
export async function sendBeapViaP2P(
  handshakeId: string,
  packageJson: string
): Promise<{ success: boolean; error?: string }> {
  return sendHandshakeRpc<{ success: boolean; error?: string }>(
    'handshake.sendBeapViaP2P',
    { handshakeId, packageJson }
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
    peerX25519PublicKey: raw.peer_x25519_public_key_b64 ?? undefined,
    peerPQPublicKey: raw.peer_mlkem768_public_key_b64 ?? undefined,
    p2pEndpoint: raw.p2p_endpoint ?? undefined,
  }
}

// ── Exported for testing ──
export { sendHandshakeRpc as _sendHandshakeRpc }
