/**
 * Pre-send hook for extension WR Chat: debug logs + optional `llm.setAiExecutionContext` via Electron RPC.
 */

import { buildWrChatExtensionAiExecutionPayload } from './wrChatExtensionAiContext'
import {
  loadPersistedWrChatExtensionModel,
  mapExtensionSelectionSourceForLog,
  type WrChatExtensionSelectionSource,
} from './wrChatExtensionModelPersistence'
import type { WrChatSelectorRow } from './wrChatModelsFromLlmStatus'
import { electronRpc } from '../rpc/electronRpc'

export type WrChatExtensionOrigin = 'sidebar_wrchat' | 'popup_wrchat'

export function wrChatExtensionDebugLog(event: string, fields: Record<string, unknown>): void {
  console.log(`[WRCHAT_EXT] ${event} ${JSON.stringify(fields)}`)
}

function logSelectionSourceForSend(
  persisted: ReturnType<typeof loadPersistedWrChatExtensionModel>,
  resolvedModelId: string,
): 'user' | 'default' {
  if (!resolvedModelId) return 'default'
  if (persisted?.modelId === resolvedModelId) {
    return mapExtensionSelectionSourceForLog(persisted.selectionSource)
  }
  return 'default'
}

export async function runWrChatExtensionPreSend(options: {
  origin: WrChatExtensionOrigin
  activeLlmModelUi: string | undefined
  resolvedModelId: string
  availableModels: readonly WrChatSelectorRow[]
  /** When set (e.g. immediately after explicit UI selection), forces persistence semantics for RPC. */
  selectionSource?: WrChatExtensionSelectionSource
}): Promise<void> {
  const persisted = loadPersistedWrChatExtensionModel()
  const selectionSourceForLog: 'user' | 'default' =
    options.selectionSource != null
      ? mapExtensionSelectionSourceForLog(options.selectionSource)
      : logSelectionSourceForSend(persisted, options.resolvedModelId)

  const fallbackUsed = selectionSourceForLog !== 'user'
  const payload = buildWrChatExtensionAiExecutionPayload(options.resolvedModelId, options.availableModels)

  wrChatExtensionDebugLog('model_select_context', {
    origin: options.origin,
    selectedModelUi: options.activeLlmModelUi ?? null,
    persistedModelId: persisted?.modelId ?? null,
    selectionSource: selectionSourceForLog,
  })

  let aiExecutionContextAvailable = false
  if (payload) {
    try {
      const res = await electronRpc(
        'llm.setAiExecutionContext',
        {
          ...payload,
          selectionSource: selectionSourceForLog === 'user' ? ('user' as const) : ('auto' as const),
          wrchat_origin: options.origin,
          origin: options.origin,
        },
        12_000,
      )
      const data = res.data as { ok?: boolean; error?: string } | undefined
      aiExecutionContextAvailable = !!(res.success && data && data.ok === true)
    } catch {
      aiExecutionContextAvailable = false
    }
  }

  wrChatExtensionDebugLog('before_send', {
    origin: options.origin,
    selectedModelUi: options.activeLlmModelUi ?? null,
    resolvedModelId: options.resolvedModelId,
    modelIdSent: options.resolvedModelId,
    selectionSource: selectionSourceForLog,
    fallbackUsed,
    aiExecutionContextAvailable,
    aiExecutionPayloadBuilt: payload != null,
  })

  if (payload && !aiExecutionContextAvailable) {
    wrChatExtensionDebugLog('ai_execution_context_miss', {
      origin: options.origin,
      aiExecutionContextAvailable: false,
      resolvedModelId: options.resolvedModelId,
    })
  }
}
