/**
 * P2P Host AI feature flags. WR Desk with Host AI ships with WebRTC/DC stack **on** when env is
 * unset; set `WRDESK_P2P_INFERENCE_ENABLED=0` to force legacy/HTTP behavior, or `WRDESK_HOST_AI_DISABLED=1`
 * to disable Host AI list UX entirely.
 */

declare const __ORCHESTRATOR_BUILD_STAMP__: string | undefined
declare const __WRDESK_HOST_AI_P2P_BUNDLE_DEFAULTS_ON__: boolean | undefined

function envTrue(k: string): boolean {
  const v = (process.env[k] ?? '').trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

/**
 * Unset/empty string → `defaultValue`. Explicit 0/false/no → false, 1/true/yes → true.
 */
function readP2pBoolWithDefaultOnUnset(
  k: string,
  defaultValue: boolean,
): { value: boolean; fromEnv: boolean } {
  const raw = process.env[k]
  if (raw === undefined) {
    return { value: defaultValue, fromEnv: false }
  }
  const t = String(raw).trim()
  if (t === '') {
    return { value: defaultValue, fromEnv: false }
  }
  const l = t.toLowerCase()
  if (l === '0' || l === 'false' || l === 'no') return { value: false, fromEnv: true }
  if (l === '1' || l === 'true' || l === 'yes') return { value: true, fromEnv: true }
  return { value: defaultValue, fromEnv: true }
}

function bundleP2pDefaultsShippedInThisApp(): boolean {
  if (typeof __WRDESK_HOST_AI_P2P_BUNDLE_DEFAULTS_ON__ !== 'undefined') {
    return Boolean(__WRDESK_HOST_AI_P2P_BUNDLE_DEFAULTS_ON__)
  }
  return true
}

function orchestratorBuildStampForLog(): string {
  try {
    if (typeof __ORCHESTRATOR_BUILD_STAMP__ !== 'undefined' && String(__ORCHESTRATOR_BUILD_STAMP__).trim()) {
      return String(__ORCHESTRATOR_BUILD_STAMP__).trim()
    }
  } catch {
    // unit tests
  }
  return 'unknown'
}

export type P2pInferenceFlagSnapshot = {
  p2pInferenceEnabled: boolean
  p2pInferenceSignalingEnabled: boolean
  p2pInferenceWebrtcEnabled: boolean
  p2pInferenceCapsOverP2p: boolean
  p2pInferenceRequestOverP2p: boolean
  p2pInferenceHttpFallback: boolean
  p2pInferenceHttpInternalCompat: boolean
  p2pInferenceVerboseLogs: boolean
  p2pInferenceAnalysisLog: boolean
  p2pInferenceDataChannelCapabilities: boolean
  p2pInferenceDataChannelInference: boolean
}

let _cache: P2pInferenceFlagSnapshot | null = null
let _lastSourceTag: 'default' | 'env' | 'config' | 'bundle-off' = 'default'

/**
 * `WRDESK_HOST_AI_DISABLED=1` / bundle without Host AI P2P: do not show Host AI rows; all flags false.
 * Otherwise Host AI (Sandbox) list may resolve targets with WebRTC defaults.
 */
export function isHostAiP2pUxEnabled(): boolean {
  if (!bundleP2pDefaultsShippedInThisApp()) {
    return false
  }
  if (envTrue('WRDESK_HOST_AI_DISABLED')) {
    return false
  }
  return true
}

/** Read at call time; call `resetP2pInferenceFlagsForTests` in unit tests. */
export function getP2pInferenceFlags(): P2pInferenceFlagSnapshot {
  if (_cache) return _cache

  if (!bundleP2pDefaultsShippedInThisApp()) {
    _lastSourceTag = 'bundle-off'
    _cache = buildAllFalseSnapshot()
    return _cache
  }

  if (envTrue('WRDESK_HOST_AI_DISABLED')) {
    _lastSourceTag = 'config'
    _cache = buildAllFalseSnapshot()
    return _cache
  }

  const m = readP2pBoolWithDefaultOnUnset('WRDESK_P2P_INFERENCE_ENABLED', true)
  if (!m.value) {
    _lastSourceTag = m.fromEnv ? 'env' : 'default'
    _cache = buildSnapshotWhenMasterOff()
    return _cache
  }

  const sig = readP2pBoolWithDefaultOnUnset('WRDESK_P2P_INFERENCE_SIGNALING_ENABLED', true)
  const wrtc = readP2pBoolWithDefaultOnUnset('WRDESK_P2P_INFERENCE_WEBRTC_ENABLED', true)
  const cCaps = readP2pBoolWithDefaultOnUnset('WRDESK_P2P_INFERENCE_CAPS_OVER_P2P', true)
  const cCapLegacy = readP2pBoolWithDefaultOnUnset('WRDESK_P2P_INFERENCE_DC_CAPABILITIES', true)
  const capsP2p = cCaps.value || cCapLegacy.value
  const rReq = readP2pBoolWithDefaultOnUnset('WRDESK_P2P_INFERENCE_REQUEST_OVER_P2P', true)
  const rReqLegacy = readP2pBoolWithDefaultOnUnset('WRDESK_P2P_INFERENCE_DC_INFERENCE', true)
  const reqP2p = rReq.value || rReqLegacy.value

  const anyEnvTouched = [m, sig, wrtc, cCaps, cCapLegacy, rReq, rReqLegacy].some((x) => x.fromEnv)

  const httpFb = readP2pBoolWithDefaultOnUnset('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', false)
  const httpIc = readP2pBoolWithDefaultOnUnset('WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT', false)
  const vrb = readP2pBoolWithDefaultOnUnset('WRDESK_P2P_INFERENCE_VERBOSE_LOGS', false)
  const ana = readP2pBoolWithDefaultOnUnset('WRDESK_P2P_INFERENCE_ANALYSIS_LOG', false)

  _lastSourceTag = anyEnvTouched || httpFb.fromEnv || httpIc.fromEnv || vrb.fromEnv || ana.fromEnv ? 'env' : 'default'

  _cache = {
    p2pInferenceEnabled: m.value,
    p2pInferenceSignalingEnabled: sig.value,
    p2pInferenceWebrtcEnabled: wrtc.value,
    p2pInferenceCapsOverP2p: capsP2p,
    p2pInferenceRequestOverP2p: reqP2p,
    p2pInferenceHttpFallback: httpFb.value,
    p2pInferenceHttpInternalCompat: httpIc.value,
    p2pInferenceVerboseLogs: vrb.value,
    p2pInferenceAnalysisLog: ana.value,
    p2pInferenceDataChannelCapabilities: capsP2p,
    p2pInferenceDataChannelInference: reqP2p,
  }
  return _cache
}

function buildAllFalseSnapshot(): P2pInferenceFlagSnapshot {
  return {
    p2pInferenceEnabled: false,
    p2pInferenceSignalingEnabled: false,
    p2pInferenceWebrtcEnabled: false,
    p2pInferenceCapsOverP2p: false,
    p2pInferenceRequestOverP2p: false,
    p2pInferenceHttpFallback: false,
    p2pInferenceHttpInternalCompat: false,
    p2pInferenceVerboseLogs: false,
    p2pInferenceAnalysisLog: false,
    p2pInferenceDataChannelCapabilities: false,
    p2pInferenceDataChannelInference: false,
  }
}

function buildSnapshotWhenMasterOff(): P2pInferenceFlagSnapshot {
  return {
    p2pInferenceEnabled: false,
    p2pInferenceSignalingEnabled: false,
    p2pInferenceWebrtcEnabled: false,
    p2pInferenceCapsOverP2p: false,
    p2pInferenceRequestOverP2p: false,
    p2pInferenceHttpFallback: readP2pBoolWithDefaultOnUnset('WRDESK_P2P_INFERENCE_HTTP_FALLBACK', false).value,
    p2pInferenceHttpInternalCompat: readP2pBoolWithDefaultOnUnset('WRDESK_P2P_INFERENCE_HTTP_INTERNAL_COMPAT', false)
      .value,
    p2pInferenceVerboseLogs: readP2pBoolWithDefaultOnUnset('WRDESK_P2P_INFERENCE_VERBOSE_LOGS', false).value,
    p2pInferenceAnalysisLog: readP2pBoolWithDefaultOnUnset('WRDESK_P2P_INFERENCE_ANALYSIS_LOG', false).value,
    p2pInferenceDataChannelCapabilities: false,
    p2pInferenceDataChannelInference: false,
  }
}

export function resetP2pInferenceFlagsForTests(): void {
  _cache = null
  _lastSourceTag = 'default'
}

/**
 * `WRDESK_P2P_INFERENCE_ENABLED` + `WRDESK_P2P_INFERENCE_WEBRTC_ENABLED` — WebRTC is the intended
 * transport architecture (vs legacy direct HTTP to BEAP).
 */
export function isWebRtcHostAiArchitectureEnabled(f: P2pInferenceFlagSnapshot): boolean {
  return f.p2pInferenceEnabled && f.p2pInferenceWebrtcEnabled
}

export function getP2pInferenceFlagsSourceTagForTests(): 'default' | 'env' | 'config' | 'bundle-off' {
  void getP2pInferenceFlags()
  return _lastSourceTag
}

/** One-line snapshot for [HOST_AI_FLAGS] — Host AI / list / transport diagnostics. */
export function logHostAiP2pFlagsSnapshot(f: P2pInferenceFlagSnapshot): void {
  console.log(
    `[HOST_AI_FLAGS] p2pInferenceEnabled=${f.p2pInferenceEnabled} signaling=${f.p2pInferenceSignalingEnabled} webrtc=${f.p2pInferenceWebrtcEnabled} capsOverP2p=${f.p2pInferenceCapsOverP2p} requestOverP2p=${f.p2pInferenceRequestOverP2p} httpFallback=${f.p2pInferenceHttpFallback}`,
  )
}

/**
 * [HOST_AI_FLAGS_SOURCE] — how flags were resolved (env vs shipped defaults) and build stamp.
 */
export function logHostAiP2pFlagsSourceLine(): void {
  const f = getP2pInferenceFlags()
  const build = orchestratorBuildStampForLog()
  const src = _lastSourceTag
  const values = {
    p2pInferenceEnabled: f.p2pInferenceEnabled,
    signaling: f.p2pInferenceSignalingEnabled,
    webrtc: f.p2pInferenceWebrtcEnabled,
    capsOverP2p: f.p2pInferenceCapsOverP2p,
    requestOverP2p: f.p2pInferenceRequestOverP2p,
    httpFallback: f.p2pInferenceHttpFallback,
  }
  console.log(
    `[HOST_AI_FLAGS_SOURCE] source=${src} build=${build} values=${JSON.stringify(values)} (hostAiUxEnabled=${isHostAiP2pUxEnabled()})`,
  )
}

/**
 * [HOST_AI_FLAGS] + [HOST_AI_FLAGS_SOURCE] in one call (list / diagnostics).
 */
export function logHostAiP2pFlagsAndSource(): void {
  const f = getP2pInferenceFlags()
  logHostAiP2pFlagsSnapshot(f)
  logHostAiP2pFlagsSourceLine()
}

/** True if any non-default P2P plane may be considered. */
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
