/**
 * Ingestion mode resolver — single source of truth for routing (pure function).
 *
 * Evaluates edge tier settings and runtime probe inputs into exactly one of four modes.
 * No I/O; callers gather inputs and pass them in.
 */

import type { EdgeTierSettings } from '../edge-tier/settings.js'
import { isEdgeTierActiveForRouting } from '../edge-tier/settings.js'

export type IngestionMode = 'EdgeActive' | 'HostPodActive' | 'LegacyInProcess' | 'Blocked'

/** Edge replica reachability from probe; `unknown` before first probe completes. */
export type EdgeReachableState = boolean | 'unknown'

export interface ResolverInputs {
  settings: EdgeTierSettings
  edgeReachable: EdgeReachableState
  /** True when the host can reach the wider network (general connectivity probe). */
  generalConnectivity: boolean
  /** Local pod GET /health succeeded. */
  hostPodReady: boolean
  /** Podman readiness check passed (getLocalPodSetupError() == null). */
  podmanAvailable: boolean
  /** User explicitly allowed host fallback for this session while edge is enabled. */
  sessionHostFallbackAuthorized: boolean
}

/** HostPodActive sub-variant for status surface copy. */
export type HostPodModeVariant = 'user_chosen' | 'session_fallback' | 'starting'

/**
 * Resolve the current ingestion mode from settings + runtime inputs.
 *
 * Decision order (see product spec):
 * 1. Edge enabled + edge reachable → EdgeActive
 * 2. Edge enabled + session fallback authorized + host pod ready → HostPodActive
 * 3. Edge enabled (else) → Blocked
 * 4. Edge disabled/pending + host pod ready → HostPodActive
 * 5. Edge disabled/pending + !podmanAvailable → LegacyInProcess
 * 6. Edge disabled/pending + podman available + pod not ready → HostPodActive (caller must hold until ready)
 */
export function resolveIngestionMode(inputs: ResolverInputs): IngestionMode {
  const edgeRouting = isEdgeTierActiveForRouting(inputs.settings)

  if (edgeRouting && inputs.edgeReachable === true) {
    return 'EdgeActive'
  }

  if (edgeRouting && inputs.sessionHostFallbackAuthorized && inputs.hostPodReady) {
    return 'HostPodActive'
  }

  if (edgeRouting) {
    return 'Blocked'
  }

  if (inputs.hostPodReady) {
    return 'HostPodActive'
  }

  if (!inputs.podmanAvailable) {
    return 'LegacyInProcess'
  }

  return 'HostPodActive'
}

export function resolveHostPodVariant(
  inputs: ResolverInputs,
  mode: IngestionMode,
): HostPodModeVariant | null {
  if (mode !== 'HostPodActive') return null
  if (isEdgeTierActiveForRouting(inputs.settings) && inputs.sessionHostFallbackAuthorized) {
    return 'session_fallback'
  }
  if (!inputs.hostPodReady && inputs.podmanAvailable) {
    return 'starting'
  }
  return 'user_chosen'
}

/** True when callers must wait for host pod before dispatching (rule 6). */
export function shouldWaitForHostPod(inputs: ResolverInputs, mode: IngestionMode): boolean {
  return (
    mode === 'HostPodActive' &&
    !isEdgeTierActiveForRouting(inputs.settings) &&
    inputs.podmanAvailable &&
    !inputs.hostPodReady
  )
}

/** Status surface: Blocked + offline uses calmer "no network" copy, same mode. */
export function isBlockedWithoutGeneralConnectivity(inputs: ResolverInputs, mode: IngestionMode): boolean {
  return mode === 'Blocked' && !inputs.generalConnectivity
}
