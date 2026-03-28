/**
 * Shim for extension-chromium handshakeRpc — routes through Electron IPC
 * instead of chrome.runtime.sendMessage.
 */

import type {
  HandshakeRecord,
  HandshakeInitiateResponse,
  HandshakeAcceptResponse,
  HandshakeRefreshResponse,
  HandshakeBuildForDownloadResponse,
} from '@ext/handshake/rpcTypes'

/**
 * Same filter mapping as extension `handshakeRpc.listHandshakes` (lines 88–99).
 * Preload passes this object to `ipcRenderer.invoke('handshake:list', arg)`; main wraps it as
 * `handleHandshakeRPC('handshake.list', { filter: arg }, db)` — so `arg` must be `{ state: 'ACTIVE' }`
 * (uppercase), not `{ state: 'active' }`, and "all" must omit state (undefined), not `{ state: 'all' }`.
 */
export async function listHandshakes(
  _filter?: 'active' | 'pending' | 'all',
): Promise<HandshakeRecord[]> {
  if (!window.handshakeView?.listHandshakes) return []

  const stateMap: Record<string, string | undefined> = {
    active: 'ACTIVE',
    pending: 'PENDING_ACCEPT',
    all: undefined,
  }
  const state = _filter ? stateMap[_filter] : undefined
  const ipcFilter = state !== undefined ? { state } : undefined

  return window.handshakeView.listHandshakes(ipcFilter)
}

export async function getHandshake(_handshakeId: string): Promise<HandshakeRecord> {
  throw new Error('getHandshake not available in Electron')
}

export async function initiateHandshake(
  receiverUserId: string,
  receiverEmail: string,
  fromAccountId: string,
  options?: {
    skipVaultContext?: boolean
    message?: string
    context_blocks?: Array<{ block_id: string; block_hash: string; type: string; content: string | Record<string, unknown>; scope_id?: string }>
    policy_selections?: { cloud_ai?: boolean; internal_ai?: boolean }
  },
): Promise<HandshakeInitiateResponse> {
  if (window.handshakeView?.initiateHandshake) {
    return window.handshakeView.initiateHandshake(
      receiverEmail || receiverUserId,
      fromAccountId,
      options as any,
    )
  }
  throw new Error('Handshake IPC not available')
}

export async function buildHandshakeForDownload(
  receiverEmail: string,
  fromAccountId: string,
  options?: {
    skipVaultContext?: boolean
    message?: string
    context_blocks?: Array<{ block_id: string; block_hash: string; type: string; content: string | Record<string, unknown>; scope_id?: string }>
    policy_selections?: { cloud_ai?: boolean; internal_ai?: boolean }
  },
): Promise<HandshakeBuildForDownloadResponse> {
  if (window.handshakeView?.buildForDownload) {
    return window.handshakeView.buildForDownload(
      receiverEmail,
      options as any,
    )
  }
  throw new Error('Handshake IPC not available')
}

export async function acceptHandshake(
  handshakeId: string,
  sharingMode: 'receive-only' | 'reciprocal',
  fromAccountId: string,
  contextOpts?: {
    context_blocks?: Array<{ block_id: string; block_hash: string; type: string; content: string | Record<string, unknown>; scope_id?: string; policy_mode?: 'inherit' | 'override'; policy?: { cloud_ai?: boolean; internal_ai?: boolean } }>
    profile_ids?: string[]
    profile_items?: Array<{ profile_id: string; policy_mode?: 'inherit' | 'override'; policy?: { cloud_ai?: boolean; internal_ai?: boolean } }>
    policy_selections?: { cloud_ai?: boolean; internal_ai?: boolean }
  },
): Promise<HandshakeAcceptResponse> {
  if (window.handshakeView?.acceptHandshake) {
    return window.handshakeView.acceptHandshake(handshakeId, sharingMode, fromAccountId, contextOpts)
  }
  throw new Error('Handshake IPC not available')
}

export async function refreshHandshake(
  _handshakeId: string,
  _fromAccountId: string,
  _contextBlockProofs?: Array<{ block_id: string; block_hash: string }>,
): Promise<HandshakeRefreshResponse> {
  throw new Error('refreshHandshake not available in Electron')
}

export async function revokeHandshake(_handshakeId: string): Promise<{ status: string }> {
  throw new Error('revokeHandshake not available in Electron')
}

export async function deleteHandshake(handshakeId: string): Promise<{ success: boolean; error?: string }> {
  const res = await window.handshakeView?.deleteHandshake(handshakeId)
  return res ?? { success: false, error: 'Handshake IPC not available' }
}

export interface PendingP2PBeapEntry {
  id: number
  handshake_id: string
  package_json: string
  created_at: string
}

export async function getPendingP2PBeapMessages(): Promise<PendingP2PBeapEntry[]> {
  const fn = (window.handshakeView as any)?.getPendingP2PBeapMessages
  if (typeof fn === 'function') {
    const res = await fn()
    return res?.items ?? res ?? []
  }
  return []
}

export async function ackPendingP2PBeap(id: number): Promise<void> {
  const fn = (window.handshakeView as any)?.ackPendingP2PBeap
  if (typeof fn === 'function') await fn(id)
}

export interface PendingPlainEmailEntry {
  id: number
  message_json: string
  account_id: string
  email_message_id: string
  created_at: string
}

export async function getPendingPlainEmails(): Promise<PendingPlainEmailEntry[]> {
  const fn = (window.handshakeView as any)?.getPendingPlainEmails
  if (typeof fn === 'function') {
    const res = await fn()
    return res?.items ?? res ?? []
  }
  return []
}

export async function ackPendingPlainEmail(id: number): Promise<void> {
  const fn = (window.handshakeView as any)?.ackPendingPlainEmail
  if (typeof fn === 'function') await fn(id)
}

/** P2P send — delegates to main `handshake.sendBeapViaP2P` (used by BeapPackageBuilder.executeP2PAction). */
export async function sendBeapViaP2P(
  handshakeId: string,
  packageJson: string,
): Promise<{
  success: boolean
  error?: string
  delivered?: boolean
  queued?: boolean
  code?: string
  [key: string]: unknown
}> {
  const fn = (window.handshakeView as any)?.sendBeapViaP2P
  if (typeof fn === 'function') return fn(handshakeId, packageJson)
  throw new Error('sendBeapViaP2P not available (handshakeView bridge missing)')
}

/** Preflight for P2P send — aligns with main `handshake.checkSendReady`. */
export async function checkHandshakeSendReady(
  handshakeId: string,
): Promise<{ ready: boolean; error?: string }> {
  const fn = (window.handshakeView as any)?.checkHandshakeSendReady
  if (typeof fn === 'function') return fn(handshakeId)
  throw new Error('checkHandshakeSendReady not available (handshakeView bridge missing)')
}

export { listHandshakes as _sendHandshakeRpc }
