import { describe, it, expect } from 'vitest'
import { shouldSkipAdvancingLastSyncAt } from './syncLastSyncAnchorPolicy'

describe('shouldSkipAdvancingLastSyncAt', () => {
  it('skips advance on incremental (or bootstrap) when list is empty and nothing ingested — regression: IMAP empty list must not move last_sync_at', () => {
    expect(
      shouldSkipAdvancingLastSyncAt({
        pullMore: false,
        listedFromProvider: 0,
        newIngestedCount: 0,
      }),
    ).toBe(true)
  })

  it('does not skip on pull-more when list is empty (allow anchor advance so history pagination completes)', () => {
    expect(
      shouldSkipAdvancingLastSyncAt({
        pullMore: true,
        listedFromProvider: 0,
        newIngestedCount: 0,
      }),
    ).toBe(false)
  })

  it('does not skip when provider listed messages even if all were duplicates (newIngestedCount 0)', () => {
    expect(
      shouldSkipAdvancingLastSyncAt({
        pullMore: false,
        listedFromProvider: 3,
        newIngestedCount: 0,
      }),
    ).toBe(false)
  })
})
