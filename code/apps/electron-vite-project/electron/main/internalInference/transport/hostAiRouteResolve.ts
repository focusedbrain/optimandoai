/**
 * Canonical Host AI route resolution (Sandbox → paired Host): viability only — no I/O, no dialing.
 * Transport selection for internal inference must converge here; callers adopt incrementally.
 */

import type { HandshakeRecord } from '../../handshake/types'
import { InternalInferenceErrorCode } from '../errors'
import { normalizeP2pIngestUrl } from '../p2pEndpointRepair'
import type { DeriveInternalHostAiPeerRolesResult } from '../policy'
import type {
  HostAiResolvedRoute,
  HostAiRouteCandidateSource,
  HostAiRouteResolveFailure,
  HostAiRouteResolveResult,
} from './hostAiRouteCandidate'

export type HostAiPeerDirectAdvertisement = {
  url: string
  ownerDeviceId: string
  /** `http_header` = Host-attested on HTTP; `relay` = coordination / control-plane attested. */
  source: 'http_header' | 'relay'
}

export type HostAiWebrtcRouteState = {
  dataChannelUp: boolean
  sessionHandshakeId: string | null
  boundPeerDeviceId: string | null
}

export type HostAiRelayRouteState = {
  /** Coordination / control plane attests relay Host AI path for this handshake + peer. */
  serverAttestedAvailable: boolean
  /** Optional relay signaling or tunnel URL — not trusted as identity, only for dialing hints. */
  relayEndpointUrl?: string | null
}

/**
 * Full resolver input. `ledgerP2pEndpoint` is an untrusted ledger hint (never sufficient for direct HTTP).
 */
export type HostAiCanonicalRouteResolveInput = {
  handshakeId: string
  localDeviceId: string
  peerHostDeviceId: string
  record: HandshakeRecord
  roles: DeriveInternalHostAiPeerRolesResult
  webrtc: HostAiWebrtcRouteState | null
  peerDirectAdvertisement: HostAiPeerDirectAdvertisement | null
  /** This process’s published MVP direct BEAP URL, for self-detection only (same normalization as repair). */
  localBeapEndpoint: string | null
  relay: HostAiRelayRouteState
  /** Raw ledger `p2p_endpoint` — examined as untrusted; does not make direct HTTP viable. */
  ledgerP2pEndpoint?: string | null
}

export type HostAiRouteResolveLogPayload = {
  handshake_id: string
  local_device_id: string
  peer_host_device_id: string
  local_role: string
  peer_role: string
  candidate_count: number
  selected_transport: 'webrtc_dc' | 'direct_http' | 'relay_tunnel' | 'none'
  selected_endpoint_source: string
  direct_http_available: boolean
  webrtc_available: boolean
  relay_available: boolean
  decision: 'ok' | 'failed'
  reason: string
  /** When `decision === 'failed'`, mirrors `resolveHostAiRoute` result `code` (stable contract for dashboards). */
  failure_code?: string
}

export type HostAiRouteResolver = (input: HostAiCanonicalRouteResolveInput) => HostAiRouteResolveResult

function normUrl(s: string | null | undefined): string | null {
  const t = typeof s === 'string' ? s.trim() : ''
  if (!t) return null
  return normalizeP2pIngestUrl(t)
}

function urlMatchesLocalBeap(localBeap: string | null, url: string): boolean {
  const l = normUrl(localBeap)
  const u = normUrl(url)
  if (!l || !u) return false
  return l === u
}

function candidateCount(input: HostAiCanonicalRouteResolveInput): number {
  let n = 0
  if (input.webrtc) n += 1
  if (input.peerDirectAdvertisement) n += 1
  if (input.relay?.serverAttestedAvailable) n += 1
  if (input.ledgerP2pEndpoint?.trim()) n += 1
  return n
}

function webrtcViable(input: HostAiCanonicalRouteResolveInput): boolean {
  const w = input.webrtc
  if (!w?.dataChannelUp) return false
  const hid = input.handshakeId.trim()
  if (!w.sessionHandshakeId?.trim() || w.sessionHandshakeId.trim() !== hid) return false
  const peer = input.peerHostDeviceId.trim()
  if (!w.boundPeerDeviceId?.trim() || w.boundPeerDeviceId.trim() !== peer) return false
  return true
}

function directHttpViable(input: HostAiCanonicalRouteResolveInput): boolean {
  const ad = input.peerDirectAdvertisement
  if (!ad || !ad.url.trim()) return false
  const peer = input.peerHostDeviceId.trim()
  if (!ad.ownerDeviceId.trim() || ad.ownerDeviceId.trim() !== peer) return false
  if (urlMatchesLocalBeap(input.localBeapEndpoint, ad.url)) return false
  if (ad.source !== 'http_header' && ad.source !== 'relay') return false
  return true
}

/** True when sandbox→Host roles align and direct HTTP is peer-advertised / attested (not raw ledger syntax). */
export function hostAiCanonicalDirectHttpViable(input: HostAiCanonicalRouteResolveInput): boolean {
  if (!input.roles.ok) return false
  if (input.roles.localRole !== 'sandbox' || input.roles.peerRole !== 'host') return false
  if (input.record.handshake_id.trim() !== input.handshakeId.trim()) return false
  if (input.roles.localCoordinationDeviceId.trim() !== input.localDeviceId.trim()) return false
  if (input.roles.peerCoordinationDeviceId.trim() !== input.peerHostDeviceId.trim()) return false
  return directHttpViable(input)
}

function relayViable(input: HostAiCanonicalRouteResolveInput): boolean {
  return Boolean(input.relay?.serverAttestedAvailable)
}

function adSourceToCandidateSource(ad: HostAiPeerDirectAdvertisement): HostAiRouteCandidateSource {
  return ad.source === 'relay' ? 'server_attested_relay' : 'host_advertisement'
}

function emitResolveLog(p: HostAiRouteResolveLogPayload, enabled: boolean): void {
  if (!enabled) return
  const outcome = p.decision === 'ok' ? 'allow' : 'deny'
  console.log(`[HOST_AI_ROUTE_RESOLVE] ${JSON.stringify({ ...p, outcome })}`)
}

function fail(
  input: HostAiCanonicalRouteResolveInput,
  partial: Partial<HostAiRouteResolveLogPayload> & {
    code: HostAiRouteResolveFailure['code']
    reason: string
    diagnostics?: HostAiRouteResolveFailure['diagnostics']
    local_role?: string
    peer_role?: string
    direct_http_available?: boolean
    webrtc_available?: boolean
    relay_available?: boolean
  },
  emitLogEnabled: boolean,
): HostAiRouteResolveResult {
  const webrtcOk = webrtcViable(input)
  const directOk = directHttpViable(input)
  const relayOk = relayViable(input)
  const lr = partial.local_role ?? 'unknown'
  const pr = partial.peer_role ?? 'unknown'
  emitResolveLog(
    {
      handshake_id: input.handshakeId.trim(),
      local_device_id: input.localDeviceId.trim(),
      peer_host_device_id: input.peerHostDeviceId.trim(),
      local_role: lr,
      peer_role: pr,
      candidate_count: candidateCount(input),
      selected_transport: 'none',
      selected_endpoint_source: 'none',
      direct_http_available: partial.direct_http_available ?? directOk,
      webrtc_available: partial.webrtc_available ?? webrtcOk,
      relay_available: partial.relay_available ?? relayOk,
      decision: 'failed',
      reason: partial.reason,
      failure_code: partial.code,
    },
    emitLogEnabled,
  )
  return {
    ok: false,
    code: partial.code,
    reason: partial.reason,
    diagnostics: partial.diagnostics,
  }
}

/**
 * Single authority for whether WebRTC, verified direct HTTP, or attested relay is viable for Host AI.
 * Does not perform network I/O. Does not read orchestrator-mode.json.
 * @param options.emitLog When true, emits `[HOST_AI_ROUTE_RESOLVE]` (off by default to avoid poll spam).
 */
export function resolveHostAiRoute(
  input: HostAiCanonicalRouteResolveInput,
  options?: { emitLog?: boolean },
): HostAiRouteResolveResult {
  const emitLogEnabled = options?.emitLog === true
  const hid = input.handshakeId.trim()
  const localId = input.localDeviceId.trim()
  const peerId = input.peerHostDeviceId.trim()

  if (!hid || !localId || !peerId) {
    return fail(
      input,
      {
        code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE,
        reason: 'missing_handshake_or_device_ids',
        local_role: 'unknown',
        peer_role: 'unknown',
        direct_http_available: false,
        webrtc_available: false,
        relay_available: false,
      },
      emitLogEnabled,
    )
  }

  if (input.record.handshake_id.trim() !== hid) {
    return fail(
      input,
      {
        code: InternalInferenceErrorCode.MALFORMED_SERVICE_MESSAGE,
        reason: 'handshake_id_mismatch_record',
        local_role: 'unknown',
        peer_role: 'unknown',
      },
      emitLogEnabled,
    )
  }

  const roles = input.roles
  if (!roles.ok) {
    return fail(
      input,
      {
        code: roles.code as HostAiRouteResolveFailure['code'],
        reason: `role_derivation_${roles.reason}`,
        local_role: 'unknown',
        peer_role: 'unknown',
      },
      emitLogEnabled,
    )
  }

  if (roles.localRole !== 'sandbox' || roles.peerRole !== 'host') {
    emitResolveLog(
      {
        handshake_id: hid,
        local_device_id: localId,
        peer_host_device_id: peerId,
        local_role: roles.localRole,
        peer_role: roles.peerRole,
        candidate_count: candidateCount(input),
        selected_transport: 'none',
        selected_endpoint_source: 'none',
        direct_http_available: false,
        webrtc_available: false,
        relay_available: false,
        decision: 'failed',
        reason: 'not_sandbox_to_host',
        failure_code: InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED,
      },
      emitLogEnabled,
    )
    return {
      ok: false,
      code: InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED,
      reason: 'host_ai_requires_sandbox_to_host_roles',
      diagnostics: { handshakeId: hid, peerHostDeviceId: peerId, localSandboxDeviceId: localId },
    }
  }

  if (roles.localCoordinationDeviceId.trim() !== localId) {
    return fail(
      input,
      {
        code: InternalInferenceErrorCode.HOST_AI_ROUTE_OWNER_MISMATCH,
        reason: 'local_device_id_mismatch_roles',
        local_role: roles.localRole,
        peer_role: roles.peerRole,
      },
      emitLogEnabled,
    )
  }

  if (roles.peerCoordinationDeviceId.trim() !== peerId) {
    return fail(
      input,
      {
        code: InternalInferenceErrorCode.HOST_AI_ROUTE_OWNER_MISMATCH,
        reason: 'peer_host_device_id_mismatch_roles',
        local_role: roles.localRole,
        peer_role: roles.peerRole,
      },
      emitLogEnabled,
    )
  }

  const ad = input.peerDirectAdvertisement
  if (ad) {
    if (urlMatchesLocalBeap(input.localBeapEndpoint, ad.url)) {
      return fail(
        input,
        {
          code: InternalInferenceErrorCode.HOST_AI_LOCAL_BEAP_IS_NOT_PEER_HOST,
          reason: 'peer_advertisement_is_local_beap',
          local_role: roles.localRole,
          peer_role: roles.peerRole,
          direct_http_available: false,
        },
        emitLogEnabled,
      )
    }
    if (ad.ownerDeviceId.trim() !== peerId) {
      return fail(
        input,
        {
          code: InternalInferenceErrorCode.HOST_AI_ROUTE_OWNER_MISMATCH,
          reason: 'peer_advertisement_owner_mismatch',
          local_role: roles.localRole,
          peer_role: roles.peerRole,
          direct_http_available: false,
        },
        emitLogEnabled,
      )
    }
  }

  const webrtcOk = webrtcViable(input)
  const directOk = directHttpViable(input)
  const relayOk = relayViable(input)

  const cc = candidateCount(input)

  if (webrtcOk) {
    const route: HostAiResolvedRoute = {
      handshakeId: hid,
      ownerDeviceId: peerId,
      ownerRole: 'host',
      requesterDeviceId: localId,
      requesterRole: 'sandbox',
      transport: 'webrtc_dc',
      source: 'webrtc_session',
      isVerifiedPeerHost: true,
    }
    emitResolveLog(
      {
        handshake_id: hid,
        local_device_id: localId,
        peer_host_device_id: peerId,
        local_role: roles.localRole,
        peer_role: roles.peerRole,
        candidate_count: cc,
        selected_transport: 'webrtc_dc',
        selected_endpoint_source: 'webrtc_session',
        direct_http_available: directOk,
        webrtc_available: true,
        relay_available: relayOk,
        decision: 'ok',
        reason: 'webrtc_dc_selected',
      },
      emitLogEnabled,
    )
    return { ok: true, route }
  }

  if (directOk && ad) {
    const route: HostAiResolvedRoute = {
      handshakeId: hid,
      ownerDeviceId: peerId,
      ownerRole: 'host',
      requesterDeviceId: localId,
      requesterRole: 'sandbox',
      transport: 'direct_http',
      endpoint: normalizeP2pIngestUrl(ad.url.trim()),
      source: adSourceToCandidateSource(ad),
      isVerifiedPeerHost: true,
      provenance: { attestationType: ad.source, notes: 'peer_or_control_plane_attested' },
    }
    emitResolveLog(
      {
        handshake_id: hid,
        local_device_id: localId,
        peer_host_device_id: peerId,
        local_role: roles.localRole,
        peer_role: roles.peerRole,
        candidate_count: cc,
        selected_transport: 'direct_http',
        selected_endpoint_source: route.source,
        direct_http_available: true,
        webrtc_available: webrtcOk,
        relay_available: relayOk,
        decision: 'ok',
        reason: 'direct_http_selected',
      },
      emitLogEnabled,
    )
    return { ok: true, route }
  }

  if (relayOk) {
    const ep = input.relay.relayEndpointUrl?.trim() || null
    const route: HostAiResolvedRoute = {
      handshakeId: hid,
      ownerDeviceId: peerId,
      ownerRole: 'host',
      requesterDeviceId: localId,
      requesterRole: 'sandbox',
      transport: 'relay_tunnel',
      endpoint: ep ? normalizeP2pIngestUrl(ep) : undefined,
      source: 'server_attested_relay',
      isVerifiedPeerHost: true,
      provenance: { attestationType: 'relay_control_plane' },
    }
    emitResolveLog(
      {
        handshake_id: hid,
        local_device_id: localId,
        peer_host_device_id: peerId,
        local_role: roles.localRole,
        peer_role: roles.peerRole,
        candidate_count: cc,
        selected_transport: 'relay_tunnel',
        selected_endpoint_source: 'server_attested_relay',
        direct_http_available: directOk,
        webrtc_available: webrtcOk,
        relay_available: true,
        decision: 'ok',
        reason: 'relay_tunnel_selected',
      },
      emitLogEnabled,
    )
    return { ok: true, route }
  }

  const noAd = !input.peerDirectAdvertisement
  const code =
    noAd && !relayOk
      ? InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING
      : InternalInferenceErrorCode.HOST_AI_NO_VERIFIED_PEER_ROUTE

  return fail(
    input,
    {
      code,
      reason: noAd && !relayOk ? 'no_peer_host_direct_or_relay' : 'no_verified_route',
      local_role: roles.localRole,
      peer_role: roles.peerRole,
      direct_http_available: directOk,
      webrtc_available: webrtcOk,
      relay_available: relayOk,
    },
    emitLogEnabled,
  )
}
