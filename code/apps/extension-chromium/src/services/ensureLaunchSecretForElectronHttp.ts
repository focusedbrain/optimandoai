/**
 * Extension UI calls `fetch()` to Electron on 127.0.0.1:51248 with `X-Launch-Secret`.
 * The secret arrives asynchronously over the WebSocket (ELECTRON_HANDSHAKE).
 * Without waiting, the first requests often get 401 and the trigger list appears empty
 * until the user opens the dashboard (by then the handshake has completed).
 */

export async function ensureLaunchSecretForElectronHttp(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
        resolve(false)
        return
      }
      chrome.runtime.sendMessage({ type: 'BEAP_ENSURE_LAUNCH_SECRET' }, (resp: { ok?: boolean } | null) => {
        if (chrome.runtime.lastError) {
          resolve(false)
          return
        }
        resolve(!!resp?.ok)
      })
    } catch {
      resolve(false)
    }
  })
}

/** Full Express mounts after an early 503 "Initializing..." window during Electron boot. */
export async function fetchWithElectronHttpReady(
  doFetch: () => Promise<Response>,
  maxAttempts = 30,
  delayMs = 350,
): Promise<Response> {
  let res: Response | null = null
  for (let i = 0; i < maxAttempts; i++) {
    res = await doFetch()
    if (res.status !== 503) return res
    if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, delayMs))
  }
  return res!
}
