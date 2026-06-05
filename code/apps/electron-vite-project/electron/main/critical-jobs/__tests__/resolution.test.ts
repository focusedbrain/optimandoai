/**
 * Resolution table — pure resolution + structural validation (INV-1 / INV-3).
 */

import { describe, test, expect } from 'vitest'
import {
  DEFAULT_RESOLUTION_TABLE,
  resolve,
  validateResolutionTable,
  type ResolutionContext,
  type ResolutionTable,
} from '../resolution'
import { CriticalJobError } from '../types'

function ctx(partial: Partial<ResolutionContext>): ResolutionContext {
  return {
    role: 'sandbox',
    tier: 'free',
    topology: { linked: [] },
    ...partial,
  }
}

describe('validateResolutionTable (INV-1)', () => {
  test('accepts the default table', () => {
    expect(() => validateResolutionTable(DEFAULT_RESOLUTION_TABLE)).not.toThrow()
  })

  test('rejects workstation → in-process (primary)', () => {
    const bad: ResolutionTable = [
      { role: 'workstation', perKind: { depackage: { executorId: 'in-process' } } },
    ]
    expect(() => validateResolutionTable(bad)).toThrowError(CriticalJobError)
    try {
      validateResolutionTable(bad)
    } catch (e) {
      expect((e as CriticalJobError).code).toBe('E_INVALID_TABLE')
    }
  })

  test('rejects workstation → in-process (fallback)', () => {
    const bad: ResolutionTable = [
      {
        role: 'workstation',
        perKind: { depackage: { executorId: 'remote-handshake', fallbackExecutorId: 'in-process' } },
      },
    ]
    expect(() => validateResolutionTable(bad)).toThrowError(/INV-1/)
  })
})

describe('validateResolutionTable — INV-1 refinement (Q5.1 / Q5.2)', () => {
  test('absolute: workstation untrusted-content → in-process rejected even WITH transitional marker', () => {
    const bad: ResolutionTable = [
      {
        role: 'workstation',
        // transitional is meaningless for untrusted-content; reject regardless.
        perKind: { depackage: { executorId: 'in-process', transitional: true } },
      },
    ]
    expect(() => validateResolutionTable(bad)).toThrowError(/INV-1 violation \(absolute\)/)
  })

  test('transitional: workstation validate kind → in-process WITHOUT marker rejected', () => {
    const bad: ResolutionTable = [
      { role: 'workstation', perKind: { 'validate-native-beap': { executorId: 'in-process' } } },
    ]
    expect(() => validateResolutionTable(bad)).toThrowError(/without a permitted transitional/)
  })

  test('permitted: workstation validate kind → in-process WITH transitional marker accepted', () => {
    const ok: ResolutionTable = [
      {
        role: 'workstation',
        perKind: {
          'validate-decrypted-beap': { executorId: 'in-process', transitional: true },
          'validate-native-beap': { executorId: 'in-process', transitional: true },
        },
      },
    ]
    expect(() => validateResolutionTable(ok)).not.toThrow()
  })
})

describe('validateResolutionTable — INV-6 key-locality (Q5.3)', () => {
  test('rejects decrypt-qbeap → remote-handshake (consumer-local; would ship keys)', () => {
    const bad: ResolutionTable = [
      { role: 'sandbox', perKind: { 'decrypt-qbeap': { executorId: 'remote-handshake' } } },
    ]
    expect(() => validateResolutionTable(bad)).toThrowError(/INV-6 violation: kind="decrypt-qbeap"/)
  })

  test('rejects decrypt-qbeap → remote-handshake as a fallback too', () => {
    const bad: ResolutionTable = [
      {
        role: 'sandbox',
        perKind: { 'decrypt-qbeap': { executorId: 'microvm', fallbackExecutorId: 'remote-handshake' } },
      },
    ]
    expect(() => validateResolutionTable(bad)).toThrowError(/INV-6 violation: kind="decrypt-qbeap"/)
  })

  test('rejects decrypt-qbeap on an appliance rule (content-key-less)', () => {
    const bad: ResolutionTable = [
      { role: 'appliance', perKind: { 'decrypt-qbeap': { executorId: 'in-process' } } },
    ]
    expect(() => validateResolutionTable(bad)).toThrowError(/role=appliance kind="decrypt-qbeap"/)
  })

  test('rejects view-attachment on an appliance rule (content-key-less)', () => {
    const bad: ResolutionTable = [
      { role: 'appliance', perKind: { 'view-attachment': { executorId: 'in-process' } } },
    ]
    expect(() => validateResolutionTable(bad)).toThrowError(/role=appliance kind="view-attachment"/)
  })

  test('permits view-attachment → remote-handshake from workstation (delivers to custody holder)', () => {
    const ok: ResolutionTable = [
      { role: 'workstation', perKind: { 'view-attachment': { executorId: 'remote-handshake' } } },
    ]
    expect(() => validateResolutionTable(ok)).not.toThrow()
  })
})

describe('resolve (pure)', () => {
  test('sandbox/free routes depackage + validators to in-process; link unsupported', () => {
    const c = ctx({ role: 'sandbox', tier: 'free' })
    expect(resolve(DEFAULT_RESOLUTION_TABLE, 'depackage', c)).toEqual({ executorId: 'in-process' })
    expect(resolve(DEFAULT_RESOLUTION_TABLE, 'validate-decrypted-beap', c)).toEqual({
      executorId: 'in-process',
    })
    expect(resolve(DEFAULT_RESOLUTION_TABLE, 'validate-native-beap', c)).toEqual({
      executorId: 'in-process',
    })
    expect(resolve(DEFAULT_RESOLUTION_TABLE, 'open-link', c)).toBeNull()
    expect(resolve(DEFAULT_RESOLUTION_TABLE, 'view-attachment', c)).toBeNull()
    // RESERVED/unimplemented (Amendment 1): no rule anywhere.
    expect(resolve(DEFAULT_RESOLUTION_TABLE, 'decrypt-qbeap', c)).toBeNull()
  })

  test('sandbox/paid routes depackage to microvm with NO fallback', () => {
    const c = ctx({ role: 'sandbox', tier: 'paid' })
    expect(resolve(DEFAULT_RESOLUTION_TABLE, 'depackage', c)).toEqual({ executorId: 'microvm' })
    expect(resolve(DEFAULT_RESOLUTION_TABLE, 'validate-decrypted-beap', c)).toEqual({
      executorId: 'in-process',
    })
  })

  test('appliance routes depackage to microvm with in-process fallback', () => {
    const c = ctx({ role: 'appliance', tier: 'paid' })
    expect(resolve(DEFAULT_RESOLUTION_TABLE, 'depackage', c)).toEqual({
      executorId: 'microvm',
      fallbackExecutorId: 'in-process',
    })
    // native-beap routes to the consumer (Build C) — unsupported here.
    expect(resolve(DEFAULT_RESOLUTION_TABLE, 'validate-native-beap', c)).toBeNull()
  })

  test('workstation routes untrusted-content remote, validate kinds in-process (transitional)', () => {
    const c = ctx({ role: 'workstation', tier: 'paid' })
    // Untrusted-content kinds → remote stub (dead until Build C), never in-process.
    for (const kind of ['depackage', 'open-link', 'view-attachment'] as const) {
      const r = resolve(DEFAULT_RESOLUTION_TABLE, kind, c)
      expect(r).not.toBeNull()
      expect(r!.executorId).toBe('remote-handshake')
      expect(r!.fallbackExecutorId).toBeUndefined()
    }
    // The two validate kinds → in-process via the transitional rule (B.1).
    for (const kind of ['validate-decrypted-beap', 'validate-native-beap'] as const) {
      const r = resolve(DEFAULT_RESOLUTION_TABLE, kind, c)
      expect(r).toEqual({ executorId: 'in-process', transitional: true })
    }
    // INV-6: the key-requiring decrypt-qbeap is never routed off-node, so the
    // workstation row has no rule for it (resolves to null, not remote).
    expect(resolve(DEFAULT_RESOLUTION_TABLE, 'decrypt-qbeap', c)).toBeNull()
  })

  test('execOverride replaces supported kinds only; unsupported stay unsupported', () => {
    const c = ctx({ role: 'sandbox', tier: 'free', execOverride: 'microvm' })
    expect(resolve(DEFAULT_RESOLUTION_TABLE, 'depackage', c)).toEqual({ executorId: 'microvm' })
    // open-link has no rule in sandbox/free → override must not invent support.
    expect(resolve(DEFAULT_RESOLUTION_TABLE, 'open-link', c)).toBeNull()
  })
})
