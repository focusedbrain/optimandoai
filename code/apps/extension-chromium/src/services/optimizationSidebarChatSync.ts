/**
 * Persists WR Chat sidebar lines into the orchestrator session blob so Electron
 * auto-optimization can include them in assembleOptimizationContext (metadata).
 */

const ORCH_BASE = 'http://127.0.0.1:51248'
const MAX_ENTRIES = 40

export type OptimizationSidebarChatLogEntry = {
  role: 'user' | 'assistant'
  text: string
  at: string
}

export async function appendOptimizationSidebarChatLog(params: {
  sessionKey: string
  role: 'user' | 'assistant'
  text: string
  headers: Record<string, string>
}): Promise<void> {
  const sessionKey = (params.sessionKey ?? '').trim()
  const text = (params.text ?? '').trim()
  if (!sessionKey || !text) return

  const getUrl = `${ORCH_BASE}/api/orchestrator/get?key=${encodeURIComponent(sessionKey)}`
  const r = await fetch(getUrl, { headers: params.headers })
  if (!r.ok) return

  const body = (await r.json()) as { data?: Record<string, unknown> }
  const session: Record<string, unknown> = { ...(body.data ?? {}) }
  const rawMeta = session.metadata
  const metadata: Record<string, unknown> =
    rawMeta && typeof rawMeta === 'object' && !Array.isArray(rawMeta)
      ? { ...(rawMeta as Record<string, unknown>) }
      : {}

  const prev = metadata.optimizationSidebarChatLog
  const arr: OptimizationSidebarChatLogEntry[] = Array.isArray(prev)
    ? [...(prev as OptimizationSidebarChatLogEntry[])]
    : []
  arr.push({
    role: params.role,
    text,
    at: new Date().toISOString(),
  })
  metadata.optimizationSidebarChatLog = arr.slice(-MAX_ENTRIES)
  session.metadata = metadata

  await fetch(`${ORCH_BASE}/api/orchestrator/set`, {
    method: 'POST',
    headers: { ...params.headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ key: sessionKey, value: session }),
  })
}
