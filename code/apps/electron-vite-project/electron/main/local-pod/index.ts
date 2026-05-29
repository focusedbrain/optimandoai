/**
 * Local pod lifecycle manager — Phase 1, P1.8; LOCAL_VERIFY mode — Phase 3, P3.8.
 *
 * Local pod runs on any host with Podman installed (Linux native, Windows or macOS
 * via Podman Desktop / podman machine).
 *
 * startLocalPod() / startLocalPodWhenSsoReady() — after SSO + Podman + image (not inner vault).
 * stopLocalPod()  — app-quit / SSO logout (not inner-vault lock).
 * restartLocalPod() — graceful stop + start when edge-tier settings change.
 */

import { generatePodAuthSecret, generateEphemeralSealKeyHex } from './secrets.js'
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
import { ImageDigestMismatchError } from './imageDigestVerify.js'
import {
  startLocalPodSupervisor,
  stopLocalPodSupervisor,
} from './supervisor/index.js'
import { setPodSessionAuthSecret, clearPodSessionAuthSecret } from './podSessionAuth.js'
import { getHostPodBaseUrl } from '../ingestion/edgeProbe.js'
import { refreshJwksOnStartup } from '../edge-tier/jwks.js'
import {
  type LocalPodLifecycleStatus,
  type LocalPodStatusSnapshot,
  getLocalPodStatus,
  getLocalPodUnavailableMessage,
  getPodSetupErrorRef,
  setPodSetupErrorRef,
  isPodmanVerifiedReady,
  isPodmanProbeComplete,
  getPodLastStartFailure,
  setPodLastStartFailure,
  getPodLifecycleStatus,
  setPodLifecycleStatus,
  _resetPodStatusForTest,
} from './podStatus.js'

export type { LocalPodLifecycleStatus, LocalPodStatusSnapshot }
export { getLocalPodStatus, getLocalPodUnavailableMessage }

// ── Module-level state ─────────────────────────────────────────────────────────

let _activePod: ActivePod | null = null
let _startPromise: Promise<void> | null = null
let _restartPromise: Promise<void> | null = null

const START_MAX_ATTEMPTS = 3
const START_BACKOFF_MS = [1000, 2000, 4000]
const POD_HEALTH_MAX_ATTEMPTS = 40
const POD_HEALTH_INTERVAL_MS = 500

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
  /** Skip post-start /health polling (unit tests with mock executor). */
  skipPodHealthWait?: boolean
  /** Injectable health probe (tests). */
  healthProbe?: (url: string) => Promise<boolean>
}

export { PodmanSetupError } from './podmanDetect.js'
export { refreshPodmanSetupProbe } from './podmanSetupProbe.js'

/** Last Podman setup failure, if the local pod could not start. */
export function getLocalPodSetupError(): PodmanSetupError | null {
  return getPodSetupErrorRef()
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

/** Start the pod after SSO ledger open (outer vault); does not require inner vault unlock. */
export async function startLocalPodWhenSsoReady(): Promise<void> {
  const { assertBeapPodIsolationPreflight } = await import('../security/beapPreflightGate.js')
  if (!assertBeapPodIsolationPreflight('startLocalPodWhenSsoReady')) {
    return
  }
  await refreshJwksOnStartup().catch((err) => {
    console.warn('[LOCAL_POD] JWKS refresh failed:', (err as Error).message ?? err)
  })
  return startLocalPod({ startContext: buildLocalPodStartContext() })
}

export async function startLocalPod(options?: LocalPodOptions): Promise<void> {
  if (_activePod && getPodLifecycleStatus() === 'ready') {
    console.log('[LOCAL_POD] pod already running — skipping start')
    return
  }

  if (_startPromise) {
    return _startPromise
  }

  _startPromise = _doStartWithRetry(options).finally(() => {
    _startPromise = null
  })

  return _startPromise
}

export async function restartLocalPod(
  context?: LocalPodStartContext,
  options?: LocalPodOptions,
): Promise<void> {
  if (_restartPromise) {
    return _restartPromise
  }

  _restartPromise = (async () => {
    console.log('[LOCAL_POD] Restarting pod to apply new configuration...')
    await stopLocalPod()
    await startLocalPod({
      ...options,
      startContext: context ?? buildLocalPodStartContext(),
    })
  })().finally(() => {
    _restartPromise = null
  })

  return _restartPromise
}

export async function stopLocalPod(): Promise<void> {
  stopLocalPodSupervisor()
  stopVerifierLogTail()
  if (!_activePod) {
    clearPodSessionAuthSecret()
    setPodLifecycleStatus('idle')
    return
  }

  const pod = _activePod
  _activePod = null
  clearPodSessionAuthSecret()
  setPodLifecycleStatus('idle')

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
  _resetPodStatusForTest()
  clearPodSessionAuthSecret()
}

// ── Internal ───────────────────────────────────────────────────────────────────

async function _doStartWithRetry(options?: LocalPodOptions): Promise<void> {
  setPodLifecycleStatus('starting')
  setPodLastStartFailure(null)

  for (let attempt = 0; attempt < START_MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      const delay = START_BACKOFF_MS[attempt - 1] ?? 4000
      console.log(`[LOCAL_POD] Retrying pod start (attempt ${attempt + 1}/${START_MAX_ATTEMPTS}) in ${delay}ms`)
      await sleep(delay)
    }
    const err = await _doStartOnce(options)
    if (!err) {
      return
    }
    setPodLastStartFailure(err)
    if (err.includes('LOCAL_VERIFY requires')) {
      setPodLifecycleStatus('failed')
      return
    }
    if (getPodSetupErrorRef()) {
      setPodLifecycleStatus('failed')
      return
    }
  }

  setPodLifecycleStatus('failed')
  console.error(
    `[LOCAL_POD] Pod start failed after ${START_MAX_ATTEMPTS} attempts: ${getPodLastStartFailure()}`,
  )
}

async function _doStartOnce(options?: LocalPodOptions): Promise<string | null> {
  const podmanCheck = options?.podmanCheck ?? assertPodmanReady

  try {
    await podmanCheck()
    setPodSetupErrorRef(null)
  } catch (err) {
    if (err instanceof PodmanSetupError) {
      setPodSetupErrorRef(err)
      notifyLocalPodSetupIssue(err.userMessage)
      return err.userMessage
    }
    const message =
      err instanceof Error ? err.message : 'Podman readiness check failed unexpectedly'
    setPodSetupErrorRef(new PodmanSetupError('not_installed', message))
    notifyLocalPodSetupIssue(message)
    return message
  }

  const podAuthSecret = generatePodAuthSecret()
  const sealKeyHex = generateEphemeralSealKeyHex()

  const ctx = options?.startContext ?? buildLocalPodStartContext()
  const edgeTier = ctx.edgeTier ?? loadEdgeTierSettings()
  const edgeEnabled = isEdgeTierActiveForRouting(edgeTier)

  const runnerOpts: PodRunnerOptions = {
    manifestPath: options?.manifestPath,
    podName: options?.podName,
    executor: options?.executor,
    skipImageDigestVerify: options?.skipImageDigestVerify,
  }

  if (edgeEnabled) {
    const localSsoSub = ctx.localSsoSub ?? getLocalSsoSub()
    const jwksJson = ctx.jwksJson ?? getCachedJwksJson(edgeTier)
    const trustedEdgePodIds = formatTrustedEdgePodIds(edgeTier)

    if (!localSsoSub) {
      const msg = 'LOCAL_VERIFY requires an active SSO session (LOCAL_SSO_SUB)'
      console.error(`[LOCAL_POD] ${msg}`)
      return msg
    }
    if (!jwksJson) {
      const msg = 'LOCAL_VERIFY requires cached Keycloak JWKS'
      console.error(`[LOCAL_POD] ${msg}`)
      return msg
    }
    if (!trustedEdgePodIds) {
      const msg = 'LOCAL_VERIFY requires at least one trusted edge replica'
      console.error(`[LOCAL_POD] ${msg}`)
      return msg
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

    if (!options?.skipPodHealthWait) {
      const healthy = await waitForPodHealth(options?.healthProbe)
      if (!healthy) {
        const pod = _activePod
        _activePod = null
        clearPodSessionAuthSecret()
        if (pod) {
          try {
            await pod.stop()
          } catch {
            /* ignore teardown errors */
          }
        }
        const failMsg = 'Pod started but ingestor /health did not become ready in time'
        console.error(`[LOCAL_POD] ${failMsg}`)
        return failMsg
      }
    }

    setPodSessionAuthSecret(podAuthSecret)
    setPodSetupErrorRef(null)
    setPodLastStartFailure(null)
    setPodLifecycleStatus('ready')
    console.log(`[LOCAL_POD] Pod started: ${_activePod.podName}`)
    startLocalPodSupervisor(_activePod.podName, () => stopLocalPod())
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
    return null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[LOCAL_POD] Failed to start pod:', msg)
    _activePod = null
    clearPodSessionAuthSecret()
    if (err instanceof ImageDigestMismatchError) {
      setPodSetupErrorRef(new PodmanSetupError('not_installed', err.message))
      notifyLocalPodSetupIssue(err.message)
    }
    return msg
  }
}

async function waitForPodHealth(
  healthProbe?: (url: string) => Promise<boolean>,
): Promise<boolean> {
  const probe =
    healthProbe ??
    (async (url: string) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3000)
      try {
        const res = await fetch(url, { method: 'GET', signal: controller.signal })
        return res.ok
      } catch {
        return false
      } finally {
        clearTimeout(timer)
      }
    })

  const url = `${getHostPodBaseUrl().replace(/\/+$/, '')}/health`
  for (let i = 0; i < POD_HEALTH_MAX_ATTEMPTS; i++) {
    if (await probe(url)) {
      return true
    }
    await sleep(POD_HEALTH_INTERVAL_MS)
  }
  return false
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
