/**
 * Sequential optimization chain: each agent sees prior agents' summaries.
 */

import type {
  AgentEntry,
  AgentOutputEntry,
  AgentRunResult,
  LlmSendFn,
  OptimizationContext,
} from '../types/optimizationTypes'
import { buildMessagesForAgent } from './optimizationPromptBuilder'

const MAX_CHAIN = 6

function summarizeAgentOutput(output: string): string {
  const t = output.trim()
  if (!t) return '(empty)'
  const brace = t.indexOf('{')
  if (brace >= 0) {
    const slice = t.slice(brace)
    try {
      const parsed = JSON.parse(slice) as Record<string, unknown>
      const compact = JSON.stringify(parsed)
      return compact.length <= 500 ? compact : compact.slice(0, 500) + '…'
    } catch {
      /* fall through */
    }
  }
  return t.length <= 500 ? t : t.slice(0, 500) + '…'
}

/**
 * Runs agents one at a time; appends each result to `ctx.priorAgentOutputs` for subsequent steps.
 * Max 6 agents; longer chains are truncated with a console warning.
 */
export async function runAgentsSequential(
  chain: AgentEntry[],
  ctx: OptimizationContext,
  llmSend: LlmSendFn,
): Promise<AgentRunResult[]> {
  let agents = chain
  if (agents.length > MAX_CHAIN) {
    console.warn(
      '[optimizationChainRunner] Chain length truncated to',
      MAX_CHAIN,
      '(was',
      agents.length,
      ')',
    )
    agents = agents.slice(0, MAX_CHAIN)
  }

  const results: AgentRunResult[] = []
  const workingCtx: OptimizationContext = {
    ...ctx,
    priorAgentOutputs: [...(ctx.priorAgentOutputs ?? [])],
  }

  for (const agent of agents) {
    const t0 = Date.now()
    const messages = buildMessagesForAgent(agent, workingCtx, 'sequential')
    try {
      const output = await llmSend(messages, agent.provider ?? undefined, agent.model ?? undefined)
      const durationMs = Date.now() - t0
      results.push({
        agentBoxId: agent.boxId,
        agentLabel: agent.title,
        boxNumber: agent.boxNumber,
        output,
        durationMs,
      })
      const entry: AgentOutputEntry = {
        agentBoxId: agent.boxId,
        agentLabel: agent.title,
        summary: summarizeAgentOutput(output),
      }
      workingCtx.priorAgentOutputs = [...workingCtx.priorAgentOutputs, entry]
    } catch (e) {
      const errText = e instanceof Error ? e.message : String(e)
      console.warn('[optimizationChainRunner] Agent failed:', agent.boxId, errText)
      const durationMs = Date.now() - t0
      results.push({
        agentBoxId: agent.boxId,
        agentLabel: agent.title,
        boxNumber: agent.boxNumber,
        output: '',
        error: errText,
        durationMs,
      })
      const failEntry: AgentOutputEntry = {
        agentBoxId: agent.boxId,
        agentLabel: agent.title,
        summary: `Agent failed: ${errText}`,
      }
      workingCtx.priorAgentOutputs = [...workingCtx.priorAgentOutputs, failEntry]
    }
  }

  return results
}
