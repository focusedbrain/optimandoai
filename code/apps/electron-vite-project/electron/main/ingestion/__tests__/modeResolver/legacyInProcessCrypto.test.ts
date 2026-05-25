/**
 * LegacyInProcess qBEAP depackage — real crypto, no pod mock.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

import { dispatchDepackageQBeap } from '../../ingestionDispatcher.js'
import {
  _setResolverInputsOverrideForTest,
  _resetIngestionModeServiceForTest,
} from '../../ingestionModeService.js'
import { DEFAULT_EDGE_TIER_SETTINGS } from '../../../edge-tier/settings.js'
import * as decryptModule from '../../../beap/decryptQBeapPackage.js'
import * as handshakeDb from '../../../handshake/db.js'
import { buildQbeapPackage, toBase64, RECEIVER_PRIV, HANDSHAKE_ID } from './fixtures/qbeap/index.js'
import type { HandshakeRecord } from '../../../handshake/types.js'

describe('edge_disabled_pod_not_ready_podman_missing — real in-process crypto', () => {
  beforeEach(() => {
    vi.spyOn(handshakeDb, 'getHandshakeRecord').mockReturnValue({
      handshake_id: HANDSHAKE_ID,
      local_x25519_private_key_b64: toBase64(RECEIVER_PRIV),
    } as HandshakeRecord)

    _resetIngestionModeServiceForTest()
    _setResolverInputsOverrideForTest({
      settings: DEFAULT_EDGE_TIER_SETTINGS,
      edgeReachable: false,
      generalConnectivity: true,
      hostPodReady: false,
      podmanAvailable: false,
      sessionHostFallbackAuthorized: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    _resetIngestionModeServiceForTest()
  })

  test('dispatchDepackageQBeap runs decryptQBeapPackage and returns depackaged plaintext', async () => {
    const expectedBody = 'Legacy in-process regression body'
    const pkg = await buildQbeapPackage({ capsuleBody: expectedBody, subject: 'Legacy path' })
    const packageJson = JSON.stringify(pkg)

    const decryptSpy = vi.spyOn(decryptModule, 'decryptQBeapPackage')

    const result = await dispatchDepackageQBeap(packageJson, HANDSHAKE_ID, {})
    expect(decryptSpy).toHaveBeenCalled()
    expect(result).not.toBeNull()
    expect(result!.body).toBe(expectedBody)
    expect(result!.rawCapsuleJson).toContain(expectedBody)

    const direct = await decryptModule.decryptQBeapPackage(packageJson, HANDSHAKE_ID, {})
    expect(direct!.rawCapsuleJson).toEqual(result!.rawCapsuleJson)
  })
})
