import { describe, it, expect } from 'vitest'
import { isUserOwnedCustomMode, normalizeCustomModeFields } from '../customModeTypes'
import { createDefaultScamWatchdogBuiltInMode } from '../scamWatchdogBuiltIn'

describe('isUserOwnedCustomMode', () => {
  it('returns true for custom:* modes', () => {
    const mode = normalizeCustomModeFields({
      id: 'custom:test',
      type: 'custom',
      name: 'Mine',
    })
    expect(isUserOwnedCustomMode(mode)).toBe(true)
  })

  it('excludes Scam Watchdog built-in', () => {
    expect(isUserOwnedCustomMode(createDefaultScamWatchdogBuiltInMode())).toBe(false)
  })

  it('excludes built-in type and deletable:false rows', () => {
    const builtIn = normalizeCustomModeFields({
      id: 'built-in:other',
      type: 'built-in',
      deletable: false,
      name: 'System',
    })
    expect(isUserOwnedCustomMode(builtIn)).toBe(false)
  })
})
