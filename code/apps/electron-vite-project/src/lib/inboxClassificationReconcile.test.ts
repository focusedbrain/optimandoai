import { describe, expect, it } from 'vitest'
import {
  combinedClassificationText,
  detectPromotionalAndHighStakes,
  reconcileAnalyzeTriage,
  reconcileInboxClassification,
} from './inboxClassificationReconcile'

describe('inboxClassificationReconcile', () => {
  const ctx = { subject: 'Sale!', body: 'Click here for 50% off.' }

  it('detects promotional Kleinanzeigen-style + "no clear action required" explanation', () => {
    const t = combinedClassificationText({
      reason: 'Promotional offer without clear action required or relevant content',
      summary: 'Unsolicited commercial email',
      ...ctx,
    })
    const d = detectPromotionalAndHighStakes(t)
    expect(d.promotional).toBe(true)
    expect(d.highStakes).toBe(false)
  })

  it('does not treat invoice overdue as promotional', () => {
    const t = combinedClassificationText({
      reason: 'Invoice #12 is overdue; pay within 48 hours.',
      summary: 'Payment reminder',
      subject: 'Invoice overdue',
      body: 'Please remit payment.',
    })
    const d = detectPromotionalAndHighStakes(t)
    expect(d.highStakes).toBe(true)
  })

  it('reconciles contradictory urgent + promotional → pending_delete, urgency ≤3, no reply', () => {
    const out = reconcileInboxClassification(
      {
        category: 'urgent',
        urgency: 10,
        needsReply: true,
        reason: 'Promotional offer without clear action required.',
        summary: 'Marketing blast',
      },
      { subject: 'Mit uns erreichen Sie über 30 Mio. Nutzer!', body: 'Profitieren Sie optimal.' }
    )
    expect(out.category).toBe('pending_delete')
    expect(out.urgency).toBeLessThanOrEqual(3)
    expect(out.needsReply).toBe(false)
  })

  it('reconciles action_required + promotional → pending_delete', () => {
    const out = reconcileInboxClassification(
      {
        category: 'action_required',
        urgency: 6,
        needsReply: true,
        reason: 'Newsletter with special offer.',
        summary: '—',
      },
      ctx
    )
    expect(out.category).toBe('pending_delete')
    expect(out.urgency).toBeLessThanOrEqual(3)
    expect(out.needsReply).toBe(false)
  })

  it('does not downgrade genuine urgent legal + promotional-looking subject', () => {
    const out = reconcileInboxClassification(
      {
        category: 'urgent',
        urgency: 9,
        needsReply: true,
        reason: 'Court filing deadline next week; response required.',
        summary: 'Legal notice',
      },
      { subject: 'Limited time offer — legal summons enclosed', body: 'You must appear...' }
    )
    expect(out.category).toBe('urgent')
    expect(out.urgency).toBe(9)
    expect(out.needsReply).toBe(true)
  })

  it('reconcileAnalyzeTriage caps urgency for promotional analyze output', () => {
    const tri = reconcileAnalyzeTriage(
      {
        urgencyScore: 10,
        needsReply: true,
        urgencyReason: 'Unsolicited commercial email.',
        summary: 'Advertisement',
      },
      ctx
    )
    expect(tri.urgencyScore).toBeLessThanOrEqual(3)
    expect(tri.needsReply).toBe(false)
  })

  it('leaves normal non-promotional mail unchanged', () => {
    const out = reconcileInboxClassification(
      {
        category: 'normal',
        urgency: 5,
        needsReply: false,
        reason: 'FYI from colleague.',
        summary: 'Project update',
      },
      { subject: 'Weekly sync', body: 'Here is the deck.' }
    )
    expect(out.category).toBe('normal')
    expect(out.urgency).toBe(5)
  })

  const beapWeight = { nativeBeap: true, depackagedEmail: false, handshakeLinked: false } as const
  const hsWeight = { nativeBeap: false, depackagedEmail: false, handshakeLinked: true } as const
  const plainWeight = { nativeBeap: false, depackagedEmail: true, handshakeLinked: false } as const

  it('Native BEAP softens promotional pending_delete to pending_review', () => {
    const out = reconcileInboxClassification(
      {
        category: 'urgent',
        urgency: 10,
        needsReply: true,
        reason: 'Promotional offer without clear action required.',
        summary: 'Marketing blast',
      },
      { subject: '50% off sale', body: 'Unsubscribe link below.' },
      beapWeight
    )
    expect(out.category).toBe('pending_review')
    expect(out.urgency).toBeGreaterThanOrEqual(4)
  })

  it('Handshake-linked bumps archive to pending_review when non-promotional', () => {
    const out = reconcileInboxClassification(
      {
        category: 'archive',
        urgency: 2,
        needsReply: false,
        reason: 'Reference newsletter digest.',
        summary: 'Weekly roundup',
      },
      { subject: 'Digest', body: 'Here are the links.' },
      hsWeight
    )
    expect(out.category).toBe('pending_review')
    expect(out.urgency).toBeGreaterThanOrEqual(4)
  })

  it('Depackaged + promotional + archive becomes pending_review', () => {
    const out = reconcileInboxClassification(
      {
        category: 'archive',
        urgency: 2,
        needsReply: false,
        reason: 'Newsletter with special offer.',
        summary: 'Promotional',
      },
      ctx,
      plainWeight
    )
    expect(out.category).toBe('pending_review')
  })
})
