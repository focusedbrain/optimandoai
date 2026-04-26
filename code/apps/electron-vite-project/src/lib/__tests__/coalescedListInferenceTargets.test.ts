import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  coalescedListInferenceTargetsInvoke,
  resetCoalescedListInferenceTargetsForTests,
} from '../coalescedListInferenceTargets'

describe('coalescedListInferenceTargetsInvoke', () => {
  beforeEach(() => {
    resetCoalescedListInferenceTargetsForTests()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('joins concurrent calls for the same handshake (single IPC)', async () => {
    let calls = 0
    const listFn = vi.fn(async () => {
      calls++
      return { ok: true, targets: [] }
    })
    const p1 = coalescedListInferenceTargetsInvoke(listFn, { coalesceHandshakeId: 'hs-1' })
    const p2 = coalescedListInferenceTargetsInvoke(listFn, { coalesceHandshakeId: 'hs-1' })
    const [a, b] = await Promise.all([p1, p2])
    expect(a).toEqual(b)
    expect(calls).toBe(1)
    expect(listFn).toHaveBeenCalledTimes(1)
  })

  it('returns cached result within TTL without calling listFn again', async () => {
    const listFn = vi.fn(async () => ({ ok: true, targets: [{ id: 'x' }] }))
    await coalescedListInferenceTargetsInvoke(listFn, { coalesceHandshakeId: 'hs-a' })
    expect(listFn).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(200)
    const r = await coalescedListInferenceTargetsInvoke(listFn, { coalesceHandshakeId: 'hs-a' })
    expect(listFn).toHaveBeenCalledTimes(1)
    expect(r).toEqual({ ok: true, targets: [{ id: 'x' }] })
  })

  it('bypassCache skips TTL replay', async () => {
    const listFn = vi.fn(async () => ({ ok: true, targets: [] }))
    await coalescedListInferenceTargetsInvoke(listFn, { coalesceHandshakeId: 'hs-b' })
    vi.advanceTimersByTime(200)
    await coalescedListInferenceTargetsInvoke(listFn, {
      coalesceHandshakeId: 'hs-b',
      bypassCache: true,
    })
    expect(listFn).toHaveBeenCalledTimes(2)
  })
})
