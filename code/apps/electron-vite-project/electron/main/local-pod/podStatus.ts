/**
 * Local pod lifecycle status (shared by index + lightweight consumers).
 */

import { getPodSessionAuthSecret } from './podSessionAuth.js'
import { PodmanSetupError, type PodmanSetupErrorCode } from './podmanDetect.js'

export type LocalPodLifecycleStatus = 'idle' | 'starting' | 'ready' | 'failed'

export type PodmanProbeCompletion = 'pending' | 'complete'

export interface LocalPodStatusSnapshot {
  status: LocalPodLifecycleStatus
  reason: string | null
  hasSessionSecret: boolean
}

const PROBE_PENDING_MESSAGE = 'Checking Podman installation…'

let _lifecycleStatus: LocalPodLifecycleStatus = 'idle'
let _lastStartFailure: string | null = null
let _podSetupError: PodmanSetupError | null = null
let _probeCompletion: PodmanProbeCompletion = 'pending'

export function getPodLifecycleStatus(): LocalPodLifecycleStatus {
  return _lifecycleStatus
}

export function setPodLifecycleStatus(status: LocalPodLifecycleStatus): void {
  _lifecycleStatus = status
}

export function getPodLastStartFailure(): string | null {
  return _lastStartFailure
}

export function setPodLastStartFailure(reason: string | null): void {
  _lastStartFailure = reason
}

export function isPodmanProbeComplete(): boolean {
  return _probeCompletion === 'complete'
}

/** Probe finished and Podman engine (+ machine when required) verified ready. */
export function isPodmanVerifiedReady(): boolean {
  return _probeCompletion === 'complete' && _podSetupError === null
}

export function markPodmanProbeComplete(): void {
  _probeCompletion = 'complete'
}

export function getPodSetupErrorRef(): PodmanSetupError | null {
  if (_probeCompletion === 'pending') {
    return new PodmanSetupError('probe_pending', PROBE_PENDING_MESSAGE)
  }
  return _podSetupError
}

export function setPodSetupErrorRef(err: PodmanSetupError | null): void {
  _podSetupError = err
}

export function getLocalPodStatus(): LocalPodStatusSnapshot {
  return {
    status: _lifecycleStatus,
    reason: _lastStartFailure,
    hasSessionSecret: getPodSessionAuthSecret() != null,
  }
}

export function getLocalPodUnavailableMessage(): string {
  const setup = getPodSetupErrorRef()
  if (setup) {
    return `Verification environment unavailable: ${setup.userMessage}`
  }
  const snap = getLocalPodStatus()
  if (snap.status === 'starting') {
    return 'Verification environment is starting; try again shortly.'
  }
  if (snap.status === 'failed' && snap.reason) {
    return `Verification environment unavailable: ${snap.reason}`
  }
  if (snap.status === 'failed') {
    return 'Verification environment unavailable: local pod failed to start.'
  }
  if (!getPodSessionAuthSecret()) {
    return 'Verification environment unavailable: local pod has not been started.'
  }
  return 'Verification environment unavailable.'
}

export function _resetPodStatusForTest(): void {
  _lifecycleStatus = 'idle'
  _lastStartFailure = null
  _podSetupError = null
  _probeCompletion = 'pending'
}
