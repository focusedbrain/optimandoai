/**
 * Handshake RPC Client
 *
 * Sends handshake.* RPC calls through the Chrome background script → WebSocket → Electron.
 * Uses the existing VAULT_RPC message channel which is already wired up.
 */

import type {
  HandshakeRecord,
  ContextBlockInput,
  HandshakeListResponse,
  HandshakeInitiateResponse,
  HandshakeAcceptResponse,
  HandshakeRefreshResponse,
} from './rpcTypes'

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
): Promise<HandshakeInitiateResponse> {
  return sendHandshakeRpc<HandshakeInitiateResponse>('handshake.initiate', {
    receiverUserId,
    receiverEmail,
    fromAccountId,
  })
}

export async function acceptHandshake(
  handshakeId: string,
  sharingMode: 'receive-only' | 'reciprocal',
  fromAccountId: string,
): Promise<HandshakeAcceptResponse> {
  return sendHandshakeRpc<HandshakeAcceptResponse>('handshake.accept', {
    handshake_id: handshakeId,
    sharing_mode: sharingMode,
    fromAccountId,
  })
}

export async function refreshHandshake(
  handshakeId: string,
  contextBlocks: ContextBlockInput[],
  fromAccountId: string,
): Promise<HandshakeRefreshResponse> {
  return sendHandshakeRpc<HandshakeRefreshResponse>('handshake.refresh', {
    handshake_id: handshakeId,
    context_blocks: contextBlocks,
    fromAccountId,
  })
}

export async function revokeHandshake(handshakeId: string): Promise<{ status: string }> {
  return sendHandshakeRpc<{ status: string }>('handshake.initiateRevocation', {
    handshakeId,
  })
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
  }
}

// ── Exported for testing ──
export { sendHandshakeRpc as _sendHandshakeRpc }
