/**
 * Idempotent built-in mode seeding for the shared custom-modes store.
 */

import type { CustomModeDefinition } from '../../../../extension-chromium/src/shared/ui/customModeTypes'
import { listBuiltInModeSeeds } from '../../../../extension-chromium/src/shared/ui/scamWatchdogBuiltIn'

/** Ensure shipped built-in modes exist exactly once (never overwrite user edits). */
export function ensureBuiltInModes(modes: CustomModeDefinition[]): CustomModeDefinition[] {
  const seeds = listBuiltInModeSeeds()
  const byId = new Set(modes.map((m) => m.id))
  const missing = seeds.filter((seed) => !byId.has(seed.id))
  if (missing.length === 0) return modes
  return [...missing, ...modes]
}
