/**
 * End-to-end auto-optimization run: guard → session → focus → DOM → context → LLM → UI.
 */

import type { Project } from '../types/projectTypes'
import type {
  AgentEntry,
  AgentRunResult,
  DomSnapshot,
  OptimizationContext,
  OptimizationRunResult,
  OptimizationSource,
  SessionSection,
  TriggerSource,
} from '../types/optimizationTypes'
import { applyOptimizationGuardFallback, canRunOptimization } from './autoOptimizationGuards'
import {
  assembleOptimizationContext,
  attachmentsFromProject,
  trimToTokenBudget,
} from './optimizationContextAssembler'
import { runAgentsParallel } from './optimizationAgentRunner'
import { runAgentsSequential } from './optimizationChainRunner'
import { createOptimizationLlmSend } from './optimizationLlmAdapter'
import { updateAgentBoxOutput } from '@ext/services/processFlow'
import {
  WRDESK_AUTO_OPTIM_ACTIVATE_SESSIONS,
  WRDESK_OPTIMIZATION_GUARD_TOAST,
  WRDESK_OPTIMIZATION_RUN_RESULTS,
} from './wrdeskUiEvents'

type OrchestratorSessionJson = Record<string, unknown>

function logStep(runId: string, step: string, phase: 'start' | 'end', extra?: string): void {
  const x = extra ? ` ${extra}` : ''
  console.info(`[OptimizationRun ${runId}] ${step} ${phase}${x}`)
}

function triggerToOptimizationSource(trigger: TriggerSource): OptimizationSource {
  if (trigger === 'dashboard_interval' || trigger === 'extension_continuous') return 'auto-optimization'
  if (trigger === 'dashboard_snapshot' || trigger === 'extension_snapshot') return 'snapshot'
  return 'manual'
}

type FetchOrchestratorSessionResult =
  | { ok: true; data: OrchestratorSessionJson }
  | { ok: false; message: string }

async function fetchOrchestratorSession(sessionKey: string): Promise<FetchOrchestratorSessionResult> {
  const { defaultDashboardLlmHeaders } = await import('./optimizationLlmAdapter')
  const headers = await defaultDashboardLlmHeaders()
  try {
    const r = await fetch(
      `http://127.0.0.1:51248/api/orchestrator/get?key=${encodeURIComponent(sessionKey)}`,
      { headers },
    )
    if (!r.ok) {
      return {
        ok: false,
        message: `Orchestrator GET failed (${r.status} ${r.statusText}) for session key "${sessionKey}"`,
      }
    }
    const body = (await r.json()) as { data?: OrchestratorSessionJson }
    const data = body?.data ?? null
    if (!data) {
      return {
        ok: false,
        message: `Orchestrator returned no session data for key "${sessionKey}"`,
      }
    }
    return { ok: true, data }
  } catch (e) {
    const hint = e instanceof Error ? e.message : String(e)
    return {
      ok: false,
      message: `Orchestrator GET network error for key "${sessionKey}": ${hint}`,
    }
  }
}

type LooseAgent = {
  id?: string
  name?: string
  number?: number
  reasoning?: { role?: string; goals?: string; outputFormattingInstructions?: string }
  execution?: { workflows?: string[] }
  capabilities?: string[]
  config?: { instructions?: string | object }
}

function formatSidebarChatFromSession(session: OrchestratorSessionJson): string | null {
  const meta = session.metadata as Record<string, unknown> | undefined
  const log = meta?.optimizationSidebarChatLog
  if (!Array.isArray(log) || log.length === 0) return null
  const lines: string[] = []
  for (const entry of log) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as { role?: string; text?: string }
    const t = typeof e.text === 'string' ? e.text.trim() : ''
    if (!t) continue
    const label = e.role === 'assistant' ? 'Assistant' : 'User'
    lines.push(`${label}: ${t}`)
  }
  return lines.length ? lines.join('\n') : null
}

function buildAgentEntries(session: OrchestratorSessionJson): AgentEntry[] {
  const boxes = Array.isArray(session.agentBoxes) ? (session.agentBoxes as Record<string, unknown>[]) : []
  const agents = Array.isArray(session.agents) ? (session.agents as LooseAgent[]) : []

  const entries: AgentEntry[] = []
  for (const box of boxes) {
    const boxId = String(box.id ?? box.identifier ?? '')
    if (!boxId) continue
    const agentNum =
      typeof box.agentNumber === 'number'
        ? box.agentNumber
        : typeof box.agentNumber === 'string'
          ? Number(box.agentNumber)
          : undefined
    const agentCfg =
      agents.find((a) => typeof a.number === 'number' && a.number === agentNum) ||
      agents.find((a) => a.id && (a.id === box.agentId || a.id === box.id)) ||
      null

    const roleParts: string[] = []
    if (agentCfg?.reasoning?.role?.trim()) roleParts.push(agentCfg.reasoning.role.trim())
    if (agentCfg?.reasoning?.goals?.trim()) roleParts.push(agentCfg.reasoning.goals.trim())
    let systemPromptOrRole: string | null = roleParts.length ? roleParts.join('\n\n') : null
    if (!systemPromptOrRole && agentCfg?.config?.instructions) {
      const ins = agentCfg.config.instructions
      systemPromptOrRole = typeof ins === 'string' ? ins : JSON.stringify(ins)
    }
    if (agentCfg?.reasoning?.outputFormattingInstructions?.trim()) {
      const ofi = agentCfg.reasoning.outputFormattingInstructions.trim()
      systemPromptOrRole = systemPromptOrRole
        ? `${systemPromptOrRole}\n\nOutput formatting: ${ofi}`
        : `Output formatting: ${ofi}`
    }

    const wf = agentCfg?.execution?.workflows
    const toolsSummary =
      Array.isArray(wf) && wf.length > 0
        ? wf.join(', ')
        : Array.isArray(agentCfg?.capabilities) && agentCfg.capabilities.length > 0
          ? agentCfg.capabilities.join(', ')
          : null

    const rawOut = box.output
    const existingBoxOutput =
      typeof rawOut === 'string' && rawOut.trim() ? rawOut.trim().slice(0, 12_000) : null

    entries.push({
      boxId,
      boxNumber: typeof box.boxNumber === 'number' ? box.boxNumber : Number(box.boxNumber) || 1,
      title: String(box.title ?? agentCfg?.name ?? 'Agent'),
      provider: typeof box.provider === 'string' ? box.provider : null,
      model: typeof box.model === 'string' ? box.model : null,
      systemPromptOrRole,
      toolsSummary,
      existingBoxOutput,
    })
  }
  return entries
}

function shouldRunSequential(session: OrchestratorSessionJson): boolean {
  const meta = session.metadata as Record<string, unknown> | undefined
  if (meta && meta.optimizationExecutionMode === 'sequential') return true
  if (Array.isArray((session as { optimizationAgentChainOrder?: unknown }).optimizationAgentChainOrder)) {
    const o = (session as { optimizationAgentChainOrder: unknown }).optimizationAgentChainOrder
    return Array.isArray(o) && o.length > 1
  }
  const boxes = session.agentBoxes as Array<{ chainIndex?: number }> | undefined
  return Boolean(boxes?.some((b) => typeof b.chainIndex === 'number'))
}

function orderAgentsSequential(entries: AgentEntry[], session: OrchestratorSessionJson): AgentEntry[] {
  const order = (session as { optimizationAgentChainOrder?: string[] }).optimizationAgentChainOrder
  if (Array.isArray(order) && order.length > 0) {
    const map = new Map(entries.map((e) => [e.boxId, e]))
    const out: AgentEntry[] = []
    for (const id of order) {
      const e = map.get(id)
      if (e) out.push(e)
    }
    for (const e of entries) {
      if (!out.includes(e)) out.push(e)
    }
    return out
  }
  const boxes = session.agentBoxes as Array<{ id?: string; identifier?: string; chainIndex?: number }> | undefined
  if (!boxes?.length) return entries
  const withIdx = entries.map((e) => {
    const b = boxes.find((x) => String(x.id ?? x.identifier) === e.boxId)
    return { e, idx: typeof b?.chainIndex === 'number' ? b.chainIndex : 999 }
  })
  withIdx.sort((a, b) => a.idx - b.idx)
  return withIdx.map((x) => x.e)
}

/** DOM snapshot is optional; `tabId` null/undefined skips capture (e.g. Electron dashboard activation). */
async function tryDomSnapshot(tabId: number | null | undefined): Promise<DomSnapshot | null> {
  if (tabId == null) return null
  try {
    if (typeof chrome === 'undefined' || typeof chrome.tabs?.sendMessage !== 'function') {
      return null
    }
    const { requestDomSnapshot } = await import('@ext/services/domSnapshotBridge')
    return requestDomSnapshot(tabId)
  } catch {
    return null
  }
}

/**
 * Full optimization pipeline. On failure after focus was entered, exits optimization focus.
 */
export async function executeOptimizationRun(
  project: Project,
  runId: string,
  trigger: TriggerSource,
): Promise<OptimizationRunResult> {
  const optSource = triggerToOptimizationSource(trigger)
  let focusEntered = false

  logStep(runId, 'guard', 'start')
  const guard = canRunOptimization(trigger, project.id)
  logStep(runId, 'guard', 'end', guard.ok ? 'ok' : 'fail')
  if (!guard.ok) {
    applyOptimizationGuardFallback(guard.fallback, guard.message)
    return { ok: false, runId, guardFail: guard }
  }

  /** Primary orchestrator key (first non-empty linked id). Required before activation so a successful run always reaches WRDESK_AUTO_OPTIM_ACTIVATE_SESSIONS. */
  const sessionKey = (project.linkedSessionIds ?? []).find((k) => typeof k === 'string' && k.trim())?.trim() ?? ''
  if (!sessionKey) {
    return { ok: false, runId, error: 'No session key' }
  }

  logStep(runId, 'session_activation', 'start')
  let currentActiveKey: string | null = null
  try {
    currentActiveKey = localStorage.getItem('optimando-active-session-key')
  } catch {
    /* noop */
  }
  const isAlreadyActive = sessionKey === currentActiveKey
  const linkedIds = project.linkedSessionIds ?? []

  const activation = isAlreadyActive
    ? (() => {
        console.log(`[AutoOpt] Session already active (${currentActiveKey}), skipping activation`)
        return { ok: true as const, tabId: null, gridId: null }
      })()
    : await (async () => {
        console.log(`[AutoOpt] Activating session ${linkedIds[0]}`)
        const m = await import('@ext/services/sessionActivationForOptimization')
        return m.activateSessionForOptimization({
          id: project.id,
          linkedSessionIds: project.linkedSessionIds ?? [],
        })
      })()
  logStep(runId, 'session_activation', 'end', activation.ok ? 'ok' : activation.code)

  if (!activation.ok) {
    try {
      window.dispatchEvent(
        new CustomEvent(WRDESK_OPTIMIZATION_GUARD_TOAST, {
          detail: { message: `Session activation failed: ${activation.code}`, variant: 'warning' },
        }),
      )
    } catch {
      /* noop */
    }
    return { ok: false, runId, sessionFail: activation }
  }

  const sessionIdsForEvent = (project.linkedSessionIds ?? []).filter(
    (id): id is string => typeof id === 'string' && id.trim().length > 0,
  )

  try {
    window.dispatchEvent(
      new CustomEvent(WRDESK_AUTO_OPTIM_ACTIVATE_SESSIONS, {
        detail: { sessionIds: sessionIdsForEvent, runId },
      }),
    )
  } catch {
    /* noop */
  }
  console.log('[AutoOpt] Dispatched ACTIVATE_SESSIONS (session key sync only; no main view change)')

  try {
    window.analysisDashboard?.presentOrchestratorDisplayGrid?.(sessionKey)
  } catch {
    /* noop */
  }

  const activeMilestone = project.milestones.find((m) => !m.completed)

  logStep(runId, 'enter_focus', 'start')
  try {
    const { useChatFocusStore } = await import('@ext/stores/chatFocusStore')
    /** Tab/grid ids are not part of focus meta; Electron may have tabId/gridId null on activation. */
    useChatFocusStore.getState().enterOptimizationFocus({
      projectId: project.id,
      projectTitle: project.title,
      projectIcon: project.icon,
      milestoneTitle: activeMilestone?.title,
      runId,
      projectDescription: project.description,
      projectGoals: project.goals,
    })
    focusEntered = true
  } catch (e) {
    logStep(runId, 'enter_focus', 'end', 'fail')
    return { ok: false, runId, error: String(e) }
  }
  logStep(runId, 'enter_focus', 'end', 'ok')

  try {
    logStep(runId, 'dom_snapshot', 'start')
    const dom = await tryDomSnapshot(activation.tabId)
    logStep(runId, 'dom_snapshot', 'end', dom ? 'captured' : 'skipped')

    logStep(runId, 'fetch_session', 'start')
    console.log(`[AutoOpt] Fetching orchestrator session: ${sessionKey}`)
    const fetchSession = await fetchOrchestratorSession(sessionKey)
    console.log(`[AutoOpt] Session fetched: ${fetchSession.ok ? 'ok' : 'null'}`)
    logStep(runId, 'fetch_session', 'end', fetchSession.ok ? 'ok' : 'fail')

    if (!fetchSession.ok) {
      throw new Error(fetchSession.message)
    }
    const sessionJson = fetchSession.data

    let agents = buildAgentEntries(sessionJson)
    if (agents.length === 0) {
      console.warn(`[OptimizationRun ${runId}] No agent boxes in session — skipping LLM calls`)
    }

    const sequential = shouldRunSequential(sessionJson)
    if (sequential) {
      agents = orderAgentsSequential(agents, sessionJson)
    }

    const linkedOrchestratorId =
      typeof sessionJson.id === 'string'
        ? sessionJson.id
        : typeof (sessionJson as { sessionId?: string }).sessionId === 'string'
          ? (sessionJson as { sessionId: string }).sessionId
          : null

    const sessionSection: SessionSection = {
      sessionKey,
      linkedOrchestratorSessionId: linkedOrchestratorId,
      agents,
    }

    logStep(runId, 'assemble_context', 'start')
    const sidebarTranscript = formatSidebarChatFromSession(sessionJson)
    let ctx: OptimizationContext = assembleOptimizationContext({
      project,
      dom,
      session: sessionSection,
      attachments: attachmentsFromProject(project),
      runId,
      source: optSource,
      userMessage: sidebarTranscript,
    })
    ctx = trimToTokenBudget(ctx, 24_000)
    logStep(runId, 'assemble_context', 'end', 'ok')

    const llmSend = createOptimizationLlmSend()

    logStep(runId, 'llm_execute', 'start', sequential ? 'sequential' : 'parallel')
    let results: AgentRunResult[] = []
    if (agents.length > 0) {
      if (sequential) {
        results = await runAgentsSequential(agents, ctx, llmSend)
      } else {
        results = await runAgentsParallel(agents, ctx, llmSend)
      }
    }
    logStep(runId, 'llm_execute', 'end', `${results.length} results`)

    const suggestionCount = results.filter((r) => !r.error && r.output.trim()).length

    logStep(runId, 'route_agentbox_output', 'start')
    for (const r of results) {
      const payload = r.error ? `Error: ${r.error}` : r.output
      if (!r.error && !payload.trim()) continue
      try {
        await updateAgentBoxOutput(r.agentBoxId, payload, undefined, sessionKey, 'dashboard')
      } catch (e) {
        console.warn(`[OptimizationRun ${runId}] updateAgentBoxOutput failed for ${r.agentBoxId}:`, e)
      }
    }
    logStep(runId, 'route_agentbox_output', 'end', `${results.length} agentboxes`)

    logStep(runId, 'render_results', 'start')
    try {
      window.dispatchEvent(
        new CustomEvent(WRDESK_OPTIMIZATION_RUN_RESULTS, {
          detail: {
            runId,
            projectId: project.id,
            projectTitle: project.title,
            completedAt: new Date().toISOString(),
            suggestionCount,
            /** Full text lives in orchestrator session agentboxes — not in chat. */
            resultsRoutedToAgentBoxes: true,
          },
        }),
      )
    } catch {
      /* noop */
    }
    logStep(runId, 'render_results', 'end', 'ok')

    logStep(runId, 'update_infobox', 'start')
    try {
      const { useChatFocusStore } = await import('@ext/stores/chatFocusStore')
      useChatFocusStore.getState().updateLastRunInfo({
        completedAt: new Date().toISOString(),
        suggestionCount,
      })
    } catch {
      /* noop */
    }
    logStep(runId, 'update_infobox', 'end', 'ok')

    return { ok: true, runId, results, suggestionCount }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn(`[OptimizationRun ${runId}] failed:`, msg)
    if (focusEntered) {
      try {
        const { useChatFocusStore } = await import('@ext/stores/chatFocusStore')
        useChatFocusStore.getState().exitOptimizationFocus()
      } catch {
        /* noop */
      }
    }
    try {
      window.dispatchEvent(
        new CustomEvent(WRDESK_OPTIMIZATION_GUARD_TOAST, {
          detail: { message: `Optimization failed: ${msg}`, variant: 'warning' },
        }),
      )
    } catch {
      /* noop */
    }
    return { ok: false, runId, error: msg }
  }
}
