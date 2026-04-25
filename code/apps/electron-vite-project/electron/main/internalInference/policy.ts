import type { HandshakeRecord } from '../handshake/types'
import { getP2PConfig } from '../p2p/p2pConfig'
import { InternalInferenceErrorCode } from './errors'

function samePrincipal(r: HandshakeRecord): boolean {
  const a = r.initiator?.wrdesk_user_id
  const b = r.acceptor?.wrdesk_user_id
  return typeof a === 'string' && typeof b === 'string' && a.length > 0 && a === b
}

/** Exported for `listTargets` / ledger filtering — same check as `assertRecordForServiceRpc` (without identity-complete gate). */
export function handshakeSamePrincipal(r: HandshakeRecord): boolean {
  return samePrincipal(r)
}

export function localDeviceRole(r: HandshakeRecord): 'host' | 'sandbox' | null {
  if (r.local_role === 'initiator') {
    return r.initiator_device_role ?? null
  }
  return r.acceptor_device_role ?? null
}

export function peerDeviceRole(r: HandshakeRecord): 'host' | 'sandbox' | null {
  if (r.local_role === 'initiator') {
    return r.acceptor_device_role ?? null
  }
  return r.initiator_device_role ?? null
}

function peerCoordinationDeviceId(r: HandshakeRecord): string | null {
  const t =
    r.local_role === 'initiator'
      ? r.acceptor_coordination_device_id?.trim()
      : r.initiator_coordination_device_id?.trim()
  return t && t.length > 0 ? t : null
}

function localCoordinationDeviceId(r: HandshakeRecord): string | null {
  const t =
    r.local_role === 'initiator'
      ? r.initiator_coordination_device_id?.trim()
      : r.acceptor_coordination_device_id?.trim()
  return t && t.length > 0 ? t : null
}

export function isCoordinationServiceEndpointUrl(p2pEndpoint: string, coordinationBase: string | undefined | null): boolean {
  const t = p2pEndpoint.trim().toLowerCase()
  if (t.includes('relay.wrdesk.com') && t.includes('/beap/')) {
    return true
  }
  if (!coordinationBase?.trim()) return false
  try {
    const c = new URL(coordinationBase.trim().replace(/\/$/, ''))
    const p = new URL(t)
    return p.host === c.host && p.pathname.includes('beap')
  } catch {
    return false
  }
}

/**
 * classifies P2P URL for Host discovery logging (not security enforcement).
 * `relay` = coordination/BEAP service path (not a direct LAN/TUN endpoint for internal inference).
 */
export function p2pEndpointKind(
  db: any,
  p2pEndpoint: string | null | undefined,
): 'direct' | 'relay' | 'missing' | 'invalid' {
  const ep = typeof p2pEndpoint === 'string' ? p2pEndpoint.trim() : ''
  if (!ep) return 'missing'
  try {
    void new URL(ep)
  } catch {
    return 'invalid'
  }
  const cfg = getP2PConfig(db)
  if (isCoordinationServiceEndpointUrl(ep, cfg.coordination_url)) return 'relay'
  return 'direct'
}

/**
 * P2P URL class for direct capability-probe logging (incl. localhost vs cross-machine).
 */
export type P2pEndpointProbeLogKind = 'direct' | 'relay' | 'localhost' | 'invalid' | 'missing'

export function p2pEndpointKindForProbeLog(
  db: any,
  p2pEndpoint: string | null | undefined,
): P2pEndpointProbeLogKind {
  const base = p2pEndpointKind(db, p2pEndpoint)
  if (base === 'missing' || base === 'invalid' || base === 'relay') {
    return base
  }
  const ep = typeof p2pEndpoint === 'string' ? p2pEndpoint.trim() : ''
  try {
    const h = new URL(ep).hostname.toLowerCase()
    if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]') {
      return 'localhost'
    }
  } catch {
    return 'invalid'
  }
  return 'direct'
}

/**
 * Direct Host inference (MVP): only non-relay, non-loopback addresses are valid (e.g. `http://192.168.x.x:port/beap/ingest`).
 * Relay, localhost/127.0.0.1, and invalid/missing URLs are not valid for the Host AI row.
 */
export type P2pMvpEndpointClass = 'direct_lan' | 'localhost' | 'relay' | 'missing' | 'invalid'

export function p2pEndpointMvpClass(
  db: any,
  p2pEndpoint: string | null | undefined,
): P2pMvpEndpointClass {
  const probe = p2pEndpointKindForProbeLog(db, p2pEndpoint)
  if (probe === 'missing' || probe === 'invalid') {
    return probe
  }
  if (probe === 'relay' || p2pEndpointKind(db, p2pEndpoint) === 'relay') {
    return 'relay'
  }
  if (probe === 'localhost') {
    return 'localhost'
  }
  return 'direct_lan'
}

export function assertP2pEndpointDirect(db: any, p2pEndpoint: string | null | undefined): { ok: true } | { ok: false; code: string } {
  const ep = typeof p2pEndpoint === 'string' ? p2pEndpoint.trim() : ''
  const kind = p2pEndpointKind(db, ep)
  if (kind === 'missing' || kind === 'invalid') {
    return { ok: false, code: InternalInferenceErrorCode.HOST_DIRECT_P2P_UNAVAILABLE }
  }
  if (kind === 'relay') {
    return { ok: false, code: InternalInferenceErrorCode.SERVICE_RPC_NOT_SUPPORTED }
  }
  return { ok: true }
}

/**
 * P2P internal inference may run when:
 * - `p2p_endpoint` is a direct Host BEAP ingest (LAN) — optional legacy HTTP path; or
 * - `p2p_endpoint` is the coordination/relay URL **and** the WebRTC+signaling stack is on — relay is for
 *   signaling; the inference data plane is the DataChannel, not HTTP to this URL.
 * Missing/invalid URLs are never OK.
 */
export function internalInferenceEndpointGateOk(
  db: any,
  p2pEndpoint: string | null | undefined,
  flags: {
    p2pInferenceEnabled: boolean
    p2pInferenceWebrtcEnabled: boolean
    p2pInferenceSignalingEnabled: boolean
  },
): boolean {
  if (assertP2pEndpointDirect(db, p2pEndpoint).ok) {
    return true
  }
  if (
    flags.p2pInferenceEnabled &&
    flags.p2pInferenceWebrtcEnabled &&
    flags.p2pInferenceSignalingEnabled &&
    p2pEndpointKind(db, p2pEndpoint) === 'relay'
  ) {
    return true
  }
  return false
}

/** True only for direct (non-relay) ingest — the only case where HTTP POST to `p2p_endpoint` is allowed for internal inference. */
export function canPostInternalInferenceHttpToP2pEndpointIngest(
  db: any,
  p2pEndpoint: string | null | undefined,
): boolean {
  return assertP2pEndpointDirect(db, p2pEndpoint).ok
}

export function assertRecordForServiceRpc(
  r: HandshakeRecord | null | undefined,
): { ok: true; record: HandshakeRecord } | { ok: false; code: string } {
  if (!r) {
    return { ok: false, code: InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE }
  }
  if (r.handshake_type !== 'internal') {
    return { ok: false, code: InternalInferenceErrorCode.POLICY_FORBIDDEN }
  }
  if (r.state !== 'ACTIVE') {
    return { ok: false, code: InternalInferenceErrorCode.POLICY_FORBIDDEN }
  }
  if (!samePrincipal(r)) {
    return { ok: false, code: InternalInferenceErrorCode.POLICY_FORBIDDEN }
  }
  if (r.internal_coordination_repair_needed) {
    return { ok: false, code: InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE }
  }
  if (r.internal_coordination_identity_complete !== true) {
    return { ok: false, code: InternalInferenceErrorCode.POLICY_FORBIDDEN }
  }
  return { ok: true, record: r }
}

/**
 * Ledger-only: this row says local device is Sandbox and peer is Host.
 * Authoritative for internal Host AI / P2P policy: do not gate on `orchestrator-mode.json` (setup
 * metadata; can be stale).
 */
export function assertLedgerRolesSandboxToHost(
  r: HandshakeRecord,
): { ok: true } | { ok: false; code: string } {
  if (localDeviceRole(r) !== 'sandbox' || peerDeviceRole(r) !== 'host') {
    return { ok: false, code: InternalInferenceErrorCode.INVALID_INTERNAL_ROLE }
  }
  return { ok: true }
}

/** Sandbox→Host request path: ledger role is authoritative; persisted orchestrator mode is not a second gate. */
export function assertSandboxRequestToHost(r: HandshakeRecord): { ok: true } | { ok: false; code: string } {
  return assertLedgerRolesSandboxToHost(r)
}

export function assertHostReceivesRequestFromSandbox(
  r: HandshakeRecord,
  senderDeviceId: string,
): { ok: true } | { ok: false; code: string } {
  if (localDeviceRole(r) !== 'host' || peerDeviceRole(r) !== 'sandbox') {
    return { ok: false, code: InternalInferenceErrorCode.INVALID_INTERNAL_ROLE }
  }
  const peer = peerCoordinationDeviceId(r)
  if (!peer || peer !== senderDeviceId.trim()) {
    return { ok: false, code: InternalInferenceErrorCode.POLICY_FORBIDDEN }
  }
  return { ok: true }
}

export function assertHostSendsResultToSandbox(r: HandshakeRecord): { ok: true } | { ok: false; code: string } {
  if (localDeviceRole(r) !== 'host' || peerDeviceRole(r) !== 'sandbox') {
    return { ok: false, code: InternalInferenceErrorCode.INVALID_INTERNAL_ROLE }
  }
  return { ok: true }
}

export function assertSandboxReceivesResultFromHost(
  r: HandshakeRecord,
  senderDeviceId: string,
): { ok: true } | { ok: false; code: string } {
  if (localDeviceRole(r) !== 'sandbox' || peerDeviceRole(r) !== 'host') {
    return { ok: false, code: InternalInferenceErrorCode.INVALID_INTERNAL_ROLE }
  }
  const peer = peerCoordinationDeviceId(r)
  if (!peer || peer !== senderDeviceId.trim()) {
    return { ok: false, code: InternalInferenceErrorCode.POLICY_FORBIDDEN }
  }
  return { ok: true }
}

export { localCoordinationDeviceId, peerCoordinationDeviceId }
