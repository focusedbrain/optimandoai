import { describe, it, expect } from 'vitest'
import {
  BUILTIN_SCAM_WATCHDOG_ID,
  createDefaultScamWatchdogBuiltInMode,
} from '../../../../../extension-chromium/src/shared/ui/scamWatchdogBuiltIn'
import { normalizeCustomModeFields } from '../../../../../extension-chromium/src/shared/ui/customModeTypes'
import { backfillEmptyScamWatchdogFields, ensureBuiltInModes } from '../builtInModes'

describe('builtInModes', () => {
  it('backfillEmptyScamWatchdogFields populates empty searchFocus from seed', () => {
    const empty = normalizeCustomModeFields({
      ...createDefaultScamWatchdogBuiltInMode(),
      searchFocus: '',
    })
    const { modes, changed } = backfillEmptyScamWatchdogFields([empty])
    expect(changed).toBe(true)
    expect(modes[0].searchFocus.trim().length).toBeGreaterThan(0)
    expect(modes[0].searchFocus).toBe(createDefaultScamWatchdogBuiltInMode().searchFocus)
  })

  it('backfillEmptyScamWatchdogFields populates generic default icon with seed dog emoji', () => {
    const genericIcon = normalizeCustomModeFields({
      ...createDefaultScamWatchdogBuiltInMode(),
      icon: '',
    })
    expect(genericIcon.icon).toBe('⚡')
    const { modes, changed } = backfillEmptyScamWatchdogFields([genericIcon])
    expect(changed).toBe(true)
    expect(modes[0].icon).toBe(createDefaultScamWatchdogBuiltInMode().icon)
  })

  it('backfillEmptyScamWatchdogFields does not overwrite user-edited searchFocus', () => {
    const edited = normalizeCustomModeFields({
      ...createDefaultScamWatchdogBuiltInMode(),
      searchFocus: 'My custom scam rules',
    })
    const { modes, changed } = backfillEmptyScamWatchdogFields([edited])
    expect(changed).toBe(false)
    expect(modes[0].searchFocus).toBe('My custom scam rules')
  })

  it('backfillEmptyScamWatchdogFields does not overwrite user-customized icon', () => {
    const edited = normalizeCustomModeFields({
      ...createDefaultScamWatchdogBuiltInMode(),
      icon: '🛡️',
    })
    const { modes, changed } = backfillEmptyScamWatchdogFields([edited])
    expect(changed).toBe(false)
    expect(modes[0].icon).toBe('🛡️')
  })

  it('ensureBuiltInModes inserts missing built-in without duplicating', () => {
    const first = ensureBuiltInModes([])
    expect(first.some((m) => m.id === BUILTIN_SCAM_WATCHDOG_ID)).toBe(true)
    const second = ensureBuiltInModes(first)
    expect(second.filter((m) => m.id === BUILTIN_SCAM_WATCHDOG_ID)).toHaveLength(1)
  })
})
