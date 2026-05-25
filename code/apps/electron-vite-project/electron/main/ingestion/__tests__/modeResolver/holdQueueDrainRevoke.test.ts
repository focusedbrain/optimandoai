/**
 * Hold queue drain — session auth revoke mid-drain returns remaining items to held state.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  _setHoldQueuePathForTest,
  _setHoldQueueVaultForTest,
  holdQueueEnqueue,
  holdQueueSize,
  holdQueueDrainTo,
  serializeOpaqueHoldPayload,
  deserializeOpaqueHoldPayload,
} from '../../holdQueue.js'
import {
  authorizeSessionHostFallback,
  revokeSessionHostFallback,
  isSessionHostFallbackAuthorized,
  _resetSessionHostFallbackForTest,
} from '../../sessionHostFallback.js'

let tempDir = ''

const testVault = {
  deriveApplicationKey(_info: string): Buffer {
    return Buffer.alloc(32, 7)
  },
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'hold-drain-'))
  _setHoldQueuePathForTest(join(tempDir, 'hold.json'))
  _setHoldQueueVaultForTest(testVault)
  _resetSessionHostFallbackForTest()
  authorizeSessionHostFallback()
})

afterEach(() => {
  _setHoldQueuePathForTest(null)
  _setHoldQueueVaultForTest(null)
  _resetSessionHostFallbackForTest()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('hold queue drain on auth revoke', () => {
  test('queue items in flight when auth revoked return to held state', async () => {
    for (let i = 0; i < 10; i++) {
      await holdQueueEnqueue({
        id: `m-${i}`,
        receivedAt: 1000 + i,
        sourceType: 'p2p',
        transportMeta: {},
        opaqueBody: serializeOpaqueHoldPayload(`body-${i}`, 'p2p', {}),
      })
    }

    const processedBodies: string[] = []
    let dispatchCount = 0

    const result = await holdQueueDrainTo(async (msg) => {
      dispatchCount++
      if (dispatchCount === 4) {
        revokeSessionHostFallback()
      }
      if (!isSessionHostFallbackAuthorized()) {
        throw new Error('session host fallback revoked during drain')
      }
      const { rawBody } = deserializeOpaqueHoldPayload(msg.opaqueBody)
      processedBodies.push(rawBody)
    })

    expect(processedBodies).toEqual(['body-0', 'body-1', 'body-2'])
    expect(result.processed).toBe(3)
    expect(result.returnedToHeld).toBe(7)
    expect((await holdQueueSize()).count).toBe(7)
    expect(isSessionHostFallbackAuthorized()).toBe(false)
  })
})
