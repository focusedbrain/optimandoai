/**
 * Local lifecycle tick — mocks remote side effects (no gateway / SQLite file).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../remoteDeletion', () => ({
  executePendingDeletions: vi.fn(async () => ({ executed: 0, failed: 0 })),
  queueRemoteDeletion: vi.fn(() => ({ ok: true })),
}))

const { enqueueMock, scheduleDrainMock } = vi.hoisted(() => ({
  enqueueMock: vi.fn(() => ({ enqueued: 2, skipped: 0 })),
  scheduleDrainMock: vi.fn(),
}))

vi.mock('../inboxOrchestratorRemoteQueue', () => ({
  enqueueOrchestratorRemoteMutations: enqueueMock,
  scheduleOrchestratorRemoteDrain: scheduleDrainMock,
}))

import { runInboxLifecycleTick, PENDING_REVIEW_RETENTION_MS, PENDING_DELETE_RETENTION_MS } from '../inboxLifecycleEngine'
import { queueRemoteDeletion } from '../remoteDeletion'

describe('inbox lifecycle timing constants', () => {
  it('uses 14d pending review and 7d pending delete retention windows', () => {
    const day = 24 * 60 * 60 * 1000
    expect(PENDING_REVIEW_RETENTION_MS).toBe(14 * day)
    expect(PENDING_DELETE_RETENTION_MS).toBe(7 * day)
  })

  it('review SQL cutoff matches UTC wall clock minus 14 days (frozen time)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-03-20T12:00:00.000Z'))
    const expected = new Date(Date.now() - PENDING_REVIEW_RETENTION_MS).toISOString()
    expect(expected).toBe('2025-03-06T12:00:00.000Z')
    vi.useRealTimers()
  })
})

describe('runInboxLifecycleTick', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-04-10T00:00:00.000Z'))
    enqueueMock.mockClear()
    scheduleDrainMock.mockClear()
    vi.mocked(queueRemoteDeletion).mockReturnValue({ ok: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createDb(opts: { reviewIds?: string[]; deleteIds?: string[] }) {
    const reviewCutoffCapture: string[] = []
    const deleteCutoffCapture: string[] = []
    const promotionRuns: unknown[][] = []

    const db = {
      prepare: vi.fn((sql: string) => {
        if (sql.includes('SELECT id FROM inbox_messages') && sql.includes('pending_review')) {
          return {
            all: (cutoff: string) => {
              reviewCutoffCapture.push(cutoff)
              return (opts.reviewIds ?? []).map((id) => ({ id }))
            },
          }
        }
        if (sql.includes('pending_delete = 1') && sql.includes('lifecycle_exited_review')) {
          return {
            run: (...args: unknown[]) => {
              promotionRuns.push(args)
            },
          }
        }
        if (sql.includes('SELECT m.id FROM inbox_messages m') && sql.includes('deletion_queue')) {
          return {
            all: (cutoff: string) => {
              deleteCutoffCapture.push(cutoff)
              return (opts.deleteIds ?? []).map((id) => ({ id }))
            },
          }
        }
        if (sql.includes('lifecycle_final_delete_queued_utc')) {
          return { run: vi.fn() }
        }
        throw new Error(`Unexpected SQL in lifecycle mock: ${sql.slice(0, 70)}`)
      }),
      transaction: (fn: () => void) => () => fn(),
    }

    return { db, reviewCutoffCapture, deleteCutoffCapture, promotionRuns }
  }

  it('returns error bucket when db is missing', async () => {
    const r = await runInboxLifecycleTick(null)
    expect(r.errors).toContain('no_database')
    expect(r.promotedReviewToPendingDelete).toBe(0)
  })

  it('passes 14d cutoff into pending_review promotion query', async () => {
    const { db, reviewCutoffCapture } = createDb({ reviewIds: [] })
    await runInboxLifecycleTick(db)
    expect(reviewCutoffCapture).toHaveLength(1)
    expect(reviewCutoffCapture[0]).toBe(new Date(Date.now() - PENDING_REVIEW_RETENTION_MS).toISOString())
  })

  it('promotes stale pending_review rows locally and enqueues remote pending_delete', async () => {
    const { db, promotionRuns } = createDb({ reviewIds: ['r1', 'r2'] })
    const r = await runInboxLifecycleTick(db)
    expect(r.promotedReviewToPendingDelete).toBe(2)
    expect(promotionRuns).toHaveLength(2)
    expect(enqueueMock).toHaveBeenCalledWith(db, ['r1', 'r2'], 'pending_delete')
    expect(scheduleDrainMock).toHaveBeenCalled()
    expect(r.remoteEnqueuedAfterReviewPromotion).toBe(2)
  })

  it('queues final deletion when pending_delete_at past 7d cutoff', async () => {
    const { db, deleteCutoffCapture } = createDb({ deleteIds: ['d1'] })
    const r = await runInboxLifecycleTick(db)
    expect(deleteCutoffCapture).toHaveLength(1)
    expect(deleteCutoffCapture[0]).toBe(new Date(Date.now() - PENDING_DELETE_RETENTION_MS).toISOString())
    expect(queueRemoteDeletion).toHaveBeenCalledWith(db, 'd1', 0)
    expect(r.promotedPendingDeleteToFinalQueue).toBe(1)
  })
})
