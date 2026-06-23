import { describe, it, expect } from 'vitest'
import { initialUIState } from '../uiState'
import { BUILTIN_SCAM_WATCHDOG_ID } from '../scamWatchdogBuiltIn'

describe('uiState defaults', () => {
  it('defaults WR Chat mode to built-in Scam Watchdog', () => {
    expect(initialUIState.workspace).toBe('wr-chat')
    expect(initialUIState.mode).toBe(BUILTIN_SCAM_WATCHDOG_ID)
  })
})
