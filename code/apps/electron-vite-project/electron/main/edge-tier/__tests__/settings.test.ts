/**
 * Edge tier settings — unit tests.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  _setSettingsPathForTest,
  DEFAULT_EDGE_TIER_SETTINGS,
  normalizeEdgeTierSettings,
  edgeTierRequiresPodRestart,
  setEdgeTierNativeBeapRouting,
  loadEdgeTierSettings,
} from '../settings.js'

let tempDir = ''

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'edge-tier-settings-'))
  _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
})

afterEach(() => {
  _setSettingsPathForTest(null)
  rmSync(tempDir, { recursive: true, force: true })
})

describe('native BEAP routing settings', () => {
  test('defaults missing native_beap_routing to direct', () => {
    expect(normalizeEdgeTierSettings({ enabled: true, replicas: [] }).native_beap_routing).toBe(
      'direct',
    )
    expect(normalizeEdgeTierSettings({ enabled: 'pending', replicas: [] }).enabled).toBe('pending')
    expect(normalizeEdgeTierSettings({ enabled: 'pending', replicas: [] }).on_edge_unreachable).toBe(
      'hold',
    )
    expect(
      normalizeEdgeTierSettings({ enabled: true, replicas: [], native_beap_routing: 'require_edge' })
        .native_beap_routing,
    ).toBe('require_edge')
    expect(DEFAULT_EDGE_TIER_SETTINGS.native_beap_routing).toBe('direct')
  })

  test('setEdgeTierNativeBeapRouting persists value', () => {
    setEdgeTierNativeBeapRouting('require_edge')
    expect(loadEdgeTierSettings().native_beap_routing).toBe('require_edge')
  })

  test('native_beap_routing change requires pod restart', () => {
    const before = { ...DEFAULT_EDGE_TIER_SETTINGS, enabled: true, native_beap_routing: 'direct' as const }
    const after = { ...before, native_beap_routing: 'require_edge' as const }
    expect(edgeTierRequiresPodRestart(before, after)).toBe(true)
  })
})
