/**
 * Mode-action orchestrator: first-open (present + pending) and refresh-if-active (direct execute).
 * Uses mode.sessionId via fetchOrchestratorSession — never BEAP import/key minting.
 */

import type { CustomModeDefinition } from '../shared/ui/customModeTypes'
import {
  customModeDefinitionToRuntime,
  type CustomModeRuntimeConfig,
} from '../shared/ui/customModeRuntime'
import { normalizeOrchestratorSessionKey } from '../lib/resolveOrchestratorSessionKey'
import { customModesClient } from './customModesClient'
import { fetchOrchestratorSession } from './fetchOrchestratorSession'
import { maybePresentOrchestratorDisplayGridSession } from './presentOrchestratorDisplayGridSession'
import { findOpenSessionSurface, type SessionSurface } from './sessionSurfaceResolver'
import { readBeapRunFallbackLlmModel } from '../beap-messages/beapSessionRunBridge'

export const RUN_MODE_ALLOCATED_SESSION_TYPE = 'RUN_MODE_ALLOCATED_SESSION' as const

export type ModeSessionRunTrigger = 'speech_bubble' | 'interval' | 'manual_icon'

export type ModeSessionRunExecuteResult = {
  ok: boolean
  matchCount?: number
  executed?: string[]
  error?: string
  busy?: boolean
}

export type RunModeAllocatedSessionAutomationResult =
  | {
      ok: true
      sessionKey: string
      phase: 'presented' | 'refreshed'
      matchCount?: number
      executed?: string[]
    }
  | {
      ok: false
      error: string
      phase?: 'resolve' | 'fetch' | 'mirror' | 'present' | 'mode_run'
      skipped?: boolean
      busy?: boolean
    }

export type RunModeAllocatedSessionOptions = {
  modeId: string
  trigger: ModeSessionRunTrigger
  fallbackModel?: string
  /** When true (default), re-run agents in place if the session grid tab is already open. */
  refreshIfActive?: boolean
}

export type ResolvedModeSessionRun = {
  sessionKey: string
  modeRuntime: CustomModeRuntimeConfig
  fallbackModel: string
}

/** Resolve mode definition → allocated session key + runtime. */
export async function resolveModeAllocatedSessionRun(
  modeId: string,
  fallbackModel?: string,
): Promise<ResolvedModeSessionRun | { skip: true; reason: string } | { error: string }> {
  const id = modeId?.trim()
  if (!id) return { error: 'Missing mode id' }

  const listed = await customModesClient.list()
  if (!listed.ok) return { error: listed.error || 'Could not load custom modes' }
  const def = listed.data.find((m) => m.id === id)
  if (!def) return { error: `Mode not found: ${id}` }

  const sessionKey = normalizeOrchestratorSessionKey(def.sessionId)
  if (!sessionKey) {
    return { skip: true, reason: 'Mode has no allocated session' }
  }

  return {
    sessionKey,
    modeRuntime: customModeDefinitionToRuntime(def),
    fallbackModel: (fallbackModel ?? readBeapRunFallbackLlmModel()).trim() || 'tinyllama',
  }
}

async function mirrorSessionBlob(sessionKey: string, blob: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.set({ [sessionKey]: blob })
}

async function focusGridTabIfPresent(tabId: number | undefined): Promise<void> {
  if (typeof tabId !== 'number') return
  try {
    await chrome.tabs.update(tabId, { active: true })
  } catch {
    /* best-effort */
  }
}

export type RunModeAllocatedSessionAutomationDeps = {
  registerPendingModeSessionRun: (
    sessionKey: string,
    payload: { fallbackModel: string; modeRuntime: CustomModeRuntimeConfig; modeId: string },
  ) => void
  executeModeSessionRunDirect: (args: {
    sessionKey: string
    fallbackModel: string
    modeRuntime: CustomModeRuntimeConfig
  }) => Promise<ModeSessionRunExecuteResult>
  /** True when agent execution is already running for this session key. */
  isSessionRunInFlight?: (sessionKey: string) => boolean
  /** Dashboard shim: detect open grids without real chrome.tabs. Defaults to extension resolver. */
  findOpenSessionSurface?: (sessionKey: string) => Promise<SessionSurface | null>
  /** Dashboard shim: Electron → extension WS present path. Defaults to extension tabs.create. */
  presentOrchestratorDisplayGridSession?: (
    sessionKey: string,
    session: Record<string, unknown>,
  ) => Promise<void>
}

export async function runModeAllocatedSessionAutomation(
  options: RunModeAllocatedSessionOptions,
  deps: RunModeAllocatedSessionAutomationDeps,
): Promise<RunModeAllocatedSessionAutomationResult> {
  const refreshIfActive = options.refreshIfActive !== false

  const resolved = await resolveModeAllocatedSessionRun(options.modeId, options.fallbackModel)
  if ('error' in resolved) {
    return { ok: false, error: resolved.error, phase: 'resolve' }
  }
  if ('skip' in resolved) {
    return { ok: false, error: resolved.reason, phase: 'resolve', skipped: true }
  }

  const { sessionKey, modeRuntime, fallbackModel } = resolved

  if (deps.isSessionRunInFlight?.(sessionKey)) {
    return {
      ok: false,
      error: 'Session run already in progress',
      phase: 'mode_run',
      busy: true,
      skipped: true,
    }
  }

  const fetched = await fetchOrchestratorSession(sessionKey)
  if (!fetched.ok) {
    return { ok: false, error: fetched.message, phase: 'fetch' }
  }

  try {
    await mirrorSessionBlob(sessionKey, fetched.data)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { ok: false, error: `Failed to mirror session: ${msg}`, phase: 'mirror' }
  }

  const surface = await (deps.findOpenSessionSurface ?? findOpenSessionSurface)(sessionKey)

  if (refreshIfActive && surface?.kind === 'grid_tab') {
    console.log('[ModeSessionRun] Grid already open — refresh in place', sessionKey, options.trigger)
    await focusGridTabIfPresent(surface.tabId)
    const run = await deps.executeModeSessionRunDirect({ sessionKey, fallbackModel, modeRuntime })
    if (run.busy) {
      return {
        ok: false,
        error: run.error ?? 'Session run already in progress',
        phase: 'mode_run',
        busy: true,
        skipped: true,
      }
    }
    if (!run.ok) {
      return { ok: false, error: run.error ?? 'Mode run failed', phase: 'mode_run' }
    }
    return {
      ok: true,
      sessionKey,
      phase: 'refreshed',
      matchCount: run.matchCount,
      executed: run.executed,
    }
  }

  deps.registerPendingModeSessionRun(sessionKey, { fallbackModel, modeRuntime, modeId: options.modeId })
  await (deps.presentOrchestratorDisplayGridSession ?? maybePresentOrchestratorDisplayGridSession)(
    sessionKey,
    fetched.data,
  )

  console.log('[ModeSessionRun] Display grids requested (first-open)', sessionKey, options.trigger)
  return { ok: true, sessionKey, phase: 'presented' }
}

/** UI bridge → background service worker. */
export function requestRunModeAllocatedSession(
  modeId: string,
  trigger: ModeSessionRunTrigger,
  options?: { fallbackModel?: string; refreshIfActive?: boolean },
): Promise<RunModeAllocatedSessionAutomationResult> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        {
          type: RUN_MODE_ALLOCATED_SESSION_TYPE,
          modeId,
          trigger,
          fallbackModel: options?.fallbackModel,
          refreshIfActive: options?.refreshIfActive,
        },
        (response: RunModeAllocatedSessionAutomationResult | undefined) => {
          if (chrome.runtime.lastError) {
            resolve({
              ok: false,
              error: chrome.runtime.lastError.message || 'Extension background unavailable',
              phase: 'resolve',
            })
            return
          }
          resolve(
            response ?? {
              ok: false,
              error: 'No response from background',
              phase: 'resolve',
            },
          )
        },
      )
    } catch (e) {
      resolve({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        phase: 'resolve',
      })
    }
  })
}

export function modeHasAllocatedSession(def: CustomModeDefinition | null | undefined): boolean {
  if (!def) return false
  return !!normalizeOrchestratorSessionKey(def.sessionId)
}
