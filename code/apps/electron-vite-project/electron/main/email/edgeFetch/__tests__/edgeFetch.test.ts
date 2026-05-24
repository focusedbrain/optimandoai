/**
 * Pure edge-fetch state merge + rules tests.
 */

import { describe, it, expect } from 'vitest'
import { mergeEdgeFetchState, accountSupportsEdgeFetch, edgeFetchEligibilityForAccount } from '../edgeFetchRules.js'

describe('mergeEdgeFetchState', () => {
  it('prefers migrating local state over remote', () => {
    expect(mergeEdgeFetchState('migrating', 'active')).toBe('migrating')
  })

  it('surfaces remote degraded', () => {
    expect(mergeEdgeFetchState('active', 'degraded')).toBe('degraded')
  })
})

describe('accountSupportsEdgeFetch', () => {
  it('allows gmail and microsoft365 when active', () => {
    expect(accountSupportsEdgeFetch({ provider: 'gmail', status: 'active' })).toBe(true)
    expect(accountSupportsEdgeFetch({ provider: 'microsoft365', status: 'active' })).toBe(true)
  })

  it('blocks imap and inactive rows', () => {
    expect(accountSupportsEdgeFetch({ provider: 'imap', status: 'active' })).toBe(false)
    expect(accountSupportsEdgeFetch({ provider: 'gmail', status: 'auth_error' })).toBe(false)
  })
})

describe('edgeFetchEligibilityForAccount', () => {
  const ready = {
    canMigrate: true,
    edgeReady: true,
    isPaidTier: true,
    replicas: [{ edge_pod_id: 'r1', host: '1.2.3.4', port: 22 }],
  }

  it('allows gmail active not_on_edge', () => {
    expect(
      edgeFetchEligibilityForAccount({ provider: 'gmail', status: 'active' }, ready).allowed,
    ).toBe(true)
  })
})
