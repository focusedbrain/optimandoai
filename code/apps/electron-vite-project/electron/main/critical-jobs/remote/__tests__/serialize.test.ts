/**
 * Phase 1 — wire serialization round-trip + INV-2 wire-level assertion
 * (spec 0017 §2.2).
 */

import { describe, test, expect } from 'vitest'
import {
  encodeBuffers,
  decodeBuffers,
  serializeCriticalJobSpec,
  deserializeCriticalJobSpec,
  assertNoKeyMaterialOnWire,
} from '../serialize'
import type { CriticalJobSpec } from '../../types'

describe('Buffer-aware codec', () => {
  test('round-trips Buffers byte-for-byte through JSON', () => {
    const original = { inputBytes: Buffer.from([0, 1, 2, 250, 255]), nested: { b: Buffer.from('hello') } }
    const wire = JSON.parse(JSON.stringify(encodeBuffers(original)))
    const back = decodeBuffers(wire) as typeof original
    expect(Buffer.isBuffer(back.inputBytes)).toBe(true)
    expect(back.inputBytes.equals(original.inputBytes)).toBe(true)
    expect(back.nested.b.toString()).toBe('hello')
  })
})

describe('spec serialization', () => {
  test('round-trips a depackage spec with the inputBytes Buffer intact', () => {
    const spec: CriticalJobSpec<'depackage'> = {
      jobId: 'j1',
      kind: 'depackage',
      input: { inputBytes: Buffer.from('Subject: hi\r\n\r\nbody') },
      custodyPubKeyB64: 'cHVibGlj',
      limits: { maxWallClockMs: 30_000, maxInputBytes: 1024 },
      flush: 'per-action',
    }
    const wire = JSON.parse(JSON.stringify(serializeCriticalJobSpec(spec)))
    const back = deserializeCriticalJobSpec(wire) as CriticalJobSpec<'depackage'>
    expect(back.jobId).toBe('j1')
    expect(back.kind).toBe('depackage')
    expect((back.input as { inputBytes: Buffer }).inputBytes.toString()).toBe('Subject: hi\r\n\r\nbody')
    expect(back.custodyPubKeyB64).toBe('cHVibGlj')
    expect(back.limits.maxWallClockMs).toBe(30_000)
  })
})

describe('INV-2 wire-level assertion', () => {
  test('rejects an unexpected top-level field on the spec', () => {
    expect(() =>
      assertNoKeyMaterialOnWire({
        jobId: 'j',
        kind: 'depackage',
        input: {},
        limits: { maxWallClockMs: 1 },
        flush: 'per-action',
        sealKey: 'AAAA',
      } as never),
    ).toThrow(/INV-2/)
  })

  test('rejects forbidden key-material field names nested in input', () => {
    expect(() =>
      assertNoKeyMaterialOnWire({
        jobId: 'j',
        kind: 'depackage',
        input: { inputBytes: {}, privateKey: 'leak' },
        limits: { maxWallClockMs: 1 },
        flush: 'per-action',
      } as never),
    ).toThrow(/INV-2/)
  })

  test('allows the public custodyPubKeyB64 field', () => {
    expect(() =>
      assertNoKeyMaterialOnWire({
        jobId: 'j',
        kind: 'depackage',
        input: { inputBytes: {} },
        custodyPubKeyB64: 'cHVi',
        limits: { maxWallClockMs: 1 },
        flush: 'per-action',
      } as never),
    ).not.toThrow()
  })

  test('deserialize re-asserts INV-2 (rejects injected key field on receipt)', () => {
    expect(() =>
      deserializeCriticalJobSpec({
        jobId: 'j',
        kind: 'depackage',
        input: { inputBytes: { $buf: '' }, vault_key: 'x' },
        limits: { maxWallClockMs: 1 },
        flush: 'per-action',
      } as never),
    ).toThrow(/INV-2/)
  })
})
