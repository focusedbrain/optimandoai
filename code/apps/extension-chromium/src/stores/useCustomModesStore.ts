/**
 * Persisted user-defined WR Chat modes (schema v2).
 */

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { CustomModeDefinition, CustomModeDraft } from '../shared/ui/customModeTypes'
import {
  buildCustomModeFromDraft,
  normalizeCustomModeFields,
  normalizeCustomModeNameKey,
} from '../shared/ui/customModeTypes'
import {
  CUSTOM_MODES_PERSIST_KEY,
  migrateCustomModesPersistedState,
} from '../shared/ui/customModePersistence'

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
          throw new Error('A mode with this name already exists. Choose a different name.')
        }

        let def: CustomModeDefinition
        try {
          def = buildCustomModeFromDraft(draft)
        } catch (e) {
          console.error('[CustomModes] buildCustomModeFromDraft failed', e)
          throw new Error('Could not create this mode. Check your inputs and try again.')
        }

        try {
          set((s) => ({ modes: [...s.modes, def] }))
        } catch (e) {
          console.error('[CustomModes] persist failed', e)
          throw new Error('Could not save the mode to storage. Try again or free some space.')
        }

        return def.id
      },

      updateMode: (id, patch) => {
        if (!id.startsWith('custom:')) return
        set((s) => ({
          modes: s.modes.map((m) => {
            if (m.id !== id) return m
            const now = new Date().toISOString()
            return normalizeCustomModeFields({
              ...m,
              ...patch,
              id,
              type: 'custom',
              updatedAt: now,
            })
          }),
        }))
      },

      removeMode: (id) => {
        if (!id.startsWith('custom:')) return
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
