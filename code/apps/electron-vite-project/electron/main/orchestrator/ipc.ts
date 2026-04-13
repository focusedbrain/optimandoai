/**
 * IPC handlers for orchestrator host/sandbox mode (renderer + preload bridge).
 */

import { ipcMain } from 'electron'
import {
  getOrchestratorMode,
  removeConnectedPeer,
  setDeviceName,
  setOrchestratorMode,
  type OrchestratorModeConfig,
} from './orchestratorModeStore'

function normalizeHttpsBaseUrl(hostUrl: string): string | null {
  try {
    const trimmed = hostUrl.trim()
    const u = new URL(trimmed)
    if (u.protocol !== 'https:') return null
    if (!u.hostname) return null
    return `${u.origin}`
  } catch {
    return null
  }
}

function isHostInferencePayload(
  data: unknown,
): data is {
  orchestrator: true
  mode: 'host'
  inference?: { available?: boolean; model?: string | null }
} {
  if (data == null || typeof data !== 'object') return false
  const o = data as Record<string, unknown>
  return o.orchestrator === true && o.mode === 'host'
}

export type RemoteOrchestratorInferenceOk = {
  ok: true
  host: {
    orchestrator: true
    mode: 'host'
    inference?: { available: boolean; model: string | null }
  }
}

export type RemoteOrchestratorInferenceFail = { ok: false; error: string }

/**
 * GET remote host `/api/orchestrator/inference-status` with Bearer token (shared by IPC + HTTP).
 */
export async function testRemoteOrchestratorInferenceStatus(
  hostUrl: string,
  accessToken: string,
): Promise<RemoteOrchestratorInferenceOk | RemoteOrchestratorInferenceFail> {
  const base = normalizeHttpsBaseUrl(hostUrl)
  if (!base) {
    return { ok: false, error: 'hostUrl must be a valid https:// URL' }
  }

  const token = accessToken?.trim() || ''
  if (!token) {
    return {
      ok: false,
      error: 'No access token: pass accessToken or sign in so a session token is available',
    }
  }

  const url = `${base}/api/orchestrator/inference-status`
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return {
        ok: false,
        error: `Host returned ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ''}`,
      }
    }

    let data: unknown
    try {
      data = await res.json()
    } catch {
      return { ok: false, error: 'Host response was not valid JSON' }
    }

    if (!isHostInferencePayload(data)) {
      return {
        ok: false,
        error: 'Host response missing orchestrator: true and mode: "host"',
      }
    }

    const rawInf = data.inference
    let inference: { available: boolean; model: string | null } | undefined
    if (rawInf != null && typeof rawInf === 'object') {
      const m = (rawInf as { model?: unknown }).model
      inference = {
        available: (rawInf as { available?: boolean }).available === true,
        model: typeof m === 'string' ? m : m === null ? null : null,
      }
    }

    const hostPayload: RemoteOrchestratorInferenceOk['host'] = {
      orchestrator: true,
      mode: 'host',
      ...(inference ? { inference } : {}),
    }

    return { ok: true, host: hostPayload }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Connection timed out after 5 seconds' }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { ok: false, error: message || 'Connection failed' }
  }
}

/**
 * Register orchestrator IPC handlers (idempotent if Electron replaces on duplicate channel names).
 */
export function registerOrchestratorIPC(): void {
  console.log('[Orchestrator IPC] Registering handlers...')

  ipcMain.handle('orchestrator:getMode', async () => {
    return getOrchestratorMode()
  })

  ipcMain.handle('orchestrator:setMode', async (_event, config: OrchestratorModeConfig) => {
    try {
      setOrchestratorMode(config)
      return { ok: true as const }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[Orchestrator IPC] setMode failed:', message)
      return { ok: false as const, error: message }
    }
  })

  ipcMain.handle('orchestrator:setDeviceName', async (_event, params: { deviceName?: string }) => {
    try {
      const name = typeof params?.deviceName === 'string' ? params.deviceName : ''
      setDeviceName(name)
      return { ok: true as const }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[Orchestrator IPC] setDeviceName failed:', message)
      return { ok: false as const, error: message }
    }
  })

  ipcMain.handle('orchestrator:getDeviceInfo', async () => {
    const c = getOrchestratorMode()
    return { instanceId: c.instanceId, deviceName: c.deviceName, mode: c.mode }
  })

  ipcMain.handle('orchestrator:getConnectedPeers', async () => {
    return getOrchestratorMode().connectedPeers
  })

  ipcMain.handle('orchestrator:removePeer', async (_event, params: { instanceId?: string }) => {
    const id = typeof params?.instanceId === 'string' ? params.instanceId.trim() : ''
    if (!id) {
      return { ok: false as const, error: 'instanceId is required' }
    }
    removeConnectedPeer(id)
    return { ok: true as const }
  })

  console.log('[Orchestrator IPC] Handlers registered')
}
