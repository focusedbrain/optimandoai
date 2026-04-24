/**
 * Recovery: ask the coordination relay to push any SQLite-queued capsules (HTTP 202 path)
 * to this user's already-open WebSocket sessions. Complements server-side flush on
 * register-handshake and initial pending delivery on WS connect.
 */

export async function requestCoordinationFlushQueued(
  coordinationUrl: string,
  oidcToken: string,
  reason: 'post_register' | 'ws_connect',
): Promise<{ ok: boolean; delivered?: number; error?: string }> {
  const base = coordinationUrl.replace(/\/$/, '')
  const url = `${base}/beap/flush-queued`
  console.log('[CLIENT-QUEUE-PULL] begin', JSON.stringify({ reason, url }))
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${oidcToken.trim()}`,
      },
    })
    const text = await res.text()
    let delivered = 0
    try {
      const j = JSON.parse(text) as { delivered?: number }
      if (typeof j.delivered === 'number') delivered = j.delivered
    } catch {
      /* ignore */
    }
    const ok = res.ok
    console.log(
      '[CLIENT-QUEUE-PULL] result',
      JSON.stringify({ ok, status: res.status, delivered, reason }),
    )
    if (!ok) {
      return { ok: false, error: text.slice(0, 400) }
    }
    return { ok: true, delivered }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[CLIENT-QUEUE-PULL] result', JSON.stringify({ ok: false, error: msg, reason }))
    return { ok: false, error: msg }
  }
}
