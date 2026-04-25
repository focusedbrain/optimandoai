/**
 * Direct HTTP reachability to peer p2p_endpoint (no relay, no prompt payload).
 * GET /beap/p2p-reachability with Bearer + X-BEAP-Handshake only.
 */

import { getHandshakeRecord, listHandshakeRecords } from '../handshake/db'
import { HandshakeState, type HandshakeRecord } from '../handshake/types'
import { isHostMode, isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { getHandshakeDbForInternalInference } from './dbAccess'
import {
  assertP2pEndpointDirect,
  assertRecordForServiceRpc,
  assertSandboxRequestToHost,
  assertHostSendsResultToSandbox,
} from './policy'
import { InternalInferenceErrorCode } from './errors'

export const DIRECT_P2P_REACHABILITY_PATH = '/beap/p2p-reachability'
/** Shorter than policy/inference: we only need TCP + TLS + HTTP response headers. */
export const DIRECT_P2P_REACHABILITY_TIMEOUT_MS = 5_000

export type DirectP2pReachabilityStatus =
  | 'reachable'
  | 'unreachable'
  | 'missing_endpoint'
  | 'tls_error'
  | 'auth_failed'
  | 'timeout'

export function reachabilityUrlFromP2pIngest(ingestUrl: string): string {
  const t = ingestUrl.trim()
  if (/\/beap\/ingest\/?$/i.test(t)) {
    return t.replace(/\/beap\/ingest\/?$/i, DIRECT_P2P_REACHABILITY_PATH)
  }
  try {
    const u = new URL(t)
    u.pathname = DIRECT_P2P_REACHABILITY_PATH
    return u.href
  } catch {
    return t
  }
}

function errChainToString(e: unknown, depth = 0): string {
  if (depth > 6) return ''
  if (e == null) return ''
  if (typeof e === 'string') return e
  if (e instanceof Error) {
    const c = (e as Error & { cause?: unknown }).cause
    return `${e.message} ${c ? errChainToString(c, depth + 1) : ''}`
  }
  if (typeof e === 'object' && 'code' in (e as object)) {
    return String((e as { code?: string }).code) + ' ' + String((e as { message?: string }).message ?? '')
  }
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}

export function classifyDirectP2pReachabilityError(e: unknown): { status: 'tls_error' } | { status: 'unreachable'; detail: string } {
  const s = errChainToString(e)
  if (
    /UNABLE_TO_VERIFY|CERT_|ERR_TLS|ERR_SSL|SSL|tls|x509|self signed|certificate|wrong version number|ephemeral key/i.test(
      s,
    )
  ) {
    return { status: 'tls_error' }
  }
  return { status: 'unreachable', detail: s.trim().slice(0, 200) }
}

export interface DirectP2pReachabilityResult {
  status: DirectP2pReachabilityStatus
  /** When status is not reachable — optional free-text for debugging (not for prompt data). */
  detail?: string
}

async function fetchReachability(
  url: string,
  handshakeId: string,
  token: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<DirectP2pReachabilityResult> {
  const res = await fetchImpl(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      'X-BEAP-Handshake': handshakeId,
    },
    signal,
  })
  if (res.status === 401 || res.status === 403) {
    return { status: 'auth_failed', detail: `http ${res.status}` }
  }
  if (res.ok) {
    return { status: 'reachable' }
  }
  return { status: 'unreachable', detail: `http ${res.status}` }
}

function resolveContext(handshakeId: string, db: any): { ok: true; record: HandshakeRecord } | { ok: false; result: DirectP2pReachabilityResult } {
  const hid = String(handshakeId ?? '').trim()
  const r = getHandshakeRecord(db, hid)
  const ar = assertRecordForServiceRpc(r)
  if (!ar.ok) {
    return { ok: false, result: { status: 'unreachable', detail: ar.code } }
  }
  if (isSandboxMode()) {
    const role = assertSandboxRequestToHost(ar.record)
    if (!role.ok) {
      return { ok: false, result: { status: 'unreachable', detail: role.code } }
    }
    return { ok: true, record: ar.record }
  }
  if (isHostMode()) {
    const role = assertHostSendsResultToSandbox(ar.record)
    if (!role.ok) {
      return { ok: false, result: { status: 'unreachable', detail: role.code } }
    }
    return { ok: true, record: ar.record }
  }
  return { ok: false, result: { status: 'unreachable', detail: InternalInferenceErrorCode.INVALID_INTERNAL_ROLE } }
}

/**
 * HTTP GET to peer's direct p2p base — no request body, no user prompt, no Ollama payload.
 */
export async function checkDirectP2pReachabilityFromHandshake(
  handshakeId: string,
  options?: { timeoutMs?: number; fetchImpl?: typeof fetch },
): Promise<DirectP2pReachabilityResult> {
  const doFetch = options?.fetchImpl ?? globalThis.fetch
  const timeoutMs = Math.min(options?.timeoutMs ?? DIRECT_P2P_REACHABILITY_TIMEOUT_MS, 15_000)
  if (!isSandboxMode() && !isHostMode()) {
    return { status: 'unreachable', detail: 'orchestrator mode' }
  }
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return { status: 'unreachable', detail: 'no database' }
  }
  const resolved = resolveContext(handshakeId, db)
  if (!resolved.ok) {
    return resolved.result
  }
  const { record } = resolved
  const direct = assertP2pEndpointDirect(db, record.p2p_endpoint)
  if (!direct.ok) {
    if (direct.code === InternalInferenceErrorCode.SERVICE_RPC_NOT_SUPPORTED) {
      return { status: 'unreachable', detail: 'relay endpoint — not direct P2P' }
    }
    return { status: 'missing_endpoint' }
  }
  const ep = record.p2p_endpoint?.trim() ?? ''
  const token = record.counterparty_p2p_token
  if (!ep || !token?.trim()) {
    return { status: 'missing_endpoint' }
  }
  const url = reachabilityUrlFromP2pIngest(ep)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetchReachability(url, record.handshake_id, token, ac.signal, doFetch)
    clearTimeout(timer)
    return res
  } catch (e) {
    clearTimeout(timer)
    if ((e as Error)?.name === 'AbortError') {
      return { status: 'timeout' }
    }
    const c = classifyDirectP2pReachabilityError(e)
    if (c.status === 'tls_error') {
      return { status: 'tls_error', detail: errChainToString(e).trim().slice(0, 200) }
    }
    return { status: 'unreachable', detail: c.detail }
  }
}

export type DirectReachabilityListRow = {
  handshakeId: string
  /** Counterparty display name. */
  peerDisplayName: string
  /** Fixed label for the peer role. */
  peerRoleLabel: string
  pairingCodeDisplay: string
  directP2pAvailable: boolean
  endpointHostLabel: string | null
}

function formatPairingCode(raw: string | null | undefined): string {
  const s = (raw ?? '').replace(/\D/g, '').trim()
  if (s.length === 6) {
    return `${s.slice(0, 3)}-${s.slice(3)}`
  }
  return s || '—'
}

function peerSandboxNameFromRecord(r: HandshakeRecord): string {
  if (r.local_role === 'initiator') {
    if (r.initiator_device_role === 'sandbox') {
      return (r.initiator_device_name?.trim() || 'This computer (Sandbox)').trim()
    }
    return (r.acceptor_device_name?.trim() || 'Sandbox').trim()
  }
  if (r.acceptor_device_role === 'sandbox') {
    return (r.acceptor_device_name?.trim() || 'This computer (Sandbox)').trim()
  }
  return (r.initiator_device_name?.trim() || 'Sandbox').trim()
}

function endpointLabel(ingestUrl: string | null | undefined): string | null {
  const ep = typeof ingestUrl === 'string' ? ingestUrl.trim() : ''
  if (!ep) return null
  try {
    return new URL(ep).hostname
  } catch {
    return null
  }
}

/**
 * List ACTIVE internal handshakes where this device is Host and peer is Sandbox (direct P2P status only).
 */
export async function listHostToSandboxDirectReachabilityRows(): Promise<DirectReachabilityListRow[]> {
  if (!isHostMode()) {
    return []
  }
  const db = await getHandshakeDbForInternalInference()
  if (!db) {
    return []
  }
  const rows = listHandshakeRecords(db, { state: HandshakeState.ACTIVE, handshake_type: 'internal' })
  const out: DirectReachabilityListRow[] = []
  for (const r of rows) {
    const ar = assertRecordForServiceRpc(r)
    if (!ar.ok) {
      continue
    }
    const h = assertHostSendsResultToSandbox(ar.record)
    if (!h.ok) {
      continue
    }
    const direct = assertP2pEndpointDirect(db, ar.record.p2p_endpoint)
    out.push({
      handshakeId: ar.record.handshake_id,
      peerDisplayName: peerSandboxNameFromRecord(ar.record),
      peerRoleLabel: 'Sandbox orchestrator',
      pairingCodeDisplay: formatPairingCode(ar.record.internal_peer_pairing_code),
      directP2pAvailable: direct.ok,
      endpointHostLabel: endpointLabel(ar.record.p2p_endpoint),
    })
  }
  return out
}
