/**
 * Single source of truth for **Host AI** (Sandbox → Host) user-facing status copy from probe/transport
 * failure codes. Renderer + Electron list targets import this — keep strings in sync with product.
 */

export type HostAiEndpointDiagnostics = {
  local_device_id: string
  peer_host_device_id: string
  /** URL or ingest the Sandbox attempted to use for the Host, when known. */
  selected_endpoint: string | null
  /** Device id the policy layer expects to own the direct endpoint, when known. */
  selected_endpoint_owner: string | null
  local_beap_endpoint: string | null
  peer_advertised_beap_endpoint: string | null
  /** Human + machine reason: code and deny detail, ICE, etc. */
  rejection_reason: string
  /** Transport snapshot when no verified peer-Host route exists (coordination ids only — not IP). */
  webrtc_available?: boolean
  direct_http_available?: boolean
  relay_available?: boolean
  /** Ledger / capability RPC roles when a role or policy gate fails. */
  local_role?: string
  peer_role?: string
  requester_role?: string
  receiver_role?: string
}

/** Must match `InternalInferenceErrorCode` in main where applicable. */
export const HostAiProbeCode = {
  HOST_AI_ENDPOINT_OWNER_MISMATCH: 'HOST_AI_ENDPOINT_OWNER_MISMATCH',
  /** Direct-HTTP-only: peer LAN BEAP not in ledger/relay ads; P2P may still be valid. */
  HOST_AI_DIRECT_PEER_BEAP_MISSING: 'HOST_AI_DIRECT_PEER_BEAP_MISSING',
  /** Host policy / orchestrator role gate — not generic transport auth failure. */
  POLICY_FORBIDDEN: 'POLICY_FORBIDDEN',
  /** Ledger role mismatch for internal capability RPC (e.g. wrong device side); not a missing BEAP endpoint. */
  HOST_AI_CAPABILITY_ROLE_REJECTED: 'HOST_AI_CAPABILITY_ROLE_REJECTED',
  /** No WebRTC, relay session, or valid direct BEAP for HTTP. */
  HOST_AI_NO_ROUTE: 'HOST_AI_NO_ROUTE',
  HOST_AI_ENDPOINT_PROVENANCE_MISSING: 'HOST_AI_ENDPOINT_PROVENANCE_MISSING',
  HOST_DIRECT_ENDPOINT_MISSING: 'HOST_DIRECT_ENDPOINT_MISSING',
  PROBE_AUTH_REJECTED: 'PROBE_AUTH_REJECTED',
  PROBE_RATE_LIMITED: 'PROBE_RATE_LIMITED',
  INTERNAL_RELAY_P2P_NOT_READY: 'INTERNAL_RELAY_P2P_NOT_READY',
  ICE_FAILED: 'ICE_FAILED',
  HOST_PROVIDER_UNAVAILABLE: 'HOST_PROVIDER_UNAVAILABLE',
  OLLAMA_UNREACHABLE_ON_SANDBOX: 'OLLAMA_UNREACHABLE_ON_SANDBOX',
  /** Local BEAP or self-owned ingest was selected instead of the peer Host’s route. */
  HOST_AI_LOCAL_BEAP_IS_NOT_PEER_HOST: 'HOST_AI_LOCAL_BEAP_IS_NOT_PEER_HOST',
  /** No candidate passed verified peer-Host checks. */
  HOST_AI_NO_VERIFIED_PEER_ROUTE: 'HOST_AI_NO_VERIFIED_PEER_ROUTE',
  HOST_AI_PEER_ENDPOINT_MISSING: 'HOST_AI_PEER_ENDPOINT_MISSING',
  HOST_AI_ROUTE_OWNER_MISMATCH: 'HOST_AI_ROUTE_OWNER_MISMATCH',
} as const

export const HOST_AI_MSG = {
  /** Self / local BEAP selected — route belongs to this coordination device, not the paired Host. */
  routeRejectedSelfBeap:
    'Host AI route rejected: the candidate endpoint belongs to this device, not the paired Host.',
  routeOwnerMismatch:
    'Host AI route rejected: route ownership does not match the paired Host.',
  noVerifiedPeerRoute: 'Host AI has no verified route to the paired Host yet.',
  peerNoDirectEndpoint:
    'The paired Host has not advertised a verified direct endpoint. Direct HTTP is not available.',
  roleGateFailed:
    'Host AI role check failed for this route. The request was not sent to a verified Host endpoint.',
  provenanceMissing: 'Host AI endpoint missing: the Host has not advertised a trusted endpoint yet.',
  authRejected: 'Host AI auth rejected: the paired Host refused the request.',
  rateLimited: 'Host AI temporarily rate-limited. Wait briefly or reduce repeated probes.',
  relayNotReady: 'Host AI relay/WebRTC path is not ready yet.',
  iceFailed: 'Host AI WebRTC connection failed.',
  hostProviderUnavailable: 'Host is reachable but no local Host AI provider is available.',
} as const

/**
 * Example diagnostics when the resolver selected this device’s BEAP instead of the peer Host (for support / tests).
 */
export const HOST_AI_DIAGNOSTICS_EXAMPLE_SELF_LOCAL_BEAP: HostAiEndpointDiagnostics = {
  local_device_id: 'coord-sandbox-abc',
  peer_host_device_id: 'coord-host-xyz',
  selected_endpoint: 'https://sandbox.example/beap/ingest',
  selected_endpoint_owner: 'coord-sandbox-abc',
  local_beap_endpoint: 'https://sandbox.example/beap/ingest',
  peer_advertised_beap_endpoint: null,
  rejection_reason: 'HOST_AI_ENDPOINT_OWNER_MISMATCH (self_local_beap_selected)',
}

export type HostAiTargetLike = {
  inference_error_code?: string | null
  failureCode?: string | null
  unavailable_reason?: string | null
  hostAiStructuredUnavailableReason?: string | null
  hostAiEndpointDenyDetail?: string | null
  host_ai_endpoint_diagnostics?: HostAiEndpointDiagnostics | null
  /** When true, capabilities/ads indicate the **remote Host** Ollama is up — do not mislabel sandbox-only Ollama issues as Host. */
  hostWireOllamaReachable?: boolean | null
}

function isSelfLocalBeapDeny(deny: string): boolean {
  return deny === 'self_local_beap_selected' || deny === 'self_endpoint_selected'
}

/**
 * When a row is mislabeled as auth but structured reason is a terminal route/identity class, prefer the real class.
 */
function identityUiCode(code: string, sur: string): string {
  const authish = code === HostAiProbeCode.PROBE_AUTH_REJECTED || sur === 'auth_rejected'
  if (!authish) return code
  switch (sur) {
    case 'host_no_verified_peer_route':
      return HostAiProbeCode.HOST_AI_NO_VERIFIED_PEER_ROUTE
    case 'host_no_route':
      return HostAiProbeCode.HOST_AI_NO_ROUTE
    case 'host_endpoint_not_advertised':
      return HostAiProbeCode.HOST_AI_DIRECT_PEER_BEAP_MISSING
    case 'host_capability_role_rejected':
      return HostAiProbeCode.HOST_AI_CAPABILITY_ROLE_REJECTED
    case 'host_route_owner_mismatch':
      return HostAiProbeCode.HOST_AI_ROUTE_OWNER_MISMATCH
    case 'host_policy_forbidden':
      return HostAiProbeCode.POLICY_FORBIDDEN
    default:
      return code
  }
}

/**
 * When `inference_error_code` is this and the Host is known to expose Ollama, suppress misleading Host-failure copy.
 * @see OLLAMA_UNREACHABLE_ON_SANDBOX rule in product spec
 */
export function shouldSuppressOllamaUnreachableSandboxAsHostFailure(
  inferenceErrorCode: string | null | undefined,
  hostWireOllamaReachable: boolean | null | undefined,
): boolean {
  return (
    String(inferenceErrorCode ?? '').trim() === HostAiProbeCode.OLLAMA_UNREACHABLE_ON_SANDBOX && hostWireOllamaReachable === true
  )
}

/**
 * One-line + optional subline for connection strips, chat blocks, and model row titles.
 * Returns `null` if the caller should fall back to generic P2P / reachability copy (e.g. suppressed Ollama-on-sandbox).
 */
export function hostAiUserFacingMessageFromTarget(
  t: HostAiTargetLike | null | undefined,
  opts?: { hostWireOllamaReachableOverride?: boolean | null },
): { primary: string; hint: string | null } | null {
  if (!t) return null
  const code = String(
    t.inference_error_code ?? t.failureCode ?? (t as { failure_code?: string }).failure_code ?? '',
  ).trim()
  const sur = String(t.hostAiStructuredUnavailableReason ?? '').trim()
  const deny = String(t.hostAiEndpointDenyDetail ?? '').trim()
  const wireOllama = opts?.hostWireOllamaReachableOverride ?? t.hostWireOllamaReachable
  const ic = identityUiCode(code, sur)

  if (shouldSuppressOllamaUnreachableSandboxAsHostFailure(code, wireOllama ?? null)) {
    return null
  }

  if (sur === 'ollama_direct_tags_unreachable') {
    return { primary: 'Host Ollama is not reachable from this device.', hint: null }
  }
  if (sur === 'ollama_direct_invalid_advertisement') {
    return { primary: 'Host Ollama endpoint advertisement is invalid.', hint: null }
  }
  if (sur === 'ollama_direct_no_models_installed') {
    return { primary: 'Host Ollama reachable, but no models are installed.', hint: null }
  }

  if (code === HostAiProbeCode.OLLAMA_UNREACHABLE_ON_SANDBOX) {
    return {
      primary: "Host's local Ollama was unreachable on the Sandbox. This is not a Host copy failure; check Sandbox Ollama or pick another model.",
      hint: null,
    }
  }

  // Route / identity / provenance — before generic PROBE_AUTH_REJECTED

  if (
    ic === HostAiProbeCode.HOST_AI_LOCAL_BEAP_IS_NOT_PEER_HOST ||
    (ic === HostAiProbeCode.HOST_AI_ENDPOINT_OWNER_MISMATCH && isSelfLocalBeapDeny(deny)) ||
    (isSelfLocalBeapDeny(deny) &&
      (!ic || ic === HostAiProbeCode.HOST_AI_ENDPOINT_OWNER_MISMATCH))
  ) {
    return { primary: HOST_AI_MSG.routeRejectedSelfBeap, hint: null }
  }

  if (ic === HostAiProbeCode.HOST_AI_ROUTE_OWNER_MISMATCH || sur === 'host_route_owner_mismatch') {
    return { primary: HOST_AI_MSG.routeOwnerMismatch, hint: null }
  }

  if (
    ic === HostAiProbeCode.HOST_AI_NO_VERIFIED_PEER_ROUTE ||
    sur === 'host_no_verified_peer_route' ||
    ic === HostAiProbeCode.HOST_AI_NO_ROUTE ||
    sur === 'host_no_route'
  ) {
    return { primary: HOST_AI_MSG.noVerifiedPeerRoute, hint: null }
  }

  if (
    ic === HostAiProbeCode.HOST_AI_DIRECT_PEER_BEAP_MISSING ||
    ic === HostAiProbeCode.HOST_AI_PEER_ENDPOINT_MISSING ||
    ic === HostAiProbeCode.HOST_AI_ENDPOINT_PROVENANCE_MISSING ||
    ic === HostAiProbeCode.HOST_DIRECT_ENDPOINT_MISSING ||
    sur === 'host_endpoint_not_advertised'
  ) {
    return { primary: HOST_AI_MSG.peerNoDirectEndpoint, hint: null }
  }

  if (ic === HostAiProbeCode.HOST_AI_CAPABILITY_ROLE_REJECTED || sur === 'host_capability_role_rejected') {
    return { primary: HOST_AI_MSG.roleGateFailed, hint: null }
  }

  /** Ledger/resolver pointed HTTP trust at this sandbox’s BEAP or denied sandbox→host resolve — not Host policy off. */
  if (
    sur === 'host_transport_trust_misrouting' ||
    ic === 'peer_host_endpoint_missing' ||
    ic === 'self_loop_detected' ||
    deny === 'peer_host_endpoint_missing' ||
    deny === 'self_loop_detected'
  ) {
    return {
      primary:
        'Host AI transport misrouted: the endpoint does not match the paired Host yet. Wait for the Host to advertise its LAN ingest, confirm P2P when possible, then refresh.',
      hint: null,
    }
  }

  if (
    ic === HostAiProbeCode.HOST_AI_ENDPOINT_OWNER_MISMATCH ||
    sur === 'host_endpoint_mismatch' ||
    sur === 'endpoint_provenance_missing'
  ) {
    return { primary: HOST_AI_MSG.routeOwnerMismatch, hint: null }
  }

  if (
    ic === HostAiProbeCode.POLICY_FORBIDDEN ||
    sur === 'host_policy_forbidden' ||
    code === 'HOST_POLICY_DISABLED'
  ) {
    return {
      primary: 'Host AI is blocked by Host policy or role (this device is not allowed to use Host AI on that Host).',
      hint: null,
    }
  }

  if (code === HostAiProbeCode.PROBE_AUTH_REJECTED || sur === 'host_auth_rejected' || sur === 'auth_rejected') {
    return { primary: HOST_AI_MSG.authRejected, hint: null }
  }
  if (code === HostAiProbeCode.PROBE_RATE_LIMITED) {
    return { primary: HOST_AI_MSG.rateLimited, hint: null }
  }
  if (
    code === HostAiProbeCode.INTERNAL_RELAY_P2P_NOT_READY ||
    (t as { unavailable_reason?: string }).unavailable_reason === 'INTERNAL_RELAY_P2P_NOT_READY'
  ) {
    return { primary: HOST_AI_MSG.relayNotReady, hint: null }
  }
  if (sur === 'host_transport_unavailable' || sur === 'transport_not_ready' || String((t as { failureCode?: string }).failureCode) === 'LIST_TRANSPORT_NOT_PROVEN') {
    return { primary: 'Host AI transport is not ready yet. Check relay, P2P, and network, then use Refresh (↻).', hint: null }
  }
  if (code === 'ICE_FAILED' || String(t.failureCode ?? '') === 'ICE_FAILED') {
    return { primary: HOST_AI_MSG.iceFailed, hint: null }
  }
  if (code === HostAiProbeCode.HOST_PROVIDER_UNAVAILABLE || sur === 'host_provider_unavailable' || sur === 'host_remote_ollama_down') {
    return { primary: HOST_AI_MSG.hostProviderUnavailable, hint: null }
  }
  return null
}

/**
 * @deprecated Use `hostAiUserFacingMessageFromTarget` for rows with structured probe codes.
 * Legacy: generic “P2P unavailable” when we have no finer-grained code.
 */
export function hostAiGenericP2pUnavailableLine(): string {
  return 'Host AI · P2P unavailable. Check that the Host is online, on a reachable path, and that firewalls or VPN allow the connection.'
}
