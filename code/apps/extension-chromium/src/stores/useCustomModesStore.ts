/**
 * Persisted user-defined WR Chat modes (schema v2) — thin cache over main-process store.
 */

import { create } from 'zustand'
import type { CustomModeDefinition, CustomModeDraft } from '../shared/ui/customModeTypes'
import {
  getCustomModeScopeFromMetadata,
  isModeDeletable,
  normalizeCustomModeNameKey,
} from '../shared/ui/customModeTypes'
import { syncCustomModeDiffWatcher } from '../services/syncCustomModeDiffWatcher'
import { customModesClient } from '../services/customModesClient'
import {
  runCustomModesMigrationIfNeeded,
  warnIfLegacyCustomModesLocalStorageReappears,
} from '../services/customModesMigration'

type StoreResponse =
  | { ok: true; data: CustomModeDefinition[] }
  | { ok: false; error: string }

interface CustomModesState {
  modes: CustomModeDefinition[]
  addMode: (draft: CustomModeDraft) => Promise<string>
  updateMode: (id: string, patch: Partial<CustomModeDraft>) => void
  removeMode: (id: string) => void
  getById: (id: string) => CustomModeDefinition | undefined
}

function isElectronDashboard(): boolean {
  return typeof window !== 'undefined' && !!(window as { customModes?: unknown }).customModes
}

function detectMigrationOrigin(): 'dashboard' | 'extension' {
  return isElectronDashboard() ? 'dashboard' : 'extension'
}

async function listFromMain(): Promise<StoreResponse> {
  if (isElectronDashboard()) {
    const api = (window as {
      customModes?: {
        list: () => Promise<StoreResponse>
      }
    }).customModes
    if (!api?.list) return { ok: false, error: 'customModes API unavailable' }
    return api.list()
  }
  return customModesClient.list()
}

async function createOnMain(draft: CustomModeDraft): Promise<StoreResponse> {
  if (isElectronDashboard()) {
    const api = (window as {
      customModes?: {
        create: (draft: CustomModeDraft) => Promise<StoreResponse>
      }
    }).customModes
    if (!api?.create) return { ok: false, error: 'customModes API unavailable' }
    return api.create(draft)
  }
  return customModesClient.create(draft)
}

async function updateOnMain(id: string, patch: Partial<CustomModeDraft>): Promise<StoreResponse> {
  if (isElectronDashboard()) {
    const api = (window as {
      customModes?: {
        update: (id: string, patch: Partial<CustomModeDraft>) => Promise<StoreResponse>
      }
    }).customModes
    if (!api?.update) return { ok: false, error: 'customModes API unavailable' }
    return api.update(id, patch)
  }
  return customModesClient.update(id, patch)
}

async function deleteOnMain(id: string): Promise<StoreResponse> {
  if (isElectronDashboard()) {
    const api = (window as {
      customModes?: {
        delete: (id: string) => Promise<StoreResponse>
      }
    }).customModes
    if (!api?.delete) return { ok: false, error: 'customModes API unavailable' }
    return api.delete(id)
  }
  return customModesClient.delete(id)
}

export const useCustomModesStore = create<CustomModesState>()((set, get) => ({
  modes: [],

  addMode: async (draft) => {
    const nameKey = normalizeCustomModeNameKey(draft.name)
    if (get().modes.some((m) => normalizeCustomModeNameKey(m.name) === nameKey)) {
      throw new Error('A mode with this name already exists. Choose a different name.')
    }

    const beforeIds = new Set(get().modes.map((m) => m.id))
    let result: StoreResponse
    try {
      result = await createOnMain(draft)
    } catch (e) {
      console.error('[CustomModes] create IPC failed', e)
      throw new Error('Could not create this mode. Check your inputs and try again.')
    }

    if (!result.ok) {
      throw new Error(result.error || 'Could not create this mode.')
    }

    set({ modes: result.data })
    const created = result.data.find((m) => !beforeIds.has(m.id))
    if (!created) {
      throw new Error('Could not save the mode to storage. Try again or free some space.')
    }
    return created.id
  },

  updateMode: (id, patch) => {
    if (!id.startsWith('custom:') && !id.startsWith('built-in:')) return
    void (async () => {
      const result = await updateOnMain(id, patch)
      if (!result.ok) {
        console.error('[CustomModes] update failed:', result.error)
        return
      }
      set({ modes: result.data })
      const next = result.data.find((m) => m.id === id)
      if (next) {
        const scope = getCustomModeScopeFromMetadata(next.metadata as Record<string, unknown> | undefined)
        void syncCustomModeDiffWatcher(id, next.name, scope.diffWatchFolders)
      }
    })()
  },

  removeMode: (id) => {
    const existing = get().modes.find((m) => m.id === id)
    if (!existing || !isModeDeletable(existing)) {
      console.warn('[CustomModes] delete rejected for mode:', id)
      return
    }
    void (async () => {
      const result = await deleteOnMain(id)
      if (!result.ok) {
        console.error('[CustomModes] delete failed:', result.error)
        return
      }
      void syncCustomModeDiffWatcher(id, existing?.name ?? 'Mode', null)
      set({ modes: result.data })
    })()
  },

  getById: (id) => get().modes.find((m) => m.id === id),
}))

async function hydrateCustomModesStore(): Promise<void> {
  const result = await listFromMain()
  if (result.ok) {
    useCustomModesStore.setState({ modes: result.data })
  } else {
    console.warn('[CustomModes] hydrate failed:', result.error)
  }
}

function subscribeCustomModesChanged(): void {
  if (isElectronDashboard()) {
    const api = (window as {
      customModes?: {
        onChanged: (handler: (payload: { modes: CustomModeDefinition[] }) => void) => () => void
      }
    }).customModes
    api?.onChanged(({ modes }) => {
      useCustomModesStore.setState({ modes })
    })
    return
  }
  customModesClient.onChanged((modes) => {
    useCustomModesStore.setState({ modes })
  })
}

void (async () => {
  const origin = detectMigrationOrigin()
  await runCustomModesMigrationIfNeeded(origin)
  await hydrateCustomModesStore()
  warnIfLegacyCustomModesLocalStorageReappears()
})()

subscribeCustomModesChanged()
