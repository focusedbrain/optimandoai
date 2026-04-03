/**
 * LmGTFY / screen capture entry: Electron dashboard uses preload bridge;
 * extension contexts use chrome.runtime → background WebSocket.
 */

type LmgtfyBridge = {
  selectScreenshot?: () => Promise<unknown>
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
  const bridge = getLmgtfyBridge()
  if (typeof bridge?.selectScreenshot === 'function') {
    void bridge.selectScreenshot().catch((err: unknown) => {
      console.warn('[WrChatCapture] LETmeGIRAFFETHATFORYOU.selectScreenshot failed', err)
    })
    return
  }

  const source = options?.source ?? 'wr-chat'
  try {
    chrome.runtime?.sendMessage({
      type: 'ELECTRON_START_SELECTION',
      source,
      ...(options?.createTrigger !== undefined && { createTrigger: options.createTrigger }),
      ...(options?.addCommand !== undefined && { addCommand: options.addCommand }),
    })
  } catch (e) {
    console.warn('[WrChatCapture] ELECTRON_START_SELECTION sendMessage failed', e)
  }
}
