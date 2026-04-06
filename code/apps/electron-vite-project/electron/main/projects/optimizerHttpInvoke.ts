import { getMainBrowserWindow } from '../mainWindowAccessor'

type BridgeResult =
  | { ok: true; enabled?: boolean; intervalMs?: number; lastRunAt?: number | null }
  | { ok: false; error: string }

export async function invokeOptimizerSnapshot(projectId: string): Promise<{ ok: boolean; error?: string }> {
  const win = getMainBrowserWindow()
  if (!win?.webContents) return { ok: false, error: 'bridge not ready' }
  const pid = JSON.stringify(projectId)
  try {
    const result = (await win.webContents.executeJavaScript(
      `(async function(){
        const b = window.__wrdeskOptimizerHttp
        if (!b || typeof b.snapshot !== 'function') return { ok: false, error: 'bridge not ready' }
        return await b.snapshot(${pid})
      })()`,
    )) as BridgeResult
    if (result && typeof result === 'object' && result.ok === true) return { ok: true }
    return { ok: false, error: (result as { error?: string })?.error || 'snapshot failed' }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'invoke failed' }
  }
}

export async function invokeOptimizerSetContinuous(
  projectId: string,
  enabled: boolean,
): Promise<{ ok: boolean; enabled?: boolean; intervalMs?: number; error?: string }> {
  const win = getMainBrowserWindow()
  if (!win?.webContents) return { ok: false, error: 'bridge not ready' }
  const pid = JSON.stringify(projectId)
  const en = JSON.stringify(enabled)
  try {
    const result = (await win.webContents.executeJavaScript(
      `(async function(){
        const b = window.__wrdeskOptimizerHttp
        if (!b || typeof b.setContinuous !== 'function') return { ok: false, error: 'bridge not ready' }
        return await b.setContinuous(${pid}, ${en})
      })()`,
    )) as BridgeResult & { enabled?: boolean; intervalMs?: number }
    if (result && typeof result === 'object' && result.ok === true) {
      return {
        ok: true,
        enabled: typeof result.enabled === 'boolean' ? result.enabled : enabled,
        intervalMs: typeof result.intervalMs === 'number' ? result.intervalMs : undefined,
      }
    }
    return { ok: false, error: (result as { error?: string })?.error || 'continuous failed' }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'invoke failed' }
  }
}

export async function invokeOptimizerGetStatus(projectId: string): Promise<{
  ok: boolean
  enabled?: boolean
  intervalMs?: number
  lastRunAt?: number | null
  error?: string
}> {
  const win = getMainBrowserWindow()
  if (!win?.webContents) return { ok: false, error: 'bridge not ready' }
  const pid = JSON.stringify(projectId)
  try {
    const result = (await win.webContents.executeJavaScript(
      `(async function(){
        const b = window.__wrdeskOptimizerHttp
        if (!b || typeof b.getStatus !== 'function') return { ok: false, error: 'bridge not ready' }
        return await b.getStatus(${pid})
      })()`,
    )) as BridgeResult & { enabled?: boolean; intervalMs?: number; lastRunAt?: number | null }
    if (result && typeof result === 'object' && result.ok === true) {
      return {
        ok: true,
        enabled: result.enabled,
        intervalMs: result.intervalMs,
        lastRunAt: result.lastRunAt,
      }
    }
    return { ok: false, error: (result as { error?: string })?.error || 'status failed' }
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : 'invoke failed' }
  }
}
