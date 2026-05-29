/**
 * Central Podman readiness probe — updates shared setup error ref for ingestion + UI gate.
 */

import { probePodmanSetup, type PodmanDetectOptions, type PodmanSetupError } from './podmanDetect.js'
import { markPodmanProbeComplete, setPodSetupErrorRef } from './podStatus.js'
import { broadcastPodmanSetupState } from './podmanSetupBroadcast.js'

export async function refreshPodmanSetupProbe(
  options?: PodmanDetectOptions,
): Promise<PodmanSetupError | null> {
  const err = await probePodmanSetup(options)
  setPodSetupErrorRef(err)
  markPodmanProbeComplete()
  broadcastPodmanSetupState()
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
