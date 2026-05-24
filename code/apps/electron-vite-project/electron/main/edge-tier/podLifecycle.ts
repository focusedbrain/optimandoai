/**
 * Edge tier ↔ local pod lifecycle — graceful restart on settings change (P3.8).
 */

import { restartLocalPod, type LocalPodStartContext } from '../local-pod/index.js'
import {
  edgeTierRequiresPodRestart,
  loadEdgeTierSettings,
  saveEdgeTierSettings,
  type EdgeTierSettings,
} from './settings.js'
import { refreshJwksOnVerificationFailure } from './jwks.js'
import { getLocalSsoSub } from './sessionBridge.js'

export interface EdgeTierPodVault {
  deriveApplicationKey(info: string): Buffer | null
}

function buildStartContext(
  vault: EdgeTierPodVault,
  settings?: EdgeTierSettings,
): LocalPodStartContext {
  const edgeTier = settings ?? loadEdgeTierSettings()
  return {
    edgeTier,
    localSsoSub: getLocalSsoSub(),
    jwksJson: edgeTier.cached_jwks_json ?? null,
  }
}

/**
 * Persist settings (if provided) and restart the local pod when mode/env changed.
 */
export async function applyEdgeTierSettingsAndRestartPod(
  vault: EdgeTierPodVault,
  next: EdgeTierSettings,
): Promise<void> {
  const before = loadEdgeTierSettings()
  saveEdgeTierSettings(next)
  if (!edgeTierRequiresPodRestart(before, next)) {
    return
  }
  console.log('[EDGE_TIER] Settings changed — restarting local pod')
  await restartLocalPod(vault, buildStartContext(vault, next))
}

/** JWKS stale path: refresh cache and restart LOCAL_VERIFY pod. */
export async function onVerificationFailureRefreshJwks(vault: EdgeTierPodVault): Promise<void> {
  const refreshed = await refreshJwksOnVerificationFailure()
  if (!refreshed) return
  const settings = loadEdgeTierSettings()
  if (!settings.enabled) return
  console.log('[EDGE_TIER] JWKS refreshed — restarting LOCAL_VERIFY pod')
  await restartLocalPod(vault, buildStartContext(vault, settings))
}
