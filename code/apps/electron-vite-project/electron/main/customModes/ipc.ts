/**
 * Custom modes IPC — dashboard renderer + HTTP mirror for extension RPC.
 */

import { ipcMain } from 'electron'
import type { CustomModeDraft } from '../../../../extension-chromium/src/shared/ui/customModeTypes'
import {
  createMode,
  deleteMode,
  getMigrationStatus,
  importModes,
  listModes,
  updateMode,
  type CustomModesMigrationOrigin,
} from './customModesStore'
import { broadcastCustomModesChanged } from './broadcast'

type IpcResult =
  | { ok: true; data: import('../../../../extension-chromium/src/shared/ui/customModeTypes').CustomModeDefinition[] }
  | { ok: false; error: string }

function isMigrationOrigin(v: unknown): v is CustomModesMigrationOrigin {
  return v === 'dashboard' || v === 'extension'
}

async function afterMutation(result: IpcResult): Promise<IpcResult> {
  if (result.ok) {
    broadcastCustomModesChanged(result.data)
  }
  return result
}

export function registerCustomModesHandlers(): void {
  ipcMain.handle('customModes:list', async () => {
    try {
      return { ok: true as const, data: listModes() }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? 'unknown')
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle('customModes:getMigrationStatus', async () => {
    try {
      return { ok: true as const, data: getMigrationStatus() }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? 'unknown')
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle('customModes:create', async (_event, payload: { draft?: CustomModeDraft }) => {
    try {
      const draft = payload?.draft
      if (!draft || typeof draft !== 'object') {
        return { ok: false as const, error: 'invalid draft' }
      }
      return afterMutation(await createMode(draft))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? 'unknown')
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(
    'customModes:update',
    async (_event, payload: { id?: string; patch?: Partial<CustomModeDraft> }) => {
      try {
        const id = typeof payload?.id === 'string' ? payload.id : ''
        const patch = payload?.patch
        if (!id || !patch || typeof patch !== 'object') {
          return { ok: false as const, error: 'invalid update payload' }
        }
        return afterMutation(await updateMode(id, patch))
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e ?? 'unknown')
        return { ok: false as const, error: msg }
      }
    },
  )

  ipcMain.handle('customModes:delete', async (_event, payload: { id?: string }) => {
    try {
      const id = typeof payload?.id === 'string' ? payload.id : ''
      if (!id) {
        return { ok: false as const, error: 'invalid id' }
      }
      return afterMutation(await deleteMode(id))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e ?? 'unknown')
      return { ok: false as const, error: msg }
    }
  })

  ipcMain.handle(
    'customModes:import',
    async (_event, payload: { modes?: unknown[]; origin?: unknown }) => {
      try {
        const modes = Array.isArray(payload?.modes) ? payload.modes : null
        const origin = payload?.origin
        if (!modes || !isMigrationOrigin(origin)) {
          return { ok: false as const, error: 'invalid import payload' }
        }
        return afterMutation(await importModes(modes, origin))
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e ?? 'unknown')
        return { ok: false as const, error: msg }
      }
    },
  )

  console.log('[CustomModes IPC] Handlers registered')
}
