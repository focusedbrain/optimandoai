/**
 * Orchestrator startup warmup — one hook for host-local default model load (PR 1) and future
 * sandbox sealed warmup / capability exchange (later PRs).
 *
 * Host-local path only: tiny throwaway chat via `ollamaManager` on 127.0.0.1 — no sealed relay.
 */

import { getHandshakeDbForInternalInference } from '../internalInference/dbAccess'
import { isEffectiveSandboxNode } from '../sandbox/sandboxOutboundPolicy'
import { ollamaManager } from './ollama-manager'
import { resolveAiExecutionContextForLlm } from './resolveAiExecutionContext'

const L = '[STARTUP_WARMUP]'

const OLLAMA_READY_POLL_MS = 500
const OLLAMA_READY_MAX_WAIT_MS = 45_000

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
    // TODO(later PR): sandbox sealed default-model warmup — sendSealedHostAiInferenceRequest (headless).
    await runSandboxSealedStartupWarmupPlaceholder()
    return
  }

  await runHostLocalDefaultModelWarmup()
}

async function runSandboxSealedStartupWarmupPlaceholder(): Promise<void> {
  // TODO(later PR): sealed host_ai_capabilities_request_v1 on startup (capability exchange).
  console.log(`${L} skipped reason=effective_sandbox_node`)
}

async function runHostLocalDefaultModelWarmup(): Promise<void> {
  const ollamaUp = await waitForOllamaRunning(OLLAMA_READY_MAX_WAIT_MS)
  if (!ollamaUp) {
    console.log(`${L} skipped reason=ollama_unreachable`)
    return
  }

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

  const t0 = Date.now()
  try {
    await ollamaManager.chat(model, [{ role: 'user', content: 'ok' }])
    console.log(`${L} host default model=${model} warmed in ${Date.now() - t0}ms`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`${L} skipped reason=warmup_failed detail=${JSON.stringify(msg.slice(0, 160))}`)
  }
}

async function waitForOllamaRunning(maxWaitMs: number): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    try {
      if (await ollamaManager.isRunning()) return true
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, OLLAMA_READY_POLL_MS))
  }
  return false
}
