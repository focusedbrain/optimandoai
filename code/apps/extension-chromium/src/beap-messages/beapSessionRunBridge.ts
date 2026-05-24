/**
 * BEAP inbox → orchestrator activation pipeline.
 *
 * Extension-inbox "Run Automation" sends {@link BEAP_INBOX_PRESENT_GRID_TYPE} to background,
 * which mirrors the session to chrome.storage.local and calls
 * maybePresentOrchestratorDisplayGridSession — the same path used by the dashboard and
 * session-history row.  No chrome.tabs.query({ active: true }) is involved.
 *
 * {@link BEAP_RUN_AUTOMATION_TYPE} is kept for the content-script handler only;
 * it must never be dispatched from a Run Automation UI click.
 */

import { narrowBeapImportPayloadForBridge, narrowBeapFallbackModel } from './beapSessionBridgeGuards'

/** Discriminant used by content-script.tsx handler (kept for backward compat — not used by Run Automation UI). */
export const BEAP_RUN_AUTOMATION_TYPE = 'BEAP_RUN_AUTOMATION' as const

// ---------------------------------------------------------------------------
// Orchestrator activation pipeline — extension inbox
// ---------------------------------------------------------------------------

/** Sent by BeapMessageDetailPanel "Run Automation" click → background. */
export const BEAP_INBOX_PRESENT_GRID_TYPE = 'BEAP_INBOX_PRESENT_GRID' as const

export type BeapInboxPresentGridResult =
  | { success: true; sessionKey: string }
  | { success: false; error: string }

/**
 * Ask the background service worker to unwrap the artefact, persist the session
 * blob to chrome.storage.local, and call maybePresentOrchestratorDisplayGridSession.
 * Returns as soon as the background acknowledges the request.
 *
 * Pass the full {@link SessionImportArtefact} object when available
 * (message.session_import_artefact). For legacy messages without a canonical
 * artefact, pass rawPayload (sessions[0] shape) — background handles both.
 */
export function requestBeapInboxPresentGrid(
  importArtefact: unknown,
  options?: { sessionKey?: string; fallbackModel?: string },
): Promise<BeapInboxPresentGridResult> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(
        {
          type: BEAP_INBOX_PRESENT_GRID_TYPE,
          importArtefact,
          sessionKey:
            typeof options?.sessionKey === 'string' && options.sessionKey.trim()
              ? options.sessionKey
              : undefined,
          fallbackModel:
            typeof options?.fallbackModel === 'string' && options.fallbackModel.trim()
              ? options.fallbackModel.trim()
              : undefined,
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error:
                chrome.runtime.lastError.message ||
                'Extension background is unavailable — reload the extension and retry.',
            })
            return
          }
          if (response?.success) {
            resolve({ success: true, sessionKey: response.sessionKey as string })
          } else {
            resolve({
              success: false,
              error: (response?.error as string) || 'Run Automation (grid present) failed',
            })
          }
        },
      )
    } catch (e) {
      resolve({ success: false, error: e instanceof Error ? e.message : String(e) })
    }
  })
}

export type BeapRunAutomationFailure = {
  success: false
  error: string
  phase?: 'init' | 'import' | 'mode_run'
  sessionKey?: string
}

export type BeapRunAutomationSuccess = {
  success: true
  sessionKey: string
  matchCount: number
  executed: string[]
  failures?: Array<{ agentName: string; error?: string }>
}

export type BeapRunAutomationResponse = BeapRunAutomationSuccess | BeapRunAutomationFailure

/**
 * Default LLM when sidepanel has not yet persisted a selection (matches sidepanel fallback).
 */
export function readBeapRunFallbackLlmModel(): string {
  try {
    const m = localStorage.getItem('optimando-wr-chat-active-model')
    if (m && String(m).trim()) return String(m).trim()
  } catch {
    /* ignore */
  }
  return 'tinyllama'
}

/**
 * @deprecated Never call from a Run Automation UI click.
 * Kept only as an internal fallback for content-script unit tests and the legacy
 * BEAP_DESKTOP_RUN_AUTOMATION backward-compat path in background.ts.
 * Route all UI-originated Run Automation calls through {@link requestBeapInboxPresentGrid}.
 */
export function requestBeapRunAutomationInActiveTab(
  importData: unknown,
  options?: { fallbackModel?: string; sessionKey?: string },
): Promise<BeapRunAutomationResponse> {
  const narrowed = narrowBeapImportPayloadForBridge(importData)
  if (!narrowed.ok) {
    return Promise.resolve({ success: false, error: narrowed.reason, phase: 'init' })
  }
  const payload = narrowed.payload
  const fallbackModel = narrowBeapFallbackModel(
    options?.fallbackModel,
    readBeapRunFallbackLlmModel(),
  )
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (tabId === undefined) {
        resolve({ success: false, error: 'No active tab', phase: 'init' })
        return
      }
      chrome.tabs.sendMessage(
        tabId,
        {
          type: BEAP_RUN_AUTOMATION_TYPE,
          data: {
            importData: payload,
            fallbackModel,
            sessionKey: typeof options?.sessionKey === 'string' ? options.sessionKey : undefined,
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error:
                chrome.runtime.lastError.message ||
                'Could not reach this page — open a normal web tab with the extension enabled.',
              phase: 'init',
            })
            return
          }
          if (response?.success) {
            resolve({
              success: true,
              sessionKey: response.sessionKey as string,
              matchCount: response.matchCount as number,
              executed: response.executed as string[],
              failures: response.failures as BeapRunAutomationSuccess['failures'],
            })
          } else {
            resolve({
              success: false,
              error: (response?.error as string) || 'Run Automation failed',
              phase: (response?.phase as BeapRunAutomationFailure['phase']) || 'import',
              sessionKey: response?.sessionKey as string | undefined,
            })
          }
        },
      )
    })
  })
}
