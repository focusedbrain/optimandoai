import { describe, expect, it } from 'vitest'
import { workflowFilterFromSessionReviewRow } from './inboxSessionReviewOpen'

describe('workflowFilterFromSessionReviewRow', () => {
  it('maps archived rows to archived tab', () => {
    expect(
      workflowFilterFromSessionReviewRow({
        archived: 1,
        pending_delete: 0,
        sort_category: 'normal',
        urgency_score: 3,
      }),
    ).toBe('archived')
  })

  it('maps pending_delete to pending_delete tab even when other flags look active', () => {
    expect(
      workflowFilterFromSessionReviewRow({
        archived: 0,
        pending_delete: 1,
        sort_category: 'spam',
        urgency_score: 2,
      }),
    ).toBe('pending_delete')
  })

  it('maps sort_category urgent to urgent tab', () => {
    expect(
      workflowFilterFromSessionReviewRow({
        archived: 0,
        pending_delete: 0,
        sort_category: 'urgent',
        urgency_score: 8,
      }),
    ).toBe('urgent')
  })

  it('maps high urgency score to urgent tab', () => {
    expect(
      workflowFilterFromSessionReviewRow({
        archived: 0,
        pending_delete: 0,
        sort_category: 'normal',
        urgency_score: 9,
      }),
    ).toBe('urgent')
  })

  it('maps pending_review category to pending_review tab', () => {
    expect(
      workflowFilterFromSessionReviewRow({
        archived: 0,
        pending_delete: 0,
        sort_category: 'pending_review',
        urgency_score: 4,
      }),
    ).toBe('pending_review')
  })

  it('uses all tab as default for normal inbox rows', () => {
    expect(
      workflowFilterFromSessionReviewRow({
        archived: 0,
        pending_delete: 0,
        sort_category: 'normal',
        urgency_score: 4,
      }),
    ).toBe('all')

    expect(
      workflowFilterFromSessionReviewRow({
        archived: 0,
        pending_delete: 0,
        sort_category: null,
        urgency_score: null,
      }),
    ).toBe('all')
  })

  it('archived wins over pending_delete in precedence', () => {
    expect(
      workflowFilterFromSessionReviewRow({
        archived: 1,
        pending_delete: 1,
        sort_category: 'spam',
        urgency_score: 2,
      }),
    ).toBe('archived')
  })
})
