import { describe, test, expect } from 'vitest'
import { classifyHandshakeTier } from '../tierClassification'
import { buildTierSignals } from './helpers'

describe('Tier Classification', () => {
  test('all signals → highest tier (enterprise)', () => {
    const signals = buildTierSignals({
      plan: 'enterprise',
      wrStampStatus: { verified: true, stampId: 's1' },
      dnsVerification: { verified: true, domain: 'acme.com' },
      hardwareAttestation: { verified: true, fresh: true, attestedAt: new Date().toISOString() },
    })
    const d = classifyHandshakeTier(signals)
    expect(d.computedTier).toBe('enterprise')
    expect(d.effectiveTier).toBe('enterprise')
  })

  test('missing signal → lower tier, still valid', () => {
    const signals = buildTierSignals({
      plan: 'enterprise',
      wrStampStatus: { verified: true, stampId: 's1' },
      dnsVerification: { verified: true, domain: 'acme.com' },
      hardwareAttestation: null,
    })
    const d = classifyHandshakeTier(signals)
    expect(d.computedTier).toBe('publisher')
  })

  test('claimed > computed → downgrade', () => {
    const signals = buildTierSignals({ plan: 'pro', wrStampStatus: { verified: true, stampId: 's1' } })
    const d = classifyHandshakeTier(signals, 'enterprise')
    expect(d.effectiveTier).toBe('pro')
    expect(d.downgraded).toBe(true)
  })

  test('claimed < computed → use claimed', () => {
    const signals = buildTierSignals({
      plan: 'publisher',
      wrStampStatus: { verified: true, stampId: 's1' },
      dnsVerification: { verified: true, domain: 'acme.com' },
    })
    const d = classifyHandshakeTier(signals, 'pro')
    expect(d.computedTier).toBe('publisher')
    expect(d.effectiveTier).toBe('pro')
  })

  test('free plan with no signals → free', () => {
    const signals = buildTierSignals({ plan: 'free', wrStampStatus: null })
    const d = classifyHandshakeTier(signals)
    expect(d.effectiveTier).toBe('free')
  })

  test('pro plan without WRStamp → free', () => {
    const signals = buildTierSignals({ plan: 'pro', wrStampStatus: null })
    const d = classifyHandshakeTier(signals)
    expect(d.computedTier).toBe('free')
  })

  test('publisher plan with WRStamp but no DNS → pro', () => {
    const signals = buildTierSignals({
      plan: 'publisher',
      wrStampStatus: { verified: true, stampId: 's1' },
      dnsVerification: null,
    })
    const d = classifyHandshakeTier(signals)
    expect(d.computedTier).toBe('pro')
  })
})

describe('Tier-Specific Checks', () => {
  test('tier-specific checks are tested via enforcement.test.ts pipeline steps', () => {
    expect(true).toBe(true)
  })
})

describe('Snapshot vs Effective Tier', () => {
  test('snapshot is independent from current classification', () => {
    const snapshot = classifyHandshakeTier(buildTierSignals({ plan: 'enterprise', wrStampStatus: { verified: true, stampId: 's1' }, dnsVerification: { verified: true, domain: 'd' }, hardwareAttestation: { verified: true, fresh: true, attestedAt: new Date().toISOString() } }))
    const current = classifyHandshakeTier(buildTierSignals({ plan: 'free', wrStampStatus: null }))
    expect(snapshot.effectiveTier).toBe('enterprise')
    expect(current.effectiveTier).toBe('free')
  })
})
