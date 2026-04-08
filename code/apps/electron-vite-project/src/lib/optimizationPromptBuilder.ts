/**
 * Builds per-agent chat messages for optimization runs (parallel vs sequential).
 */

import type { AgentEntry, OptimizationContext } from '../types/optimizationTypes'

function formatMilestones(ctx: OptimizationContext): string {
  const ms = ctx.project.milestones
  if (!ms.length) return '(none)'
  return ms
    .map(
      (m) =>
        `- ${m.title} (id: ${m.id}, completed: ${m.completed}, active: ${m.isActive})`,
    )
    .join('\n')
}

function formatDomBlock(ctx: OptimizationContext): string {
  const dom = ctx.dom
  if (!dom) return ''
  const lines: string[] = []
  lines.push(`Layout: ${dom.layout} | Grid ID: ${dom.gridId ?? 'n/a'} | Captured: ${dom.capturedAt}`)
  for (const s of dom.slots) {
    const label = s.agentLabel ?? '(no label)'
    lines.push(
      `  Slot box#${s.boxNumber} | ${label} | status=${s.status}${s.truncated ? ' [truncated]' : ''}`,
    )
    const digest = s.textDigest.trim() || '(empty)'
    lines.push(`    ${digest.replace(/\n/g, '\n    ')}`)
  }
  return lines.join('\n')
}

function formatAttachmentsBlock(ctx: OptimizationContext): string {
  const items = ctx.attachments.items
  if (!items.length) return '(none)'
  return items
    .map((it) => {
      const ex = it.excerpt?.trim()
        ? it.excerpt.length > 2000
          ? `${it.excerpt.slice(0, 2000)}…`
          : it.excerpt
        : '(no excerpt)'
      return `- ${it.filename} (${it.mimeType}) parse=${it.parseStatus ?? 'unknown'}\n  ${ex}`
    })
    .join('\n')
}

function formatPriorSummaries(ctx: OptimizationContext): string {
  if (!ctx.priorAgentOutputs.length) return ''
  return ctx.priorAgentOutputs
    .map((p) => `- [${p.agentLabel}]: ${p.summary}`)
    .join('\n')
}

/**
 * Builds OpenAI-style messages for one agent. Parallel mode omits prior-agent block; sequential includes it when non-empty.
 */
export function buildMessagesForAgent(
  agent: AgentEntry,
  ctx: OptimizationContext,
  mode: 'parallel' | 'sequential',
): Array<{ role: string; content: string }> {
  const runId = ctx.runId
  const sharedInstructions =
    `You are an AI optimization agent participating in a WR Desk optimization run. Run ID: ${runId}. ` +
    `Your task is to analyze the project state and provide actionable optimization suggestions.`

  const projectBlock =
    `Project\n` +
    `Title: ${ctx.project.title}\n` +
    `Description:\n${ctx.project.description}\n\n` +
    `Goals:\n${ctx.project.goals}\n\n` +
    `Milestones:\n${formatMilestones(ctx)}\n\n` +
    `Session key: ${ctx.session.sessionKey}\n` +
    `Linked orchestrator session: ${ctx.session.linkedOrchestratorSessionId ?? 'none'}`

  const domPart = ctx.dom ? `DOM / grid state\n${formatDomBlock(ctx)}` : ''
  const attachmentsPart = `Attachments\n${formatAttachmentsBlock(ctx)}`

  const roleText = agent.systemPromptOrRole?.trim()
    ? `Your specific role: ${agent.systemPromptOrRole}`
    : 'Provide general optimization.'
  const toolsPart =
    agent.toolsSummary?.trim() ? `Tools available (summary): ${agent.toolsSummary}` : ''

  let systemParts = [
    sharedInstructions,
    projectBlock,
    domPart,
    attachmentsPart,
    `Agent profile\nBox: ${agent.boxId} (#${agent.boxNumber}) — ${agent.title}\nProvider: ${agent.provider ?? 'default'} | Model: ${agent.model ?? 'default'}`,
    roleText,
    toolsPart,
  ].filter((p) => p.length > 0)

  if (mode === 'sequential' && ctx.priorAgentOutputs.length > 0) {
    systemParts.push(
      `Previous agents have provided the following analysis:\n${formatPriorSummaries(ctx)}`,
    )
  }

  const systemContent = systemParts.join('\n\n')

  let userContent =
    `Analyze the current project state and provide optimization suggestions. ` +
    `Focus on your role as '${agent.title}'. Be specific and actionable. ` +
    `Reference concrete elements from the DOM state or milestones where relevant.`

  if (ctx.userMessage?.trim()) {
    userContent += `\n\nAdditional user context:\n${ctx.userMessage.trim()}`
  }

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ]
}
