/**
 * Typed Host AI route candidates and resolve-result scaffolding (Sandbox → paired Host).
 * Identity is coordination-device scoped: handshake + owner/requester device ids and roles — not IP.
 *
 * Route viability: see `resolveHostAiRoute` in `hostAiRouteResolve.ts`. Predicates and types are safe to import anywhere.
 */

import { InternalInferenceErrorCode, type InternalInferenceErrorCodeType } from '../errors'

/** How traffic would flow if this candidate were selected. */
export type HostAiRouteCandidateTransport = 'webrtc_dc' | 'direct_http' | 'relay_tunnel'

/** Where the candidate’s trust signal came from. */
export type HostAiRouteCandidateSource =
  | 'webrtc_session'
  | 'host_advertisement'
  | 'server_attested_relay'
  | 'ledger_candidate'

export type HostAiRouteCandidateProvenance = {
  /** e.g. relay capsule, repair log tag — opaque, non-IP */
  attestationType?: string
  relaySessionId?: string
  ledgerResolutionCategory?: string
  notes?: string
}

/**
 * One routable option under consideration. Owner is always the paired Host device; requester is Sandbox.
 */
export type HostAiRouteCandidate = {
  handshakeId: string
  ownerDeviceId: string
  ownerRole: 'host'
  requesterDeviceId: string
  requesterRole: 'sandbox'
  transport: HostAiRouteCandidateTransport
  /** HTTP ingest URL, relay base, or similar — absent for pure WebRTC session handles. */
  endpoint?: string | undefined
  source: HostAiRouteCandidateSource
  /** Epoch ms after which the candidate must not be used without refresh. */
  expiresAt?: number | undefined
  provenance?: HostAiRouteCandidateProvenance | undefined
  /** Host-owned route vetted for this handshake’s peer Host coordination id. */
  isVerifiedPeerHost: boolean
}

export type HostAiResolvedRoute = HostAiRouteCandidate

export type HostAiRouteResolveDiagnostics = {
  handshakeId?: string
  peerHostDeviceId?: string
  localSandboxDeviceId?: string
  detail?: string
}

export type HostAiRouteResolveOk = {
  ok: true
  route: HostAiResolvedRoute
}

export type HostAiRouteResolveFailure = {
  ok: false
  code: InternalInferenceErrorCodeType
  reason: string
  diagnostics?: HostAiRouteResolveDiagnostics | undefined
}

export type HostAiRouteResolveResult = HostAiRouteResolveOk | HostAiRouteResolveFailure

const terminalIdentityCodes: ReadonlySet<InternalInferenceErrorCodeType> = new Set([
  InternalInferenceErrorCode.POLICY_FORBIDDEN,
  InternalInferenceErrorCode.HOST_AI_LOCAL_BEAP_IS_NOT_PEER_HOST,
  InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING,
  InternalInferenceErrorCode.HOST_AI_PEER_ENDPOINT_MISSING,
  InternalInferenceErrorCode.HOST_AI_ROUTE_OWNER_MISMATCH,
  InternalInferenceErrorCode.HOST_AI_ENDPOINT_OWNER_MISMATCH,
  InternalInferenceErrorCode.HOST_AI_ENDPOINT_PROVENANCE_MISSING,
  InternalInferenceErrorCode.HOST_DIRECT_ENDPOINT_MISSING,
  InternalInferenceErrorCode.HOST_AI_CAPABILITY_ROLE_REJECTED,
  InternalInferenceErrorCode.HOST_AI_NO_VERIFIED_PEER_ROUTE,
  InternalInferenceErrorCode.HOST_AI_NO_ROUTE,
  InternalInferenceErrorCode.NO_ACTIVE_INTERNAL_HOST_HANDSHAKE,
  InternalInferenceErrorCode.HOST_AI_LEDGER_ASYMMETRIC,
  InternalInferenceErrorCode.HOST_AI_PAIRING_STALE,
])

export function hostAiRouteFailureCodeIsTerminalIdentityProvenance(code: InternalInferenceErrorCodeType): boolean {
  return terminalIdentityCodes.has(code)
}

/**
 * Data-channel capabilities error: never fall back to unverified HTTP when the Host already returned a
 * terminal role / ownership / provenance / policy class (or local preflight role gate).
 */
export function hostAiDcCapabilityResultBlocksHttpFallback(
  errReason: string | undefined,
  errCode: string | undefined,
): boolean {
  const r = typeof errReason === 'string' ? errReason.trim() : ''
  const c = typeof errCode === 'string' ? errCode.trim() : ''
  if (r === 'not_sandbox_requester' || r === 'role') return true
  if (c && hostAiRouteFailureCodeIsTerminalIdentityProvenance(c as InternalInferenceErrorCodeType)) return true
  if (r === 'inference_error' && c && hostAiRouteFailureCodeIsTerminalIdentityProvenance(c as InternalInferenceErrorCodeType)) {
    return true
  }
  return false
}

export type HostAiProbeTerminalInput = {
  ok: boolean
  reason?: string
  hostAiEndpointDenyDetail?: string
  message?: string
}

/**
 * Sandbox policy/capabilities probe: terminal identity/policy failures must not run GET /internal-inference-policy.
 * Covers deny-detail strings from endpoint repair / resolution (not only `InternalInferenceErrorCode`).
 */
export function isHostAiProbeTerminalNoPolicyFallback(p: HostAiProbeTerminalInput): boolean {
  if (p.ok) return false
  const reason = typeof p.reason === 'string' ? p.reason.trim() : ''
  if (!reason) return false
  /** Peer BEAP ingest missing — top-chat gated only; LAN ODL listing is handled upstream (never fail-close `list_targets`). */
  if (reason === InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING) return false
  if (hostAiRouteFailureCodeIsTerminalIdentityProvenance(reason as InternalInferenceErrorCodeType)) return true
  const d = typeof p.hostAiEndpointDenyDetail === 'string' ? p.hostAiEndpointDenyDetail.trim() : ''
  if (d === 'self_local_beap_selected' || d === 'peer_host_beap_not_advertised') return true
  const msg = typeof p.message === 'string' ? p.message.trim() : ''
  if (msg === 'forbidden_host_role') return true
  return false
}

export function hostAiRouteCandidateBelongsToPeerHost(
  c: HostAiRouteCandidate,
  peerHostDeviceId: string,
): boolean {
  const peer = peerHostDeviceId.trim()
  if (!peer) return false
  return c.ownerRole === 'host' && c.ownerDeviceId.trim() === peer
}

export function hostAiRouteCandidateBelongsToLocalDevice(c: HostAiRouteCandidate, localDeviceId: string): boolean {
  const id = localDeviceId.trim()
  if (!id) return false
  return c.ownerDeviceId.trim() === id || c.requesterDeviceId.trim() === id
}

export function hostAiRouteCandidateIsDirectHttp(c: HostAiRouteCandidate): boolean {
  return c.transport === 'direct_http'
}

/**
 * True when treating this candidate as a Host-owned dial target would be a terminal provenance/identity error:
 * HTTP or relay-tunnel paths require verified peer-Host ownership; unverified WebRTC may still be in-flight.
 */
export function hostAiRouteCandidateIsTerminalIdentityProvenanceFailure(c: HostAiRouteCandidate): boolean {
  if (c.isVerifiedPeerHost) return false
  return c.transport === 'direct_http' || c.transport === 'relay_tunnel'
}

/**
 * True when the candidate could be dialed for the given peer Host: verified, matches peer, not expired,
 * and HTTP/relay paths have a non-empty endpoint.
 */
export function hostAiRouteCandidateMayBeDialed(
  c: HostAiRouteCandidate,
  peerHostDeviceId: string,
  nowMs: number = Date.now(),
): boolean {
  if (!c.isVerifiedPeerHost) return false
  if (!hostAiRouteCandidateBelongsToPeerHost(c, peerHostDeviceId)) return false
  if (c.expiresAt != null && c.expiresAt <= nowMs) return false
  if (c.transport === 'direct_http' || c.transport === 'relay_tunnel') {
    const ep = c.endpoint?.trim() ?? ''
    if (!ep) return false
  }
  return true
}
