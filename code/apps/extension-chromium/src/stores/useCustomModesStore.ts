/**
 * Persisted user-defined WR Chat modes (schema v2).
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { CustomModeDefinition, CustomModeDraft } from '../shared/ui/customModeTypes'
import {
  buildCustomModeFromDraft,
  getCustomModeScopeFromMetadata,
  normalizeCustomModeFields,
  normalizeCustomModeNameKey,
} from '../shared/ui/customModeTypes'
import {
  CUSTOM_MODES_PERSIST_KEY,
  migrateCustomModesPersistedState,
} from '../shared/ui/customModePersistence'
import { syncCustomModeDiffWatcher } from '../services/syncCustomModeDiffWatcher'

const SCHEMA_VERSION = 2

interface CustomModesState {
  modes: CustomModeDefinition[]
  addMode: (draft: CustomModeDraft) => string
  updateMode: (id: string, patch: Partial<CustomModeDraft>) => void
  removeMode: (id: string) => void
  getById: (id: string) => CustomModeDefinition | undefined
}

export const useCustomModesStore = create<CustomModesState>()(
  persist(
    (set, get) => ({
      modes: [],

      addMode: (draft) => {
        const nameKey = normalizeCustomModeNameKey(draft.name)
        if (get().modes.some((m) => normalizeCustomModeNameKey(m.name) === nameKey)) {
          throw new Error('An automation with this name already exists. Choose a different name.')
        }

        let def: CustomModeDefinition
        try {
          def = buildCustomModeFromDraft(draft)
        } catch (e) {
          console.error('[CustomModes] buildCustomModeFromDraft failed', e)
          throw new Error('Could not create this automation. Check your inputs and try again.')
        }

        try {
          set((s) => ({ modes: [...s.modes, def] }))
        } catch (e) {
          console.error('[CustomModes] persist failed', e)
          throw new Error('Could not save the automation to storage. Try again or free some space.')
        }

        return def.id
      },

      updateMode: (id, patch) => {
        if (!id.startsWith('custom:')) return
        set((s) => ({
          modes: s.modes.map((m) => {
            if (m.id !== id) return m
            const now = new Date().toISOString()
            const next = normalizeCustomModeFields({
              ...m,
              ...patch,
              id,
              type: 'custom',
              updatedAt: now,
            })
            const scope = getCustomModeScopeFromMetadata(next.metadata as Record<string, unknown> | undefined)
            void syncCustomModeDiffWatcher(id, next.name, scope.diffWatchFolders)
            return next
          }),
        }))
      },

      removeMode: (id) => {
        if (!id.startsWith('custom:')) return
        const existing = get().modes.find((m) => m.id === id)
        void syncCustomModeDiffWatcher(id, existing?.name ?? 'Mode', null)
        set((s) => ({ modes: s.modes.filter((m) => m.id !== id) }))
      },

      getById: (id) => get().modes.find((m) => m.id === id),
    }),
    {
      name: CUSTOM_MODES_PERSIST_KEY,
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ modes: s.modes }),
      migrate: (persistedState, version) =>
        migrateCustomModesPersistedState(persistedState, version),
    },
  ),
)
