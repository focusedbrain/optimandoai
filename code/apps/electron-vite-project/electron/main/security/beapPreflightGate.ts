/**
 * Hard preflight gate — BEAP critical paths require Podman + usable machine (host).
 * Single source of truth: completed Podman probe with verified ready state.
 */

import { getPodSetupErrorRef, isPodmanVerifiedReady } from '../local-pod/podStatus.js'

export const BEAP_PREFLIGHT_LOG_TAG = '[BEAP_PREFLIGHT]'

/** Podman engine + machine (when applicable) passed the last completed probe. */
export function isBeapPodIsolationPreflightPassed(): boolean {
  return isPodmanVerifiedReady()
}

/** Human-readable block reason for logs and health surfaces. */
export function beapPreflightBlockedReason(): string | null {
  const err = getPodSetupErrorRef()
  if (!err) return null
  return err.userMessage
}

/**
 * Returns false when critical BEAP functions must not run (coordination WS, P2P ingest, relay pull, local pod).
 */
export function assertBeapPodIsolationPreflight(context: string): boolean {
  if (isBeapPodIsolationPreflightPassed()) {
    return true
  }
  const reason = beapPreflightBlockedReason() ?? 'Podman isolation not ready'
  console.warn(
    `${BEAP_PREFLIGHT_LOG_TAG} BLOCKED ${context}: ${reason}`,
  )
  return false
}
