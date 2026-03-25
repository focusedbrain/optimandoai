import { describe, expect, it } from 'vitest'
import type { SessionReviewMessageRow } from './inboxSessionReviewOpen'
import {
  aggregateReceivedByDay,
  aggregateReplyNeededForSessionReview,
  aggregateTopSenders,
  formatSessionReviewReceivedAtShort,
} from './autoSortSessionReviewCharts'

function row(partial: Partial<SessionReviewMessageRow> & { id: string }): SessionReviewMessageRow {
  return {
    id: partial.id,
    received_at: partial.received_at,
    sort_category: partial.sort_category,
    urgency_score: partial.urgency_score,
    needs_reply: partial.needs_reply,
    from_name: partial.from_name,
    from_address: partial.from_address,
    subject: partial.subject,
    pending_delete: partial.pending_delete,
    pending_review_at: partial.pending_review_at,
    archived: partial.archived,
    sort_reason: partial.sort_reason,
  }
}

describe('formatSessionReviewReceivedAtShort', () => {
  it('returns em dash for null, empty, whitespace, and invalid ISO', () => {
    expect(formatSessionReviewReceivedAtShort(null)).toBe('—')
    expect(formatSessionReviewReceivedAtShort(undefined)).toBe('—')
    expect(formatSessionReviewReceivedAtShort('')).toBe('—')
    expect(formatSessionReviewReceivedAtShort('   ')).toBe('—')
    expect(formatSessionReviewReceivedAtShort('not-a-date')).toBe('—')
  })

  it('formats a valid ISO string without throwing', () => {
    const s = formatSessionReviewReceivedAtShort('2024-06-15T14:30:00.000Z')
    expect(s).not.toBe('—')
    expect(s.length).toBeGreaterThan(4)
  })
})

describe('aggregateReplyNeededForSessionReview', () => {
  it('returns empty when there are no messages', () => {
    expect(aggregateReplyNeededForSessionReview([])).toEqual([])
  })

  it('counts needs_reply=1 vs everything else as no reply', () => {
    const out = aggregateReplyNeededForSessionReview([
      row({ id: '1', needs_reply: 1 }),
      row({ id: '2', needs_reply: 0 }),
      row({ id: '3', needs_reply: null }),
    ])
    const need = out.find((x) => x.name === 'Reply needed')
    const no = out.find((x) => x.name === 'No reply')
    expect(need?.value).toBe(1)
    expect(no?.value).toBe(2)
  })

  it('omits slices with zero count (all need reply)', () => {
    const out = aggregateReplyNeededForSessionReview([
      row({ id: '1', needs_reply: 1 }),
      row({ id: '2', needs_reply: 1 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Reply needed')
    expect(out[0].value).toBe(2)
  })
})

describe('aggregateTopSenders', () => {
  it('uses Unknown when sender fields missing', () => {
    const out = aggregateTopSenders([row({ id: 'a' }), row({ id: 'b' })])
    const unk = out.find((x) => x.name === 'Unknown')
    expect(unk?.count).toBe(2)
  })

  it('prefers trimmed from_name over from_address', () => {
    const out = aggregateTopSenders([
      row({ id: '1', from_name: ' Acme ', from_address: 'x@y.com' }),
      row({ id: '2', from_name: ' Acme ', from_address: 'z@z.com' }),
    ])
    const acme = out.find((x) => x.name === 'Acme')
    expect(acme?.count).toBe(2)
  })

  it('falls back to address when name empty', () => {
    const out = aggregateTopSenders([
      row({ id: '1', from_name: '  ', from_address: 'only@mail.test' }),
    ])
    expect(out.some((x) => x.name.includes('only@mail.test'))).toBe(true)
  })

  it('does not throw on empty strings and aggregates Other past cap', () => {
    const rows: SessionReviewMessageRow[] = []
    for (let i = 0; i < 10; i++) {
      rows.push(row({ id: String(i), from_name: `Sender ${i}`, from_address: '' }))
    }
    const out = aggregateTopSenders(rows)
    expect(out.some((x) => x.name === 'Other')).toBe(true)
    expect(out.reduce((s, x) => s + x.count, 0)).toBe(10)
  })
})

describe('aggregateReceivedByDay', () => {
  it('returns empty when no valid received_at', () => {
    expect(aggregateReceivedByDay([row({ id: '1' })])).toEqual([])
    expect(aggregateReceivedByDay([row({ id: '1', received_at: '' })])).toEqual([])
    expect(aggregateReceivedByDay([row({ id: '1', received_at: 'not-a-date' })])).toEqual([])
  })

  it('rolls days beyond cap into Older days and preserves total count', () => {
    const rows: SessionReviewMessageRow[] = []
    for (let d = 1; d <= 8; d++) {
      rows.push(
        row({
          id: String(d),
          received_at: `2025-03-${String(d).padStart(2, '0')}T12:00:00.000Z`,
        }),
      )
    }
    const out = aggregateReceivedByDay(rows)
    const older = out.find((x) => x.name === 'Older days')
    expect(older).toBeDefined()
    expect(older!.count).toBe(3)
    expect(out.reduce((s, x) => s + x.count, 0)).toBe(8)
  })
})
