/**
 * Shared merge logic for `handshake:getAvailableModels` and WR Chat (`llm:getStatus` / `/api/llm/status`).
 * Keeps Host-internal rows + sandbox-local Ollama + cloud aligned across Electron dashboard and extension.
 */

import { getOrchestratorMode, isSandboxMode } from '../orchestrator/orchestratorModeStore'
import type { OllamaStatus } from './types'

/** Deduped discovery log (same semantics as former inline helper in main.ts). */
let lastLocalProviderOllamaDiscoveryLogSig = ''
function logLocalProviderOllamaDiscovery(ok: boolean, errorMessage: string | null): void {
  const sig = `${ok}:${errorMessage ?? ''}`
  if (sig === lastLocalProviderOllamaDiscoveryLogSig) return
  lastLocalProviderOllamaDiscoveryLogSig = sig
  const errPart =
    errorMessage == null || errorMessage === ''
      ? 'null'
      : String(errorMessage).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
  console.log(`[LOCAL_PROVIDER_DISCOVERY] provider=ollama ok=${ok} error=${errPart} affects_host_ai=false`)
}

export type HandshakeUiModelRow =
  | {
      id: string
      name: string
      provider: string
      type: 'local'
      inferenceTargetContext: 'sandbox_local'
    }
  | {
      id: string
      name: string
      provider: string
      type: 'host_internal'
      inferenceTargetContext: 'host_remote'
      displayTitle: string
      displaySubtitle: string
      hostTargetAvailable: boolean
      hostSelectorState: 'available' | 'checking' | 'unavailable'
      p2pUiPhase?: string
    }
  | {
      id: string
      name: string
      provider: string
      type: 'cloud'
      inferenceTargetContext: 'cloud'
    }

export type WrChatAvailableModelRow = {
  id: string
  displayName: string
  kind: 'local_ollama' | 'host_internal' | 'cloud'
  displaySubtitle?: string
}

export type ComputeHandshakeAvailableModelsOpts = {
  /**
   * Skip `ollamaManager.listModels()` and use these entries (e.g. `getStatus().modelsInstalled`)
   * so `llm:getStatus` does not double-fetch local tags.
   */
  reuseLocalModels?: ReadonlyArray<{ name?: string | null }>
  /** When `reuseLocalModels` is set: mirrors whether local Ollama was reachable in `getStatus()`. */
  reusedLocalOllamaDiscoveryOk?: boolean
}

export type ComputeHandshakeAvailableModelsResult =
  | {
      success: true
      models: HandshakeUiModelRow[]
      ledgerProvesInternalSandboxToHost: boolean
      hostInferenceTargets?: unknown[]
      inferenceRefreshMeta?: { hadCapabilitiesProbed: boolean }
    }
  | { success: false; error: string; models: [] }

export function handshakeModelsToWrChatRows(models: HandshakeUiModelRow[]): WrChatAvailableModelRow[] {
  return models.map((m) => {
    if (m.type === 'host_internal') {
      return {
        id: m.id,
        displayName: m.displayTitle || m.name,
        kind: 'host_internal',
        displaySubtitle: m.displaySubtitle?.trim() ? m.displaySubtitle : undefined,
      }
    }
    if (m.type === 'cloud') {
      return { id: m.id, displayName: m.name, kind: 'cloud' }
    }
    return { id: m.id, displayName: m.name, kind: 'local_ollama' }
  })
}

export async function computeHandshakeAvailableModels(
  opts?: ComputeHandshakeAvailableModelsOpts,
): Promise<ComputeHandshakeAvailableModelsResult> {
  try {
    const localModels: HandshakeUiModelRow[] = []
    const cloudModels: Extract<HandshakeUiModelRow, { type: 'cloud' }>[] = []

    const mainOrchMode = getOrchestratorMode().mode
    if (mainOrchMode !== 'host' && mainOrchMode !== 'sandbox') {
      console.warn(
        `[HOST_INFERENCE_TARGETS] mode_unknown persisted_orchestrator_mode=${String(mainOrchMode)}`,
      )
    }
    const {
      hasActiveInternalLedgerSandboxToHostForHostAi,
      hasActiveInternalLedgerLocalHostPeerSandboxForHostUi,
      listSandboxHostInternalInferenceTargets,
      shouldMergeHostInternalRowsForGetAvailableModels,
    } = await import('../internalInference/listInferenceTargets')
    const ledgerProvesInternalSandboxToHost = await hasActiveInternalLedgerSandboxToHostForHostAi()
    const mergeHostInternalInference = shouldMergeHostInternalRowsForGetAvailableModels(
      isSandboxMode(),
      ledgerProvesInternalSandboxToHost,
    )
    const ledgerProvesLocalHostWithPeerSandbox =
      await hasActiveInternalLedgerLocalHostPeerSandboxForHostUi()

    if (!mergeHostInternalInference) {
      if (ledgerProvesLocalHostWithPeerSandbox && !ledgerProvesInternalSandboxToHost) {
        console.log(
          '[HOST_INFERENCE_TARGETS] host_internal_merge_skipped reason=not_sandbox_client expected=true (ledger=host; merge applies only to sandbox-side Host AI list)',
        )
      } else {
        console.log(
          '[HOST_INFERENCE_TARGETS] host_internal_merge_skipped reason=no_sandbox_mode_and_no_ledger_sandbox_to_host',
        )
      }
    }

    const hostForChat: Extract<HandshakeUiModelRow, { type: 'host_internal' }>[] = []
    let hostInferenceTargetsOut: unknown[] | undefined
    let inferenceRefreshMeta: { hadCapabilitiesProbed: boolean } | undefined
    if (mergeHostInternalInference) {
      try {
        const h = await listSandboxHostInternalInferenceTargets()
        hostInferenceTargetsOut = h.targets
        inferenceRefreshMeta = h.refreshMeta
        for (const t of h.targets) {
          const defaultModel = t.model_id?.trim() || t.model?.trim() || ''
          const titleFromMain =
            typeof (t as { displayTitle?: string }).displayTitle === 'string'
              ? (t as { displayTitle: string }).displayTitle.trim()
              : ''
          const title =
            titleFromMain ||
            ((t.display_label || t.label).trim() ||
              (defaultModel ? `Host AI · ${defaultModel}` : 'Host AI'))
          const subFromMain =
            typeof (t as { displaySubtitle?: string }).displaySubtitle === 'string'
              ? (t as { displaySubtitle: string }).displaySubtitle.trim()
              : ''
          const sub = subFromMain || (t.secondary_label || '').trim()
          const p2pUiPhase = (t as { p2pUiPhase?: string }).p2pUiPhase
          hostForChat.push({
            id: t.id,
            name: title,
            provider: 'host_internal',
            type: 'host_internal',
            inferenceTargetContext: 'host_remote',
            displayTitle: title,
            displaySubtitle: sub,
            hostTargetAvailable: t.available,
            hostSelectorState: t.host_selector_state,
            ...(p2pUiPhase ? { p2pUiPhase } : {}),
          })
        }
      } catch (e: unknown) {
        console.warn('[MAIN] handshake:getAvailableModels host targets:', (e as Error)?.message ?? e)
      }
    }

    let ollamaDiscoveryOk = true
    let ollamaModelCount = 0
    if (opts?.reuseLocalModels) {
      ollamaModelCount = opts.reuseLocalModels.length
      ollamaDiscoveryOk = opts.reusedLocalOllamaDiscoveryOk ?? opts.reuseLocalModels.length > 0
      for (const m of opts.reuseLocalModels) {
        const name = (m?.name ?? '').trim()
        if (!name) continue
        localModels.push({
          id: name,
          name,
          provider: 'ollama',
          type: 'local',
          inferenceTargetContext: 'sandbox_local',
        })
      }
      logLocalProviderOllamaDiscovery(ollamaDiscoveryOk, null)
    } else {
      try {
        const { ollamaManager } = await import('./ollama-manager')
        const installed = await ollamaManager.listModels()
        ollamaModelCount = Array.isArray(installed) ? installed.length : 0
        for (const m of installed) {
          const name = m?.name?.trim?.() || ''
          if (!name) continue
          localModels.push({
            id: name,
            name,
            provider: 'ollama',
            type: 'local',
            inferenceTargetContext: 'sandbox_local',
          })
        }
        logLocalProviderOllamaDiscovery(true, null)
      } catch (err: unknown) {
        ollamaDiscoveryOk = false
        ollamaModelCount = 0
        const msg = err != null && typeof err === 'object' && 'message' in err ? String((err as Error).message) : String(err)
        logLocalProviderOllamaDiscovery(false, msg || 'unknown_error')
        console.warn('[MAIN] handshake:getAvailableModels sandbox-local Ollama:', (err as Error)?.message ?? err)
      }
    }

    try {
      const { buildHostAiProviderAdvertisementPayload } = await import(
        '../internalInference/hostAiProviderAdvertisementLog'
      )
      const hostAiProvPayload = await buildHostAiProviderAdvertisementPayload({
        ledgerProvesInternalSandboxToHost,
        mergeHostInternalInference,
        ollamaDiscoveryOk,
        ollamaModelCount,
      })
      console.log(`[HOST_AI_PROVIDER_ADVERTISEMENT] ${JSON.stringify(hostAiProvPayload)}`)
      if (hostAiProvPayload.advertised_as_host_ai) {
        const { getHandshakeDbForInternalInference } = await import('../internalInference/dbAccess')
        const hdb = await getHandshakeDbForInternalInference()
        if (hdb) {
          const { publishHostAiDirectBeapAdvertisementsForEligibleHost } = await import(
            '../internalInference/hostAiDirectBeapAdPublish'
          )
          void publishHostAiDirectBeapAdvertisementsForEligibleHost(hdb, {
            context: 'provider_models_list',
          })
        }
      }
    } catch (e: unknown) {
      console.log(`[HOST_AI_PROVIDER_ADVERTISEMENT] err=${(e as Error)?.message ?? String(e)}`)
    }

    const { ocrRouter } = await import('../ocr/router')
    const providers = ocrRouter.getAvailableProviders()
    const CLOUD_MODEL_MAP: Record<string, { id: string; name: string; provider: string }> = {
      OpenAI: { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
      Claude: { id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'anthropic' },
      Gemini: { id: 'gemini-pro', name: 'Gemini Pro', provider: 'google' },
      Grok: { id: 'grok-1', name: 'Grok', provider: 'xai' },
    }
    for (const p of providers) {
      const entry = CLOUD_MODEL_MAP[p]
      if (entry) {
        cloudModels.push({ ...entry, type: 'cloud', inferenceTargetContext: 'cloud' })
      }
    }

    if (cloudModels.length === 0) {
      try {
        const { getOrchestratorService } = await import('../orchestrator-db/service')
        const service = getOrchestratorService()
        const keys = await service.get<Record<string, string>>('optimando-api-keys')
        if (keys && typeof keys === 'object') {
          const PROVIDER_ORDER = ['OpenAI', 'Claude', 'Gemini', 'Grok'] as const
          for (const p of PROVIDER_ORDER) {
            const val = keys[p]
            if (val && typeof val === 'string' && val.trim()) {
              const entry = CLOUD_MODEL_MAP[p]
              if (entry) {
                cloudModels.push({ ...entry, type: 'cloud', inferenceTargetContext: 'cloud' })
              }
            }
          }
        }
      } catch (e) {
        console.error('[MAIN] Failed to read optimando-api-keys from orchestrator:', e)
      }
    }

    const localForChat: HandshakeUiModelRow[] =
      isSandboxMode() && process.env.WRDESK_SANDBOX_LOCAL_OLLAMA !== '1' ? [] : localModels

    return {
      success: true,
      models: [...localForChat, ...hostForChat, ...cloudModels],
      ledgerProvesInternalSandboxToHost,
      ...(mergeHostInternalInference && hostInferenceTargetsOut ? { hostInferenceTargets: hostInferenceTargetsOut } : {}),
      ...(mergeHostInternalInference && inferenceRefreshMeta ? { inferenceRefreshMeta } : {}),
    }
  } catch (err: unknown) {
    console.error('[MAIN] handshake:getAvailableModels error:', (err as Error)?.message)
    return { success: false, error: (err as Error)?.message ?? 'failed', models: [] }
  }
}

/** Attach unified WR Chat registry rows to Ollama status (extension + HTTP GET `/api/llm/status`). */
export async function augmentOllamaStatusWithWrChatModels(
  status: OllamaStatus,
): Promise<OllamaStatus & { wrChatAvailableModels?: WrChatAvailableModelRow[] }> {
  try {
    const gav = await computeHandshakeAvailableModels({
      reuseLocalModels: status.modelsInstalled,
      reusedLocalOllamaDiscoveryOk: status.installed && status.running,
    })
    if (!gav.success) return status
    const wrChatAvailableModels = handshakeModelsToWrChatRows(gav.models)
    const locals = wrChatAvailableModels.filter((x) => x.kind === 'local_ollama').length
    const hosts = wrChatAvailableModels.filter((x) => x.kind === 'host_internal').length
    const clouds = wrChatAvailableModels.filter((x) => x.kind === 'cloud').length
    console.log(
      `[LLM_STATUS_WR_CHAT_REGISTRY] local_ollama=${locals} host_cross=${hosts} cloud=${clouds} active_local=${status.activeModel ?? ''}`,
    )
    return { ...status, wrChatAvailableModels }
  } catch (e: unknown) {
    console.warn('[LLM_STATUS_WR_CHAT_REGISTRY] merge_failed', (e as Error)?.message ?? e)
    return status
  }
}
