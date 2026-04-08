/**
 * Background / service-worker helper: request a DOM snapshot from a grid tab's content script.
 */

import type { DomSnapshot } from '../types/optimizationTypes'
import { CAPTURE_DOM_SNAPSHOT_MESSAGE_TYPE } from './domSnapshotMessageTypes'

const CAPTURE_TIMEOUT_MS = 5000

export function requestDomSnapshot(tabId: number): Promise<DomSnapshot | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(null)
    }, CAPTURE_TIMEOUT_MS)

    try {
      chrome.tabs.sendMessage(
        tabId,
        { type: CAPTURE_DOM_SNAPSHOT_MESSAGE_TYPE },
        (response: { ok?: boolean; snapshot?: DomSnapshot; error?: string } | undefined) => {
          clearTimeout(timer)
          if (chrome.runtime.lastError) {
            resolve(null)
            return
          }
          if (response?.ok && response.snapshot) {
            resolve(response.snapshot)
            return
          }
          resolve(null)
        },
      )
    } catch {
      clearTimeout(timer)
      resolve(null)
    }
  })
}
