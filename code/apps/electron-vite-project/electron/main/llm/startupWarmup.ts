/**
 * Orchestrator startup warmup — host-local default model load (PR1) + adaptive strategy init (batch-04).
 *
 * Host-local path only: tiny throwaway chat via `warmModel` on 127.0.0.1 — no sealed relay.
 */

import { getHandshakeDbForInternalInference } from '../internalInference/dbAccess'
import { isEffectiveSandboxNode } from '../sandbox/sandboxOutboundPolicy'
import { resolveAiExecutionContextForLlm } from './resolveAiExecutionContext'
import { resolveAdaptiveWarmupStrategy } from './adaptiveWarmupStrategy'
import { warmModel } from './warmModel'

const L = '[STARTUP_WARMUP]'

let startupWarmupScheduled = false

export type StartupWarmupContext = {
  phase?: string
}

/**
 * Fire-and-forget: runs at most once per process. Safe to call from main init.
 */
export function scheduleStartupWarmup(ctx: StartupWarmupContext = {}): void {
  if (startupWarmupScheduled) return
  startupWarmupScheduled = true
  void runStartupWarmup(ctx).catch((e) => {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`${L} unexpected error detail=${JSON.stringify(msg.slice(0, 200))}`)
  })
}

/** @internal tests */
export function _resetStartupWarmupScheduleForTests(): void {
  startupWarmupScheduled = false
}

export async function runStartupWarmup(_ctx: StartupWarmupContext = {}): Promise<void> {
  const db = await getHandshakeDbForInternalInference()
  if (isEffectiveSandboxNode(db)) {
    await runSandboxSealedStartupWarmupPlaceholder()
    return
  }

  await resolveAdaptiveWarmupStrategy()
  await runHostLocalDefaultModelWarmup()
}

async function runSandboxSealedStartupWarmupPlaceholder(): Promise<void> {
  console.log(`${L} skipped reason=effective_sandbox_node`)
}

async function runHostLocalDefaultModelWarmup(): Promise<void> {
  const resolved = await resolveAiExecutionContextForLlm()
  if (!resolved.ok) {
    console.log(`${L} skipped reason=no_default_model`)
    return
  }

  const { ctx } = resolved
  if (ctx.lane !== 'local') {
    console.log(`${L} skipped reason=non_local_lane lane=${ctx.lane}`)
    return
  }

  const model = ctx.model?.trim()
  if (!model) {
    console.log(`${L} skipped reason=no_default_model`)
    return
  }

  const result = await warmModel(model)
  if (result.ok && result.ms != null) {
    console.log(`${L} host default model=${model} warmed in ${result.ms}ms`)
    return
  }
  console.log(
    `${L} skipped reason=${result.skippedReason ?? 'warmup_failed'}`,
  )
}
