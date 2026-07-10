/**
 * Single source of truth for llama.cpp provider status (B1).
 *
 * Every consumer that needs to know "is the local model provider usable" — the BEAP ad
 * publish gate, `hostAiProviderAdvertisementBlockedReason`, `handshakeAvailableModelsCompute`,
 * `hostAiHostOrchestratorHealth`, the warmup gate, `inboxAutosortRuntime`, and the LLM status
 * registry — must read this object instead of independently re-deriving "is it up" from a
 * roster scan, a disk scan, or its own probe. `serverRunning` is always the real cached
 * llama-server reachability signal (see `LocalLlmManager.probeCached`), never inferred from
 * "did the model roster throw".
 */

import { localLlmManager } from './local-llm-manager'
import { getStoredActiveLocalModelId, resolveEffectiveLocalModel } from './activeLocalModelStore'
import type { InstalledModel } from './types'

export type LocalLlmProviderStatus = {
  /** llama-server(.exe) resolved on disk (bundled, Windows install dir, or PATH) — see B0. */
  binaryInstalled: boolean
  /** Real, cached llama-server HTTP reachability (not "roster derivation didn't throw"). */
  serverRunning: boolean
  /** Disk-scanned + (when reachable) server-reported installed GGUF models. */
  modelsInstalled: InstalledModel[]
  modelsCount: number
  /** Resolved active model id, or `null` when none installed / stored id unresolvable. */
  activeModel: string | null
  /** `true` when a stored active-model preference exists but no installed model matches it. */
  activeModelUnresolvable: boolean
  port: number
  baseUrl: string
}

export async function getLocalLlmProviderStatus(): Promise<LocalLlmProviderStatus> {
  const binaryInstalled = localLlmManager.isBinaryAvailable()
  const [probe, modelsInstalled] = await Promise.all([
    localLlmManager.probeCached(),
    localLlmManager.listModels().catch(() => [] as InstalledModel[]),
  ])
  const names = modelsInstalled.map((m) => m.name)
  const stored = getStoredActiveLocalModelId()
  const { model: activeModel } = resolveEffectiveLocalModel(names, stored)
  return {
    binaryInstalled,
    // Strictly the real HTTP reachability signal — never `probe.ok`, which also covers the
    // disk-only fallback used by `checkInstalled()`. Conflating the two was the root cause of
    // the `ollama_ok: true`-while-down regression this module exists to prevent.
    serverRunning: probe.serverReachable,
    modelsInstalled,
    modelsCount: modelsInstalled.length,
    activeModel,
    activeModelUnresolvable: Boolean(stored) && modelsInstalled.length > 0 && !names.includes(stored as string),
    port: localLlmManager.getPort(),
    baseUrl: probe.baseUrl || localLlmManager.getBaseUrl(),
  }
}
