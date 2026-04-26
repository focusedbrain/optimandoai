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
}

/** Must match `InternalInferenceErrorCode` in main where applicable. */
export const HostAiProbeCode = {
  HOST_AI_ENDPOINT_OWNER_MISMATCH: 'HOST_AI_ENDPOINT_OWNER_MISMATCH',
  HOST_AI_ENDPOINT_PROVENANCE_MISSING: 'HOST_AI_ENDPOINT_PROVENANCE_MISSING',
  HOST_DIRECT_ENDPOINT_MISSING: 'HOST_DIRECT_ENDPOINT_MISSING',
  PROBE_AUTH_REJECTED: 'PROBE_AUTH_REJECTED',
  PROBE_RATE_LIMITED: 'PROBE_RATE_LIMITED',
  INTERNAL_RELAY_P2P_NOT_READY: 'INTERNAL_RELAY_P2P_NOT_READY',
  ICE_FAILED: 'ICE_FAILED',
  HOST_PROVIDER_UNAVAILABLE: 'HOST_PROVIDER_UNAVAILABLE',
  OLLAMA_UNREACHABLE_ON_SANDBOX: 'OLLAMA_UNREACHABLE_ON_SANDBOX',
} as const

export const HOST_AI_MSG = {
  ownerMismatch:
    'Host AI endpoint rejected: the selected endpoint appears to belong to this device, not the paired Host.',
  provenanceMissing: 'Host AI endpoint missing: the Host has not advertised a trusted endpoint yet.',
  authRejected: 'Host AI auth rejected: the paired Host refused the request.',
  rateLimited: 'Host AI temporarily rate-limited. Wait briefly or reduce repeated probes.',
  relayNotReady: 'Host AI relay/WebRTC path is not ready yet.',
  iceFailed: 'Host AI WebRTC connection failed.',
  hostProviderUnavailable: 'Host is reachable but no local Host AI provider is available.',
} as const

export type HostAiTargetLike = {
  inference_error_code?: string | null
  failureCode?: string | null
  unavailable_reason?: string | null
  hostAiStructuredUnavailableReason?: string | null
  hostAiEndpointDenyDetail?: string | null
  /** When true, capabilities/ads indicate the **remote Host** Ollama is up — do not mislabel sandbox-only Ollama issues as Host. */
  hostWireOllamaReachable?: boolean | null
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

  if (shouldSuppressOllamaUnreachableSandboxAsHostFailure(code, wireOllama ?? null)) {
    return null
  }

  if (code === HostAiProbeCode.OLLAMA_UNREACHABLE_ON_SANDBOX) {
    return {
      primary: "Host's local Ollama was unreachable on the Sandbox. This is not a Host copy failure; check Sandbox Ollama or pick another model.",
      hint: null,
    }
  }

  if (code === HostAiProbeCode.HOST_AI_ENDPOINT_OWNER_MISMATCH) {
    return { primary: HOST_AI_MSG.ownerMismatch, hint: null }
  }
  if (code === HostAiProbeCode.HOST_AI_ENDPOINT_PROVENANCE_MISSING || code === HostAiProbeCode.HOST_DIRECT_ENDPOINT_MISSING) {
    return { primary: HOST_AI_MSG.provenanceMissing, hint: null }
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
