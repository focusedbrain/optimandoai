/**
 * fetch() to the desktop app's HTTP API with the per-launch secret.
 *
 * The app makes a new secret on every start and hands it over only in the WebSocket
 * handshake. After an app restart the extension keeps sending the old secret until its
 * WebSocket reconnects, and the app answers 401 "missing or invalid launch secret". The
 * fetch here waits for the new handshake and sends the request once more.
 */

export interface LaunchSecretFetchDeps {
  getSecret: () => string | null
  /** Resolves true once the cached secret differs from `stale`; false on timeout. */
  awaitFreshSecret: (stale: string | null) => Promise<boolean>
  fetchImpl?: typeof fetch
}

/** True for the app's global auth middleware rejection (electron main.ts), not for other 401s. */
export async function isStaleLaunchSecretResponse(res: Response): Promise<boolean> {
  if (res.status !== 401) return false
  try {
    const body = (await res.clone().json()) as { error?: unknown }
    return typeof body?.error === 'string' && body.error.includes('launch secret')
  } catch {
    return false
  }
}

export function createLaunchSecretFetch(deps: LaunchSecretFetchDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch
  return async function electronFetch(url: string, init: RequestInit = {}, timeoutMs?: number): Promise<Response> {
    const send = (secret: string | null) => {
      const headers = new Headers(init.headers)
      if (secret) headers.set('X-Launch-Secret', secret)
      return fetchImpl(url, {
        ...init,
        headers,
        // A fresh timeout per attempt: waiting for the handshake must not eat the retry's budget.
        ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
      })
    }
    const used = deps.getSecret()
    const res = await send(used)
    if (!(await isStaleLaunchSecretResponse(res))) return res
    if (!(await deps.awaitFreshSecret(used))) return res
    return send(deps.getSecret())
  }
}
