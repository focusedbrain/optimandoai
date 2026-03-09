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

export async function listHandshakes(
  _filter?: 'active' | 'pending' | 'all',
): Promise<HandshakeRecord[]> {
  if (window.handshakeView?.listHandshakes) {
    return window.handshakeView.listHandshakes({ state: _filter })
  }
  return []
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

export { listHandshakes as _sendHandshakeRpc }
