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
