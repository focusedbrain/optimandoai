/**
 * Hold queue tests — no global mock pod (uses isolated vault + temp path).
 *
 * Run via vitest.modeResolver.config.ts project or direct path include.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

vi.mock('electron', () => ({
  app: { getPath: () => join(tmpdir(), 'hold-queue-test-userdata') },
}))

import {
  _setHoldQueuePathForTest,
  _setHoldQueueVaultForTest,
  holdQueueEnqueue,
  holdQueueSize,
  holdQueueDrainTo,
  serializeOpaqueHoldPayload,
  deserializeOpaqueHoldPayload,
  generateHoldMessageId,
} from '../../holdQueue.js'
import { resolveIngestionMode, type ResolverInputs } from '../../modeResolver.js'
import { DEFAULT_EDGE_TIER_SETTINGS } from '../../../edge-tier/settings.js'

let tempDir = ''

const testVault = {
  deriveApplicationKey(_info: string): Buffer {
    return Buffer.alloc(32, 7)
  },
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'hold-queue-'))
  _setHoldQueuePathForTest(join(tempDir, 'hold.json'))
  _setHoldQueueVaultForTest(testVault)
})

afterEach(() => {
  _setHoldQueuePathForTest(null)
  _setHoldQueueVaultForTest(null)
  rmSync(tempDir, { recursive: true, force: true })
})

describe('holdQueue', () => {
  test('enqueue persists across reload', async () => {
    const id = generateHoldMessageId()
    const opaque = serializeOpaqueHoldPayload('hello', 'p2p', {})
    await holdQueueEnqueue({
      id,
      receivedAt: Date.now(),
      sourceType: 'p2p',
      transportMeta: {},
      opaqueBody: opaque,
    })
    _setHoldQueueVaultForTest(testVault)
    const size = await holdQueueSize()
    expect(size.count).toBe(1)
    expect(existsSync(join(tempDir, 'hold.json'))).toBe(true)
  })

  test('drains in FIFO order', async () => {
    const order: string[] = []
    for (let i = 0; i < 3; i++) {
      await holdQueueEnqueue({
        id: `m-${i}`,
        receivedAt: 1000 + i,
        sourceType: 'p2p',
        transportMeta: {},
        opaqueBody: serializeOpaqueHoldPayload(`body-${i}`, 'p2p', {}),
      })
    }
    await holdQueueDrainTo(async (msg) => {
      const { rawBody } = deserializeOpaqueHoldPayload(msg.opaqueBody)
      order.push(rawBody)
    })
    expect(order).toEqual(['body-0', 'body-1', 'body-2'])
    expect((await holdQueueSize()).count).toBe(0)
  })

  test('opaque round-trip preserves bytes without parsing body', async () => {
    const payload = serializeOpaqueHoldPayload('{"secret":"x"}', 'email', { message_id: '1' })
    const parsed = deserializeOpaqueHoldPayload(payload)
    expect(parsed.rawBody).toBe('{"secret":"x"}')
    expect(parsed.sourceType).toBe('email')
  })
})

describe('edge_pending_treated_as_disabled', () => {
  test('pending settings resolve like disabled for routing', () => {
    const mode = resolveIngestionMode({
      settings: { ...DEFAULT_EDGE_TIER_SETTINGS, enabled: 'pending' },
      edgeReachable: false,
      generalConnectivity: true,
      hostPodReady: false,
      podmanAvailable: false,
      sessionHostFallbackAuthorized: false,
    } satisfies ResolverInputs)
    expect(mode).toBe('Blocked')
  })
})
