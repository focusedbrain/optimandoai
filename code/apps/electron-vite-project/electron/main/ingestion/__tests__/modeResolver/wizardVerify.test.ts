/**
 * Wizard verification — must not persist enabled: true without full verification.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { verifyEdgeRoundTripAndEnable } from '../../../wizard/verify.js'
import {
  _setSettingsPathForTest,
  loadEdgeTierSettings,
  type EdgeReplica,
} from '../../../edge-tier/settings.js'

let tempDir = ''

const REPLICA: EdgeReplica = {
  host: '127.0.0.1',
  port: 59999,
  edge_pod_id: '11111111-1111-4111-8111-111111111111',
  edge_public_key: 'ed25519:' + 'aa'.repeat(32),
  sso_attestation_jwt: 'stub.jwt',
}

const mockVault = {
  deriveApplicationKey(): Buffer {
    return Buffer.alloc(32, 1)
  },
}

function writeSettings(enabled: false | true | 'pending' = false): void {
  writeFileSync(
    join(tempDir, 'edge-tier-settings.json'),
    JSON.stringify({
      enabled,
      replicas: [REPLICA],
      on_edge_unreachable: 'hold',
      fallback_policy: 'reject',
      native_beap_routing: 'direct',
    }),
    { mode: 0o600 },
  )
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'wizard-verify-'))
  _setSettingsPathForTest(join(tempDir, 'edge-tier-settings.json'))
  writeSettings(false)
})

afterEach(() => {
  _setSettingsPathForTest(null)
  rmSync(tempDir, { recursive: true, force: true })
})

describe('wizard does not persist enabled: true without verification', () => {
  test('wizard with failing probe persists enabled: pending, not true', async () => {
    const result = await verifyEdgeRoundTripAndEnable(0, {
      vault: mockVault,
      probeEdge: async () => false,
      restartPod: async () => {},
      ingest: async () => ({ ok: true }),
    })

    expect(result.verified).toBe(false)
    expect(loadEdgeTierSettings().enabled).toBe('pending')
    expect(loadEdgeTierSettings().enabled).not.toBe(true)
  })

  test('wizard with failing test-capsule round-trip persists enabled: pending', async () => {
    const result = await verifyEdgeRoundTripAndEnable(0, {
      vault: mockVault,
      probeEdge: async () => true,
      restartPod: async () => {},
      ingest: async () => ({ ok: false, reason: 'round-trip failed' }),
    })

    expect(result.verified).toBe(false)
    expect(loadEdgeTierSettings().enabled).toBe('pending')
    expect(loadEdgeTierSettings().enabled).not.toBe(true)
  })

  test('wizard with failing cert verification persists enabled: pending', async () => {
    const result = await verifyEdgeRoundTripAndEnable(0, {
      vault: mockVault,
      probeEdge: async () => true,
      restartPod: async () => {},
      ingest: async () => ({ ok: false, reason: 'edge certificate verification failed' }),
    })

    expect(result.verified).toBe(false)
    expect(loadEdgeTierSettings().enabled).toBe('pending')
    expect(loadEdgeTierSettings().enabled).not.toBe(true)
  })

  test('wizard with full success persists enabled: true', async () => {
    const result = await verifyEdgeRoundTripAndEnable(0, {
      vault: mockVault,
      probeEdge: async () => true,
      restartPod: async () => {},
      ingest: async () => ({ ok: true }),
    })

    expect(result.verified).toBe(true)
    expect(loadEdgeTierSettings().enabled).toBe(true)
  })
})
