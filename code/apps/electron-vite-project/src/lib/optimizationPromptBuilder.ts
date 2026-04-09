/**
 * Builds per-agent chat messages for optimization runs (parallel vs sequential).
 */

import type { AgentEntry, OptimizationContext } from '../types/optimizationTypes'

const ATTACHMENT_SUMMARY_MAX = 200

function formatMilestonesForAdvisor(ctx: OptimizationContext): string {
  const ms = ctx.project.milestones
  if (!ms.length) return '(none)'
  return ms
    .map((m) => {
      const desc = m.description?.trim()
      const descPart = desc
        ? `\n    Notes: ${desc.length <= 160 ? desc : `${desc.slice(0, 160)}…`}`
        : ''
      return `- ${m.title} (id: ${m.id}, completed: ${m.completed}, active: ${m.isActive})${descPart}`
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

/** Title + brief excerpt only (excerpt already capped in attachmentsFromProject; enforce here too). */
function formatReferenceDocuments(ctx: OptimizationContext): string {
  const items = ctx.attachments.items
  if (!items.length) return ''
  return items
    .map((it) => {
      const raw = it.excerpt?.trim() ?? ''
      const brief =
        raw.length === 0
          ? '(no excerpt)'
          : raw.length <= ATTACHMENT_SUMMARY_MAX
            ? raw
            : `${raw.slice(0, ATTACHMENT_SUMMARY_MAX)}…`
      return `- ${it.filename} (${it.mimeType}) parse=${it.parseStatus ?? 'unknown'}\n  ${brief}`
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
  return a?.title?.trim() || ''
}

/**
 * Builds OpenAI-style messages for one agent. Parallel mode omits prior-agent block; sequential includes it when non-empty.
 * Framing: project optimization advisors for the owner — not developers implementing milestones or attachments.
 */
export function buildMessagesForAgent(
  agent: AgentEntry,
  ctx: OptimizationContext,
  mode: 'parallel' | 'sequential',
): Array<{ role: string; content: string }> {
  const runId = ctx.runId
  const milestonesBlock = formatMilestonesForAdvisor(ctx)
  const refDocs = formatReferenceDocuments(ctx)
  const domBlock = ctx.dom ? formatDomBlock(ctx) : ''

  const roleInstructions = agent.systemPromptOrRole?.trim()
    ? agent.systemPromptOrRole.trim()
    : 'Offer concise, practical guidance that fits your assigned role title.'

  let systemContent =
    'You are a project optimization advisor. You analyze project state and provide strategic advice to help the project owner improve progress, clarity, and execution.\n\n' +
    'RULES:\n' +
    '- You advise on the project. You do NOT implement it.\n' +
    '- Do not write code, propose CSS, design APIs, or create technical implementations.\n' +
    '- Do not treat milestones as feature tickets to build. Analyze them for clarity, feasibility, and progress.\n' +
    '- Do not reference documents, schemas, panels, or systems not explicitly present in the project data below.\n' +
    '- Do not continue conversations from previous sessions. Each run is independent.\n' +
    '- Base every claim on the actual project description, goals, and milestones provided below.\n\n' +
    '=== PROJECT DATA ===\n' +
    `Title: ${ctx.project.title}\n\n` +
    `Description:\n${ctx.project.description}\n\n` +
    `Goals:\n${ctx.project.goals}\n\n` +
    `Milestones (these are the project owner's planned work items — analyze their clarity, feasibility, and progress, do NOT implement them):\n` +
    `${milestonesBlock}\n`

  if (refDocs.length > 0) {
    systemContent +=
      '\n=== REFERENCE DOCUMENTS (background context only — do not build solutions around these) ===\n' +
      `${refDocs}\n`
  }

  if (domBlock.length > 0) {
    systemContent +=
      '\n=== CURRENT UI STATE (for situational awareness only) ===\n' + `${domBlock}\n`
  }

  systemContent +=
    '\n=== YOUR SPECIALIST PERSPECTIVE ===\n' +
    `Your assigned role: "${agent.title}"\n` +
    `${roleInstructions}\n\n` +
    'Apply this specialist perspective to advise on the project above. Your output should help the project owner understand gaps, risks, and concrete next steps.\n'

  systemContent +=
    `\n=== RUN METADATA ===\n` +
    `Run ID: ${runId} | Session key: ${ctx.session.sessionKey} | Linked orchestrator session: ${ctx.session.linkedOrchestratorSessionId ?? 'none'}\n` +
    `Agent box: ${agent.boxId} (#${agent.boxNumber}) | Provider: ${agent.provider ?? 'default'} | Model: ${agent.model ?? 'default'}`
  if (agent.toolsSummary?.trim()) {
    systemContent += `\nTools (summary): ${agent.toolsSummary.trim()}`
  }

  if (mode === 'sequential' && ctx.priorAgentOutputs.length > 0) {
    systemContent +=
      `\nEarlier in this optimization run, other advisors noted:\n${formatPriorSummaries(ctx)}\n`
  }

  const focusTitle = activeMilestoneTitle(ctx) || 'no specific milestone selected'

  let userContent =
    `Analyze the project described above and provide your specialist advice as a "${agent.title}" advisor.\n\n` +
    `The project owner is currently focused on: ${focusTitle}\n\n` +
    'Provide actionable, specific advice grounded in the actual project description, goals, and milestones. Do not invent features or reference systems not mentioned above.'

  if (ctx.userMessage?.trim()) {
    userContent += `\n\nAdditional context from the project owner:\n${ctx.userMessage.trim()}`
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
    activeMilestone: focusTitle.substring(0, 60),
    attachmentSummariesOnly: true,
    existingBoxOutputInPrompt: false,
  })

  return messages
}
