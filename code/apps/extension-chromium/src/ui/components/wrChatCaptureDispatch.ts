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

  /** Default matches docked WR Chat; popup/dashboard pass explicit `source` via WrChatCaptureButton. */
  const source = options?.source ?? DEFAULT_WR_CHAT_CAPTURE_SOURCE

  /** Prefer HTTP to orchestrator (same idea as /api/dashboard/open): WS :51247 from MV3 background is often down or races. */
  void tryStartSelectionViaHttp(source, options).then((ok) => {
    if (ok) return
    console.log('[Capture] HTTP start-selection failed or unavailable — using chrome.runtime → background WebSocket')
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
  })
}

async function tryStartSelectionViaHttp(
  source: string,
  options?: { createTrigger?: boolean; addCommand?: boolean },
): Promise<boolean> {
  if (typeof chrome === 'undefined' || typeof chrome.runtime?.sendMessage !== 'function') {
    return false
  }
  const secret = await new Promise<string | null>((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: { secret?: string } | null) => {
        if (chrome.runtime.lastError) resolve(null)
        else resolve(resp?.secret?.trim() ? resp.secret : null)
      })
    } catch {
      resolve(null)
    }
  })
  if (!secret) {
    console.warn('[Capture] No X-Launch-Secret yet — cannot call HTTP start-selection')
    return false
  }
  try {
    const r = await fetch('http://127.0.0.1:51248/api/lmgtfy/start-selection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Launch-Secret': secret },
      body: JSON.stringify({
        source,
        ...(options?.createTrigger !== undefined && { createTrigger: options.createTrigger }),
        ...(options?.addCommand !== undefined && { addCommand: options.addCommand }),
      }),
      signal: AbortSignal.timeout(15000),
    })
    if (!r.ok) {
      const t = await r.text().catch(() => '')
      console.warn('[Capture] HTTP /api/lmgtfy/start-selection failed:', r.status, t.slice(0, 200))
      return false
    }
    console.log('[Capture] HTTP /api/lmgtfy/start-selection ok')
    return true
  } catch (e) {
    console.warn('[Capture] HTTP start-selection error:', e)
    return false
  }
}
