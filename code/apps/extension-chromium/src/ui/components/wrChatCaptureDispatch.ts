/**
 * LmGTFY / screen capture entry: Electron dashboard uses preload bridge;
 * extension contexts use chrome.runtime → background WebSocket.
 */

import { SOURCE_TO_SURFACE } from './wrChatSurface'

/** Canonical default `source` when omitted — matches `SOURCE_TO_SURFACE` entry for `sidepanel`. */
const DEFAULT_WR_CHAT_CAPTURE_SOURCE =
  Object.keys(SOURCE_TO_SURFACE).find((k) => SOURCE_TO_SURFACE[k] === 'sidepanel') ?? 'sidepanel-docked-chat'

type LmgtfyBridge = {
  selectScreenshot?: (opts?: { createTrigger?: boolean; addCommand?: boolean }) => Promise<unknown>
}

function getLmgtfyBridge(): LmgtfyBridge | undefined {
  if (typeof globalThis === 'undefined') return undefined
  const w = globalThis as typeof globalThis & { LETmeGIRAFFETHATFORYOU?: LmgtfyBridge }
  return w.LETmeGIRAFFETHATFORYOU
}

export function startWrChatScreenCapture(options?: {
  source?: string
  createTrigger?: boolean
  addCommand?: boolean
}): void {
  console.log('[Capture] startWrChatScreenCapture called', options)
  const bridge = getLmgtfyBridge()
  if (typeof bridge?.selectScreenshot === 'function') {
    console.log('[Capture] Using Electron preload bridge')
    const bridgeOpts =
      options?.createTrigger !== undefined || options?.addCommand !== undefined
        ? {
            ...(options?.createTrigger !== undefined && { createTrigger: options.createTrigger }),
            ...(options?.addCommand !== undefined && { addCommand: options.addCommand }),
          }
        : undefined
    void bridge.selectScreenshot(bridgeOpts).catch((err: unknown) => {
      console.warn('[WrChatCapture] LETmeGIRAFFETHATFORYOU.selectScreenshot failed', err)
    })
    return
  }

  console.log('[Capture] Preload bridge unavailable — using chrome.runtime fallback')
  /** Default matches docked WR Chat; popup/dashboard pass explicit `source` via WrChatCaptureButton. */
  const source = options?.source ?? DEFAULT_WR_CHAT_CAPTURE_SOURCE
  try {
    chrome.runtime?.sendMessage(
      {
        type: 'ELECTRON_START_SELECTION',
        source,
        ...(options?.createTrigger !== undefined && { createTrigger: options.createTrigger }),
        ...(options?.addCommand !== undefined && { addCommand: options.addCommand }),
      },
      (response) => {
        console.log('[Capture] ELECTRON_START_SELECTION response:', response, 'lastError:', chrome.runtime.lastError)
      },
    )
  } catch (e) {
    console.warn('[WrChatCapture] ELECTRON_START_SELECTION sendMessage failed', e)
  }
}
