/**
 * Assembles and trims the OptimizationContext envelope for auto-optimization runs.
 */

import type { Project } from '../types/projectTypes'
import type {
  AgentOutputEntry,
  AttachmentsSection,
  DomSnapshot,
  OptimizationContext,
  OptimizationSource,
  ProjectSection,
  SessionSection,
} from '../types/optimizationTypes'

export function mapProjectToSection(project: Project): ProjectSection {
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    goals: project.goals,
    milestones: project.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      completed: m.completed,
      isActive: m.isActive,
    })),
  }
}

export function attachmentsFromProject(project: Project): AttachmentsSection {
  return {
    items: project.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mimeType: a.mimeType,
      excerpt: a.content?.trim() ? a.content.slice(0, 8000) : null,
      parseStatus: a.parseStatus ?? null,
    })),
  }
}

export type AssembleOptimizationContextParams = {
  project: Project
  dom: DomSnapshot | null
  session: SessionSection
  attachments: AttachmentsSection
  priorAgentOutputs?: AgentOutputEntry[]
  userMessage?: string | null
  runId: string
  source: OptimizationSource
}

export function assembleOptimizationContext(
  params: AssembleOptimizationContextParams,
): OptimizationContext {
  return {
    version: 1,
    runId: params.runId,
    source: params.source,
    createdAt: new Date().toISOString(),
    project: mapProjectToSection(params.project),
    dom: params.dom,
    session: params.session,
    attachments: params.attachments,
    priorAgentOutputs: params.priorAgentOutputs ? [...params.priorAgentOutputs] : [],
    userMessage: params.userMessage ?? null,
  }
}

/** ~1 token per 4 characters (English heuristic). */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

function estimateContextTokens(ctx: OptimizationContext): number {
  return estimateTokens(JSON.stringify(ctx))
}

function cloneCtx(ctx: OptimizationContext): OptimizationContext {
  return structuredClone(ctx)
}

function truncateStr(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, Math.max(0, maxLen - 20)) + ' [… trimmed]'
}

/**
 * Trims context to fit token budget. Priority (trim first → trim last):
 * 1) dom.slots[].textDigest — supplementary DOM capture
 * 2) userMessage — WR Chat sidebar transcript for this session
 * 3) priorAgentOutputs[].summary
 * 4) attachments.items[].excerpt (oldest items first), then drop oldest
 * 5) project.milestones — remove completed entries
 * 6) session.agents[].existingBoxOutput — shorten longest first
 * 7) session.agents[].systemPromptOrRole — trimmed last (agent prompts)
 *
 * Never removes project.title or project.description or project.goals. Default maxTokens 24000 with 3000 reserved for completion.
 */
export function trimToTokenBudget(
  ctx: OptimizationContext,
  maxTokens = 24_000,
  reservationForCompletion = 3000,
): OptimizationContext {
  const budget = Math.max(1000, maxTokens - reservationForCompletion)
  const out = cloneCtx(ctx)
  let guard = 0

  while (estimateContextTokens(out) > budget && guard < 600) {
    guard++

    if (trimDomSlots(out)) continue
    if (trimUserMessage(out)) continue
    if (trimPriorOutputs(out)) continue
    if (trimAttachments(out)) continue
    if (trimMilestonesCompleted(out)) continue
    if (trimAgentExistingBoxOutputs(out)) continue
    if (trimAgentSystemPrompts(out)) continue

    break
  }

  return out
}

function trimUserMessage(ctx: OptimizationContext): boolean {
  const u = ctx.userMessage?.trim()
  if (!u) return false
  if (u.length < 24) {
    ctx.userMessage = null
    return true
  }
  const nextLen = Math.max(8, Math.floor(u.length / 2))
  ctx.userMessage = truncateStr(u, nextLen)
  return true
}

function trimDomSlots(ctx: OptimizationContext): boolean {
  const dom = ctx.dom
  if (!dom?.slots?.length) return false
  let longestIdx = -1
  let longestLen = -1
  dom.slots.forEach((s, i) => {
    const L = s.textDigest.length
    if (L > longestLen) {
      longestLen = L
      longestIdx = i
    }
  })
  if (longestIdx < 0 || longestLen < 16) return false
  const slot = dom.slots[longestIdx]
  const half = Math.max(8, Math.floor(slot.textDigest.length / 2))
  dom.slots[longestIdx] = {
    ...slot,
    textDigest: slot.textDigest.slice(0, half) + ' [… trimmed]',
    truncated: true,
  }
  return true
}

function trimPriorOutputs(ctx: OptimizationContext): boolean {
  if (!ctx.priorAgentOutputs.length) return false
  let longestIdx = -1
  let longestLen = -1
  ctx.priorAgentOutputs.forEach((p, i) => {
    const L = p.summary.length
    if (L > longestLen) {
      longestLen = L
      longestIdx = i
    }
  })
  if (longestIdx < 0 || longestLen < 8) {
    ctx.priorAgentOutputs.pop()
    return true
  }
  const p = ctx.priorAgentOutputs[longestIdx]
  const nextLen = Math.max(8, Math.floor(p.summary.length / 2))
  ctx.priorAgentOutputs[longestIdx] = {
    ...p,
    summary: truncateStr(p.summary, nextLen),
  }
  return true
}

function trimAttachments(ctx: OptimizationContext): boolean {
  const items = ctx.attachments.items
  if (!items.length) return false
  const oldestIdx = 0
  const it = items[oldestIdx]
  if (it.excerpt && it.excerpt.length > 16) {
    const nextLen = Math.max(16, Math.floor(it.excerpt.length / 2))
    items[oldestIdx] = {
      ...it,
      excerpt: truncateStr(it.excerpt, nextLen),
    }
    return true
  }
  if (it.excerpt) {
    items[oldestIdx] = { ...it, excerpt: null }
    return true
  }
  items.splice(oldestIdx, 1)
  return true
}

function trimMilestonesCompleted(ctx: OptimizationContext): boolean {
  const ms = ctx.project.milestones
  const idx = ms.findIndex((m) => m.completed)
  if (idx < 0) return false
  ctx.project.milestones = ms.filter((_, i) => i !== idx)
  return true
}

function trimAgentExistingBoxOutputs(ctx: OptimizationContext): boolean {
  const agents = ctx.session.agents
  let bestIdx = -1
  let bestLen = -1
  agents.forEach((a, i) => {
    const ex = a.existingBoxOutput || ''
    if (ex.length > bestLen) {
      bestLen = ex.length
      bestIdx = i
    }
  })
  if (bestIdx < 0 || bestLen < 16) return false
  const a = agents[bestIdx]
  const raw = a.existingBoxOutput || ''
  const nextLen = Math.max(16, Math.floor(raw.length / 2))
  agents[bestIdx] = {
    ...a,
    existingBoxOutput: truncateStr(raw, nextLen),
  }
  return true
}

function trimAgentSystemPrompts(ctx: OptimizationContext): boolean {
  const agents = ctx.session.agents
  let bestIdx = -1
  let bestLen = -1
  agents.forEach((a, i) => {
    const sp = a.systemPromptOrRole || ''
    if (sp.length > bestLen) {
      bestLen = sp.length
      bestIdx = i
    }
  })
  if (bestIdx < 0 || bestLen < 16) return false
  const a = agents[bestIdx]
  const nextLen = Math.max(16, Math.floor((a.systemPromptOrRole || '').length / 2))
  agents[bestIdx] = {
    ...a,
    systemPromptOrRole: truncateStr(a.systemPromptOrRole || '', nextLen),
  }
  return true
}

