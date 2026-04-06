const BASE_URL = 'http://127.0.0.1:51248'

function getLaunchSecret(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: 'GET_LAUNCH_SECRET' }, (resp: { secret?: string } | null) => {
        if (chrome.runtime.lastError) {
          resolveElectronFallback(resolve)
        } else {
          const s = resp?.secret?.trim() ? resp.secret : null
          if (s) resolve(s)
          else resolveElectronFallback(resolve)
        }
      })
    } catch {
      resolveElectronFallback(resolve)
    }
  })
}

function resolveElectronFallback(resolve: (v: string | null) => void): void {
  try {
    const pqHeaders = (window as unknown as { handshakeView?: { pqHeaders?: () => Promise<Record<string, string>> } })
      .handshakeView?.pqHeaders
    if (typeof pqHeaders === 'function') {
      void pqHeaders()
        .then((h) => resolve(h?.['X-Launch-Secret']?.trim() || null))
        .catch(() => resolve(null))
    } else {
      resolve(null)
    }
  } catch {
    resolve(null)
  }
}

function buildHeaders(secret: string | null): Record<string, string> {
  return { 'Content-Type': 'application/json', 'X-Launch-Secret': secret ?? '' }
}

export async function getOptimizerStatus(projectId: string): Promise<{ enabled: boolean; intervalMs: number }> {
  try {
    const secret = await getLaunchSecret()
    const res = await fetch(
      `${BASE_URL}/api/projects/${encodeURIComponent(projectId)}/optimize/status`,
      { method: 'GET', headers: buildHeaders(secret), signal: AbortSignal.timeout(15_000) },
    )
    if (!res.ok) return { enabled: false, intervalMs: 300_000 }
    const j = (await res.json().catch(() => null)) as { enabled?: boolean; intervalMs?: number } | null
    return {
      enabled: typeof j?.enabled === 'boolean' ? j.enabled : false,
      intervalMs: typeof j?.intervalMs === 'number' ? j.intervalMs : 300_000,
    }
  } catch {
    return { enabled: false, intervalMs: 300_000 }
  }
}

export async function setOptimizerContinuous(
  projectId: string,
  enabled: boolean,
): Promise<{ enabled: boolean; intervalMs: number }> {
  try {
    const secret = await getLaunchSecret()
    const res = await fetch(
      `${BASE_URL}/api/projects/${encodeURIComponent(projectId)}/optimize/continuous`,
      {
        method: 'POST',
        headers: buildHeaders(secret),
        body: JSON.stringify({ enabled }),
        signal: AbortSignal.timeout(30_000),
      },
    )
    if (!res.ok) return { enabled: false, intervalMs: 300_000 }
    const j = (await res.json().catch(() => null)) as { enabled?: boolean; intervalMs?: number } | null
    return {
      enabled: typeof j?.enabled === 'boolean' ? j.enabled : enabled,
      intervalMs: typeof j?.intervalMs === 'number' ? j.intervalMs : 300_000,
    }
  } catch {
    return { enabled: false, intervalMs: 300_000 }
  }
}

export async function triggerOptimizerSnapshot(projectId: string): Promise<void> {
  try {
    const secret = await getLaunchSecret()
    await fetch(`${BASE_URL}/api/projects/${encodeURIComponent(projectId)}/optimize/snapshot`, {
      method: 'POST',
      headers: buildHeaders(secret),
      signal: AbortSignal.timeout(600_000),
    })
  } catch {
    /* noop */
  }
}
