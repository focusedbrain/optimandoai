/**

 * Idempotent built-in mode seeding for the shared custom-modes store.

 */



import type { CustomModeDefinition } from '../../../../extension-chromium/src/shared/ui/customModeTypes'

import { normalizeCustomModeFields } from '../../../../extension-chromium/src/shared/ui/customModeTypes'

import {

  BUILTIN_SCAM_WATCHDOG_ID,

  createDefaultScamWatchdogBuiltInMode,

  listBuiltInModeSeeds,

  SCAM_WATCHDOG_DEFAULT_ICON,

} from '../../../../extension-chromium/src/shared/ui/scamWatchdogBuiltIn'

import { scamWatchdogSearchFocusToChatOnly } from '../../../../extension-chromium/src/shared/ui/watchdogPrompts'



/** Ensure shipped built-in modes exist exactly once (never overwrite user edits). */

export function ensureBuiltInModes(modes: CustomModeDefinition[]): CustomModeDefinition[] {

  const seeds = listBuiltInModeSeeds()

  const byId = new Set(modes.map((m) => m.id))

  const missing = seeds.filter((seed) => !byId.has(seed.id))

  if (missing.length === 0) return modes

  return [...missing, ...modes]

}



function seedRow(): CustomModeDefinition {

  return createDefaultScamWatchdogBuiltInMode()

}



/**

 * Populate empty Scam Watchdog seed fields on persisted rows (pre-batch-03 installs).

 * Does not overwrite user-edited values.

 */

export function backfillEmptyScamWatchdogFields(modes: CustomModeDefinition[]): {

  modes: CustomModeDefinition[]

  changed: boolean

} {

  const seed = seedRow()

  const seedFocus = seed.searchFocus?.trim() ?? ''

  const seedIcon = seed.icon?.trim() || SCAM_WATCHDOG_DEFAULT_ICON



  let changed = false

  const next = modes.map((m) => {

    if (m.id !== BUILTIN_SCAM_WATCHDOG_ID) return m



    const patch: Partial<CustomModeDefinition> = {}

    if (seedFocus && (m.searchFocus?.trim() ?? '') === '') {

      patch.searchFocus = seed.searchFocus

    }

    if (seedIcon) {
      const currentIcon = m.icon?.trim() ?? ''
      const needsDogIcon = currentIcon === '' || currentIcon === '⚡'
      if (needsDogIcon) {
        patch.icon = seedIcon
      }
    }

    if (Object.keys(patch).length === 0) return m



    changed = true

    return normalizeCustomModeFields({

      ...m,

      ...patch,

      updatedAt: new Date().toISOString(),

    })

  })

  return { modes: next, changed }

}



/**

 * One-time: split legacy bundled Scam Watchdog searchFocus (chat + scan JSON) into chat-only.

 * Does not overwrite user-edited chat-only text.

 */

export function backfillScamWatchdogChatOnlySearchFocus(modes: CustomModeDefinition[]): {

  modes: CustomModeDefinition[]

  changed: boolean

} {

  let changed = false

  const next = modes.map((m) => {

    if (m.id !== BUILTIN_SCAM_WATCHDOG_ID) return m

    const current = m.searchFocus?.trim() ?? ''

    const chatOnly = scamWatchdogSearchFocusToChatOnly(current)

    if (chatOnly == null || chatOnly === current) return m

    changed = true

    return normalizeCustomModeFields({

      ...m,

      searchFocus: chatOnly,

      updatedAt: new Date().toISOString(),

    })

  })

  return { modes: next, changed }

}



/** @deprecated Use backfillEmptyScamWatchdogFields */

export function backfillEmptyScamWatchdogSearchFocus(modes: CustomModeDefinition[]): {

  modes: CustomModeDefinition[]

  changed: boolean

} {

  return backfillEmptyScamWatchdogFields(modes)

}


