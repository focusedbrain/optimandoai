/**
 * Authoritative Host AI / Sandbox internal transport and selector policy.
 * - Handshake trust → targetDetected
 * - Feature flags + session → P2P vs legacy HTTP
 * - p2p_endpoint (direct / relay) only gates legacy HTTP POST; relay does not block target or P2P when stack is on
 *
 * List targets and intent routing must not branch on p2p_endpoint_kind alone; use this result.
 */
import { isWebRtcHostAiArchitectureEnabled, type P2pInferenceFlagSnapshot } from '../p2pInferenceFlags'
import {
  p2pEndpointKind,
  p2pEndpointMvpClass,
  canPostInternalInferenceHttpToP2pEndpointIngest,
  deriveInternalHostAiPeerRoles,
  handshakeSamePrincipal,
  internalInferenceEndpointGateOk,
  type P2pMvpEndpointClass,
} from '../policy'
import { getInstanceId } from '../../orchestrator/orchestratorModeStore'
import { getSessionState, P2pSessionPhase, type P2pSessionState } from '../p2pSession/p2pInferenceSessionManager'
import { isP2pDataChannelUpForHandshake } from '../p2pSession/p2pSessionWait'
import type { HandshakeRecord } from '../../handshake/types'

const L = '[HOST_AI_TRANSPORT]'

export type HostAiOperationContext = 'list_targets' | 'capabilities' | 'request' | 'result'

export type HostAiSelectorPhase =
  | 'hidden'
  | 'detected'
  | 'connecting'
  | 'ready'
  | 'p2p_unavailable'
  | 'legacy_http_available'
  | 'legacy_http_invalid'
  | 'policy_disabled'
  | 'no_model'

export type HostAiPreferredTransport = 'webrtc_p2p' | 'legacy_http' | 'none'

export type HandshakeDerivedRoles = {
  /** Ledger says local sandbox ↔ remote host. */
  ledgerSandboxToHost: boolean
  samePrincipal: boolean
  internalIdentityComplete: boolean
  peerHostDeviceIdPresent: boolean
}

export type LegacyEndpointInfo = {
  p2pEndpointKind: 'direct' | 'relay' | 'missing' | 'invalid'
  mayPostInternalInferenceHttpToIngest: boolean
  mvpClassForLog: P2pMvpEndpointClass
  /** Result of `internalInferenceEndpointGateOk` — direct BEAP or relay+full P2P stack. */
  p2pEndpointGateOpen: boolean
}

export type HostPolicyState = {
  allowSandboxInference: boolean | null
  hasActiveModel: boolean | null
}

export type HostAiSessionStateInput = {
  handshakeId: string
  p2pSession: P2pSessionState | null
  dataChannelUp: boolean
}

export type HostAiTransportDeciderInput = {
  operationContext: HostAiOperationContext
  handshakeRecord: HandshakeRecord | null
  handshakeDerivedRoles: HandshakeDerivedRoles
  featureFlags: P2pInferenceFlagSnapshot
  sessionState: HostAiSessionStateInput | null
  legacyEndpointInfo: LegacyEndpointInfo
  hostPolicyState: HostPolicyState | null
  /**
   * Coordination GET /health `host_ai_p2p_signaling` — required when `legacyEndpointInfo.p2pEndpointKind === 'relay'`
   * and the full P2P stack is on. Omitted or `'na'` is treated as not applicable (non-relay or stack off).
   */
  relayHostAiP2pSignaling?: 'supported' | 'missing' | 'na'
}

export type HostAiTransportDeciderResult = {
  targetDetected: boolean
  selectorPhase: HostAiSelectorPhase
  /** Intent routing hint; for list_targets mirrors best-effort P2P vs HTTP. */
  preferredTransport: HostAiPreferredTransport
  /**
   * `WRDESK_P2P_INFERENCE_HTTP_FALLBACK` only. Does not imply legacy HTTP will succeed (see `legacyHttpFallbackViable`).
   */
  mayUseLegacyHttpFallback: boolean
  /**
   * True when HTTP fallback is both **allowed** and the ledger has a valid **direct** BEAP ingest for POST.
   * Isolated from Host discovery: only describes legacy fallback readiness.
   */
  legacyHttpFallbackViable: boolean
  /**
   * True when WebRTC+signaling path may be attempted (incl. relay as signaling URL).
   * Do not re-derive from p2p_endpoint_kind in callers; use this for intent gating.
   */
  p2pTransportEndpointOpen: boolean
  failureCode: string | null
  userSafeReason: string | null
}

export type HostAiTransportAuthoritative =
  | {
      kind: 'webrtc_p2p'
      phase: 'connecting' | 'ready' | 'failed'
      allowLegacyHttpProbe: false
    }
  | { kind: 'legacy_http'; phase: 'available' | 'invalid'; allowLegacyHttpProbe: true }
  | { kind: 'none'; phase: 'disabled' | 'unavailable'; allowLegacyHttpProbe: false }

/**
 * One authoritative result for gating HTTP capability probes: when `kind === 'webrtc_p2p'`,
 * callers must not POST/GET the relay or direct legacy inference HTTP paths (use P2P/DC or wait).
 */
export function decideHostAiTransport(
  d: HostAiTransportDeciderResult,
): HostAiTransportAuthoritative {
  if (d.preferredTransport === 'webrtc_p2p') {
    let ph: 'connecting' | 'ready' | 'failed' = 'connecting'
    if (d.selectorPhase === 'ready') ph = 'ready'
    else if (d.selectorPhase === 'p2p_unavailable' && d.failureCode) ph = 'failed'
    return { kind: 'webrtc_p2p', phase: ph, allowLegacyHttpProbe: false }
  }
  if (d.preferredTransport === 'legacy_http') {
    return {
      kind: 'legacy_http',
      phase: d.selectorPhase === 'legacy_http_invalid' ? 'invalid' : 'available',
      allowLegacyHttpProbe: true,
    }
  }
  if (d.selectorPhase === 'policy_disabled' || d.failureCode === 'HOST_POLICY_DISABLED') {
    return { kind: 'none', phase: 'disabled', allowLegacyHttpProbe: false }
  }
  return { kind: 'none', phase: 'unavailable', allowLegacyHttpProbe: false }
}

function p2pStackEnabled(f: P2pInferenceFlagSnapshot): boolean {
  return f.p2pInferenceEnabled && f.p2pInferenceWebrtcEnabled && f.p2pInferenceSignalingEnabled
}

/**
 * One authoritative policy decision for Host internal AI: discovery row, selector phase, and transport hints.
 */
export function decideInternalInferenceTransport(
  input: HostAiTransportDeciderInput,
): HostAiTransportDeciderResult {
  const {
    handshakeRecord: hr,
    handshakeDerivedRoles: roles,
    featureFlags: f,
    sessionState: ss,
    legacyEndpointInfo: le,
    hostPolicyState: pol,
  } = input
  const relaySig = input.relayHostAiP2pSignaling ?? 'na'

  const mayFb = f.p2pInferenceHttpFallback
  /** `HTTP_FALLBACK` flag && direct BEAP ingest — legacy path could actually be used. Relay never POSTs; `mayPost` is false. */
  const legacyViable = mayFb && le.mayPostInternalInferenceHttpToIngest
  const p2pOn = p2pStackEnabled(f)
  const kind = le.p2pEndpointKind
  const wrtcArch = isWebRtcHostAiArchitectureEnabled(f)
  /**
   * P2P transport may run over relay (signaling URL). `p2pEndpointGateOpen` already encodes that when policy agrees;
   * if `legacyEndpointInfo` is stale, relay + full stack still must not be treated as `P2P_TRANSPORT_BLOCK` (relay only blocks legacy HTTP to `p2p_endpoint`).
   */
  const transportOpen = le.p2pEndpointGateOpen || (p2pOn && kind === 'relay')

  if (f.p2pInferenceVerboseLogs) {
    console.log(
      `${L} transport_decide flags_snapshot p2pInferenceEnabled=${f.p2pInferenceEnabled} p2pWebrtcEnabled=${f.p2pInferenceWebrtcEnabled} p2pSignalingEnabled=${f.p2pInferenceSignalingEnabled} httpFallback=${f.p2pInferenceHttpFallback} capsOverP2p=${f.p2pInferenceCapsOverP2p} requestOverP2p=${f.p2pInferenceRequestOverP2p} p2pOn=${p2pOn} wrtcArch=${wrtcArch} p2pEndpointKind=${kind} mayPostIngest=${le.mayPostInternalInferenceHttpToIngest} legacyHttpFallbackViable=${legacyViable} p2pEndpointGateOpen_le=${le.p2pEndpointGateOpen} transportOpen=${transportOpen} sessionPhase=${ss?.p2pSession?.phase ?? 'null'} dataChannelUp=${ss?.dataChannelUp ?? false}`,
    )
  }

  const trust =
    Boolean(hr) &&
    roles.ledgerSandboxToHost &&
    roles.samePrincipal &&
    roles.internalIdentityComplete &&
    roles.peerHostDeviceIdPresent

  if (!hr || !trust) {
    return {
      targetDetected: false,
      selectorPhase: 'hidden',
      preferredTransport: 'none',
      mayUseLegacyHttpFallback: mayFb,
      legacyHttpFallbackViable: legacyViable,
      p2pTransportEndpointOpen: false,
      failureCode: 'TARGET_NOT_TRUSTED',
      userSafeReason: null,
    }
  }

  if (pol?.allowSandboxInference === false) {
    return {
      targetDetected: true,
      selectorPhase: 'policy_disabled',
      preferredTransport: 'none',
      mayUseLegacyHttpFallback: mayFb,
      legacyHttpFallbackViable: legacyViable,
      p2pTransportEndpointOpen: transportOpen,
      failureCode: 'HOST_POLICY_DISABLED',
      userSafeReason: 'Host has disabled remote access for this feature.',
    }
  }

  if (input.operationContext === 'list_targets' && pol && pol.hasActiveModel === false && pol.allowSandboxInference === true) {
    return {
      targetDetected: true,
      selectorPhase: 'no_model',
      preferredTransport: 'none',
      mayUseLegacyHttpFallback: mayFb,
      legacyHttpFallbackViable: legacyViable,
      p2pTransportEndpointOpen: transportOpen,
      failureCode: 'HOST_NO_ACTIVE_LOCAL_LLM',
      userSafeReason: 'Host has no active local model selected.',
    }
  }

  if (kind === 'missing' || kind === 'invalid') {
    return {
      targetDetected: true,
      selectorPhase: 'p2p_unavailable',
      preferredTransport: 'none',
      mayUseLegacyHttpFallback: mayFb,
      legacyHttpFallbackViable: legacyViable,
      p2pTransportEndpointOpen: false,
      failureCode: kind === 'missing' ? 'MISSING_P2P_ENDPOINT' : 'INVALID_P2P_ENDPOINT',
      userSafeReason: 'No valid coordination or Host endpoint in the handshake record.',
    }
  }

  if (kind === 'relay' && p2pOn && relaySig !== 'supported') {
    return {
      targetDetected: true,
      selectorPhase: 'p2p_unavailable',
      preferredTransport: 'none',
      mayUseLegacyHttpFallback: mayFb,
      legacyHttpFallbackViable: legacyViable,
      p2pTransportEndpointOpen: false,
      failureCode: 'RELAY_HOST_AI_P2P_SIGNALING_UNAVAILABLE',
      userSafeReason:
        'This relay does not advertise Host AI P2P signaling. Update the coordination service or confirm the relay URL.',
    }
  }

  /**
   * Internal same-principal Sandbox→Host with a direct BEAP ingest: prefer capability probe over HTTP
   * even when the full WebRTC stack is enabled. Relay-only rows still use WebRTC below.
   */
  const internalPreferDirectHttp =
    Boolean(hr?.handshake_type === 'internal') &&
    trust &&
    le.mayPostInternalInferenceHttpToIngest &&
    kind === 'direct'

  if (internalPreferDirectHttp) {
    console.log(
      `[HOST_AI_TRANSPORT_DECIDE] mode=internal preferred=direct_http reason=same_principal_direct_ingest p2p_endpoint_kind=${kind} p2p_stack_on=${p2pOn}`,
    )
    return {
      targetDetected: true,
      selectorPhase: 'legacy_http_available',
      preferredTransport: 'legacy_http',
      mayUseLegacyHttpFallback: mayFb,
      legacyHttpFallbackViable: legacyViable,
      p2pTransportEndpointOpen: true,
      failureCode: null,
      userSafeReason: null,
    }
  }

  if (!p2pOn) {
    // WRDESK_P2P_INFERENCE_ENABLED + WEBRTC: incomplete stack is a P2P config issue, not legacy MVP.
    if (wrtcArch) {
      // Relay URL is signaling; it never supports legacy HTTP POST — do not conflate with MVP / legacy_http_invalid.
      if (kind === 'relay') {
        return {
          targetDetected: true,
          selectorPhase: 'connecting',
          preferredTransport: 'webrtc_p2p',
          mayUseLegacyHttpFallback: mayFb,
          legacyHttpFallbackViable: false,
          p2pTransportEndpointOpen: true,
          failureCode: null,
          userSafeReason: null,
        }
      }
      return {
        targetDetected: true,
        selectorPhase: 'p2p_unavailable',
        preferredTransport: 'webrtc_p2p',
        mayUseLegacyHttpFallback: mayFb,
        legacyHttpFallbackViable: legacyViable,
        p2pTransportEndpointOpen: false,
        failureCode: 'P2P_STACK_INCOMPLETE',
        userSafeReason: !f.p2pInferenceSignalingEnabled
          ? 'Enable P2P signaling (WRDESK_P2P_INFERENCE_SIGNALING_ENABLED) for WebRTC, or disable WebRTC to use legacy direct HTTP only (with a valid direct BEAP address).'
          : 'P2P transport stack is not fully configured.',
      }
    }
    // Legacy-only (WebRTC off): direct HTTP to p2p_endpoint / MVP rules apply; MVP is isolated here.
    if (le.mayPostInternalInferenceHttpToIngest) {
      return {
        targetDetected: true,
        selectorPhase: 'legacy_http_available',
        preferredTransport: 'legacy_http',
        mayUseLegacyHttpFallback: mayFb,
        legacyHttpFallbackViable: legacyViable,
        // True so `decideHostAiIntentRoute` may select `http_direct` (same gate as P2P-capable rows; list still uses `p2pEnsureEligibleForList` before WebRTC ensure).
        p2pTransportEndpointOpen: true,
        failureCode: null,
        userSafeReason: null,
      }
    }
    return {
      targetDetected: true,
      selectorPhase: 'legacy_http_invalid',
      preferredTransport: 'none',
      mayUseLegacyHttpFallback: mayFb,
      legacyHttpFallbackViable: false,
      p2pTransportEndpointOpen: false,
      failureCode: 'MVP_P2P_ENDPOINT_INVALID',
      userSafeReason:
        'Legacy direct HTTP needs a valid direct BEAP address, or enable the full P2P stack. HTTP fallback (WRDESK_P2P_INFERENCE_HTTP_FALLBACK) applies only after P2P is considered.',
    }
  }

  if (!transportOpen) {
    return {
      targetDetected: true,
      selectorPhase: 'p2p_unavailable',
      preferredTransport: wrtcArch ? 'webrtc_p2p' : 'none',
      mayUseLegacyHttpFallback: mayFb,
      legacyHttpFallbackViable: legacyViable,
      p2pTransportEndpointOpen: false,
      failureCode: 'P2P_TRANSPORT_BLOCK',
      userSafeReason: 'P2P transport cannot be started with the current endpoint configuration.',
    }
  }

  const ph = ss?.p2pSession?.phase
  const dcUp = Boolean(ss?.dataChannelUp)
  if (dcUp) {
    return {
      targetDetected: true,
      selectorPhase: 'ready',
      preferredTransport: 'webrtc_p2p',
      mayUseLegacyHttpFallback: mayFb,
      legacyHttpFallbackViable: legacyViable,
      p2pTransportEndpointOpen: true,
      failureCode: null,
      userSafeReason: null,
    }
  }
  if (ph === P2pSessionPhase.starting || ph === P2pSessionPhase.signaling || ph === P2pSessionPhase.connecting) {
    return {
      targetDetected: true,
      selectorPhase: 'connecting',
      preferredTransport: 'webrtc_p2p',
      mayUseLegacyHttpFallback: mayFb,
      legacyHttpFallbackViable: legacyViable,
      p2pTransportEndpointOpen: true,
      failureCode: null,
      userSafeReason: null,
    }
  }

  return {
    targetDetected: true,
    selectorPhase: 'connecting',
    preferredTransport: 'webrtc_p2p',
    mayUseLegacyHttpFallback: mayFb,
    legacyHttpFallbackViable: legacyViable,
    p2pTransportEndpointOpen: true,
    failureCode: null,
    userSafeReason: null,
  }
}

/**
 * Build session slice for the decider (call from list / main before decideInternalInferenceTransport).
 */
export function buildSessionStateForHostAiDecider(handshakeId: string): {
  sessionState: HostAiSessionStateInput
} {
  const hid = String(handshakeId ?? '').trim()
  const p2pSession = getSessionState(hid)
  const dataChannelUp = isP2pDataChannelUpForHandshake(hid)
  return {
    sessionState: { handshakeId: hid, p2pSession, dataChannelUp },
  }
}

export function deriveHostAiHandshakeRoles(r: HandshakeRecord): HandshakeDerivedRoles {
  const dr = deriveInternalHostAiPeerRoles(r, getInstanceId().trim())
  const samePrincipal = handshakeSamePrincipal(r)
  const internalComplete = r.internal_coordination_identity_complete === true
  if (!dr.ok) {
    return {
      ledgerSandboxToHost: false,
      samePrincipal,
      internalIdentityComplete: internalComplete,
      peerHostDeviceIdPresent: false,
    }
  }
  const pairOk =
    (dr.localRole === 'sandbox' && dr.peerRole === 'host') ||
    (dr.localRole === 'host' && dr.peerRole === 'sandbox')
  return {
    /** Internal Host↔Sandbox row for this instance id (coordination identity), not orchestrator file. */
    ledgerSandboxToHost: pairOk,
    samePrincipal,
    internalIdentityComplete: internalComplete,
    peerHostDeviceIdPresent: pairOk && Boolean((dr.peerCoordinationDeviceId ?? '').trim()),
  }
}

export function buildLegacyEndpointInfoForDecider(
  db: unknown,
  p2pEndpoint: string | null | undefined,
  featureFlags: P2pInferenceFlagSnapshot,
): LegacyEndpointInfo {
  const raw = p2pEndpointKind(db as any, p2pEndpoint)
  const kind: LegacyEndpointInfo['p2pEndpointKind'] =
    raw === 'missing' || raw === 'invalid' ? raw : raw === 'relay' ? 'relay' : 'direct'
  return {
    p2pEndpointKind: kind,
    mayPostInternalInferenceHttpToIngest: canPostInternalInferenceHttpToP2pEndpointIngest(
      db as any,
      p2pEndpoint,
    ),
    mvpClassForLog: p2pEndpointMvpClass(db as any, p2pEndpoint),
    p2pEndpointGateOpen: internalInferenceEndpointGateOk(db as any, p2pEndpoint, featureFlags),
  }
}

/**
 * Fills `HostAiTransportDeciderInput` for a ledger row (list targets, HTTP/P2P RPC).
 * Session phase + DC state are current process state; policy fields can be set after a probe.
 */
export function buildHostAiTransportDeciderInput(args: {
  operationContext: HostAiOperationContext
  db: unknown
  handshakeRecord: HandshakeRecord
  featureFlags: P2pInferenceFlagSnapshot
  hostPolicyState?: HostPolicyState | null
  relayHostAiP2pSignaling?: 'supported' | 'missing' | 'na'
}): HostAiTransportDeciderInput {
  const hid = String(args.handshakeRecord.handshake_id ?? '').trim()
  const { sessionState } = buildSessionStateForHostAiDecider(hid)
  return {
    operationContext: args.operationContext,
    handshakeRecord: args.handshakeRecord,
    handshakeDerivedRoles: deriveHostAiHandshakeRoles(args.handshakeRecord),
    featureFlags: args.featureFlags,
    sessionState,
    legacyEndpointInfo: buildLegacyEndpointInfoForDecider(
      args.db,
      args.handshakeRecord.p2p_endpoint,
      args.featureFlags,
    ),
    hostPolicyState: args.hostPolicyState ?? null,
    relayHostAiP2pSignaling: args.relayHostAiP2pSignaling ?? 'na',
  }
}

/**
 * Resolves relay Host AI P2P signaling capability from coordination /health when the row uses a relay endpoint.
 */
export async function buildHostAiTransportDeciderInputAsync(args: {
  operationContext: HostAiOperationContext
  db: unknown
  handshakeRecord: HandshakeRecord
  featureFlags: P2pInferenceFlagSnapshot
  hostPolicyState?: HostPolicyState | null
  relayHostAiP2pSignaling?: 'supported' | 'missing' | 'na'
}): Promise<HostAiTransportDeciderInput> {
  if (args.relayHostAiP2pSignaling !== undefined) {
    return buildHostAiTransportDeciderInput(args)
  }
  const le = buildLegacyEndpointInfoForDecider(
    args.db,
    args.handshakeRecord.p2p_endpoint,
    args.featureFlags,
  )
  let sig: 'supported' | 'missing' | 'na' = 'na'
  if (le.p2pEndpointKind === 'relay') {
    const { resolveRelayHostAiP2pSignalingForTransportDecider } = await import('../hostAiRelayCapability')
    sig = await resolveRelayHostAiP2pSignalingForTransportDecider(
      args.db,
      args.featureFlags,
      args.handshakeRecord.p2p_endpoint,
    )
  }
  return buildHostAiTransportDeciderInput({ ...args, relayHostAiP2pSignaling: sig })
}
