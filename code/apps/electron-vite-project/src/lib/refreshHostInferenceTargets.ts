import { logInferenceTargetRefreshStart } from './inferenceTargetRefreshLog'
import type { InferenceTargetRefreshReason } from './inferenceTargetRefreshLog'

/**
 * Optional helper: logs then runs `run('manual_refresh', { force: true })`.
 * UI should prefer calling `loadModels` / `refreshModels` directly with `force: true` so Host discovery is
 * never skipped by a sandbox guard here. Kept for tests and any legacy callers.
 */
export type RefreshHostInferenceTargetsArgs = {
  reason: 'manual_refresh'
  force: true
}

export type HostInferenceRunContext = {
  orchestratorIsSandbox: boolean
  run: (reason: InferenceTargetRefreshReason, options?: { force?: boolean }) => Promise<unknown> | void
}

export async function refreshHostInferenceTargets(
  _args: RefreshHostInferenceTargetsArgs,
  ctx: HostInferenceRunContext,
): Promise<void> {
  if (!ctx.orchestratorIsSandbox) {
    return
  }
  logInferenceTargetRefreshStart('manual_refresh')
  await ctx.run('manual_refresh', { force: true })
}
