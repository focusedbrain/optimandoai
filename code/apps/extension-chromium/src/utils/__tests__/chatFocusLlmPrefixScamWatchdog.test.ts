import { describe, it, expect } from 'vitest'
import { BUILTIN_SCAM_WATCHDOG_ID } from '../../shared/ui/scamWatchdogBuiltIn'
import { SCAM_WATCHDOG_CHAT_INSTRUCTION } from '../../shared/ui/watchdogPrompts'
import { getChatFocusLlmPrefix } from '../chatFocusLlmPrefix'

describe('chatFocusLlmPrefix Scam Watchdog', () => {
  it('returns chat instruction when Scam Watchdog focus is active via custom-automation', () => {
    const prefix = getChatFocusLlmPrefix({
      chatFocusMode: {
        mode: 'custom-automation',
        modeId: BUILTIN_SCAM_WATCHDOG_ID,
        modeName: 'Scam Watchdog',
        startedAt: new Date().toISOString(),
      },
      focusMeta: null,
    })
    expect(prefix).toContain(SCAM_WATCHDOG_CHAT_INSTRUCTION)
    expect(prefix).not.toContain('Respond ONLY with a JSON object')
  })
})
