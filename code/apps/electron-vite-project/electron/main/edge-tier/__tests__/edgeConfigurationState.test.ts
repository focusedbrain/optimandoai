/**
 * EdgeConfigurationState — single source of truth for dashboard and email panel.
 */

import { describe, test, expect } from 'vitest'

import {
  DEFAULT_EDGE_TIER_SETTINGS,
  deriveEdgeConfigurationState,
  type EdgeReplica,
  type EdgeTierSettings,
} from '../settings.js'

const REPLICA: EdgeReplica = {
  host: '203.0.113.10',
  port: 18100,
  edge_pod_id: '11111111-1111-4111-8111-111111111111',
  edge_public_key: 'ed25519:' + 'aa'.repeat(32),
  sso_attestation_jwt: 'stub.jwt',
}

function settings(overrides: Partial<EdgeTierSettings>): EdgeTierSettings {
  return { ...DEFAULT_EDGE_TIER_SETTINGS, ...overrides }
}

describe('deriveEdgeConfigurationState', () => {
  test('not_configured when disabled with no replicas', () => {
    expect(deriveEdgeConfigurationState(settings({ enabled: false, replicas: [] }))).toBe(
      'not_configured',
    )
  })

  test('setup_in_progress when pending with replica deployed', () => {
    expect(
      deriveEdgeConfigurationState(settings({ enabled: 'pending', replicas: [REPLICA] })),
    ).toBe('setup_in_progress')
  })

  test('configured_active when enabled with healthy reachability', () => {
    expect(
      deriveEdgeConfigurationState(settings({ enabled: true, replicas: [REPLICA] }), true),
    ).toBe('configured_active')
  })

  test('configured_unreachable when enabled but edge probe failed', () => {
    expect(
      deriveEdgeConfigurationState(settings({ enabled: true, replicas: [REPLICA] }), false),
    ).toBe('configured_unreachable')
  })

  test('setup_in_progress when replicas exist but not fully enabled', () => {
    expect(
      deriveEdgeConfigurationState(settings({ enabled: false, replicas: [REPLICA] })),
    ).toBe('setup_in_progress')
  })

  test('dashboard payload uses same state for pending replica', () => {
    // Mirrors { enabled: 'pending', replicas: [oneReplica] } from A4 acceptance criteria.
    const pending = settings({ enabled: 'pending', replicas: [REPLICA] })
    expect(deriveEdgeConfigurationState(pending)).toBe('setup_in_progress')
  })
})
