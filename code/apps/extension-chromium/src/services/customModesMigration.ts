/**
 * One-time migration from Zustand localStorage to the main-process custom modes store.
 */

import type { CustomModeDefinition } from '../shared/ui/customModeTypes'
import {
  CUSTOM_MODES_PERSIST_KEY,
  loadCustomModesFromLocalStorageKey,
} from '../shared/ui/customModePersistence'
import { customModesClient, type CustomModesMigrationOrigin } from './customModesClient'

function isElectronDashboard(): boolean {
  return typeof window !== 'undefined' && !!(window as { customModes?: unknown }).customModes
}

async function getMigrationStatus(origin: CustomModesMigrationOrigin): Promise<boolean> {
  if (isElectronDashboard()) {
    const api = (window as { customModes?: { getMigrationStatus: () => Promise<{ ok: boolean; data?: { localStorageImport?: Record<string, boolean> } }> } }).customModes
    if (!api?.getMigrationStatus) return false
    const resp = await api.getMigrationStatus()
    if (!resp.ok || !resp.data?.localStorageImport) return false
    return resp.data.localStorageImport[origin] === true
  }
  const resp = await customModesClient.getMigrationStatus()
  if (!resp.ok) return false
  return resp.data.localStorageImport[origin] === true
}

async function importModes(
  modes: CustomModeDefinition[],
  origin: CustomModesMigrationOrigin,
): Promise<{ ok: true; data: CustomModeDefinition[] } | { ok: false; error: string }> {
  if (isElectronDashboard()) {
    const api = (window as {
      customModes?: {
        import: (
          modes: CustomModeDefinition[],
          origin: CustomModesMigrationOrigin,
        ) => Promise<{ ok: boolean; data?: CustomModeDefinition[]; error?: string }>
      }
    }).customModes
    if (!api?.import) return { ok: false, error: 'customModes API unavailable' }
    const resp = await api.import(modes, origin)
    if (!resp.ok || !Array.isArray(resp.data)) {
      return { ok: false, error: resp.error ?? 'import failed' }
    }
    return { ok: true, data: resp.data }
  }
  return customModesClient.import(modes, origin)
}

function verifyImportedModes(resultModes: CustomModeDefinition[], importedIds: string[]): boolean {
  const resultIds = new Set(resultModes.map((m) => m.id))
  return importedIds.every((id) => resultIds.has(id))
}

/**
 * Import legacy localStorage modes into main once per surface (`dashboard` | `extension`).
 * Clears localStorage only after verified successful import.
 */
export async function runCustomModesMigrationIfNeeded(origin: CustomModesMigrationOrigin): Promise<void> {
  try {
    const alreadyDone = await getMigrationStatus(origin)
    if (alreadyDone) return

    const legacyModes = loadCustomModesFromLocalStorageKey(CUSTOM_MODES_PERSIST_KEY)
    if (legacyModes.length === 0) {
      const emptyImport = await importModes([], origin)
      if (!emptyImport.ok && import.meta.env?.DEV) {
        console.warn('[CustomModesMigration] empty legacy import mark failed:', emptyImport.error)
      }
      return
    }

    const importedIds = legacyModes.map((m) => m.id)
    const result = await importModes(legacyModes, origin)
    if (!result.ok) {
      console.warn('[CustomModesMigration] import failed; keeping localStorage backup:', result.error)
      return
    }

    if (!verifyImportedModes(result.data, importedIds)) {
      console.warn('[CustomModesMigration] verify failed; keeping localStorage backup')
      return
    }

    try {
      localStorage.removeItem(CUSTOM_MODES_PERSIST_KEY)
    } catch {
      /* quota / private mode */
    }
  } catch (e) {
    console.warn('[CustomModesMigration] unexpected error:', e instanceof Error ? e.message : e)
  }
}

/** Dev-only guard: log if legacy key reappears after migration. */
export function warnIfLegacyCustomModesLocalStorageReappears(): void {
  if (!import.meta.env?.DEV) return
  try {
    const raw = localStorage.getItem(CUSTOM_MODES_PERSIST_KEY)
    if (raw && raw.trim()) {
      console.warn('[CustomModesMigration] legacy localStorage key wr-ui-custom-modes-v1 reappeared')
    }
  } catch {
    /* ignore */
  }
}
