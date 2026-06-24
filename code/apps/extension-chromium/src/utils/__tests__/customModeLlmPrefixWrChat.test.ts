import { describe, it, expect } from 'vitest'
import { createDefaultScamWatchdogBuiltInMode } from '../../shared/ui/scamWatchdogBuiltIn'
import { customModeDefinitionToRuntime } from '../../shared/ui/customModeRuntime'
import { WATCHDOG_SYSTEM_PROMPT } from '../../shared/ui/watchdogPrompts'
import { getCustomModeLlmPrefix, getCustomModeLlmPrefixForWrChat } from '../customModeLlmPrefix'

describe('getCustomModeLlmPrefixForWrChat', () => {
  it('does not inject Scam Watchdog scan JSON contract into WR Chat', () => {
    const mode = createDefaultScamWatchdogBuiltInMode()
    const full = getCustomModeLlmPrefix(customModeDefinitionToRuntime(mode))
    const chat = getCustomModeLlmPrefixForWrChat(customModeDefinitionToRuntime(mode))
    expect(full).toMatch(/scam|fraud|phishing/i)
    expect(full).not.toContain('Respond ONLY with a JSON object')
    expect(chat).toBeNull()
  })

  it('does not inject custom mode searchFocus analysis into WR Chat', () => {
    const runtime = customModeDefinitionToRuntime({
      id: 'custom:x',
      type: 'custom',
      name: 'Invoices',
      searchFocus: 'Find overdue invoices and respond ONLY with JSON {"threats":[]}',
      systemInstructions: 'You are an invoice detector.',
      modelProvider: 'ollama',
      modelName: '',
      endpoint: '',
      sessionId: null,
      sessionMode: 'shared',
      ignoreInstructions: '',
      intervalSeconds: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    expect(getCustomModeLlmPrefix(runtime)).toContain('Find overdue invoices')
    expect(getCustomModeLlmPrefixForWrChat(runtime)).toBeNull()
  })

  it('still includes profileFields context in WR Chat prefix', () => {
    const runtime = customModeDefinitionToRuntime({
      id: 'custom:y',
      type: 'custom',
      name: 'Ctx',
      searchFocus: 'analysis-only',
      profileFields: [{ key: 'loc', label: 'Location', value: 'EU', usage: 'context' }],
      modelProvider: 'ollama',
      modelName: '',
      endpoint: '',
      sessionId: null,
      sessionMode: 'shared',
      ignoreInstructions: '',
      intervalSeconds: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const chat = getCustomModeLlmPrefixForWrChat(runtime)
    expect(chat).toContain('[User-provided context]')
    expect(chat).not.toContain('analysis-only')
    expect(chat).not.toContain(WATCHDOG_SYSTEM_PROMPT.slice(0, 40))
  })
})
