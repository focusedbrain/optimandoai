import { describe, test, expect, afterEach } from 'vitest'

import {
  AGENT_MAX_REPLACEMENTS,
  AGENT_REPLACEMENT_WINDOW_MS,
  checkReplacementAllowed,
  recordReplacement,
  _resetReplacementBudgetForTest,
} from '../src/pod-replacement-budget.js'

describe('Agent pod replacement budget', () => {
  afterEach(() => {
    _resetReplacementBudgetForTest()
  })

  test('allows replacements under budget', () => {
    const now = 1_000_000
    for (let i = 0; i < AGENT_MAX_REPLACEMENTS; i++) {
      expect(checkReplacementAllowed('ingestor', now + i).allowed).toBe(true)
      recordReplacement('ingestor', now + i)
    }
    const last = checkReplacementAllowed('ingestor', now + AGENT_MAX_REPLACEMENTS + 1)
    expect(last.allowed).toBe(false)
    expect(last.newlyExhausted).toBe(true)
  })

  test('uses 10 minute rolling window', () => {
    expect(AGENT_REPLACEMENT_WINDOW_MS).toBe(600_000)
  })
})
