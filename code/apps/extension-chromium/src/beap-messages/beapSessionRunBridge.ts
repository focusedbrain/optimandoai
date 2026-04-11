/**
 * BEAP inbox → active tab: full session import/activate + mode-trigger execution (`executeModeRunAgents`).
 * Does not use `routeInput` / WR Chat tag routing.
 * Must send {@link BEAP_RUN_AUTOMATION_TYPE} only — never the Edit-session message.
 */

import { narrowBeapImportPayloadForBridge, narrowBeapFallbackModel } from './beapSessionBridgeGuards'

/** Discriminant for tests and cross-call audits (Run ≠ Edit). */
export const BEAP_RUN_AUTOMATION_TYPE = 'BEAP_RUN_AUTOMATION' as const

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

export function requestBeapRunAutomationInActiveTab(
  importData: unknown,
  options?: { fallbackModel?: string },
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
        { type: BEAP_RUN_AUTOMATION_TYPE, data: { importData: payload, fallbackModel } },
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
