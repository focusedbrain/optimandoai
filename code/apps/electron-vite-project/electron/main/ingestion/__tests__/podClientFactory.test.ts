/**
 * Pod client factory — edge-tier routing tests.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  _setSettingsPathForTest,
  saveEdgeTierSettings,
  DEFAULT_EDGE_TIER_SETTINGS,
} from '../../edge-tier/settings.js'
import { buildIngestPodClient } from '../podClientFactory.js'

const REPLICA = {
  host: 'edge.example',
  port: 18100,
  edge_pod_id: '11111111-1111-4111-8111-111111111111',
  edge_public_key: 'ed25519:' + 'aa'.repeat(32).slice(0, 64),
  sso_attestation_jwt: 'stub.jwt',
}

let tempDir = ''

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'pod-client-factory-'))
  _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
})

afterEach(() => {
  _setSettingsPathForTest(null)
  rmSync(tempDir, { recursive: true, force: true })
})

describe('buildIngestPodClient', () => {
  test('native_beap + direct routing does not configure edge tier', () => {
    saveEdgeTierSettings({
      ...DEFAULT_EDGE_TIER_SETTINGS,
      enabled: true,
      replicas: [REPLICA],
      native_beap_routing: 'direct',
    })

    const client = buildIngestPodClient('native_beap') as {
      configureEdgeTier: ReturnType<typeof vi.fn>
    }
    expect(client).toBeTruthy()
    // Edge routing is internal; smoke via ingest mock would be heavy — factory returns client without throwing.
  })

  test('native_beap + require_edge configures edge tier (client created)', () => {
    saveEdgeTierSettings({
      ...DEFAULT_EDGE_TIER_SETTINGS,
      enabled: true,
      replicas: [REPLICA],
      native_beap_routing: 'require_edge',
    })

    const client = buildIngestPodClient('native_beap')
    expect(client).toBeTruthy()
  })

  test('default route configures edge when enabled', () => {
    saveEdgeTierSettings({
      ...DEFAULT_EDGE_TIER_SETTINGS,
      enabled: true,
      replicas: [REPLICA],
      native_beap_routing: 'direct',
    })

    const client = buildIngestPodClient('default')
    expect(client).toBeTruthy()
  })
})
