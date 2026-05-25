/**
 * Mode resolver unit tests — isolated from global test/setup.ts mock pod server.
 *
 * Run: pnpm exec vitest run --config vitest.modeResolver.config.ts
 */

import { describe, test, expect } from 'vitest'

import {
  resolveIngestionMode,
  resolveHostPodVariant,
  shouldWaitForHostPod,
  isBlockedWithoutGeneralConnectivity,
  type ResolverInputs,
} from '../../modeResolver.js'
import { DEFAULT_EDGE_TIER_SETTINGS, type EdgeTierSettings } from '../../../edge-tier/settings.js'

function baseSettings(overrides?: Partial<EdgeTierSettings>): EdgeTierSettings {
  return { ...DEFAULT_EDGE_TIER_SETTINGS, ...overrides }
}

function inputs(overrides: Partial<ResolverInputs> = {}): ResolverInputs {
  return {
    settings: baseSettings(),
    edgeReachable: 'unknown',
    generalConnectivity: true,
    hostPodReady: false,
    podmanAvailable: true,
    sessionHostFallbackAuthorized: false,
    ...overrides,
  }
}

describe('resolveIngestionMode', () => {
  test('edge enabled + reachable → EdgeActive', () => {
    expect(
      resolveIngestionMode(
        inputs({
          settings: baseSettings({ enabled: true, replicas: [{ host: 'e', port: 1, edge_pod_id: 'id', edge_public_key: 'k', sso_attestation_jwt: 'j' }] }),
          edgeReachable: true,
        }),
      ),
    ).toBe('EdgeActive')
  })

  test('edge enabled + unreachable + no auth → Blocked', () => {
    expect(
      resolveIngestionMode(
        inputs({
          settings: baseSettings({ enabled: true }),
          edgeReachable: false,
        }),
      ),
    ).toBe('Blocked')
  })

  test('edge enabled + unreachable + unknown edge → Blocked', () => {
    expect(
      resolveIngestionMode(
        inputs({
          settings: baseSettings({ enabled: true }),
          edgeReachable: 'unknown',
        }),
      ),
    ).toBe('Blocked')
  })

  test('edge enabled + unreachable + session auth + host pod ready → HostPodActive', () => {
    expect(
      resolveIngestionMode(
        inputs({
          settings: baseSettings({ enabled: true }),
          edgeReachable: false,
          sessionHostFallbackAuthorized: true,
          hostPodReady: true,
        }),
      ),
    ).toBe('HostPodActive')
  })

  test('edge enabled + unreachable + session auth but pod not ready → Blocked', () => {
    expect(
      resolveIngestionMode(
        inputs({
          settings: baseSettings({ enabled: true }),
          edgeReachable: false,
          sessionHostFallbackAuthorized: true,
          hostPodReady: false,
        }),
      ),
    ).toBe('Blocked')
  })

  test('edge disabled + host pod ready → HostPodActive', () => {
    expect(
      resolveIngestionMode(
        inputs({
          hostPodReady: true,
        }),
      ),
    ).toBe('HostPodActive')
  })

  test('edge disabled + pod not ready + podman missing → LegacyInProcess', () => {
    expect(
      resolveIngestionMode(
        inputs({
          podmanAvailable: false,
          hostPodReady: false,
        }),
      ),
    ).toBe('LegacyInProcess')
  })

  test('edge disabled + podman available + pod not ready → HostPodActive (transient starting)', () => {
    expect(
      resolveIngestionMode(
        inputs({
          podmanAvailable: true,
          hostPodReady: false,
        }),
      ),
    ).toBe('HostPodActive')
  })

  test("edge pending treated like disabled → LegacyInProcess when podman missing", () => {
    expect(
      resolveIngestionMode(
        inputs({
          settings: baseSettings({ enabled: 'pending' }),
          podmanAvailable: false,
        }),
      ),
    ).toBe('LegacyInProcess')
  })

  test('edge pending + host pod ready → HostPodActive', () => {
    expect(
      resolveIngestionMode(
        inputs({
          settings: baseSettings({ enabled: 'pending' }),
          hostPodReady: true,
        }),
      ),
    ).toBe('HostPodActive')
  })

  test('edge enabled + connectivity down + edge down → Blocked (not EdgeActive)', () => {
    expect(
      resolveIngestionMode(
        inputs({
          settings: baseSettings({ enabled: true }),
          edgeReachable: false,
          generalConnectivity: false,
        }),
      ),
    ).toBe('Blocked')
  })

  test('edge enabled + connectivity up + edge down → Blocked', () => {
    expect(
      resolveIngestionMode(
        inputs({
          settings: baseSettings({ enabled: true }),
          edgeReachable: false,
          generalConnectivity: true,
        }),
      ),
    ).toBe('Blocked')
  })
})

describe('resolveHostPodVariant', () => {
  test('session fallback variant when edge enabled + authorized', () => {
    const inp = inputs({
      settings: baseSettings({ enabled: true }),
      sessionHostFallbackAuthorized: true,
      hostPodReady: true,
    })
    const mode = resolveIngestionMode(inp)
    expect(mode).toBe('HostPodActive')
    expect(resolveHostPodVariant(inp, mode)).toBe('session_fallback')
  })

  test('starting variant when podman available but pod not ready', () => {
    const inp = inputs({ podmanAvailable: true, hostPodReady: false })
    const mode = resolveIngestionMode(inp)
    expect(resolveHostPodVariant(inp, mode)).toBe('starting')
  })

  test('user_chosen when edge disabled and pod ready', () => {
    const inp = inputs({ hostPodReady: true })
    const mode = resolveIngestionMode(inp)
    expect(resolveHostPodVariant(inp, mode)).toBe('user_chosen')
  })
})

describe('shouldWaitForHostPod', () => {
  test('true when edge disabled, podman ok, pod not ready', () => {
    const inp = inputs({ podmanAvailable: true, hostPodReady: false })
    const mode = resolveIngestionMode(inp)
    expect(shouldWaitForHostPod(inp, mode)).toBe(true)
  })

  test('false when LegacyInProcess', () => {
    const inp = inputs({ podmanAvailable: false })
    const mode = resolveIngestionMode(inp)
    expect(shouldWaitForHostPod(inp, mode)).toBe(false)
  })
})

describe('isBlockedWithoutGeneralConnectivity', () => {
  test('Blocked + offline → true', () => {
    const inp = inputs({
      settings: baseSettings({ enabled: true }),
      edgeReachable: false,
      generalConnectivity: false,
    })
    expect(isBlockedWithoutGeneralConnectivity(inp, 'Blocked')).toBe(true)
  })

  test('Blocked + online → false', () => {
    const inp = inputs({
      settings: baseSettings({ enabled: true }),
      generalConnectivity: true,
    })
    expect(isBlockedWithoutGeneralConnectivity(inp, 'Blocked')).toBe(false)
  })
})
