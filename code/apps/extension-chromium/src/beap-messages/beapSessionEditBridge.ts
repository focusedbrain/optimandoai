/**
 * Sidepanel / BEAP UI → active tab content script: import session for editing.
 *
 * Does not mutate BEAP messages; only sends serializable `importData` to the page.
 * Must send {@link BEAP_EDIT_SESSION_IMPORT_TYPE} only — never the Run Automation message.
 */

import { narrowBeapImportPayloadForBridge } from './beapSessionBridgeGuards'

/** Discriminant for tests and cross-call audits (Edit ≠ Run). */
export const BEAP_EDIT_SESSION_IMPORT_TYPE = 'BEAP_EDIT_SESSION_IMPORT' as const

export type BeapSessionEditImportResponse =
  | { success: true; sessionKey: string; warnings?: string[] }
  | { success: false; error: string }

/**
 * Ask the active tab's content script to persist + activate a session working copy
 * for editing (minimal activation, unlocked, agents lightbox). No agent execution.
 */
export function requestBeapSessionEditInActiveTab(importData: unknown): Promise<BeapSessionEditImportResponse> {
  const narrowed = narrowBeapImportPayloadForBridge(importData)
  if (!narrowed.ok) {
    return Promise.resolve({ success: false, error: narrowed.reason })
  }
  const payload = narrowed.payload
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id
      if (tabId === undefined) {
        resolve({ success: false, error: 'No active tab' })
        return
      }
      chrome.tabs.sendMessage(
        tabId,
        { type: BEAP_EDIT_SESSION_IMPORT_TYPE, data: { importData: payload } },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({
              success: false,
              error:
                chrome.runtime.lastError.message ||
                'Could not reach this page — open a normal web tab with the extension enabled.',
            })
            return
          }
          if (response?.success) {
            resolve({
              success: true,
              sessionKey: response.sessionKey as string,
              warnings: response.warnings as string[] | undefined,
            })
          } else {
            resolve({
              success: false,
              error: (response?.error as string) || 'Import failed',
            })
          }
        },
      )
    })
  })
}
