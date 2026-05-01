/**
 * Agent-box model precedence for dashboard auto-optimization (no WR Chat surface on this path).
 */

import { resolveAgentBoxInference, agentBoxInferenceDebugLog } from '@ext/services/processFlow'
import type { AgentEntry } from '../types/optimizationTypes'

export const OPTIMIZATION_AGENT_DEFAULT_MODEL = 'llama3.2'

export function resolveOptimizationAgentInference(agent: AgentEntry) {
  return resolveAgentBoxInference({
    agentBoxProvider: agent.provider ?? '',
    agentBoxModel: agent.model ?? '',
    agentBoxUserSelectedInferenceModel: agent.userSelectedInferenceModel ?? '',
    wrchatModelId: '',
    defaultModelId: OPTIMIZATION_AGENT_DEFAULT_MODEL,
    agentId: agent.title,
    boxId: agent.boxId,
  })
}

/** Best-effort IPC for host dashboard (extension pages use `runAgentBoxInferencePreSend`). */
export function optimizationDashboardAgentBoxSetAiExecutionContext(
  agent: AgentEntry,
  inf: ReturnType<typeof resolveOptimizationAgentInference>,
): void {
  try {
    if (typeof window === 'undefined') return
    if (!inf.brain.ok || !inf.brain.isLocal) return
    const w = window as unknown as {
      llm?: { setAiExecutionContext?: (x: Record<string, unknown>) => unknown }
    }
    if (!w.llm?.setAiExecutionContext) return
    w.llm.setAiExecutionContext({
      lane: 'local',
      model: inf.brain.model,
      ollamaDirectReady: false,
      beapReady: false,
      selectionSource:
        inf.modelSource === 'agent_fixed' || inf.modelSource === 'agent_user_selected' ? 'user' : 'auto',
      origin: 'agent_box',
      wrchat_origin: 'agent_box',
      agentId: agent.title,
      boxId: agent.boxId,
      modelSource: inf.modelSource,
    })
  } catch {
    /* noop */
  }
}

export function logOptimizationAgentBoxSend(
  inf: ReturnType<typeof resolveOptimizationAgentInference>,
  inferencePath: 'optimization_dashboard_parallel' | 'optimization_dashboard_sequential',
): void {
  if (!inf.brain.ok) return
  agentBoxInferenceDebugLog('before_send', {
    origin: 'agent_box',
    resolvedModelId: inf.brain.model,
    modelSent: inf.brain.model,
    inferencePath,
    modelSource: inf.modelSource,
    fallbackUsed: inf.modelSource === 'default' || inf.modelSource === 'wrchat_inherited',
    agentId: inf.logFields.agentId ?? null,
    boxId: inf.logFields.boxId ?? null,
  })
}
