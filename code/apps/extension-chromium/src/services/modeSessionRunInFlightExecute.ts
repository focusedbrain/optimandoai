/**
 * Bounded mode-session execute — guarantees `modeSessionExecuteInFlight` releases on hang/timeout.
 * Shared by dashboard bridge and MV3 background (separate in-flight Sets, same pattern).
 */

import type { CustomModeRuntimeConfig } from '../shared/ui/customModeRuntime'
import type { WrChatSurface } from '../ui/components/wrChatSurface'
import type {
  BeapAutomationModeRunErr,
  BeapAutomationModeRunOk,
} from './beapRunAutomationResult'

/** Above longest per-LLM ceiling in modeRunExecution (600s HTTP). */
export const MODE_RUN_HARD_TIMEOUT_MS = 660_000

export const MODE_RUN_TIMED_OUT_ERROR = 'Mode run timed out'

/** Must match `WRDESK_OPTIMIZATION_GUARD_TOAST` in Electron `wrdeskUiEvents.ts`. */
const MODE_RUN_TOAST_EVENT = 'wrdesk:optimization-guard-toast'

export type ModeSessionRunInFlightResult = {
  ok: boolean
  matchCount?: number
  executed?: string[]
  error?: string
  busy?: boolean
  timedOut?: boolean
  interpreted?: BeapAutomationModeRunOk | BeapAutomationModeRunErr
}

function notifyModeSessionRunTimedOut(sessionKey: string, logPrefix: string): void {
  const msg = `Mode session run timed out (${sessionKey}). The run latch was released — try again.`
  console.warn(`[${logPrefix}]`, msg)
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent(MODE_RUN_TOAST_EVENT, { detail: { message: msg, variant: 'warning' } }),
      )
    }
  } catch {
    /* service worker / headless */
  }
}

async function raceExecuteModeRunAgentsWithHardTimeout(
  run: (signal: AbortSignal) => Promise<import('./modeRunExecution').ExecuteModeRunAgentsResult>,
  timeoutMs: number,
): Promise<
  | { timedOut: false; runResult: import('./modeRunExecution').ExecuteModeRunAgentsResult }
  | { timedOut: true }
> {
  const controller = new AbortController()
  let didTimeout = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      didTimeout = true
      controller.abort()
      reject(new Error(MODE_RUN_TIMED_OUT_ERROR))
    }, timeoutMs)
  })

  try {
    const runResult = await Promise.race([run(controller.signal), timeoutPromise])
    return { timedOut: false, runResult }
  } catch (e) {
    if (didTimeout) {
      return { timedOut: true }
    }
    throw e
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export async function executeModeSessionRunWithInFlightGuard(args: {
  inFlight: Set<string>
  sessionKey: string
  fallbackModel: string
  modeRuntime?: CustomModeRuntimeConfig | null
  runMode?: boolean
  sourceSurface?: WrChatSurface
  logPrefix: string
  hardTimeoutMs?: number
}): Promise<ModeSessionRunInFlightResult> {
  const sk = args.sessionKey.trim()
  if (args.inFlight.has(sk)) {
    return { ok: false, error: 'Session run already in progress', busy: true }
  }

  args.inFlight.add(sk)
  try {
    const {
      executeModeRunAgents,
      resolveModeRunWrchatModelId,
      fetchWrChatAvailableModelsForModeRun,
    } = await import('./modeRunExecution')
    const { interpretBeapAutomationModeRun } = await import('./beapRunAutomationResult')

    const fallbackModel = args.fallbackModel.trim()
    const modeRuntime = args.modeRuntime ?? null
    const wrchatModelId = resolveModeRunWrchatModelId(modeRuntime, fallbackModel)
    const availableModels = await fetchWrChatAvailableModelsForModeRun()

    const raced = await raceExecuteModeRunAgentsWithHardTimeout(
      (signal) =>
        executeModeRunAgents({
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
          modeRuntime,
          runMode: args.runMode ?? !!modeRuntime,
          sourceSurface: args.sourceSurface,
          signal,
        }),
      args.hardTimeoutMs ?? MODE_RUN_HARD_TIMEOUT_MS,
    )

    if (raced.timedOut) {
      notifyModeSessionRunTimedOut(sk, args.logPrefix)
      return { ok: false, error: MODE_RUN_TIMED_OUT_ERROR, timedOut: true }
    }

    const interpreted = interpretBeapAutomationModeRun(sk, raced.runResult)
    if (!interpreted.ok) {
      return { ok: false, error: interpreted.error, matchCount: interpreted.matchCount, interpreted }
    }
    return {
      ok: true,
      matchCount: interpreted.matchCount,
      executed: interpreted.executed,
      interpreted,
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    args.inFlight.delete(sk)
  }
}
