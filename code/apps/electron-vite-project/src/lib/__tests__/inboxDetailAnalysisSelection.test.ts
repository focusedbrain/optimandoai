import { describe, expect, it, vi, afterEach } from 'vitest'
import {
  INBOX_ANALYSIS_SELECTION_DEBOUNCE_MS,
  resolveSelectionAnalysisRun,
  shouldApplyAnalysisStreamResult,
  shouldTriggerAnalysisOnSelectionChange,
} from '../inboxDetailAnalysisSelection'

describe('inboxDetailAnalysisSelection', () => {
  describe('shouldTriggerAnalysisOnSelectionChange', () => {
    it('runs only when Analysis mode is active', () => {
      expect(shouldTriggerAnalysisOnSelectionChange(true)).toBe(true)
      expect(shouldTriggerAnalysisOnSelectionChange(false)).toBe(false)
    })
  })

  describe('shouldApplyAnalysisStreamResult', () => {
    it('accepts events for the active generation and message', () => {
      expect(
        shouldApplyAnalysisStreamResult({
          runGeneration: 2,
          activeGeneration: 2,
          eventMessageId: 'msg-b',
          panelMessageId: 'msg-b',
        }),
      ).toBe(true)
    })

    it('drops stale generation after rapid switch (A in flight, user on C)', () => {
      expect(
        shouldApplyAnalysisStreamResult({
          runGeneration: 1,
          activeGeneration: 3,
          eventMessageId: 'msg-a',
          panelMessageId: 'msg-c',
        }),
      ).toBe(false)
    })

    it('drops wrong message id even at same generation', () => {
      expect(
        shouldApplyAnalysisStreamResult({
          runGeneration: 2,
          activeGeneration: 2,
          eventMessageId: 'msg-a',
          panelMessageId: 'msg-b',
        }),
      ).toBe(false)
    })
  })

  describe('resolveSelectionAnalysisRun', () => {
    it('invokes manual run when analysis mode active and generation matches', () => {
      expect(
        resolveSelectionAnalysisRun({
          analysisModeActive: true,
          debounceGeneration: 4,
          activeGeneration: 4,
          hasCachedResult: false,
        }),
      ).toEqual({ shouldInvoke: true, manual: true, skipBecauseStale: false })
    })

    it('skips when analysis mode off', () => {
      expect(
        resolveSelectionAnalysisRun({
          analysisModeActive: false,
          debounceGeneration: 1,
          activeGeneration: 1,
          hasCachedResult: true,
        }).shouldInvoke,
      ).toBe(false)
    })

    it('skips stale debounced target after superseding selection', () => {
      expect(
        resolveSelectionAnalysisRun({
          analysisModeActive: true,
          debounceGeneration: 1,
          activeGeneration: 3,
          hasCachedResult: false,
        }),
      ).toEqual({ shouldInvoke: false, manual: false, skipBecauseStale: true })
    })
  })

  describe('debounced selection (rapid A→B→C fires only C)', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('schedules one run after debounce for the last message id', () => {
      vi.useFakeTimers()
      const runs: string[] = []
      let activeGeneration = 0
      let debounceTimer: ReturnType<typeof setTimeout> | null = null
      let debounceGen = 0
      let selectedId = 'msg-a'

      const schedule = (messageId: string) => {
        selectedId = messageId
        activeGeneration += 1
        debounceGen = activeGeneration
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          if (debounceGen !== activeGeneration) return
          if (!shouldTriggerAnalysisOnSelectionChange(true)) return
          runs.push(selectedId)
        }, INBOX_ANALYSIS_SELECTION_DEBOUNCE_MS)
      }

      schedule('msg-a')
      vi.advanceTimersByTime(200)
      schedule('msg-b')
      vi.advanceTimersByTime(200)
      schedule('msg-c')
      vi.advanceTimersByTime(INBOX_ANALYSIS_SELECTION_DEBOUNCE_MS)

      expect(runs).toEqual(['msg-c'])
    })
  })
})
