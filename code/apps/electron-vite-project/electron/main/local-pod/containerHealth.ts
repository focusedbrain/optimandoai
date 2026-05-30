/**
 * Container health assessment — prefer Podman aggregated Health; tolerate exec-layer flakes.
 */

import {
  LOCAL_POD_EXEC_LAYER_EXIT_CODES,
  LOCAL_POD_GENUINE_HEALTH_FAILURE_THRESHOLD,
  LOCAL_POD_HEALTH_EXEC_RETRIES,
  LOCAL_POD_HEALTH_PROBE_TIMEOUT_MS,
} from './podConstants.js'
import {
  inspectPodmanHealthStatus,
  probeContainerHealthExec,
  type ContainerHealthExecOutcome,
} from './supervisor/podmanLocal.js'

export type ContainerHealthPollOutcome = 'ok' | 'genuine_fail' | 'inconclusive'

export type ContainerHealthGateMode = 'startup' | 'steady'

const genuineFailureStreak = new Map<string, number>()

export function resetContainerHealthStreak(containerName?: string): void {
  if (!containerName) {
    genuineFailureStreak.clear()
    return
  }
  genuineFailureStreak.delete(containerName)
}

export function recordHealthyContainer(containerName: string): void {
  genuineFailureStreak.delete(containerName)
}

export function recordGenuineHealthFailure(containerName: string): number {
  const next = (genuineFailureStreak.get(containerName) ?? 0) + 1
  genuineFailureStreak.set(containerName, next)
  return next
}

export function isSustainedGenuineHealthFailure(containerName: string): boolean {
  return (
    (genuineFailureStreak.get(containerName) ?? 0) >=
    LOCAL_POD_GENUINE_HEALTH_FAILURE_THRESHOLD
  )
}

async function probeExecWithRetries(
  containerName: string,
  port: number,
  timeoutMs: number,
): Promise<ContainerHealthExecOutcome> {
  let last: ContainerHealthExecOutcome = { kind: 'exec_layer', exitCode: 125 }
  const attempts = 1 + LOCAL_POD_HEALTH_EXEC_RETRIES
  for (let i = 0; i < attempts; i++) {
    last = await probeContainerHealthExec(containerName, port, timeoutMs)
    if (last.kind === 'ok' || last.kind === 'http_unhealthy') {
      return last
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  return last
}

/**
 * Poll one container: Podman Health first, exec fallback only when needed.
 */
export async function pollContainerHealthOutcome(
  containerName: string,
  port: number,
  timeoutMs = LOCAL_POD_HEALTH_PROBE_TIMEOUT_MS,
): Promise<ContainerHealthPollOutcome> {
  const aggregated = await inspectPodmanHealthStatus(containerName)
  if (aggregated === 'healthy') {
    return 'ok'
  }
  if (aggregated === 'unhealthy') {
    return 'genuine_fail'
  }

  const exec = await probeExecWithRetries(containerName, port, timeoutMs)
  if (exec.kind === 'ok') {
    return 'ok'
  }
  if (exec.kind === 'http_unhealthy') {
    return 'genuine_fail'
  }
  if (exec.kind === 'exec_layer' || LOCAL_POD_EXEC_LAYER_EXIT_CODES.has(exec.exitCode)) {
    return 'inconclusive'
  }
  return 'inconclusive'
}
