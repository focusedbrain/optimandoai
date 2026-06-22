/**
 * Built-in Scam Watchdog — schema helpers and LLM prefix (extension).
 */

import { describe, it, expect } from 'vitest'
import {
  BUILTIN_SCAM_WATCHDOG_ID,
  createDefaultScamWatchdogBuiltInMode,
  isScamWatchdogBuiltInMode,
} from '../scamWatchdogBuiltIn'
import { isModeDeletable } from '../customModeTypes'
import { getCustomModeLlmPrefix } from '../../../utils/customModeLlmPrefix'
import { customModeDefinitionToRuntime } from '../customModeRuntime'
import { getEffectiveLlmModelNameForActiveMode } from '../../../stores/activeCustomModeRuntime'

describe('scamWatchdogBuiltIn schema', () => {
  it('default built-in has empty model slot and non-deletable type', () => {
    const mode = createDefaultScamWatchdogBuiltInMode()
    expect(mode.id).toBe(BUILTIN_SCAM_WATCHDOG_ID)
    expect(mode.type).toBe('built-in')
    expect(mode.builtInKey).toBe('scam-watchdog')
    expect(mode.deletable).toBe(false)
    expect(mode.modelName).toBe('')
    expect(isScamWatchdogBuiltInMode(mode)).toBe(true)
    expect(isModeDeletable(mode)).toBe(false)
  })

  it('searchFocus folds into custom-mode LLM prefix pipeline', () => {
    const mode = createDefaultScamWatchdogBuiltInMode()
    const prefix = getCustomModeLlmPrefix(customModeDefinitionToRuntime(mode))
    expect(prefix).toContain('[Mode focus:')
    expect(prefix).toMatch(/scam|fraud|phishing/i)
  })

  it('empty modelName defers to WR Chat picker fallback', () => {
    const mode = createDefaultScamWatchdogBuiltInMode()
    const runtime = customModeDefinitionToRuntime(mode)
    expect(runtime.modelName).toBe('')
    // Runtime helper: empty override → fallback ref/state
    expect(getEffectiveLlmModelNameForActiveMode('', 'picker-model')).toBe('picker-model')
  })
})
