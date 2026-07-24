/**
 * build038 — event-anchored model warmup.
 *
 * The old startup warmup was single-shot and app-start-anchored: if llama-server (or the
 * model) was not ready within its 45s window at app launch, warmup was permanently skipped
 * for the whole session — post-install starts, manual starts, supervised restarts, and
 * "Apply & restart" all came up cold, so the first real inference paid model-load +
 * first-token GPU init.
 *
 * This module subscribes to `LocalLlmManager.onServerHealthy` (fired on every observed
 * down→up transition) and warms the default model once per spawn generation:
 *  - anchor: server-healthy event, not a fixed timer window
 *  - dedup: at most one warmup per spawn generation (concurrent events collapse)
 *  - payload: `max_tokens: 1` via `warmModel` — model load + first-token GPU init only
 *  - logging: `[WARMUP]` with ttft_ms on success (in `warmModel`), skip reasons here
 *
 * Host-local only; sandbox nodes never register (checked at init and per-run).
 */

import { getHandshakeDbForInternalInference } from '../internalInference/dbAccess'
import { isEffectiveSandboxNode } from '../sandbox/sandboxOutboundPolicy'
import { resolveAiExecutionContextForLlm } from './resolveAiExecutionContext'
import { warmModel } from './warmModel'
import { localLlmManager } from './local-llm-manager'

const L = '[WARMUP]'

let registered = false
let lastWarmedGeneration = -1
let warmupInFlight = false

/** @internal tests */
export function _resetWarmupOnServerHealthyForTests(): void {
  registered = false
  lastWarmedGeneration = -1
  warmupInFlight = false
}

/**
 * Idempotent. Call once from main init on the Host orchestrator; safe to call on
 * sandbox nodes (registers nothing).
 */
export async function initWarmupOnServerHealthy(): Promise<void> {
  if (registered) return
  registered = true
  try {
    const db = await getHandshakeDbForInternalInference()
    if (isEffectiveSandboxNode(db)) {
      console.log(`${L} trigger_not_registered reason=effective_sandbox_node`)
      return
    }
  } catch {
    // DB unavailable at init — register anyway; warmModel re-checks sandbox per run.
  }
  localLlmManager.onServerHealthy((generation) => {
    void runWarmupForGeneration(generation)
  })
  console.log(`${L} trigger_registered anchor=server_healthy`)
}

async function runWarmupForGeneration(generation: number): Promise<void> {
  if (generation <= lastWarmedGeneration) return
  if (warmupInFlight) return
  warmupInFlight = true
  try {
    lastWarmedGeneration = generation
    const resolved = await resolveAiExecutionContextForLlm()
    if (!resolved.ok) {
      console.log(`${L} skipped generation=${generation} reason=no_default_model`)
      return
    }
    const { ctx } = resolved
    if (ctx.lane !== 'local') {
      console.log(`${L} skipped generation=${generation} reason=non_local_lane lane=${ctx.lane}`)
      return
    }
    const model = ctx.model?.trim()
    if (!model) {
      console.log(`${L} skipped generation=${generation} reason=no_default_model`)
      return
    }
    console.log(`${L} start generation=${generation} model=${model} trigger=server_healthy`)
    const result = await warmModel(model)
    if (!result.ok) {
      console.log(
        `${L} skipped generation=${generation} reason=${result.skippedReason ?? 'warmup_failed'}`,
      )
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`${L} unexpected_error generation=${generation} detail=${JSON.stringify(msg.slice(0, 160))}`)
  } finally {
    warmupInFlight = false
  }
}
