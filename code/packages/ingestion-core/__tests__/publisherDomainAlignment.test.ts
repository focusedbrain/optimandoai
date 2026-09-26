/**
 * 3C — sender-domain ↔ publisher-domain alignment [IX.3.1 r7].
 *
 * The property that matters is the ratchet: this stage runs after a CPR
 * already exists, so it must be able to raise friction and be structurally
 * unable to lower it.
 */
import { describe, expect, test } from 'vitest'
import {
  applyPublisherDomainAlignment,
  channelAlertRequired,
  createChannelProvenanceRecord,
  domainWithinOrigin,
  evaluatePublisherDomainAlignment,
} from '../src/channelProvenance.js'

const SHA = 'a'.repeat(64)
const AT = '2026-08-08T12:00:00.000Z'
const LATER = '2026-08-08T13:00:00.000Z'

const authenticated = (domain: string, from = domain) =>
  createChannelProvenanceRecord({
    contentSha256: SHA,
    material: {
      authenticationResults: [`mx.test; dkim=pass header.d=${domain}; dmarc=pass header.from=${from}`],
      fromDomain: from,
    },
    evaluatedAt: AT,
  })

describe('domainWithinOrigin', () => {
  test('matches the origin itself and true subdomains only', () => {
    expect(domainWithinOrigin('example.com', 'example.com')).toBe(true)
    expect(domainWithinOrigin('mail.example.com', 'example.com')).toBe(true)
    expect(domainWithinOrigin('EXAMPLE.com.', 'example.com')).toBe(true)
    // The label boundary is what stops the classic suffix confusion.
    expect(domainWithinOrigin('evil-example.com', 'example.com')).toBe(false)
    expect(domainWithinOrigin('exampleXcom', 'example.com')).toBe(false)
    expect(domainWithinOrigin('example.com.evil.test', 'example.com')).toBe(false)
    expect(domainWithinOrigin('', 'example.com')).toBe(false)
  })
})

describe('evaluatePublisherDomainAlignment', () => {
  test('no resolved publisher ⇒ not_evaluated', () => {
    expect(evaluatePublisherDomainAlignment(authenticated('example.com'), [])).toBe('not_evaluated')
  })

  test('authenticated domain inside the bound origin set ⇒ aligned', () => {
    expect(evaluatePublisherDomainAlignment(authenticated('mail.example.com', 'example.com'), ['example.com']))
      .toBe('aligned')
  })

  test('authenticated domain outside the set ⇒ misaligned', () => {
    expect(evaluatePublisherDomainAlignment(authenticated('example.com'), ['publisher.test']))
      .toBe('misaligned')
  })

  test('nothing authenticated ⇒ no_authenticated_domain', () => {
    const none = createChannelProvenanceRecord({ contentSha256: SHA, material: {}, evaluatedAt: AT })
    expect(evaluatePublisherDomainAlignment(none, ['publisher.test'])).toBe('no_authenticated_domain')
  })
})

describe('applyPublisherDomainAlignment — ratchet discipline', () => {
  test('aligned: activates the Discovery Record and keeps the pass', () => {
    const before = authenticated('example.com')
    expect(before.channel_pass).toBe(true)
    expect(before.discovery_record).toBe('not_evaluated')

    const { record, alignment } = applyPublisherDomainAlignment(before, ['example.com'], LATER)
    expect(alignment).toBe('aligned')
    expect(record.discovery_record).toBe('present_and_consistent')
    expect(record.channel_pass).toBe(true)
    expect(record.authenticated_sender_domain).toBe('example.com')
  })

  test('misaligned: drops the pass, clears alignment flags, marks inconsistent', () => {
    const before = authenticated('example.com')
    expect(before.channel_pass).toBe(true)

    const { record, alignment } = applyPublisherDomainAlignment(before, ['publisher.test'], LATER)
    expect(alignment).toBe('misaligned')
    expect(record.channel_pass).toBe(false)
    expect(record.dkim.aligned).toBe(false)
    expect(record.spf.aligned).toBe(false)
    expect(record.discovery_record).toBe('present_and_inconsistent')
  })

  test('cannot loosen: a failing record stays failing when alignment succeeds', () => {
    const failing = createChannelProvenanceRecord({
      contentSha256: SHA,
      material: { authenticationResults: ['mx.test; dkim=fail; spf=fail; dmarc=fail'], fromDomain: 'example.com' },
      evaluatedAt: AT,
    })
    expect(failing.channel_pass).toBe(false)
    const { record } = applyPublisherDomainAlignment(failing, ['example.com'], LATER)
    expect(record.channel_pass).toBe(false)
    expect(record.dkim.verdict).toBe('fail')
  })

  test('cannot argue away an inconsistency once observed', () => {
    const before = authenticated('example.com')
    const first = applyPublisherDomainAlignment(before, ['publisher.test'], LATER).record
    expect(first.discovery_record).toBe('present_and_inconsistent')
    // A later, "successful" evaluation must not repaint it as consistent.
    const second = applyPublisherDomainAlignment(first, ['example.com'], LATER).record
    expect(second.discovery_record).toBe('present_and_inconsistent')
    expect(second.channel_pass).toBe(false)
  })

  test('no resolved publisher leaves the record untouched', () => {
    const before = authenticated('example.com')
    const { record, alignment } = applyPublisherDomainAlignment(before, [], LATER)
    expect(alignment).toBe('not_evaluated')
    expect(record).toBe(before)
  })

  test('does not disturb the §IX.3.1 rule-8 alert trigger', () => {
    // Rule 8 reads DKIM/DMARC verdicts, which alignment never rewrites.
    const before = authenticated('example.com')
    expect(channelAlertRequired(before)).toBe(false)
    const { record } = applyPublisherDomainAlignment(before, ['publisher.test'], LATER)
    expect(channelAlertRequired(record)).toBe(false)
  })
})
