/**
 * Background / service-worker helper: inject DOM snapshot capture into the grid tab via scripting API.
 */

import type { DomSnapshot } from '../types/optimizationTypes'
import { domSnapshotCaptureInjected } from './domSnapshotCapture'

const CAPTURE_TIMEOUT_MS = 5000

export async function requestDomSnapshot(tabId: number | null | undefined): Promise<DomSnapshot | null> {
  if (tabId == null) return null
  try {
    const exec = chrome.scripting.executeScript({
      target: { tabId },
      func: domSnapshotCaptureInjected,
      args: ['#grid-root'],
    })
    const result = await Promise.race([
      exec,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CAPTURE_TIMEOUT_MS)),
    ])
    if (!result || !Array.isArray(result)) return null
    const first = result[0]
    if (!first || first.result == null) return null
    return first.result as DomSnapshot
  } catch (e) {
    console.warn('[DOM Capture] Failed for tab', tabId, e)
    return null
  }
}
