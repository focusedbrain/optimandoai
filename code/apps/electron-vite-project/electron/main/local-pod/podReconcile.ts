/**
 * Idempotent pod reconciliation — remove stale / partial pods before play kube.
 *
 * Every apply uses fresh session secrets, so an existing pod must be recreated even
 * when all five containers appear running from a prior app session.
 */

import { checkRequiredPodContainersReady } from './podContainerCompleteness.js'
import { runPodmanCli } from './podExec.js'
import type { PodmanExecutor } from './podRunner.js'

export async function podExistsLocally(podName: string): Promise<boolean> {
  const result = await runPodmanCli(['pod', 'exists', podName], { timeoutMs: 15_000 })
  return result.code === 0
}

/**
 * Force-remove a pod (Created / partial / running). Uses `pod rm -f` so infra-only
 * pods from failed play kube are cleared without a separate stop step.
 */
export async function forceRemovePodLocal(
  podName: string,
  executor?: PodmanExecutor,
): Promise<void> {
  if (executor) {
    try {
      await executor(['pod', 'rm', '-f', podName], { ...process.env })
      console.log(`[LOCAL_POD] Reconciled pod ${podName}`)
    } catch (err) {
      console.warn(
        `[LOCAL_POD] pod rm -f ${podName}: ${(err as Error).message ?? err}`,
      )
    }
    return
  }

  const result = await runPodmanCli(['pod', 'rm', '-f', podName], { timeoutMs: 30_000 })
  if (result.code === 0) {
    console.log(`[LOCAL_POD] Reconciled pod ${podName}`)
  } else if (!result.stderr.includes('no such pod') && !result.stderr.includes('not found')) {
    console.warn(`[LOCAL_POD] pod rm -f ${podName}: ${result.stderr.trim() || result.code}`)
  }
}

/**
 * Tear down any existing pod with this name before applying a fresh manifest.
 */
export async function reconcilePodBeforeStart(
  podName: string,
  executor: PodmanExecutor,
): Promise<void> {
  if (!(await podExistsLocally(podName))) {
    return
  }

  const complete = await checkRequiredPodContainersReady(podName, { probeHealth: false })
  if (complete.ok) {
    console.log(
      `[LOCAL_POD] Removing prior ${podName} before apply (new session credentials)`,
    )
  } else {
    console.log(
      `[LOCAL_POD] Reconciling incomplete ${podName}: ${complete.reason}`,
    )
  }

  await forceRemovePodLocal(podName, executor)
}
