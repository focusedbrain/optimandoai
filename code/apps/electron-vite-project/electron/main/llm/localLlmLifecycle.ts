/**
 * Host-only orchestrator lifecycle for llama-server (spawn, readiness, shutdown).
 * Sandbox nodes never spawn a local engine.
 */

import { isSandboxMode } from '../orchestrator/orchestratorModeStore'
import { localLlmManager } from './local-llm-manager'

const L = '[LOCAL_LLM_LIFECYCLE]'

export type LocalLlmLifecycleInitResult = {
  ok: boolean
  running: boolean
  reason?: string
}

/** Enable supervision and attempt to bring llama-server up on host startup. */
export async function initHostLocalLlmLifecycle(ctx: { phase: string }): Promise<LocalLlmLifecycleInitResult> {
  if (isSandboxMode()) {
    console.log(`${L} skip reason=sandbox_mode phase=${ctx.phase}`)
    return { ok: true, running: false, reason: 'sandbox_mode' }
  }

  localLlmManager.enableSupervision()
  const result = await localLlmManager.ensureManagedServerRunning({ reason: ctx.phase })
  console.log(
    `${L} init phase=${ctx.phase} ok=${result.ok} running=${result.running} reason=${result.reason ?? 'none'}`,
  )
  return result
}

/** Stop managed llama-server on app quit — frees loopback :8080. */
export async function shutdownHostLocalLlmLifecycle(ctx: { phase: string }): Promise<void> {
  if (isSandboxMode()) return
  console.log(`${L} shutdown phase=${ctx.phase}`)
  await localLlmManager.shutdownManagedServer(ctx.phase)
}

/** After first GGUF install — start server if it was deferred for missing model. */
export async function ensureLocalLlmAfterModelInstall(reason: string): Promise<void> {
  if (isSandboxMode()) return
  localLlmManager.enableSupervision()
  const result = await localLlmManager.ensureManagedServerRunning({ reason })
  console.log(
    `${L} post_install reason=${reason} ok=${result.ok} running=${result.running} detail=${result.reason ?? 'none'}`,
  )
}
