/**
 * Programmatic session + display grid activation for auto-optimization (extension context).
 */

import type { AgentBox, DisplayGrid } from './processFlow'
import { firstGridWithEarliestAgentSetup } from './displayGridAgentSelection'
import { findOpenSessionSurface } from './sessionSurfaceResolver'
import { maybePresentOrchestratorDisplayGridSession } from './presentOrchestratorDisplayGridSession'

export type OptimizationProject = {
  id: string
  linkedSessionIds: string[]
}

export type ActivationResult =
  | { ok: true; tabId: number | null; gridId: string | null }
  | { ok: false; code: string; retryable: boolean }

const T1_MS = 10_000
const T2_MS = 8_000

async function loadSessionBlob(sessionKey: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await chrome.storage.local.get(sessionKey)
    const v = raw[sessionKey]
    if (v && typeof v === 'object') return v as Record<string, unknown>
  } catch (e) {
    console.warn('[sessionActivationForOptimization] storage get failed:', e)
  }
  return null
}

function waitForTabComplete(tabId: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout>

    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        chrome.tabs.onUpdated.removeListener(onUpd)
      } catch {
        /* noop */
      }
      resolve(ok)
    }

    const onUpd = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === 'complete') finish(true)
    }
    chrome.tabs.onUpdated.addListener(onUpd)

    timer = setTimeout(() => finish(false), timeoutMs)

    void chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === 'complete') finish(true)
      })
      .catch(() => {})
  })
}

async function waitForGridTabSessionKey(sessionKey: string, timeoutMs: number): Promise<number | null> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const surface = await findOpenSessionSurface(sessionKey)
    if (surface?.kind === 'grid_tab') return surface.tabId
    await new Promise((r) => setTimeout(r, 200))
  }
  return null
}

async function runActivation(project: OptimizationProject): Promise<ActivationResult> {
  const ids = project.linkedSessionIds ?? []
  const sessionKey = ids.find((x) => typeof x === 'string' && x.trim().length > 0)?.trim()
  if (!sessionKey) {
    return { ok: false, code: 'NO_SESSION', retryable: false }
  }

  let surface = await findOpenSessionSurface(sessionKey)
  const sessionBlob = await loadSessionBlob(sessionKey)
  if (!sessionBlob) {
    return { ok: false, code: 'SESSION_NOT_READY', retryable: true }
  }

  const agentBoxes = (Array.isArray(sessionBlob.agentBoxes) ? sessionBlob.agentBoxes : []) as AgentBox[]
  const displayGrids = (Array.isArray(sessionBlob.displayGrids) ? sessionBlob.displayGrids : []) as DisplayGrid[]
  const grid = firstGridWithEarliestAgentSetup(displayGrids, agentBoxes)
  if (!grid) {
    return { ok: false, code: 'NO_GRID', retryable: false }
  }

  if (surface === null) {
    await maybePresentOrchestratorDisplayGridSession(sessionKey, sessionBlob)
    const tabIdAfterPresent = await waitForGridTabSessionKey(sessionKey, T1_MS)
    if (tabIdAfterPresent === null) {
      return { ok: false, code: 'SESSION_NOT_READY', retryable: true }
    }
    surface = await findOpenSessionSurface(sessionKey)
  }

  let activeTabId: number | null = surface?.kind === 'grid_tab' ? surface.tabId : null
  if (activeTabId === null) {
    activeTabId = await waitForGridTabSessionKey(sessionKey, T2_MS)
  }
  if (activeTabId === null && surface?.kind === 'sidepanel_only') {
    await maybePresentOrchestratorDisplayGridSession(sessionKey, sessionBlob)
    activeTabId = await waitForGridTabSessionKey(sessionKey, T2_MS)
  }
  if (activeTabId === null) {
    return { ok: false, code: 'SESSION_NOT_READY', retryable: true }
  }

  const shellOk = await waitForTabComplete(activeTabId, T2_MS)
  if (!shellOk) {
    return { ok: false, code: 'SESSION_NOT_READY', retryable: true }
  }

  try {
    await chrome.storage.local.set({
      orchestrator_wrchat_present_request: {
        sessionKey,
        at: Date.now(),
        source: 'optimization',
      },
    })
  } catch (e) {
    console.warn('[sessionActivationForOptimization] storage set failed:', e)
    return { ok: false, code: 'SESSION_NOT_READY', retryable: true }
  }

  const gridId =
    (typeof grid.sessionId === 'string' && grid.sessionId.trim()) ||
    (typeof grid.layout === 'string' && grid.layout.trim()) ||
    'default'

  return { ok: true, tabId: activeTabId, gridId }
}

function mapMessageResponseToActivation(
  response: unknown,
): ActivationResult | null {
  const r = response as { success?: boolean; result?: unknown; error?: string }
  if (r?.success !== true || r.result == null) return null
  const res = r.result as Record<string, unknown>
  if (res.ok === true) {
    const tabId =
      res.tabId === null || typeof res.tabId === 'number' ? (res.tabId as number | null) : null
    const gridId =
      res.gridId === null || typeof res.gridId === 'string' ? (res.gridId as string | null) : null
    return { ok: true, tabId, gridId }
  }
  if (res.ok === false && typeof res.code === 'string') {
    return {
      ok: false,
      code: res.code,
      retryable: res.retryable === true,
    }
  }
  return null
}

function activateViaRuntimeMessage(project: OptimizationProject): Promise<ActivationResult> {
  return new Promise((resolve) => {
    try {
      console.log('[AutoOpt] activateViaRuntimeMessage: sending to shim')
      chrome.runtime.sendMessage(
        { type: 'ACTIVATE_SESSION_FOR_OPTIMIZATION', project },
        (response: unknown) => {
          console.log('[AutoOpt] activateViaRuntimeMessage: response', response)
          if (chrome.runtime.lastError) {
            resolve({ ok: false, code: 'SESSION_NOT_READY', retryable: true })
            return
          }
          const mapped = mapMessageResponseToActivation(response)
          if (mapped) {
            resolve(mapped)
            return
          }
          const r = response as { success?: boolean; error?: string }
          if (r?.success === false) {
            resolve({ ok: false, code: 'ACTIVATE_FAILED', retryable: false })
            return
          }
          resolve({ ok: false, code: 'ACTIVATE_FAILED', retryable: false })
        },
      )
    } catch {
      resolve({ ok: false, code: 'ACTIVATE_FAILED', retryable: false })
    }
  })
}

/**
 * Activates the linked orchestrator session surface (grid tab + WR Chat present request).
 * In the extension service worker, runs inline. In other extension pages or Electron, delegates via runtime message.
 */
export async function activateSessionForOptimization(project: OptimizationProject): Promise<ActivationResult> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return { ok: false, code: 'NO_BROWSER_CONTEXT', retryable: false }
  }
  if (!chrome.runtime.id) {
    return activateViaRuntimeMessage(project)
  }
  return runActivation(project)
}
