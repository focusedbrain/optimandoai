/**
 * Host-AI content routing. Sandbox→Host inference always goes over the **sealed relay**
 * transport (`sealed_host`); the Sandbox's own loopback Ollama stays `local_ollama`.
 * Plaintext LAN `ollama_direct` (`192.168.x:11434`) has been removed — see
 * `internal-inference-p2p-invariants.mdc`. Only transport selection changed; trust/role/model frozen.
 */

import type { AiExecutionContext } from '../llm/aiExecutionTypes'
import { InternalInferenceErrorCode } from './errors'

export type BeapContentAiTaskKind = 'summary' | 'analysis' | 'draft' | 'refine' | 'chat_rag' | 'other'

export type BeapContentAiTask = {
  kind: BeapContentAiTaskKind
  /** When true, use BEAP / P2P host completion path and require {@link AiExecutionContext.beapReady}. */
  requiresTopChatTools?: boolean
}

/** Transport label for diagnostics — never the removed `ollama_direct` LAN wire. */
function routeTransportLabel(ai: AiExecutionContext | null | undefined): 'local' | 'sealed_host' {
  return ai?.lane === 'local' ? 'local' : 'sealed_host'
}

export function logBeapContentAiRoute(task: BeapContentAiTask, ai: AiExecutionContext | null | undefined): void {
  const transport = routeTransportLabel(ai)
  const model = (ai?.model ?? '').trim()
  const beapReady = ai?.beapReady === true
  const requiresTopChatTools = task.requiresTopChatTools === true
  console.log(
    `[BEAP_CONTENT_AI_ROUTE] task=${task.kind} transport=${transport} model=${model} beapReady=${beapReady} requiresTopChatTools=${requiresTopChatTools}`,
  )
}

export type SandboxContentHostExecutionPlan =
  | { mode: 'sealed_host' }
  | { mode: 'local_ollama' }
  | { mode: 'blocked'; code: string; message: string }

/**
 * How {@link SandboxHostChat} should reach the Host for sandbox callers that have {@link AiExecutionContext}.
 * Cross-device Host inference resolves to `sealed_host` (sealed relay); the Sandbox's own loopback
 * Ollama resolves to `local_ollama`. There is no plaintext LAN path.
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
    return { mode: 'sealed_host' }
  }

  if (aiExecution?.lane === 'local') {
    return { mode: 'local_ollama' }
  }

  return { mode: 'sealed_host' }
}
