/**
 * Built-in Scam Watchdog mode — id, seed, and helpers.
 */

import type { CustomModeDefinition } from './customModeTypes'
import { normalizeCustomModeFields } from './customModeTypes'
import { SCAM_WATCHDOG_DEFAULT_SEARCH_FOCUS } from './watchdogPrompts'

export const BUILTIN_SCAM_WATCHDOG_ID = 'built-in:scam-watchdog' as const
export const BUILTIN_SCAM_WATCHDOG_KEY = 'scam-watchdog' as const

const BUILTIN_SEED_TIMESTAMP = '2026-01-01T00:00:00.000Z'

export function createDefaultScamWatchdogBuiltInMode(): CustomModeDefinition {
  return normalizeCustomModeFields({
    id: BUILTIN_SCAM_WATCHDOG_ID,
    type: 'built-in',
    builtInKey: BUILTIN_SCAM_WATCHDOG_KEY,
    deletable: false,
    name: 'Scam Watchdog',
    description:
      'Scam and fraud detection for WR Chat and screen scans. Share suspicious content in chat or run a vision scan from the trigger bar.',
    icon: '🐕‍🦺',
    modelProvider: 'ollama',
    modelName: '',
    endpoint: 'http://127.0.0.1:11434',
    sessionId: null,
    sessionMode: 'shared',
    searchFocus: SCAM_WATCHDOG_DEFAULT_SEARCH_FOCUS,
    ignoreInstructions: '',
    intervalSeconds: null,
    createdAt: BUILTIN_SEED_TIMESTAMP,
    updatedAt: BUILTIN_SEED_TIMESTAMP,
  })
}

export function isScamWatchdogBuiltInMode(def: CustomModeDefinition | null | undefined): boolean {
  if (!def) return false
  return def.id === BUILTIN_SCAM_WATCHDOG_ID || def.builtInKey === BUILTIN_SCAM_WATCHDOG_KEY
}

/** Built-in rows seeded on store init (extend when adding more shipped modes). */
export function listBuiltInModeSeeds(): CustomModeDefinition[] {
  return [createDefaultScamWatchdogBuiltInMode()]
}
