/**
 * Builds per-agent chat messages for optimization runs (parallel vs sequential).
 */

import type { AgentEntry, OptimizationContext } from '../types/optimizationTypes'

function formatMilestones(ctx: OptimizationContext): string {
  const ms = ctx.project.milestones
  if (!ms.length) return '(none)'
  return ms
    .map((m) => {
      const desc = m.description?.trim()
      const descPart = desc ? ` | desc: ${desc}` : ''
      return `- ${m.title}${descPart} (id: ${m.id}, completed: ${m.completed}, active: ${m.isActive})`
    })
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

function activeMilestoneTitle(ctx: OptimizationContext): string {
  const ms = ctx.project.milestones
  const a = ms.find((m) => m.isActive) ?? ms.find((m) => !m.completed) ?? ms[0]
  return a?.title?.trim() || '(none)'
}

function descriptionSnippet(ctx: OptimizationContext, maxLen: number): string {
  const d = ctx.project.description?.trim() ?? ''
  if (!d) return '(none)'
  return d.length <= maxLen ? d : `${d.slice(0, maxLen)}…`
}

/**
 * Builds OpenAI-style messages for one agent. Parallel mode omits prior-agent block; sequential includes it when non-empty.
 * System message order: primary project context first, then role-as-lens, DOM/attachments/profile, optional prior box output, run metadata last.
 */
export function buildMessagesForAgent(
  agent: AgentEntry,
  ctx: OptimizationContext,
  mode: 'parallel' | 'sequential',
): Array<{ role: string; content: string }> {
  const runId = ctx.runId

  const primaryObjectiveBlock =
    `=== PRIMARY OBJECTIVE ===\n` +
    `You are analyzing and optimizing the following project. ALL your output must directly address this project's description, goals, and milestones. ` +
    `Do not reference prior conversations or documents not mentioned below.\n\n` +
    `Project: ${ctx.project.title}\n` +
    `Description:\n${ctx.project.description}\n\n` +
    `Goals:\n${ctx.project.goals}\n\n` +
    `Milestones:\n${formatMilestones(ctx)}\n\n` +
    `Session key: ${ctx.session.sessionKey}\n` +
    `Linked orchestrator session: ${ctx.session.linkedOrchestratorSessionId ?? 'none'}`

  const roleLensBody = agent.systemPromptOrRole?.trim()
    ? agent.systemPromptOrRole.trim()
    : 'Provide clear, actionable optimization suggestions aligned with the milestones above.'

  const roleBlock =
    `=== YOUR ROLE ===\n` +
    `Approach this project analysis as a "${agent.title}" specialist. ${roleLensBody}\n` +
    `Apply this role specifically to the project above. Do not reference any prior sessions, documents, or conversations.`

  const domPart = ctx.dom ? `DOM / grid state\n${formatDomBlock(ctx)}` : ''
  const attachmentsPart = `Attachments\n${formatAttachmentsBlock(ctx)}`

  const agentProfileBlock =
    `Agent profile\n` +
    `Box: ${agent.boxId} (#${agent.boxNumber}) — ${agent.title}\n` +
    `Provider: ${agent.provider ?? 'default'} | Model: ${agent.model ?? 'default'}`

  const toolsPart =
    agent.toolsSummary?.trim() ? `Tools available (summary): ${agent.toolsSummary}` : ''

  const existingTrim = agent.existingBoxOutput?.trim()
  const existingBoxPart = existingTrim
    ? `=== PREVIOUS OUTPUT (for reference only — generate fresh analysis based on current project state) ===\n${existingTrim}`
    : ''

  const sharedInstructionsEnd =
    `=== RUN METADATA ===\n` +
    `You are an AI optimization agent participating in a WR Desk optimization run. Run ID: ${runId}. ` +
    `Analyze the project state and provide actionable optimization suggestions grounded in the PRIMARY OBJECTIVE above.`

  let systemParts = [
    primaryObjectiveBlock,
    roleBlock,
    domPart,
    attachmentsPart,
    agentProfileBlock,
    toolsPart,
    existingBoxPart,
  ].filter((p) => p.length > 0)

  if (mode === 'sequential' && ctx.priorAgentOutputs.length > 0) {
    systemParts.push(
      `Previous agents have provided the following analysis:\n${formatPriorSummaries(ctx)}`,
    )
  }

  systemParts.push(sharedInstructionsEnd)

  const systemContent = systemParts.join('\n\n')

  const descSnip = descriptionSnippet(ctx, 200)
  const activeMs = activeMilestoneTitle(ctx)

  let userContent =
    `Based on the project description, goals, and milestones provided above, provide your analysis as a ${agent.title} specialist.\n\n` +
    `Focus specifically on:\n` +
    `- The project description: "${descSnip}"\n` +
    `- Active milestone: "${activeMs}"\n\n` +
    `Do not reference any documents, schemas, or conversations not explicitly mentioned in the project context above.`

  if (ctx.userMessage?.trim()) {
    userContent += `\n\nAdditional user context:\n${ctx.userMessage.trim()}`
  }

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ]

  console.log('[AutoOpt] LLM prompt for', agent.title, ':', {
    systemLength: messages[0].content.length,
    userLength: messages[1].content.length,
    projectDesc: ctx.project.description?.substring(0, 80),
    milestoneCount: ctx.project.milestones?.length,
    activeMilestone: activeMilestoneTitle(ctx).substring(0, 60),
    hasExistingOutput: !!agent.existingBoxOutput,
    existingOutputLength: agent.existingBoxOutput?.length ?? 0,
  })

  return messages
}
