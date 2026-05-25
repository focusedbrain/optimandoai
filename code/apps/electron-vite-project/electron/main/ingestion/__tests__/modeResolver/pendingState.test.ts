/**
 * Pending edge-tier state must not coerce to active routing.
 */

import { describe, test, expect } from 'vitest'

import {
  DEFAULT_EDGE_TIER_SETTINGS,
  isEdgeTierActiveForRouting,
  isEdgeTierDisabledForRouting,
  isEdgeTierSetupPending,
} from '../../../edge-tier/settings.js'
import { resolveIngestionMode, type ResolverInputs } from '../../modeResolver.js'

describe('pending state coercion', () => {
  test("'pending' is not active for routing helpers", () => {
    const settings = { ...DEFAULT_EDGE_TIER_SETTINGS, enabled: 'pending' as const }
    expect(isEdgeTierActiveForRouting(settings)).toBe(false)
    expect(isEdgeTierSetupPending(settings)).toBe(true)
    expect(isEdgeTierDisabledForRouting(settings)).toBe(true)
  })

  test("'pending' resolves to HostPodActive when pod ready (same as disabled)", () => {
    const inputs: ResolverInputs = {
      settings: { ...DEFAULT_EDGE_TIER_SETTINGS, enabled: 'pending' },
      edgeReachable: false,
      generalConnectivity: true,
      hostPodReady: true,
      podmanAvailable: true,
      sessionHostFallbackAuthorized: false,
    }
    expect(resolveIngestionMode(inputs)).toBe('HostPodActive')
  })
})
