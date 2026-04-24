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

type LedgerParty = { email: string; wrdesk_user_id: string }

/**
 * Main-process `handshake:list` returns full ledger `HandshakeRecord` rows (initiator/acceptor,
 * snake_case peer key fields). Map to extension `HandshakeRecord` for `RecipientHandshakeSelect`.
 */
export function mapLedgerHandshakeToRpc(raw: unknown): HandshakeRecord {
  if (typeof raw === 'object' && raw !== null && 'counterparty_email' in raw && !('initiator' in raw)) {
    return raw as HandshakeRecord
  }

  const r = raw as {
    handshake_id: string
    state: HandshakeRecord['state']
    local_role: 'initiator' | 'acceptor'
    initiator: LedgerParty
    acceptor: LedgerParty | null
    relationship_id: string
    sharing_mode?: 'receive-only' | 'reciprocal' | null
    created_at: string
    activated_at?: string | null
    expires_at?: string | null
    p2p_endpoint?: string | null
    receiver_email?: string | null
    peer_x25519_public_key_b64?: string | null
    peer_mlkem768_public_key_b64?: string | null
  }

  let counterparty_email = ''
  let counterparty_user_id = ''
  if (r.local_role === 'initiator') {
    if (r.acceptor) {
      counterparty_email = r.acceptor.email ?? ''
      counterparty_user_id = r.acceptor.wrdesk_user_id ?? ''
    } else {
      counterparty_email = (r.receiver_email ?? '').trim()
    }
  } else {
    counterparty_email = r.initiator?.email ?? ''
    counterparty_user_id = r.initiator?.wrdesk_user_id ?? ''
  }

  return {
    handshake_id: r.handshake_id,
    state: r.state,
    local_role: r.local_role,
    counterparty_email,
    counterparty_user_id,
    relationship_id: r.relationship_id,
    sharing_mode: r.sharing_mode ?? undefined,
    created_at: r.created_at,
    activated_at: r.activated_at ?? undefined,
    expires_at: r.expires_at ?? null,
    peerX25519PublicKey: r.peer_x25519_public_key_b64 ?? undefined,
    peerPQPublicKey: r.peer_mlkem768_public_key_b64 ?? undefined,
    p2pEndpoint: r.p2p_endpoint ?? null,
  }
}

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

  const rows = await window.handshakeView.listHandshakes(ipcFilter)
  if (!Array.isArray(rows)) return []
  return rows.map(mapLedgerHandshakeToRpc)
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

const ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED_MSG =
  'ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED: Normal handshake accept requires the acceptor device X25519 public key ' +
  '(`senderX25519PublicKeyB64` or `key_agreement.x25519_public_key_b64`). ' +
  'If it is omitted, Electron would generate an ephemeral X25519 key here, which breaks key continuity with the acceptor device and qBEAP decryption.'

/**
 * Electron preload's `beap.getDevicePublicKey` resolves to `{ success, publicKey? }`;
 * older or browser-style call sites may return the base64 string directly.
 */
function extractDevicePublicKeyB64(result: unknown): string {
  if (result == null) return ''
  if (typeof result === 'string') {
    const s = result.trim()
    return s
  }
  if (typeof result !== 'object') return ''
  const o = result as { success?: unknown; publicKey?: unknown }
  if (o.success !== true) return ''
  if (typeof o.publicKey !== 'string') return ''
  return o.publicKey.trim()
}

type BeapDevicePublicKeyResultShape = 'string' | 'object_success' | 'object_failure' | 'missing' | 'invalid'

function classifyBeapGetDevicePublicKeyResultShape(raw: unknown): BeapDevicePublicKeyResultShape {
  if (raw == null) return 'missing'
  if (typeof raw === 'string') return raw.trim() === '' ? 'invalid' : 'string'
  if (typeof raw !== 'object') return 'invalid'
  const o = raw as { success?: unknown; publicKey?: unknown }
  if (o.success === true) {
    if (typeof o.publicKey !== 'string' || o.publicKey.trim() === '') return 'invalid'
    return 'object_success'
  }
  if (o.success === false) return 'object_failure'
  return 'invalid'
}

/** Normal-for-shim path only (no device_role hint) — beap returned no usable key. */
function logNormalAcceptX25519ShimFailure(args: {
  handshakeId: string
  deviceRoleInternalHint: boolean
  handshakeType?: string | null
  raw: unknown
}): void {
  const beap = typeof window !== 'undefined' ? (window as Window & { beap?: { getDevicePublicKey?: unknown } }).beap : undefined
  const resultShape = classifyBeapGetDevicePublicKeyResultShape(args.raw)
  console.warn(
    '[HANDSHAKE][ACCEPT_X25519]',
    JSON.stringify({
      handshakeId: args.handshakeId,
      device_role_internal_hint: args.deviceRoleInternalHint,
      handshake_type: args.handshakeType ?? null,
      has_beap: !!beap,
      has_getDevicePublicKey: typeof beap?.getDevicePublicKey === 'function',
      result_shape: resultShape,
    }),
  )
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
    /**
     * UX for internal pairing in `AcceptHandshakeModal` (host/sandbox). This is a **hint only**;
     * whether the handshake is internal same-principal is **authoritative in main** via persisted
     * `record.handshake_type`. The shim does not use `device_role` as the final security decision.
     */
    device_name?: string
    device_role?: 'host' | 'sandbox'
    local_pairing_code_typed?: string
  },
): Promise<HandshakeAcceptResponse> {
  if (!window.handshakeView?.acceptHandshake) throw new Error('Handshake IPC not available')

  /**
   * X25519 + ML-KEM: supply keys for normal accepts when beap is available; main `ensureKeyAgreementKeys`
   * remains canonical for binding.
   *
   * Control flow (after refactor — behavior aligned with main using `record.handshake_type`):
   * - **Before (conceptual bug):** `internalAccept := device_role` doubled as a security label; easy to
   *   misread as “internal handshake” vs persisted row state.
   * - **After:** `deviceRoleInternalHint` only affects *shim* fail-fast: when absent, the shim can treat
   *   the call as a normal accept path and require `getDevicePublicKey` before IPC. When present, the shim
   *   never returns ERR just for missing `senderX25519PublicKeyB64` — main/core loads the row and applies
   *   `record.handshake_type` (see `handleHandshakeRPC` + `handshake:accept` in Electron main).
   * - `deviceRoleInternalHint` true → optional beap, forward without X25519 if unavailable.
   * - `deviceRoleInternalHint` false → require non-empty beap key; fail fast if missing.
   */
  // Fetch the device X25519 public key and generate a fresh ML-KEM-768 keypair so that
  // ensureKeyAgreementKeys in the main process does NOT fall back to generating a random
  // ephemeral keypair that would later mismatch on reply.
  let senderX25519PublicKeyB64: string | undefined
  let senderMlkem768PublicKeyB64: string | undefined
  let mlkem768SecretKeyB64: string | undefined

  const deviceRoleInternalHint =
    contextOpts?.device_role === 'host' || contextOpts?.device_role === 'sandbox'
  const handshakeTypeOpt =
    contextOpts && typeof contextOpts === 'object' && 'handshake_type' in contextOpts
      ? (contextOpts as { handshake_type?: string }).handshake_type ?? null
      : null

  let normalAcceptBeapRaw: unknown = undefined
  if (!deviceRoleInternalHint) {
    try {
      normalAcceptBeapRaw = await window.beap?.getDevicePublicKey()
    } catch (e) {
      console.error('[KEY-AGREEMENT] acceptHandshake (shim): failed to get device X25519 key:', e)
      normalAcceptBeapRaw = undefined
    }
    const trimmed = extractDevicePublicKeyB64(normalAcceptBeapRaw)
    if (!trimmed) {
      logNormalAcceptX25519ShimFailure({
        handshakeId: handshakeId,
        deviceRoleInternalHint: false,
        handshakeType: handshakeTypeOpt,
        raw: normalAcceptBeapRaw,
      })
      return {
        type: 'handshake-accept-result',
        success: false,
        error: ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED_MSG,
        code: 'ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED',
        handshake_id: handshakeId,
        email_sent: false,
        email_error: undefined,
        local_result: { success: false, error: ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED_MSG },
        context_sync_status: 'skipped',
        electronGeneratedMlkemSecret: null,
        message: undefined,
        status: 'error',
      } as HandshakeAcceptResponse
    }
    senderX25519PublicKeyB64 = trimmed
    console.log('[KEY-AGREEMENT] acceptHandshake (shim): device X25519 public key fetched')
  } else {
    try {
      const rawInternal = await window.beap?.getDevicePublicKey()
      const t = extractDevicePublicKeyB64(rawInternal)
      if (t) senderX25519PublicKeyB64 = t
      if (t) console.log('[KEY-AGREEMENT] acceptHandshake (shim): device X25519 public key fetched')
    } catch (e) {
      console.error('[KEY-AGREEMENT] acceptHandshake (shim): failed to get device X25519 key:', e)
    }
  }

  try {
    const { pqKemSupportedAsync, pqKemGenerateKeyPair } = await import('@ext/beap-messages/services/beapCrypto')
    if (await pqKemSupportedAsync()) {
      const kp = await pqKemGenerateKeyPair()
      senderMlkem768PublicKeyB64 = kp.publicKeyB64
      mlkem768SecretKeyB64 = kp.secretKeyB64
      console.log('[KEY-AGREEMENT] acceptHandshake (shim): ML-KEM-768 keypair generated')
    }
  } catch {
    // PQ service unavailable — Electron will generate the keypair and return the secret
  }

  // When there is no device_role hint, the shim is on the normal-accept path: do not call IPC
  // without a concrete device X25519. When `deviceRoleInternalHint` is set, main may resolve the key
  // from the orchestrator record for true internal handshakes (`record.handshake_type === 'internal'`).
  if (!deviceRoleInternalHint) {
    if (typeof senderX25519PublicKeyB64 !== 'string' || !senderX25519PublicKeyB64.trim()) {
      logNormalAcceptX25519ShimFailure({
        handshakeId: handshakeId,
        deviceRoleInternalHint: false,
        handshakeType: handshakeTypeOpt,
        raw: normalAcceptBeapRaw,
      })
      return {
        type: 'handshake-accept-result',
        success: false,
        error: ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED_MSG,
        code: 'ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED',
        handshake_id: handshakeId,
        email_sent: false,
        email_error: undefined,
        local_result: { success: false, error: ERR_HANDSHAKE_ACCEPT_X25519_REQUIRED_MSG },
        context_sync_status: 'skipped',
        electronGeneratedMlkemSecret: null,
        message: undefined,
        status: 'error',
      } as HandshakeAcceptResponse
    }
  }

  const optsWithKeys = {
    ...contextOpts,
    senderX25519PublicKeyB64,
    senderMlkem768PublicKeyB64,
    senderMlkem768SecretKeyB64: mlkem768SecretKeyB64,
  }

  const res = await window.handshakeView.acceptHandshake(handshakeId, sharingMode, fromAccountId, optsWithKeys)

  // When WE generated the ML-KEM keypair, the secret is already stored in the Electron DB
  // (main process stores it in local_mlkem768_secret_key_b64 on the handshake record).
  // When Electron generated it as a fallback, it returns electronGeneratedMlkemSecret —
  // on the dashboard side the DB is the canonical store so no additional persistence is needed.
  if (mlkem768SecretKeyB64) {
    console.log('[KEY-AGREEMENT] acceptHandshake (shim): ML-KEM secret stored in Electron DB via accept handler')
  } else if ((res as any).electronGeneratedMlkemSecret) {
    console.warn('[KEY-AGREEMENT] acceptHandshake (shim): Electron generated ML-KEM fallback — secret in DB')
  } else {
    console.error('[KEY-AGREEMENT] acceptHandshake (shim): NO ML-KEM secret available — inbound hybrid qBEAP WILL FAIL')
  }

  return res
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
): Promise<{ ready: boolean; error?: string; localX25519PublicKey?: string; hasStoredPrivateKey?: boolean }> {
  const fn = (window.handshakeView as any)?.checkHandshakeSendReady
  if (typeof fn === 'function') return fn(handshakeId)
  throw new Error('checkHandshakeSendReady not available (handshakeView bridge missing)')
}

export { listHandshakes as _sendHandshakeRpc }
