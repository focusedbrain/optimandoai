/**
 * Electron dashboard mode-run bridge — same `runModeAllocatedSessionAutomation` core as MV3 background,
 * with dashboard-specific grid present (WS → extension) and in-renderer agent execution on refresh.
 */

import type { CustomModeRuntimeConfig } from '@ext/shared/ui/customModeRuntime'
import type { SessionSurface } from '@ext/services/sessionSurfaceResolver'
import {
  RUN_MODE_ALLOCATED_SESSION_TYPE,
  type ModeSessionRunExecuteResult,
  type RunModeAllocatedSessionAutomationResult,
} from '@ext/services/runModeAllocatedSessionAutomation'

const DASHBOARD_GRID_OPEN_PREFIX = 'dashboard-grid-open:'

const modeSessionExecuteInFlight = new Set<string>()

/** Stashed between registerPending + present; forwarded to extension via PRESENT_ORCHESTRATOR_DISPLAY_GRID. */
const pendingModeRunsForExtension = new Map<
  string,
  { fallbackModel: string; modeRuntime: CustomModeRuntimeConfig; modeId: string }
>()

function isSessionRunInFlight(sessionKey: string): boolean {
  return modeSessionExecuteInFlight.has(sessionKey.trim())
}

async function executeModeSessionRunDirectForDashboard(args: {
  sessionKey: string
  fallbackModel: string
  modeRuntime: CustomModeRuntimeConfig
}): Promise<ModeSessionRunExecuteResult> {
  const sk = args.sessionKey.trim()
  if (modeSessionExecuteInFlight.has(sk)) {
    return { ok: false, error: 'Session run already in progress', busy: true }
  }
  modeSessionExecuteInFlight.add(sk)
  try {
    const {
      executeModeRunAgents,
      resolveModeRunWrchatModelId,
      fetchWrChatAvailableModelsForModeRun,
    } = await import('@ext/services/modeRunExecution')
    const { interpretBeapAutomationModeRun } = await import('@ext/services/beapRunAutomationResult')

    const fallbackModel = args.fallbackModel.trim()
    const wrchatModelId = resolveModeRunWrchatModelId(args.modeRuntime, fallbackModel)
    const availableModels = await fetchWrChatAvailableModelsForModeRun()

    const runResult = await executeModeRunAgents({
      modeLinkedSessionId: sk,
      currentOrchestratorSessionId: sk,
      sessionKey: sk,
      inferenceSessionKey: sk,
      fallbackModel,
      wrchatModelId,
      defaultModelId: wrchatModelId,
      availableModels,
      inputText: '',
      processedMessages: [{ role: 'user', content: '' }],
      modeRuntime: args.modeRuntime,
      runMode: true,
      sourceSurface: 'dashboard',
    })

    const interpreted = interpretBeapAutomationModeRun(sk, runResult)
    if (!interpreted.ok) {
      return { ok: false, error: interpreted.error, matchCount: interpreted.matchCount }
    }
    return {
      ok: true,
      matchCount: interpreted.matchCount,
      executed: interpreted.executed,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    modeSessionExecuteInFlight.delete(sk)
  }
}

async function findOpenSessionSurfaceForDashboard(sessionKey: string): Promise<SessionSurface | null> {
  const sk = sessionKey.trim()
  if (!sk) return null
  try {
    if (localStorage.getItem(DASHBOARD_GRID_OPEN_PREFIX + sk)) {
      return { kind: 'grid_tab', tabId: 0, gridSessionParam: sk }
    }
  } catch {
    /* noop */
  }
  return null
}

async function presentOrchestratorDisplayGridForModeRun(
  sessionKey: string,
  session: Record<string, unknown>,
): Promise<void> {
  const sk = sessionKey.trim()
  const pending = pendingModeRunsForExtension.get(sk)
  pendingModeRunsForExtension.delete(sk)

  try {
    localStorage.setItem(DASHBOARD_GRID_OPEN_PREFIX + sk, String(Date.now()))
  } catch {
    /* noop */
  }

  const dash = window.analysisDashboard
  if (typeof dash?.presentOrchestratorDisplayGrid !== 'function') {
    console.warn('[DashboardModeRun] analysisDashboard.presentOrchestratorDisplayGrid unavailable')
    return
  }

  dash.presentOrchestratorDisplayGrid(sk, session, 'mode-action', pending ? { pendingModeSessionRun: pending } : undefined)
}

function registerPendingModeSessionRunForDashboard(
  sessionKey: string,
  payload: { fallbackModel: string; modeRuntime: CustomModeRuntimeConfig; modeId: string },
): void {
  pendingModeRunsForExtension.set(sessionKey.trim(), payload)
}

export const dashboardModeRunDeps = {
  registerPendingModeSessionRun: registerPendingModeSessionRunForDashboard,
  executeModeSessionRunDirect: executeModeSessionRunDirectForDashboard,
  isSessionRunInFlight,
  findOpenSessionSurface: findOpenSessionSurfaceForDashboard,
  presentOrchestratorDisplayGridSession: presentOrchestratorDisplayGridForModeRun,
}

export async function handleDashboardRunModeAllocatedSession(
  msg: Record<string, unknown>,
): Promise<RunModeAllocatedSessionAutomationResult> {
  const modeId = typeof msg.modeId === 'string' ? msg.modeId.trim() : ''
  const triggerRaw = msg.trigger
  const trigger =
    triggerRaw === 'speech_bubble' || triggerRaw === 'interval' || triggerRaw === 'manual_icon'
      ? triggerRaw
      : 'manual_icon'
  const fallbackModel =
    typeof msg.fallbackModel === 'string' ? msg.fallbackModel.trim() : undefined
  const refreshIfActive = msg.refreshIfActive !== false

  const { runModeAllocatedSessionAutomation } = await import(
    '@ext/services/runModeAllocatedSessionAutomation'
  )

  return runModeAllocatedSessionAutomation(
    { modeId, trigger, fallbackModel, refreshIfActive },
    dashboardModeRunDeps,
  )
}

export { RUN_MODE_ALLOCATED_SESSION_TYPE }
