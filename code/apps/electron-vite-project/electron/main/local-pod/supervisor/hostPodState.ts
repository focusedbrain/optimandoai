/**
 * Host pod supervisor lifecycle state exposed to ingestion mode resolver (Stream A — A7).
 */

export type HostPodSupervisorState =
  | 'healthy'
  | 'replacement_exhausted'
  | 'halted_by_anomaly'

let _state: HostPodSupervisorState = 'healthy'
let _haltReason: string | null = null
let _lastTeardownAt: string | null = null

export function getHostPodSupervisorState(): HostPodSupervisorState {
  return _state
}

export function getHostPodHaltReason(): string | null {
  return _haltReason
}

export function getHostPodLastTeardownAt(): string | null {
  return _lastTeardownAt
}

export function setHostPodSupervisorHealthy(): void {
  _state = 'healthy'
  _haltReason = null
}

export function setHostPodReplacementExhausted(reason: string): void {
  _state = 'replacement_exhausted'
  _haltReason = reason
  _lastTeardownAt = new Date().toISOString()
}

export function setHostPodHaltedByAnomaly(reason: string): void {
  _state = 'halted_by_anomaly'
  _haltReason = reason
  _lastTeardownAt = new Date().toISOString()
}

/** User-initiated recovery — clears budget and halt flags. */
export function clearHostPodSupervisorHaltForRetry(): void {
  _state = 'healthy'
  _haltReason = null
}

export function _resetHostPodSupervisorStateForTest(): void {
  _state = 'healthy'
  _haltReason = null
  _lastTeardownAt = null
}
