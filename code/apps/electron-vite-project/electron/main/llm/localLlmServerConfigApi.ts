/**
 * Shared handler logic for the llama-server inference-settings surface
 * (build038) — used by both the IPC handlers (llm/ipc.ts) and the HTTP routes
 * (main.ts) so the extension and the Electron renderer see the same payloads.
 */

import { localLlmManager } from './local-llm-manager'
import {
  getLocalLlmServerConfig,
  setLocalLlmServerConfig,
  LOCAL_LLM_CTX_STANDARD,
  LOCAL_LLM_CTX_LONG,
  type LocalLlmServerConfig,
} from './localLlmServerConfig'

export interface LocalLlmServerConfigView {
  config: LocalLlmServerConfig
  ctxPresets: { standard: number; long: number }
  /** Computed "Maximum" per-slot ctx for the active model at the configured parallel value. */
  maxCtxPerSlot: number | null
  kvSource: 'gguf' | 'fallback' | null
  vramUsedBytes: number | null
  vramTotalBytes: number | null
  /** Last applied spawn plan (null until the app has spawned llama-server). */
  applied: {
    args: string[]
    ctxTokens: number
    ctxPerSlot: number
    parallel: number
    parallelRequested: number
    reasoningEnabled: boolean
  } | null
  clampNotice: string | null
  restart: { pending: boolean; waitingForTasks: boolean }
  serverRunning: boolean
  activeModel: string | null
}

export async function getLocalLlmServerConfigView(): Promise<LocalLlmServerConfigView> {
  const config = getLocalLlmServerConfig()
  const insight = await localLlmManager.computeServerConfigInsight(config.parallel)
  const { plan, clampNotice } = localLlmManager.getLastSpawnPlan()
  const probeRunning = await localLlmManager.isRunning()
  let activeModel: string | null = null
  try {
    activeModel = await localLlmManager.getEffectiveChatModelName()
  } catch {
    /* best-effort */
  }
  return {
    config,
    ctxPresets: { standard: LOCAL_LLM_CTX_STANDARD, long: LOCAL_LLM_CTX_LONG },
    maxCtxPerSlot: insight.maxCtxPerSlot,
    kvSource: insight.kvSource,
    vramUsedBytes: insight.vramUsedBytes,
    vramTotalBytes: insight.vramTotalBytes,
    applied: plan
      ? {
          args: plan.args,
          ctxTokens: plan.ctxTokens,
          ctxPerSlot: plan.ctxPerSlot,
          parallel: plan.parallelApplied,
          parallelRequested: plan.parallelRequested,
          reasoningEnabled: plan.reasoningEnabled,
        }
      : null,
    clampNotice,
    restart: localLlmManager.getRestartState(),
    serverRunning: probeRunning,
    activeModel,
  }
}

export function applyLocalLlmServerConfigPatch(raw: unknown): LocalLlmServerConfig {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const patch: Partial<LocalLlmServerConfig> = {}
  if (o.ctxMode === 'standard' || o.ctxMode === 'long' || o.ctxMode === 'max') {
    patch.ctxMode = o.ctxMode
  }
  if (o.parallel === 1 || o.parallel === 2 || o.parallel === 4) {
    patch.parallel = o.parallel
  }
  if (typeof o.reasoningEnabled === 'boolean') {
    patch.reasoningEnabled = o.reasoningEnabled
  }
  return setLocalLlmServerConfig(patch)
}

export async function restartLocalLlmServerForSettings(): Promise<{
  ok: boolean
  queued: boolean
  reason?: string
}> {
  return localLlmManager.restartManagedServerGraceful()
}
