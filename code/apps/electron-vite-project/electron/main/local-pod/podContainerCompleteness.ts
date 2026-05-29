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
import {
  inspectContainerState,
  probeContainerHealthLocal,
} from './supervisor/podmanLocal.js'
import { LOCAL_POD_HEALTH_PROBE_TIMEOUT_MS } from './supervisor/index.js'

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

export async function checkRequiredPodContainersReady(
  podName: string,
  options?: { probeHealth?: boolean; timeoutMs?: number },
): Promise<PodContainerCompletenessResult> {
  const checked = containersForPodName(podName)
  const probeHealth = options?.probeHealth ?? true
  const timeoutMs = options?.timeoutMs ?? LOCAL_POD_HEALTH_PROBE_TIMEOUT_MS
  const issues: PodContainerCompletenessIssue[] = []

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
    if (probeHealth) {
      const healthy = await probeContainerHealthLocal(spec.containerName, spec.port, timeoutMs)
      if (!healthy) {
        issues.push({ role: spec.role, containerName: spec.containerName, detail: 'unhealthy' })
      }
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

  return { ok: true, podName, checked }
}
