/**
 * Shared headless throwaway llama.cpp warmup — used by startup default warm and mode on-trigger warm.
 * Host-local path only; sandbox nodes skip.
 */

import { getHandshakeDbForInternalInference } from '../internalInference/dbAccess'
import { isEffectiveSandboxNode } from '../sandbox/sandboxOutboundPolicy'
import { assertGpuInferenceAvailable } from '../inference/inferenceGate'
import { getAdaptiveKeepAlive } from './adaptiveWarmupStrategy'
import { localLlmManager } from './local-llm-manager'

// B2: poll the shared cached prober (via `isRunning` → `probeCached`) rather than raw-probing
// every 500ms — the cache/backoff inside `LocalLlmManager` now absorbs this cadence, so this
// loop is a lifecycle-state check, not an independent network prober. Total wait cap unchanged.
const LOCAL_LLM_READY_POLL_MS = 1_000
const LOCAL_LLM_READY_MAX_WAIT_MS = 45_000

export type WarmModelResult = {
  ok: boolean
  ms?: number
  skippedReason?: string
}

export async function warmModel(modelId: string, opts?: { keepAlive?: string }): Promise<WarmModelResult> {
  const trimmed = modelId?.trim()
  if (!trimmed) return { ok: false, skippedReason: 'empty_model_id' }

  const db = await getHandshakeDbForInternalInference()
  if (isEffectiveSandboxNode(db)) {
    return { ok: false, skippedReason: 'effective_sandbox_node' }
  }

  const localLlmUp = await waitForLocalLlmRunning(LOCAL_LLM_READY_MAX_WAIT_MS)
  if (!localLlmUp) {
    return { ok: false, skippedReason: 'local_llm_unreachable' }
  }

  const keepAlive = opts?.keepAlive ?? getAdaptiveKeepAlive()
  const t0 = Date.now()
  try {
    await assertGpuInferenceAvailable()
    await localLlmManager.chat(trimmed, [{ role: 'user', content: 'ok' }], { keepAlive })
    return { ok: true, ms: Date.now() - t0 }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, skippedReason: `warmup_failed:${msg.slice(0, 120)}` }
  }
}

async function waitForLocalLlmRunning(maxWaitMs: number): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    try {
      if (await localLlmManager.isRunning()) return true
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, LOCAL_LLM_READY_POLL_MS))
  }
  return false
}
