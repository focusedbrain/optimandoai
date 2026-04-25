/**
 * Phased P2P Host inference feature flags (env-driven; safe defaults = current HTTP direct path only).
 * WebRTC / DataChannel: future phases. Do not enable in production until wired.
 */

function envTrue(k: string): boolean {
  const v = (process.env[k] ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

function envFalseMeansOff(k: string, defaultOn: boolean): boolean {
  const raw = process.env[k]
  if (raw == null || raw === '') return defaultOn
  const v = raw.trim().toLowerCase()
  if (v === '0' || v === 'false' || v === 'no') return false
  if (v === '1' || v === 'true' || v === 'yes') return true
  return defaultOn
}

/** When env is unset: packaged app → false (production); dev / unpackaged → true for emergency HTTP testing. */
function defaultHttpFallbackWhenEnvUnset(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const { app } = require('electron') as { app: { isPackaged: boolean } }
    return !app.isPackaged
  } catch {
    return false
  }
}

function resolveHttpFallback(): boolean {
  const k = 'WRDESK_P2P_INFERENCE_HTTP_FALLBACK'
  const raw = process.env[k]
  if (raw == null || raw === '') {
    return defaultHttpFallbackWhenEnvUnset()
  }
  return envFalseMeansOff(k, false)
}

export type P2pInferenceFlagSnapshot = {
  /** `WRDESK_P2P_INFERENCE_ENABLED` — master; future session manager. Default off. */
  p2pInferenceEnabled: boolean
  /** `WRDESK_P2P_INFERENCE_SIGNALING_ENABLED` — coordination signaling only. Default off. */
  p2pInferenceSignalingEnabled: boolean
  /** `WRDESK_P2P_INFERENCE_WEBRTC_ENABLED` — WebRTC stack. Default off. */
  p2pInferenceWebrtcEnabled: boolean
  /** `WRDESK_P2P_INFERENCE_CAPS_OVER_P2P` — prefer DC for capabilities when ready. Default off. */
  p2pInferenceCapsOverP2p: boolean
  /** `WRDESK_P2P_INFERENCE_REQUEST_OVER_P2P` — prefer DC for request + Host→Sandbox result when ready. Default off. */
  p2pInferenceRequestOverP2p: boolean
  /**
   * `WRDESK_P2P_INFERENCE_HTTP_FALLBACK` — **only** controls whether legacy direct HTTP to
   * `p2p_endpoint` may be used **after** the WebRTC path is unavailable. Does not create Host rows,
   * does not define “WebRTC mode”, and is not the default future architecture. Unset: **false in
   * packaged (production)**, **true in dev** (`!app.isPackaged`). `1` / `0` to force.
   */
  p2pInferenceHttpFallback: boolean
  /**
   * `WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT` — Host still accepts `internal_inference_request` on
   * HTTP /beap/ingest (legacy Sandboxes). Default off; enable only for transition / emergency.
   */
  p2pInferenceHttpInternalCompat: boolean
  /** `WRDESK_P2P_INFERENCE_VERBOSE_LOGS` — [HOST_AI_TRANSPORT] opt-in. Default off. */
  p2pInferenceVerboseLogs: boolean
  /**
   * Legacy: `WRDESK_P2P_INFERENCE_ANALYSIS_LOG=1` — [P2P_INFER] opt-in. Default off.
   * Prefer `WRDESK_P2P_INFERENCE_VERBOSE_LOGS`.
   */
  p2pInferenceAnalysisLog: boolean
  /** @deprecated Use p2pInferenceCapsOverP2p. Kept for env compatibility. */
  p2pInferenceDataChannelCapabilities: boolean
  /** @deprecated Use p2pInferenceRequestOverP2p. */
  p2pInferenceDataChannelInference: boolean
}

let _cache: P2pInferenceFlagSnapshot | null = null

/** Read at call time; call `resetP2pInferenceFlagsForTests` in unit tests. */
export function getP2pInferenceFlags(): P2pInferenceFlagSnapshot {
  if (_cache) return _cache
  const capsP2p = envTrue('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P') || envTrue('WRDESK_P2P_INFERENCE_DC_CAPABILITIES')
  const reqP2p = envTrue('WRDESK_P2P_INFERENCE_REQUEST_OVER_P2P') || envTrue('WRDESK_P2P_INFERENCE_DC_INFERENCE')
  _cache = {
    p2pInferenceEnabled: envTrue('WRDESK_P2P_INFERENCE_ENABLED'),
    p2pInferenceSignalingEnabled: envTrue('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED'),
    p2pInferenceWebrtcEnabled: envTrue('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED'),
    p2pInferenceCapsOverP2p: capsP2p,
    p2pInferenceRequestOverP2p: reqP2p,
    p2pInferenceHttpFallback: resolveHttpFallback(),
    p2pInferenceHttpInternalCompat: envTrue('WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT'),
    p2pInferenceVerboseLogs: envTrue('WRDESK_P2P_INFERENCE_VERBOSE_LOGS'),
    p2pInferenceAnalysisLog: envTrue('WRDESK_P2P_INFERENCE_ANALYSIS_LOG'),
    p2pInferenceDataChannelCapabilities: capsP2p,
    p2pInferenceDataChannelInference: reqP2p,
  }
  return _cache
}

export function resetP2pInferenceFlagsForTests(): void {
  _cache = null
}

/**
 * `WRDESK_P2P_INFERENCE_ENABLED` + `WRDESK_P2P_INFERENCE_WEBRTC_ENABLED` — WebRTC is the intended
 * transport architecture (vs legacy direct HTTP to BEAP). If signaling is off, the stack is
 * incomplete: policy must **not** treat that as a legacy / MVP `p2p_endpoint` failure.
 */
export function isWebRtcHostAiArchitectureEnabled(f: P2pInferenceFlagSnapshot): boolean {
  return f.p2pInferenceEnabled && f.p2pInferenceWebrtcEnabled
}

/** One-line snapshot for [HOST_AI_FLAGS] — Host AI / list / transport diagnostics. */
export function logHostAiP2pFlagsSnapshot(f: P2pInferenceFlagSnapshot): void {
  console.log(
    `[HOST_AI_FLAGS] p2pInferenceEnabled=${f.p2pInferenceEnabled} signaling=${f.p2pInferenceSignalingEnabled} webrtc=${f.p2pInferenceWebrtcEnabled} capsOverP2p=${f.p2pInferenceCapsOverP2p} requestOverP2p=${f.p2pInferenceRequestOverP2p} httpFallback=${f.p2pInferenceHttpFallback}`,
  )
}

/** True if any non-default P2P plane may be considered (all off in production until wired). */
export function isP2pInferenceFeatureTouched(): boolean {
  const f = getP2pInferenceFlags()
  return (
    f.p2pInferenceEnabled ||
    f.p2pInferenceSignalingEnabled ||
    f.p2pInferenceWebrtcEnabled ||
    f.p2pInferenceCapsOverP2p ||
    f.p2pInferenceRequestOverP2p
  )
}

/**
 * When true, Host must not run `internal_inference_request` on HTTP /beap/ingest — use DataChannel,
 * or set `WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT=1`. Other service RPCs (caps, cancel) are unchanged.
 */
export function shouldRejectHttpInternalInferenceRequest(): boolean {
  const f = getP2pInferenceFlags()
  if (f.p2pInferenceHttpInternalCompat) return false
  return (
    f.p2pInferenceEnabled &&
    f.p2pInferenceSignalingEnabled &&
    f.p2pInferenceWebrtcEnabled &&
    f.p2pInferenceRequestOverP2p
  )
}
