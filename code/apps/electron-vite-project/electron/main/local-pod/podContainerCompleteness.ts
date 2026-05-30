/**
 * Fail-closed readiness: every required container from the active pod manifest
 * must be running and pass /health before hostPodReady is true.
 *
 * Authoritative role lists: supervisor/containers.ts (aligned with pod.yaml /
 * pod-local-verify.yaml container names + ports).
 */

import {
  containersForPodName,
  type LocalPodContainerSpec,
} from './supervisor/containers.js'
import { inspectContainerState } from './supervisor/podmanLocal.js'
import {
  pollContainerHealthOutcome,
  recordHealthyContainer,
  recordGenuineHealthFailure,
  resetContainerHealthStreak,
  type ContainerHealthGateMode,
} from './containerHealth.js'
import {
  LOCAL_POD_GENUINE_HEALTH_FAILURE_THRESHOLD,
  LOCAL_POD_HEALTH_PROBE_TIMEOUT_MS,
} from './podConstants.js'

export type PodContainerCompletenessIssue = {
  role: LocalPodContainerSpec['role']
  containerName: string
  detail: 'missing' | 'exited' | 'unknown' | 'unhealthy'
}

export type PodContainerCompletenessResult =
  | { ok: true; podName: string; checked: readonly LocalPodContainerSpec[] }
  | {
      ok: false
      podName: string
      checked: readonly LocalPodContainerSpec[]
      issues: PodContainerCompletenessIssue[]
      reason: string
    }

export type CheckRequiredPodContainersOptions = {
  probeHealth?: boolean
  timeoutMs?: number
  /** Startup wait: inconclusive exec flakes block readiness without marking unhealthy. */
  healthGateMode?: ContainerHealthGateMode
}

export async function checkRequiredPodContainersReady(
  podName: string,
  options?: CheckRequiredPodContainersOptions,
): Promise<PodContainerCompletenessResult> {
  const checked = containersForPodName(podName)
  const probeHealth = options?.probeHealth ?? true
  const timeoutMs = options?.timeoutMs ?? LOCAL_POD_HEALTH_PROBE_TIMEOUT_MS
  const healthGateMode = options?.healthGateMode ?? 'steady'
  const issues: PodContainerCompletenessIssue[] = []
  let healthPending = false

  for (const spec of checked) {
    const state = await inspectContainerState(spec.containerName)
    if (state === 'missing') {
      issues.push({ role: spec.role, containerName: spec.containerName, detail: 'missing' })
      continue
    }
    if (state === 'exited') {
      issues.push({ role: spec.role, containerName: spec.containerName, detail: 'exited' })
      continue
    }
    if (state !== 'running') {
      issues.push({ role: spec.role, containerName: spec.containerName, detail: 'unknown' })
      continue
    }
    if (!probeHealth) {
      continue
    }

    const outcome = await pollContainerHealthOutcome(
      spec.containerName,
      spec.port,
      timeoutMs,
    )

    if (outcome === 'ok') {
      recordHealthyContainer(spec.containerName)
      continue
    }

    if (outcome === 'inconclusive') {
      if (healthGateMode === 'startup') {
        healthPending = true
      }
      continue
    }

    // genuine_fail
    if (healthGateMode === 'startup') {
      issues.push({ role: spec.role, containerName: spec.containerName, detail: 'unhealthy' })
      continue
    }

    const streak = recordGenuineHealthFailure(spec.containerName)
    if (streak >= LOCAL_POD_GENUINE_HEALTH_FAILURE_THRESHOLD) {
      issues.push({ role: spec.role, containerName: spec.containerName, detail: 'unhealthy' })
    }
  }

  if (issues.length > 0) {
    const summary = issues.map((i) => `${i.role}:${i.detail}`).join(',')
    return {
      ok: false,
      podName,
      checked,
      issues,
      reason: `required_pod_containers_incomplete pod=${podName} issues=${summary}`,
    }
  }

  if (healthPending) {
    return {
      ok: false,
      podName,
      checked,
      issues: [],
      reason: `required_pod_containers_incomplete pod=${podName} issues=health_pending`,
    }
  }

  return { ok: true, podName, checked }
}

/** Clear health streak state when a pod is torn down or replaced. */
export function resetPodContainerHealthProbeState(): void {
  resetContainerHealthStreak()
}
