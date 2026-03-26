/**
 * Pure policy for when `email_sync_state.last_sync_at` must not advance after a sync run.
 *
 * An empty provider list with zero new ingests must not move the incremental anchor (avoids
 * “connected but empty” drift when SEARCH/list returns nothing). Pull-more uses a separate
 * date window; we still advance `last_sync_at` on an empty pull-more page so pagination can finish.
 */
export function shouldSkipAdvancingLastSyncAt(params: {
  pullMore: boolean
  listedFromProvider: number
  newIngestedCount: number
}): boolean {
  const { pullMore, listedFromProvider, newIngestedCount } = params
  return !pullMore && listedFromProvider === 0 && newIngestedCount === 0
}
