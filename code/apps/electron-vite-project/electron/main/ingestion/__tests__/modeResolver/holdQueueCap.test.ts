/**
 * Hold queue cap eviction and 80% warning tests.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  _setHoldQueuePathForTest,
  _setHoldQueueVaultForTest,
  _setHoldQueueLimitsForTest,
  holdQueueEnqueue,
  holdQueueSize,
  onHoldQueueCapacityWarning,
  serializeOpaqueHoldPayload,
  HOLD_QUEUE_WARN_RATIO,
} from '../../holdQueue.js'

let tempDir = ''

const testVault = {
  deriveApplicationKey(_info: string): Buffer {
    return Buffer.alloc(32, 7)
  },
}

async function enqueueN(n: number, bodyPrefix: string, byteSize = 32): Promise<void> {
  for (let i = 0; i < n; i++) {
    const body = `${bodyPrefix}-${i}-${'x'.repeat(Math.max(0, byteSize - 20))}`
    await holdQueueEnqueue({
      id: `cap-${bodyPrefix}-${i}`,
      receivedAt: 1000 + i,
      sourceType: 'email',
      transportMeta: {},
      opaqueBody: serializeOpaqueHoldPayload(body, 'email', {}),
    })
  }
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'hold-cap-'))
  _setHoldQueuePathForTest(join(tempDir, 'hold.json'))
  _setHoldQueueVaultForTest(testVault)
  _setHoldQueueLimitsForTest(null)
  onHoldQueueCapacityWarning(null)
})

afterEach(() => {
  _setHoldQueuePathForTest(null)
  _setHoldQueueVaultForTest(null)
  _setHoldQueueLimitsForTest(null)
  onHoldQueueCapacityWarning(null)
  rmSync(tempDir, { recursive: true, force: true })
})

describe('hold queue capacity', () => {
  test('queue evicts oldest at message cap and fires 80% warning once', async () => {
    _setHoldQueueLimitsForTest({ maxMessages: 10, maxBytes: 10 * 1024 * 1024 })
    const warnings: Array<{ count: number; ratio: number }> = []
    onHoldQueueCapacityWarning((stats) => {
      warnings.push({ count: stats.count, ratio: stats.ratio })
    })

    await enqueueN(7, 'pre-warn')
    expect(warnings).toHaveLength(0)

    await holdQueueEnqueue({
      id: 'warn-trigger',
      receivedAt: 2000,
      sourceType: 'email',
      transportMeta: {},
      opaqueBody: serializeOpaqueHoldPayload('warn-trigger-body', 'email', {}),
    })
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.count).toBe(8)
    expect(warnings[0]!.ratio).toBeGreaterThanOrEqual(HOLD_QUEUE_WARN_RATIO)

    await enqueueN(2, 'fill-cap')
    expect((await holdQueueSize()).count).toBe(10)

    await holdQueueEnqueue({
      id: 'cap-evict-victim',
      receivedAt: 9999,
      sourceType: 'email',
      transportMeta: {},
      opaqueBody: serializeOpaqueHoldPayload('newest', 'email', {}),
    })

    const size = await holdQueueSize()
    expect(size.count).toBe(10)

    const raw = readFileSync(join(tempDir, 'hold.json'), 'utf8')
    expect(raw).not.toContain('pre-warn-0')
    expect(raw).toContain('cap-evict-victim')
  })

  test('queue evicts oldest at byte cap', async () => {
    _setHoldQueueLimitsForTest({ maxMessages: 100, maxBytes: 500 })
    await holdQueueEnqueue({
      id: 'byte-old',
      receivedAt: 1000,
      sourceType: 'email',
      transportMeta: {},
      opaqueBody: serializeOpaqueHoldPayload('a'.repeat(80), 'email', {}),
    })

    await holdQueueEnqueue({
      id: 'byte-new',
      receivedAt: 1001,
      sourceType: 'email',
      transportMeta: {},
      opaqueBody: serializeOpaqueHoldPayload('b'.repeat(200), 'email', {}),
    })

    const size = await holdQueueSize()
    expect(size.bytes).toBeLessThanOrEqual(500)
    expect(size.count).toBe(1)
    const raw = readFileSync(join(tempDir, 'hold.json'), 'utf8')
    expect(raw).not.toContain('byte-old')
    expect(raw).toContain('byte-new')
  })

  test('held blob on disk is encrypted ciphertext, not plaintext body', async () => {
    const secret = 'super-secret-held-body-content'
    await holdQueueEnqueue({
      id: 'opaque-1',
      receivedAt: Date.now(),
      sourceType: 'email',
      transportMeta: {},
      opaqueBody: serializeOpaqueHoldPayload(secret, 'email', {}),
    })

    const raw = readFileSync(join(tempDir, 'hold.json'), 'utf8')
    expect(raw).not.toContain(secret)
    expect(raw).toMatch(/ciphertext_b64/)
  })
})
