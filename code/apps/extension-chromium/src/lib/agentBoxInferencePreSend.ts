/**
 * Pre-inference hook for agent box LLM calls: logs + `llm.setAiExecutionContext` (Electron RPC).
 */

import { buildWrChatExtensionAiExecutionPayload } from './wrChatExtensionAiContext'
import type { WrChatSelectorRow } from './wrChatModelsFromLlmStatus'
import { electronRpc } from '../rpc/electronRpc'
import type { AgentBoxModelSource } from '../services/processFlow'
import { agentBoxInferenceDebugLog } from '../services/processFlow'

export type AgentBoxInferencePath =
  | 'sidepanel_processWithAgent'
  | 'sidepanel_screenshot_agent'
  | 'sidepanel_trigger_agent'
  | 'mode_run_agent'
  | 'optimization_dashboard_parallel'
  | 'optimization_dashboard_sequential'

function selectionSourceForAgentBox(modelSource: AgentBoxModelSource): 'user' | 'auto' {
  if (modelSource === 'agent_fixed' || modelSource === 'agent_user_selected') return 'user'
  return 'auto'
}

export async function runAgentBoxInferencePreSend(options: {
  resolvedModelId: string
  modelSource: AgentBoxModelSource
  availableModels: readonly WrChatSelectorRow[]
  agentId?: string
  boxId?: string
  inferencePath: AgentBoxInferencePath
}): Promise<void> {
  const selectionSource = selectionSourceForAgentBox(options.modelSource)
  const payload = buildWrChatExtensionAiExecutionPayload(options.resolvedModelId, options.availableModels)

  let aiExecutionContextAvailable = false
  if (payload) {
    try {
      const res = await electronRpc(
        'llm.setAiExecutionContext',
        {
          ...payload,
          selectionSource,
          origin: 'agent_box' as const,
          wrchat_origin: 'agent_box',
          agentId: options.agentId,
          boxId: options.boxId,
          modelSource: options.modelSource,
        },
        12_000,
      )
      const data = res.data as { ok?: boolean; error?: string } | undefined
      aiExecutionContextAvailable = !!(res.success && data && data.ok === true)
    } catch {
      aiExecutionContextAvailable = false
    }
  }

  agentBoxInferenceDebugLog('before_send', {
    origin: 'agent_box',
    resolvedModelId: options.resolvedModelId,
    modelSent: options.resolvedModelId,
    inferencePath: options.inferencePath,
    modelSource: options.modelSource,
    selectionSource,
    fallbackUsed: selectionSource === 'auto',
    aiExecutionContextAvailable,
    aiExecutionPayloadBuilt: payload != null,
    agentId: options.agentId ?? null,
    boxId: options.boxId ?? null,
  })
}
