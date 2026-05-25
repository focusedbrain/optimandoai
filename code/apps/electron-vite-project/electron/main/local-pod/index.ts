/**
 * Local pod lifecycle manager — Phase 1, P1.8; LOCAL_VERIFY mode — Phase 3, P3.8.
 *
 * Local pod runs on any host with Podman installed (Linux native, Windows or macOS
 * via Podman Desktop / podman machine).
 *
 * startLocalPod() — called after vault unlock.
 * stopLocalPod()  — called on vault-lock and app-quit.
 * restartLocalPod() — graceful stop + start when edge-tier settings change.
 */

import { generatePodAuthSecret, deriveSealKeyHex } from './secrets.js'
import {
  applyPodManifest,
  resolveManifestPath,
  resolveLocalVerifyManifestPath,
  DEFAULT_POD_NAME,
  DEFAULT_LOCAL_VERIFY_POD_NAME,
  type ActivePod,
  type PodRunnerOptions,
} from './podRunner.js'
import {
  loadEdgeTierSettings,
  formatTrustedEdgePodIds,
  isEdgeTierActiveForRouting,
  type EdgeTierSettings,
} from '../edge-tier/settings.js'
import { getCachedJwksJson } from '../edge-tier/jwks.js'
import { getLocalSsoSub } from '../edge-tier/sessionBridge.js'
import {
  startVerifierLogTail,
  stopVerifierLogTail,
} from '../edge-tier/verifierLogTailer.js'
import { assertPodmanReady, PodmanSetupError } from './podmanDetect.js'
import { notifyLocalPodSetupIssue } from './notify.js'

// ── Module-level state ─────────────────────────────────────────────────────────

let _activePod: ActivePod | null = null
let _startPromise: Promise<void> | null = null
let _restartPromise: Promise<void> | null = null
let _podSetupError: PodmanSetupError | null = null

// ── Public API ─────────────────────────────────────────────────────────────────

export interface LocalPodStartContext {
  edgeTier?: EdgeTierSettings
  localSsoSub?: string | null
  jwksJson?: string | null
}

export interface LocalPodOptions extends PodRunnerOptions {
  /** Injectable Podman readiness check (tests). Default: assertPodmanReady. */
  podmanCheck?: () => Promise<void>
  /** Edge-tier / SSO context for LOCAL_VERIFY mode selection. */
  startContext?: LocalPodStartContext
}

export { PodmanSetupError } from './podmanDetect.js'

/** Last Podman setup failure, if the local pod could not start. */
export function getLocalPodSetupError(): PodmanSetupError | null {
  return _podSetupError
}

export function buildLocalPodStartContext(
  overrides?: Partial<LocalPodStartContext>,
): LocalPodStartContext {
  const edgeTier = overrides?.edgeTier ?? loadEdgeTierSettings()
  return {
    edgeTier,
    localSsoSub: overrides?.localSsoSub ?? getLocalSsoSub(),
    jwksJson: overrides?.jwksJson ?? getCachedJwksJson(edgeTier),
  }
}

export async function startLocalPod(
  vault: { deriveApplicationKey(info: string): Buffer | null },
  options?: LocalPodOptions,
): Promise<void> {
  if (_activePod) {
    console.log('[LOCAL_POD] pod already running — skipping start')
    return
  }

  if (_startPromise) {
    return _startPromise
  }

  _startPromise = _doStart(vault, options).finally(() => {
    _startPromise = null
  })

  return _startPromise
}

export async function restartLocalPod(
  vault: { deriveApplicationKey(info: string): Buffer | null },
  context?: LocalPodStartContext,
  options?: LocalPodOptions,
): Promise<void> {
  if (_restartPromise) {
    return _restartPromise
  }

  _restartPromise = (async () => {
    console.log('[LOCAL_POD] Restarting pod to apply new configuration...')
    await stopLocalPod()
    await startLocalPod(vault, {
      ...options,
      startContext: context ?? buildLocalPodStartContext(),
    })
  })().finally(() => {
    _restartPromise = null
  })

  return _restartPromise
}

export async function stopLocalPod(): Promise<void> {
  stopVerifierLogTail()
  if (!_activePod) return

  const pod = _activePod
  _activePod = null

  console.log(`[LOCAL_POD] Stopping pod: ${pod.podName}`)
  try {
    await pod.stop()
    console.log('[LOCAL_POD] Pod stopped and removed')
  } catch (err) {
    console.error('[LOCAL_POD] Error stopping pod:', (err as Error).message ?? err)
  }
}

/** For tests — resets module-level singleton state between test cases. */
export function _resetStateForTest(): void {
  _activePod = null
  _startPromise = null
  _restartPromise = null
  _podSetupError = null
}

// ── Internal ───────────────────────────────────────────────────────────────────

async function _doStart(
  vault: { deriveApplicationKey(info: string): Buffer | null },
  options?: LocalPodOptions,
): Promise<void> {
  const podmanCheck = options?.podmanCheck ?? assertPodmanReady

  try {
    await podmanCheck()
    _podSetupError = null
  } catch (err) {
    if (err instanceof PodmanSetupError) {
      _podSetupError = err
      notifyLocalPodSetupIssue(err.userMessage)
      return
    }
    const message =
      err instanceof Error ? err.message : 'Podman readiness check failed unexpectedly'
    _podSetupError = new PodmanSetupError('not_installed', message)
    notifyLocalPodSetupIssue(message)
    return
  }

  const podAuthSecret = generatePodAuthSecret()
  const sealKeyHex = deriveSealKeyHex(vault)

  if (!sealKeyHex) {
    console.error('[LOCAL_POD] Vault is locked — cannot derive seal key; pod not started')
    return
  }

  const ctx = options?.startContext ?? buildLocalPodStartContext()
  const edgeTier = ctx.edgeTier ?? loadEdgeTierSettings()
  const edgeEnabled = isEdgeTierActiveForRouting(edgeTier)

  const runnerOpts: PodRunnerOptions = {
    manifestPath: options?.manifestPath,
    podName: options?.podName,
    executor: options?.executor,
  }

  if (edgeEnabled) {
    const localSsoSub = ctx.localSsoSub ?? getLocalSsoSub()
    const jwksJson = ctx.jwksJson ?? getCachedJwksJson(edgeTier)
    const trustedEdgePodIds = formatTrustedEdgePodIds(edgeTier)

    if (!localSsoSub) {
      console.error('[LOCAL_POD] LOCAL_VERIFY requires an active SSO session (LOCAL_SSO_SUB)')
      return
    }
    if (!jwksJson) {
      console.error('[LOCAL_POD] LOCAL_VERIFY requires cached Keycloak JWKS')
      return
    }
    if (!trustedEdgePodIds) {
      console.error('[LOCAL_POD] LOCAL_VERIFY requires at least one trusted edge replica')
      return
    }

    runnerOpts.manifestPath =
      options?.manifestPath ?? resolveLocalVerifyManifestPath()
    runnerOpts.podName = options?.podName ?? DEFAULT_LOCAL_VERIFY_POD_NAME
    runnerOpts.localVerify = {
      localSsoSub,
      trustedEdgePodIds,
      keycloakJwksJson: jwksJson,
      allowDirectP2p: edgeTier.native_beap_routing !== 'require_edge',
    }

    console.log('[LOCAL_POD] Starting LOCAL_VERIFY pod...')
  } else {
    runnerOpts.manifestPath = options?.manifestPath ?? resolveManifestPath()
    runnerOpts.podName = options?.podName ?? DEFAULT_POD_NAME
    console.log('[LOCAL_POD] Starting LOCAL_HOST pod...')
  }

  try {
    _activePod = await applyPodManifest(podAuthSecret, sealKeyHex, runnerOpts)
    _podSetupError = null
    console.log(`[LOCAL_POD] Pod started: ${_activePod.podName}`)
    try {
      const { invalidateHostPodReadyCache } = await import('../ingestion/edgeProbe.js')
      const { refreshIngestionMode } = await import('../ingestion/ingestionModeService.js')
      invalidateHostPodReadyCache()
      void refreshIngestionMode(true)
    } catch {
      /* mode service optional during tests */
    }
    if (edgeEnabled) {
      startVerifierLogTail(runnerOpts.podName ?? DEFAULT_LOCAL_VERIFY_POD_NAME)
    } else {
      stopVerifierLogTail()
    }
  } catch (err) {
    console.error('[LOCAL_POD] Failed to start pod:', (err as Error).message ?? err)
    _activePod = null
  }
}
