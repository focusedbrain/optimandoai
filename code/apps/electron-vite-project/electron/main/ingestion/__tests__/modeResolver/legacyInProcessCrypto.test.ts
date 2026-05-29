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
import * as deviceKeyStore from '../../../device-keys/deviceKeyStore.js'
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

  test('dispatchDepackageQBeap uses device key when handshake private key column is null', async () => {
    vi.spyOn(handshakeDb, 'getHandshakeRecord').mockReturnValue({
      handshake_id: HANDSHAKE_ID,
      local_x25519_private_key_b64: null,
    } as HandshakeRecord)
    vi.spyOn(deviceKeyStore, 'getDeviceX25519KeyPair').mockResolvedValue({
      keyId: 'x25519_device_v1',
      publicKey: toBase64(new Uint8Array(32)),
      privateKey: toBase64(RECEIVER_PRIV),
    })

    const expectedBody = 'New-flow device key fallback body'
    const pkg = await buildQbeapPackage({ capsuleBody: expectedBody, subject: 'Device key path' })
    const packageJson = JSON.stringify(pkg)
    const failures: Array<{ code: string }> = []

    const result = await dispatchDepackageQBeap(packageJson, HANDSHAKE_ID, {}, {
      reportFailure: (info) => failures.push({ code: info.code }),
    })

    expect(failures.some((f) => f.code === 'missing_x25519_private_key')).toBe(false)
    expect(result).not.toBeNull()
    expect(result!.body).toBe(expectedBody)
  })

  test('reports missing_x25519_private_key when row and device key are both absent', async () => {
    vi.spyOn(handshakeDb, 'getHandshakeRecord').mockReturnValue({
      handshake_id: HANDSHAKE_ID,
      local_x25519_private_key_b64: null,
    } as HandshakeRecord)
    vi.spyOn(deviceKeyStore, 'getDeviceX25519KeyPair').mockRejectedValue(
      new deviceKeyStore.DeviceKeyNotFoundError(),
    )

    const pkg = await buildQbeapPackage({ capsuleBody: 'x', subject: 'missing key' })
    const failures: Array<{ code: string; handshakeId: string }> = []

    const result = await dispatchDepackageQBeap(JSON.stringify(pkg), HANDSHAKE_ID, {}, {
      reportFailure: (info) => failures.push({ code: info.code, handshakeId: info.handshakeId }),
    })

    expect(result).toBeNull()
    expect(failures).toEqual([
      { code: 'missing_x25519_private_key', handshakeId: HANDSHAKE_ID },
    ])
  })
})
