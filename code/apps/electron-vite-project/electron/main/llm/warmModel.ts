/**
 * Shared headless throwaway Ollama warmup — used by startup default warm and mode on-trigger warm.
 * Host-local path only; sandbox nodes skip.
 */

import { getHandshakeDbForInternalInference } from '../internalInference/dbAccess'
import { isEffectiveSandboxNode } from '../sandbox/sandboxOutboundPolicy'
import { assertGpuInferenceAvailable } from '../inference/inferenceGate'
import { getAdaptiveKeepAlive } from './adaptiveWarmupStrategy'
import { ollamaManager } from './ollama-manager'

const OLLAMA_READY_POLL_MS = 500
const OLLAMA_READY_MAX_WAIT_MS = 45_000

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

  const ollamaUp = await waitForOllamaRunning(OLLAMA_READY_MAX_WAIT_MS)
  if (!ollamaUp) {
    return { ok: false, skippedReason: 'ollama_unreachable' }
  }

  const keepAlive = opts?.keepAlive ?? getAdaptiveKeepAlive()
  const t0 = Date.now()
  try {
    await assertGpuInferenceAvailable()
    await ollamaManager.chat(trimmed, [{ role: 'user', content: 'ok' }], { keepAlive })
    return { ok: true, ms: Date.now() - t0 }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, skippedReason: `warmup_failed:${msg.slice(0, 120)}` }
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
