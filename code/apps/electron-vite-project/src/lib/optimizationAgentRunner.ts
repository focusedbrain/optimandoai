/**
 * Parallel optimization agent execution (batched LLM calls).
 */

import type { AgentEntry, AgentRunResult, LlmSendFn, OptimizationContext } from '../types/optimizationTypes'
import { buildMessagesForAgent } from './optimizationPromptBuilder'

function chunkAgents<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size))
  }
  return out
}

/**
 * Runs all agents in parallel batches of at most 4, with 500ms between batches.
 * Uses Promise.allSettled so one failure does not cancel others.
 */
export async function runAgentsParallel(
  agents: AgentEntry[],
  ctx: OptimizationContext,
  llmSend: LlmSendFn,
): Promise<AgentRunResult[]> {
  const results: AgentRunResult[] = []
  const batches = chunkAgents(agents, 4)

  for (let b = 0; b < batches.length; b++) {
    if (b > 0) {
      await new Promise((r) => setTimeout(r, 500))
    }
    const batch = batches[b]
    const settled = await Promise.allSettled(
      batch.map(async (agent) => {
        const t0 = Date.now()
        const messages = buildMessagesForAgent(agent, ctx, 'parallel')
        const output = await llmSend(messages, agent.provider ?? undefined, agent.model ?? undefined)
        return {
          agentBoxId: agent.boxId,
          agentLabel: agent.title,
          boxNumber: agent.boxNumber,
          output,
          durationMs: Date.now() - t0,
        }
      }),
    )

    settled.forEach((s, i) => {
      const agent = batch[i]
      if (s.status === 'fulfilled') {
        results.push(s.value)
      } else {
        const reason = s.reason
        results.push({
          agentBoxId: agent.boxId,
          agentLabel: agent.title,
          boxNumber: agent.boxNumber,
          output: '',
          error: reason instanceof Error ? reason.message : String(reason),
          durationMs: 0,
        })
      }
    })
  }

  return results
}
