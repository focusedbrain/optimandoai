import { describe, it, expect } from 'vitest'
import {
  SCAM_WATCHDOG_CHAT_INSTRUCTION,
  SCAM_WATCHDOG_DEFAULT_SEARCH_FOCUS,
  SCAM_WATCHDOG_LEGACY_BUNDLED_SEARCH_FOCUS,
  WATCHDOG_SYSTEM_PROMPT,
  extractScamWatchdogScanPromptFromLegacySearchFocus,
  scamWatchdogSearchFocusToChatOnly,
} from '../watchdogPrompts'

describe('watchdogPrompts chat/scan split', () => {
  it('default searchFocus is chat-only', () => {
    expect(SCAM_WATCHDOG_DEFAULT_SEARCH_FOCUS).toBe(SCAM_WATCHDOG_CHAT_INSTRUCTION)
    expect(SCAM_WATCHDOG_DEFAULT_SEARCH_FOCUS).not.toContain('Respond ONLY with a JSON object')
  })

  it('extracts scan prompt from legacy bundled searchFocus', () => {
    const scan = extractScamWatchdogScanPromptFromLegacySearchFocus(SCAM_WATCHDOG_LEGACY_BUNDLED_SEARCH_FOCUS)
    expect(scan).toContain('"threats"')
    expect(scan).toContain('Respond ONLY with a JSON object')
  })

  it('backfill reduces legacy bundle to chat-only', () => {
    expect(scamWatchdogSearchFocusToChatOnly(SCAM_WATCHDOG_LEGACY_BUNDLED_SEARCH_FOCUS)).toBe(
      SCAM_WATCHDOG_CHAT_INSTRUCTION,
    )
  })

  it('does not alter user chat-only edits', () => {
    expect(scamWatchdogSearchFocusToChatOnly('My custom scam rules')).toBeNull()
  })

  it('scan constant unchanged for watchdog path', () => {
    expect(WATCHDOG_SYSTEM_PROMPT).toContain('"threats"')
  })
})
