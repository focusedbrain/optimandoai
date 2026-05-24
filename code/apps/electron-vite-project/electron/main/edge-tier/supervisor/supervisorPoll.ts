/**
 * Health-probe stuck detection for REMOTE_EDGE supervisor (P5.9).
 *
 * Complements exit-code crash detection (P5.4): running containers that fail liveness
 * probes are force-killed and replaced.
 */

import type { ReplicaActionSshRunner } from '../replicaActions.js'
import { buildContainerHealthProbeCommand } from '../ssh/deploy.js'
import type { RemoteEdgeContainerSpec } from './containers.js'

export const HEALTH_PROBE_INTERVAL_MS = 10_000
export const HEALTH_PROBE_TIMEOUT_MS = 5_000
export const STUCK_THRESHOLD_CONSECUTIVE_FAILURES = 3

const consecutiveFailures = new Map<string, number>()

function probeKey(replicaId: string, role: string): string {
  return `${replicaId}:${role}`
}

export function _resetStuckDetectionForTest(): void {
  consecutiveFailures.clear()
}

export function getConsecutiveProbeFailures(replicaId: string, role: string): number {
  return consecutiveFailures.get(probeKey(replicaId, role)) ?? 0
}

export function resetHealthProbeState(replicaId: string, role?: string): void {
  if (role) {
    consecutiveFailures.delete(probeKey(replicaId, role))
    return
  }
  const prefix = `${replicaId}:`
  for (const key of consecutiveFailures.keys()) {
    if (key.startsWith(prefix)) {
      consecutiveFailures.delete(key)
    }
  }
}

export interface HealthProbeOutcome {
  healthy: boolean
  consecutiveFailures: number
  isStuck: boolean
}

export async function probeContainerHealth(
  ssh: ReplicaActionSshRunner,
  spec: RemoteEdgeContainerSpec,
  timeoutMs: number = HEALTH_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  const cmd = buildContainerHealthProbeCommand(spec.containerName, spec.port, timeoutMs)
  const result = await ssh.run(cmd)
  return result.code === 0
}

export function recordHealthProbeOutcome(
  replicaId: string,
  role: string,
  healthy: boolean,
): HealthProbeOutcome {
  const key = probeKey(replicaId, role)
  if (healthy) {
    consecutiveFailures.delete(key)
    return { healthy: true, consecutiveFailures: 0, isStuck: false }
  }

  const next = (consecutiveFailures.get(key) ?? 0) + 1
  consecutiveFailures.set(key, next)
  return {
    healthy: false,
    consecutiveFailures: next,
    isStuck: next >= STUCK_THRESHOLD_CONSECUTIVE_FAILURES,
  }
}
