/**
 * Central Podman readiness probe — updates shared setup error ref for ingestion + UI gate.
 * Cheap path only: does NOT shell wsl.exe (see podmanWslStatusCache for full WSL diagnosis).
 */

import { probePodmanSetup, type PodmanDetectOptions, type PodmanSetupError } from './podmanDetect.js'
import { markPodmanProbeComplete, setPodSetupErrorRef } from './podStatus.js'
import { broadcastPodmanSetupState } from './podmanSetupBroadcast.js'

export interface RefreshPodmanSetupProbeOptions extends PodmanDetectOptions {
  /** Bypass cached not-ready probe (user setup, startup, explicit reprobe). */
  force?: boolean
  /** Skip renderer broadcast (caller will broadcast after companion steps). */
  skipBroadcast?: boolean
}

/** When Podman is not ready, avoid hammering `where podman` / machine probes every tick. */
const NOT_READY_PROBE_CACHE_MS = 30_000

let _cachedProbe: { at: number; err: PodmanSetupError | null } | null = null

export function invalidatePodmanSetupProbeCache(): void {
  _cachedProbe = null
}

export async function refreshPodmanSetupProbe(
  options?: RefreshPodmanSetupProbeOptions,
): Promise<PodmanSetupError | null> {
  const now = Date.now()
  if (
    !options?.force &&
    _cachedProbe &&
    now - _cachedProbe.at < NOT_READY_PROBE_CACHE_MS
  ) {
    setPodSetupErrorRef(_cachedProbe.err)
    markPodmanProbeComplete()
    if (!options?.skipBroadcast) {
      broadcastPodmanSetupState()
    }
    return _cachedProbe.err
  }

  const err = await probePodmanSetup(options)
  setPodSetupErrorRef(err)
  markPodmanProbeComplete()
  _cachedProbe = { at: now, err }

  if (!options?.skipBroadcast) {
    broadcastPodmanSetupState()
  }

  if (err) {
    console.warn(
      '[BEAP_PREFLIGHT] Podman isolation NOT ready:',
      err.code,
      err.userMessage,
    )
  } else {
    console.log('[BEAP_PREFLIGHT] Podman isolation ready — critical BEAP paths may start')
  }
  return err
}
