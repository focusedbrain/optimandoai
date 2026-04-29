/**
 * BEAP / Host-AI content routing: simple plaintext-in → chat-out uses LAN `ollama_direct`
 * when possible; top-chat tool orchestration keeps BEAP transport and requires `beapReady`.
 */

import type { AiExecutionContext } from '../llm/aiExecutionTypes'
import { InternalInferenceErrorCode } from './errors'

export type BeapContentAiTaskKind = 'summary' | 'analysis' | 'draft' | 'refine' | 'chat_rag' | 'other'

export type BeapContentAiTask = {
  kind: BeapContentAiTaskKind
  /** When true, use BEAP / P2P host completion path and require {@link AiExecutionContext.beapReady}. */
  requiresTopChatTools?: boolean
}

export function logBeapContentAiRoute(task: BeapContentAiTask, ai: AiExecutionContext | null | undefined): void {
  const lane = ai?.lane ?? 'local'
  const model = (ai?.model ?? '').trim()
  const baseUrl = ai?.baseUrl?.trim().length ? ai.baseUrl!.trim() : null
  const beapReady = ai?.beapReady === true
  const ollamaDirectReady = ai?.ollamaDirectReady === true
  const requiresTopChatTools = task.requiresTopChatTools === true
  console.log(
    `[BEAP_CONTENT_AI_ROUTE] task=${task.kind} lane=${lane} model=${model} baseUrl=${baseUrl} beapReady=${beapReady} ollamaDirectReady=${ollamaDirectReady} requiresTopChatTools=${requiresTopChatTools}`,
  )
}

export type SandboxContentHostExecutionPlan =
  | { mode: 'ollama_direct' }
  | { mode: 'beap_transport' }
  | { mode: 'blocked'; code: string; message: string }

/**
 * How {@link SandboxHostChat} should reach the Host for sandbox callers that have {@link AiExecutionContext}.
 */
export function planSandboxHostChatExecution(
  aiExecution: AiExecutionContext | null | undefined,
  task: BeapContentAiTask,
): SandboxContentHostExecutionPlan {
  logBeapContentAiRoute(task, aiExecution ?? undefined)

  if (task.requiresTopChatTools === true) {
    if (aiExecution?.beapReady !== true) {
      return {
        mode: 'blocked',
        code: InternalInferenceErrorCode.HOST_AI_DIRECT_PEER_BEAP_MISSING,
        message:
          'Top-chat BEAP tools are unavailable because the host BEAP endpoint is not advertised or not ready.',
      }
    }
    return { mode: 'beap_transport' }
  }

  if (!aiExecution) {
    return { mode: 'ollama_direct' }
  }

  const odlReady = aiExecution.ollamaDirectReady === true
  const lane = aiExecution.lane

  if (lane === 'local') {
    return { mode: 'ollama_direct' }
  }

  const simpleKinds: BeapContentAiTaskKind[] = ['summary', 'analysis', 'draft', 'refine']
  const isSimpleContent = simpleKinds.includes(task.kind)

  if (isSimpleContent && lane === 'ollama_direct' && odlReady) {
    return { mode: 'ollama_direct' }
  }

  if (isSimpleContent && lane === 'beap' && odlReady) {
    return { mode: 'ollama_direct' }
  }

  if (lane === 'ollama_direct' && odlReady) {
    return { mode: 'ollama_direct' }
  }

  if (lane === 'beap' && odlReady && (task.kind === 'chat_rag' || task.kind === 'other')) {
    return { mode: 'ollama_direct' }
  }

  return { mode: 'beap_transport' }
}
