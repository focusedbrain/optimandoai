/**
 * Extension client for shared custom modes (HTTP via electronRpc + runtime broadcast).
 */

import type { CustomModeDefinition, CustomModeDraft } from '../shared/ui/customModeTypes'
import { electronRpc } from '../rpc/electronRpc'

export type CustomModesMigrationOrigin = 'dashboard' | 'extension'

export type CustomModesStoreResponse =
  | { ok: true; data: CustomModeDefinition[] }
  | { ok: false; error: string }

export type CustomModesMigrationStatusResponse =
  | {
      ok: true
      data: {
        localStorageImport: { dashboard: boolean; extension: boolean }
        completedAt?: string
      }
    }
  | { ok: false; error: string }

function parseModesResponse(raw: unknown): CustomModesStoreResponse {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid response' }
  const o = raw as Record<string, unknown>
  if (o.ok === true && Array.isArray(o.data)) {
    return { ok: true, data: o.data as CustomModeDefinition[] }
  }
  if (o.ok === false && typeof o.error === 'string') {
    return { ok: false, error: o.error }
  }
  return { ok: false, error: 'unexpected response shape' }
}

function parseMigrationStatusResponse(raw: unknown): CustomModesMigrationStatusResponse {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid response' }
  const o = raw as Record<string, unknown>
  if (o.ok === true && o.data && typeof o.data === 'object') {
    const d = o.data as Record<string, unknown>
    const ls = d.localStorageImport as Record<string, unknown> | undefined
    return {
      ok: true,
      data: {
        localStorageImport: {
          dashboard: ls?.dashboard === true,
          extension: ls?.extension === true,
        },
        completedAt: typeof d.completedAt === 'string' ? d.completedAt : undefined,
      },
    }
  }
  if (o.ok === false && typeof o.error === 'string') {
    return { ok: false, error: o.error }
  }
  return { ok: false, error: 'unexpected response shape' }
}

export const customModesClient = {
  async list(): Promise<CustomModesStoreResponse> {
    const resp = await electronRpc('customModes.list')
    if (!resp.success) return { ok: false, error: resp.error ?? 'list failed' }
    return parseModesResponse(resp.data)
  },

  async create(draft: CustomModeDraft): Promise<CustomModesStoreResponse> {
    const resp = await electronRpc('customModes.create', { draft })
    if (!resp.success) return { ok: false, error: resp.error ?? 'create failed' }
    return parseModesResponse(resp.data)
  },

  async update(id: string, patch: Partial<CustomModeDraft>): Promise<CustomModesStoreResponse> {
    const resp = await electronRpc('customModes.update', { id, patch })
    if (!resp.success) return { ok: false, error: resp.error ?? 'update failed' }
    return parseModesResponse(resp.data)
  },

  async delete(id: string): Promise<CustomModesStoreResponse> {
    const resp = await electronRpc('customModes.delete', { id })
    if (!resp.success) return { ok: false, error: resp.error ?? 'delete failed' }
    return parseModesResponse(resp.data)
  },

  async import(modes: CustomModeDefinition[], origin: CustomModesMigrationOrigin): Promise<CustomModesStoreResponse> {
    const resp = await electronRpc('customModes.import', { modes, origin })
    if (!resp.success) return { ok: false, error: resp.error ?? 'import failed' }
    return parseModesResponse(resp.data)
  },

  async getMigrationStatus(): Promise<CustomModesMigrationStatusResponse> {
    const resp = await electronRpc('customModes.getMigrationStatus')
    if (!resp.success) return { ok: false, error: resp.error ?? 'migration status failed' }
    return parseMigrationStatusResponse(resp.data)
  },

  onChanged(handler: (modes: CustomModeDefinition[]) => void): () => void {
    const listener = (msg: unknown) => {
      if (!msg || typeof msg !== 'object') return
      const o = msg as Record<string, unknown>
      if (o.type !== 'CUSTOM_MODES_CHANGED') return
      if (!Array.isArray(o.modes)) return
      handler(o.modes as CustomModeDefinition[])
    }
    try {
      chrome.runtime.onMessage.addListener(listener)
    } catch {
      return () => {}
    }
    return () => {
      try {
        chrome.runtime.onMessage.removeListener(listener)
      } catch {
        /* ignore */
      }
    }
  },
}
