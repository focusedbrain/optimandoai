/**
 * InboxSecurityPanel & InboxPhishingBadge — P2.5 UI component tests.
 *
 * Uses renderToStaticMarkup (no jsdom) following the ThisDeviceCard pattern.
 * Tests cover:
 *   - No badge when phishing_assessment absent
 *   - Correct badge for each phishing label (high, elevated)
 *   - needs_review badge when crosscheck disagrees
 *   - Disclaimer text verbatim
 *   - Security panel hidden when no data and not loading
 *   - Loading indicator present when loading=true
 */

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  InboxPhishingBadge,
  InboxSecurityPanel,
  SECURITY_DISCLAIMER,
  type InboxPhishingBadgeProps,
  type InboxSecurityPanelProps,
} from '../InboxSecurityPanel'
import type { PhishingAssessmentUi, ValidationCrosscheckUi } from '../../types/inboxAi'

// ── Fixtures ────────────────────────────────────────────────────────────────

const phishingHigh: PhishingAssessmentUi = {
  score: 9,
  label: 'high',
  signals: [{ kind: 'domain_spoof', evidence: 'paypa1.com mimics paypal.com' }],
  flagged_urls: [{ url: 'http://paypa1.com/verify', reason: 'domain spoof' }],
  disclaimer_version: 'v1',
  model: 'gpt-4o',
  generated_at: '2026-05-24T10:00:00Z',
}

const phishingElevated: PhishingAssessmentUi = {
  score: 6,
  label: 'elevated',
  signals: [{ kind: 'urgency_language', evidence: 'Act now or your account will be closed' }],
  flagged_urls: [],
  disclaimer_version: 'v1',
}

const phishingLow: PhishingAssessmentUi = {
  score: 2,
  label: 'low',
  signals: [],
  flagged_urls: [],
  disclaimer_version: 'v1',
}

const crosscheckDisagrees: ValidationCrosscheckUi = {
  agrees_with_validator: false,
  findings: [{ kind: 'header_anomaly', evidence: 'SPF pass but DKIM fail' }],
  confidence: 'medium',
}

const crosscheckAgrees: ValidationCrosscheckUi = {
  agrees_with_validator: true,
  findings: [],
  confidence: 'high',
}

// ── InboxPhishingBadge ───────────────────────────────────────────────────────

describe('InboxPhishingBadge', () => {
  it('renders nothing when no phishing_assessment and no crosscheck', () => {
    const html = renderToStaticMarkup(<InboxPhishingBadge />)
    expect(html).toBe('')
  })

  it('renders nothing when phishing label is low and crosscheck agrees', () => {
    const html = renderToStaticMarkup(<InboxPhishingBadge phishing={phishingLow} crosscheck={crosscheckAgrees} />)
    expect(html).toBe('')
  })

  it('renders red "phishing risk" badge for high label', () => {
    const html = renderToStaticMarkup(<InboxPhishingBadge phishing={phishingHigh} />)
    expect(html).toContain('phishing risk')
    expect(html).toContain('phishing-badge-high')
    expect(html).not.toContain('phishing-badge-elevated')
    expect(html).not.toContain('needs review')
  })

  it('renders yellow "phishing risk" badge for elevated label', () => {
    const html = renderToStaticMarkup(<InboxPhishingBadge phishing={phishingElevated} />)
    expect(html).toContain('phishing risk')
    expect(html).toContain('phishing-badge-elevated')
    expect(html).not.toContain('phishing-badge-high')
    expect(html).not.toContain('needs review')
  })

  it('renders grey "needs review" badge when crosscheck disagrees and no phishing label', () => {
    const html = renderToStaticMarkup(<InboxPhishingBadge crosscheck={crosscheckDisagrees} />)
    expect(html).toContain('needs review')
    expect(html).toContain('phishing-badge-needs-review')
    expect(html).not.toContain('phishing risk')
  })

  it('renders phishing risk badge (high) taking precedence over needs_review', () => {
    const html = renderToStaticMarkup(
      <InboxPhishingBadge phishing={phishingHigh} crosscheck={crosscheckDisagrees} />,
    )
    expect(html).toContain('phishing risk')
    expect(html).toContain('phishing-badge-high')
    expect(html).not.toContain('needs review')
  })
})

// ── InboxSecurityPanel ───────────────────────────────────────────────────────

describe('InboxSecurityPanel', () => {
  it('renders nothing when no data and not loading', () => {
    const html = renderToStaticMarkup(<InboxSecurityPanel />)
    expect(html).toBe('')
  })

  it('shows loading indicator when loading=true with no data', () => {
    const html = renderToStaticMarkup(<InboxSecurityPanel loading />)
    expect(html).toContain('analyzing security signals')
    expect(html).toContain('security-panel')
  })

  it('renders disclaimer text verbatim (snapshot)', () => {
    const html = renderToStaticMarkup(<InboxSecurityPanel phishing={phishingHigh} />)
    expect(html).toContain(SECURITY_DISCLAIMER)
    expect(html).toContain(
      'AI phishing analysis can miss attacks. Open links only via the sandbox orchestrator. Do not enter credentials based on email contents.',
    )
  })

  it('renders phishing score and label', () => {
    const html = renderToStaticMarkup(<InboxSecurityPanel phishing={phishingHigh} />)
    expect(html).toContain('high')
    expect(html).toContain('Score 9/10')
    expect(html).toContain('strong indicators')
  })

  it('renders signals list', () => {
    const html = renderToStaticMarkup(<InboxSecurityPanel phishing={phishingHigh} />)
    expect(html).toContain('domain_spoof')
    expect(html).toContain('paypa1.com mimics paypal.com')
  })

  it('renders flagged URL with disabled sandbox button', () => {
    const html = renderToStaticMarkup(<InboxSecurityPanel phishing={phishingHigh} />)
    expect(html).toContain('http://paypa1.com/verify')
    expect(html).toContain('Open in sandbox')
    expect(html).toContain('disabled')
  })

  it('renders crosscheck disagreement section when crosscheck disagrees', () => {
    const html = renderToStaticMarkup(
      <InboxSecurityPanel phishing={phishingLow} crosscheck={crosscheckDisagrees} />,
    )
    expect(html).toContain('needs review')
    expect(html).toContain('AI disagrees with validator outcome')
    expect(html).toContain('header_anomaly')
  })

  it('does not render crosscheck section when crosscheck agrees', () => {
    const html = renderToStaticMarkup(
      <InboxSecurityPanel phishing={phishingLow} crosscheck={crosscheckAgrees} />,
    )
    expect(html).not.toContain('AI disagrees with validator outcome')
  })
})

// ── Constant ─────────────────────────────────────────────────────────────────

describe('SECURITY_DISCLAIMER', () => {
  it('is byte-identical to the strategy §6.1 wording', () => {
    expect(SECURITY_DISCLAIMER).toBe(
      'AI phishing analysis can miss attacks. Open links only via the sandbox orchestrator. Do not enter credentials based on email contents.',
    )
  })
})
