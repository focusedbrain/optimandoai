/**
 * Scam Watchdog — parse-layer scenario tests.
 *
 * The detection itself is performed by the shared analysis LLM (guided by the prompt in
 * electron/main/email/scamWatchdog.ts). These tests simulate the model's JSON output for
 * each scenario and assert the deterministic parse + false-positive guard:
 *   - concrete findings -> flagged with the specific reason
 *   - clean / silent -> "clear" with no findings
 *   - a "flagged" claim with NO concrete finding collapses to "clear" (discipline)
 */
import { describe, expect, it } from 'vitest'
import { assembleScamWatchdog, tryParseAnalysis, tryParsePartialAnalysis } from './parseInboxAiJson'

function analysis(scamStatus: unknown, scamFindings: unknown): string {
  return JSON.stringify({
    needsReply: false,
    needsReplyReason: 'n',
    summary: 's',
    urgencyScore: 3,
    urgencyReason: 'u',
    actionItems: [],
    archiveRecommendation: 'keep',
    archiveReason: 'a',
    draftReply: null,
    scamStatus,
    scamFindings,
  })
}

describe('assembleScamWatchdog — false-positive guard', () => {
  it('flags only when there is at least one concrete finding', () => {
    expect(assembleScamWatchdog('flagged', ['x']).status).toBe('flagged')
    expect(assembleScamWatchdog('clear', []).status).toBe('clear')
  })

  it('a "flagged" claim with no findings collapses to clear', () => {
    expect(assembleScamWatchdog('flagged', []).status).toBe('clear')
    expect(assembleScamWatchdog('flagged', undefined).findings).toEqual([])
  })

  it('findings present always mean flagged even if model said clear', () => {
    expect(assembleScamWatchdog('clear', ['concrete reason']).status).toBe('flagged')
  })

  it('drops empty/blank findings and caps the list', () => {
    expect(assembleScamWatchdog('flagged', ['', '  ', 'real']).findings).toEqual(['real'])
    expect(assembleScamWatchdog('flagged', Array(20).fill('f')).findings.length).toBe(10)
  })
})

describe('Scam Watchdog — scenario coverage', () => {
  it('brand-impersonation POSITIVE: flagged with the specific reason', () => {
    const reason = 'Asks you to update your eBay account, but was sent from peter@xxx.com, which is not an eBay domain'
    const r = tryParseAnalysis(analysis('flagged', [reason]))
    expect(r?.scamWatchdog?.status).toBe('flagged')
    expect(r?.scamWatchdog?.findings).toContain(reason)
  })

  it('brand-impersonation NEGATIVE (real brand domain): clean', () => {
    const r = tryParseAnalysis(analysis('clear', []))
    expect(r?.scamWatchdog?.status).toBe('clear')
    expect(r?.scamWatchdog?.findings).toEqual([])
  })

  it('sender structural mismatch (display vs address): flagged', () => {
    const reason = 'Display name says "PayPal" but the address is billing@secure-pay-alerts.ru'
    const r = tryParseAnalysis(analysis('flagged', [reason]))
    expect(r?.scamWatchdog?.status).toBe('flagged')
    expect(r?.scamWatchdog?.findings[0]).toBe(reason)
  })

  it('link-string lookalike / anchor-vs-href: flagged', () => {
    const reason = 'Link text shows "paypal.com" but the URL points to http://paypa1-secure.ru/verify'
    const r = tryParseAnalysis(analysis('flagged', [reason]))
    expect(r?.scamWatchdog?.status).toBe('flagged')
    expect(r?.scamWatchdog?.findings[0]).toMatch(/paypa1-secure\.ru/)
  })

  it('content urgency + credential-harvest: flagged', () => {
    const reason = 'Pressures you to "verify your password within 24 hours or lose access"'
    const r = tryParseAnalysis(analysis('flagged', [reason]))
    expect(r?.scamWatchdog?.status).toBe('flagged')
  })

  it('clean transactional message: "no indicators" (false-positive guard)', () => {
    const r = tryParseAnalysis(analysis('clear', []))
    expect(r?.scamWatchdog?.status).toBe('clear')
  })

  it('unfamiliar-but-unremarkable sender: silent (clear), even if model over-claims', () => {
    // Model wrongly labels "flagged" but provides no nameable finding -> stays silent.
    const r = tryParseAnalysis(analysis('flagged', []))
    expect(r?.scamWatchdog?.status).toBe('clear')
    expect(r?.scamWatchdog?.findings).toEqual([])
  })
})

describe('Scam Watchdog — streaming partial parse', () => {
  it('extracts scam findings progressively', () => {
    const partialText =
      '{"summary":"s","scamStatus":"flagged","scamFindings":["Sent from a non-eBay domain"'
    const p = tryParsePartialAnalysis(partialText)
    expect(p?.receivedKeys).toContain('scamWatchdog')
    expect(p?.partial.scamWatchdog?.status).toBe('flagged')
    expect(p?.partial.scamWatchdog?.findings[0]).toMatch(/non-eBay domain/)
  })

  it('full parse reports scamWatchdog as a received key', () => {
    const p = tryParsePartialAnalysis(analysis('clear', []))
    expect(p?.receivedKeys).toContain('scamWatchdog')
    expect(p?.partial.scamWatchdog?.status).toBe('clear')
  })
})
