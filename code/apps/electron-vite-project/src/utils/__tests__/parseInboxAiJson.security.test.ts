/**
 * parseSecurityAnalysis — unit tests for the P2.5 security analysis parser.
 */

import { describe, it, expect } from 'vitest'
import { parseSecurityAnalysis } from '../parseInboxAiJson'

describe('parseSecurityAnalysis', () => {
  it('returns empty object for null input', () => {
    expect(parseSecurityAnalysis(null)).toEqual({})
  })

  it('returns empty object for empty string', () => {
    expect(parseSecurityAnalysis('')).toEqual({})
  })

  it('returns empty object for invalid JSON', () => {
    expect(parseSecurityAnalysis('not json')).toEqual({})
  })

  it('returns empty object when neither field present', () => {
    const raw = JSON.stringify({ summary: 'hello', urgencyScore: 3 })
    const result = parseSecurityAnalysis(raw)
    expect(result.phishing).toBeUndefined()
    expect(result.crosscheck).toBeUndefined()
  })

  it('parses a valid phishing_assessment with high label', () => {
    const raw = JSON.stringify({
      phishing_assessment: {
        score: 9,
        label: 'high',
        signals: [{ kind: 'domain_spoof', evidence: 'paypa1.com' }],
        flagged_urls: [{ url: 'http://paypa1.com', reason: 'domain spoof' }],
        disclaimer_version: 'v1',
        model: 'gpt-4o',
        generated_at: '2026-05-24T10:00:00Z',
      },
    })
    const result = parseSecurityAnalysis(raw)
    expect(result.phishing).toBeDefined()
    expect(result.phishing!.score).toBe(9)
    expect(result.phishing!.label).toBe('high')
    expect(result.phishing!.signals).toHaveLength(1)
    expect(result.phishing!.signals[0].kind).toBe('domain_spoof')
    expect(result.phishing!.flagged_urls).toHaveLength(1)
    expect(result.phishing!.flagged_urls[0].url).toBe('http://paypa1.com')
    expect(result.phishing!.model).toBe('gpt-4o')
  })

  it('parses a valid phishing_assessment with elevated label', () => {
    const raw = JSON.stringify({
      phishing_assessment: {
        score: 6,
        label: 'elevated',
        signals: [],
        flagged_urls: [],
        disclaimer_version: 'v1',
      },
    })
    const result = parseSecurityAnalysis(raw)
    expect(result.phishing!.label).toBe('elevated')
    expect(result.phishing!.score).toBe(6)
  })

  it('rejects phishing_assessment with missing required fields', () => {
    const raw = JSON.stringify({
      phishing_assessment: { signals: [], flagged_urls: [] },
    })
    const result = parseSecurityAnalysis(raw)
    expect(result.phishing).toBeUndefined()
  })

  it('rejects phishing_assessment with invalid label', () => {
    const raw = JSON.stringify({
      phishing_assessment: { score: 5, label: 'unknown', signals: [], flagged_urls: [], disclaimer_version: 'v1' },
    })
    const result = parseSecurityAnalysis(raw)
    expect(result.phishing).toBeUndefined()
  })

  it('parses a valid validation_crosscheck that disagrees', () => {
    const raw = JSON.stringify({
      validation_crosscheck: {
        agrees_with_validator: false,
        findings: [{ kind: 'header_anomaly', evidence: 'SPF fail' }],
        confidence: 'medium',
      },
    })
    const result = parseSecurityAnalysis(raw)
    expect(result.crosscheck).toBeDefined()
    expect(result.crosscheck!.agrees_with_validator).toBe(false)
    expect(result.crosscheck!.findings).toHaveLength(1)
    expect(result.crosscheck!.confidence).toBe('medium')
  })

  it('parses a valid validation_crosscheck that agrees', () => {
    const raw = JSON.stringify({
      validation_crosscheck: {
        agrees_with_validator: true,
        findings: [],
        confidence: 'high',
      },
    })
    const result = parseSecurityAnalysis(raw)
    expect(result.crosscheck!.agrees_with_validator).toBe(true)
  })

  it('rejects crosscheck missing agrees_with_validator', () => {
    const raw = JSON.stringify({
      validation_crosscheck: { findings: [], confidence: 'high' },
    })
    const result = parseSecurityAnalysis(raw)
    expect(result.crosscheck).toBeUndefined()
  })

  it('parses both fields together', () => {
    const raw = JSON.stringify({
      summary: 'normal triage output',
      phishing_assessment: {
        score: 4,
        label: 'low',
        signals: [],
        flagged_urls: [],
        disclaimer_version: 'v1',
      },
      validation_crosscheck: {
        agrees_with_validator: true,
        findings: [],
        confidence: 'high',
      },
    })
    const result = parseSecurityAnalysis(raw)
    expect(result.phishing).toBeDefined()
    expect(result.crosscheck).toBeDefined()
    expect(result.phishing!.label).toBe('low')
    expect(result.crosscheck!.agrees_with_validator).toBe(true)
  })
})
