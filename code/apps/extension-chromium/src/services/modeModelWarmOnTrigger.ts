/**
 * Fire-and-forget mode-model warm on speech bubble or interval enable (batch-04).
 * Extension + Electron dashboard both hit the HTTP bridge; dashboard may use IPC when embedded.
 */

import { ensureLaunchSecretForElectronHttp } from './ensureLaunchSecretForElectronHttp'

const DEFAULT_LLM_BASE = 'http://127.0.0.1:51248'

export type ModeWarmTrigger = 'speech_bubble' | 'interval'

async function resolveLaunchSecret(): Promise<string> {
  await ensureLaunchSecretForElectronHttp()
  return new Promise((resolve) => {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: { secret?: string } | undefined) => {
          resolve(resp?.secret?.trim() ?? '')
        })
        return
      }
    } catch {
      /* fall through */
    }
    try {
      const w = window as unknown as {
        handshakeView?: { pqHeaders?: () => Record<string, string> }
      }
      const secret = w.handshakeView?.pqHeaders?.()['X-Launch-Secret']?.trim()
      resolve(secret ?? '')
    } catch {
      resolve('')
    }
  })
}

/** Non-blocking — errors are swallowed (warmup is best-effort). */
export function requestModeModelWarmOnTrigger(modeId: string, trigger: ModeWarmTrigger): void {
  const id = modeId?.trim()
  if (!id) return

  void (async () => {
    try {
      const secret = await resolveLaunchSecret()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (secret) headers['X-Launch-Secret'] = secret
      await fetch(`${DEFAULT_LLM_BASE}/api/llm/mode-model-warm`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ modeId: id, trigger }),
        signal: AbortSignal.timeout(5_000),
      })
    } catch {
      /* best effort */
    }
  })()
}
