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

  test('workstation routes every ROUTABLE kind to remote-handshake (never in-process)', () => {
    const c = ctx({ role: 'workstation', tier: 'paid' })
    for (const kind of [
      'depackage',
      'validate-decrypted-beap',
      'validate-native-beap',
      'open-link',
      'view-attachment',
    ] as const) {
      const r = resolve(DEFAULT_RESOLUTION_TABLE, kind, c)
      expect(r).not.toBeNull()
      expect(r!.executorId).toBe('remote-handshake')
      expect(r!.fallbackExecutorId).toBeUndefined()
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
