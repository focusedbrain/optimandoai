/**
 * Phase 2 — linked-topology validation + key-locality (spec 0017 §3.1).
 */

import { describe, test, expect, vi } from 'vitest'
import { validateLinkedEntry, validateLinkedTopology, loadLinkedTopology } from '../../topology'

describe('validateLinkedEntry — shape + key-locality (INV-6)', () => {
  test('accepts a sandbox entry routing key-less + custody-holder-local kinds', () => {
    const v = validateLinkedEntry({
      role: 'sandbox',
      handshakeId: 'hs-1',
      jobKinds: ['depackage', 'depackage-email', 'view-attachment'],
    })
    expect(v.ok).toBe(true)
  })

  test('rejects decrypt-qbeap in jobKinds (consumer-local, would ship keys)', () => {
    const v = validateLinkedEntry({ role: 'sandbox', handshakeId: 'hs-1', jobKinds: ['decrypt-qbeap'] })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/consumer-local|INV-6/)
  })

  test('rejects a key-requiring kind linked to an appliance (view-attachment)', () => {
    const v = validateLinkedEntry({ role: 'appliance', handshakeId: 'hs-1', jobKinds: ['view-attachment'] })
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/appliance|INV-6/)
  })

  test('appliance may route key-less kinds', () => {
    const v = validateLinkedEntry({ role: 'appliance', handshakeId: 'hs-1', jobKinds: ['depackage'] })
    expect(v.ok).toBe(true)
  })

  test('rejects unknown kind / bad role / empty handshake', () => {
    expect(validateLinkedEntry({ role: 'sandbox', handshakeId: 'h', jobKinds: ['nope'] }).ok).toBe(false)
    expect(validateLinkedEntry({ role: 'workstation', handshakeId: 'h', jobKinds: ['depackage'] }).ok).toBe(false)
    expect(validateLinkedEntry({ role: 'sandbox', handshakeId: '', jobKinds: ['depackage'] }).ok).toBe(false)
  })
})

describe('validateLinkedTopology — drops invalid, keeps valid', () => {
  test('drops the decrypt-qbeap entry, keeps the clean one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = validateLinkedTopology([
      { role: 'sandbox', handshakeId: 'good', jobKinds: ['depackage'] },
      { role: 'sandbox', handshakeId: 'bad', jobKinds: ['decrypt-qbeap'] },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].handshakeId).toBe('good')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  test('non-array config → []', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(validateLinkedTopology({ not: 'an array' })).toEqual([])
    expect(validateLinkedTopology(null)).toEqual([])
    warn.mockRestore()
  })
})

describe('loadLinkedTopology — override precedence', () => {
  const persisted = [{ role: 'sandbox', handshakeId: 'persisted', jobKinds: ['depackage'] }]

  test('env override wins over persisted', () => {
    const env = { WRDESK_TOPOLOGY_LINKED: JSON.stringify([{ role: 'sandbox', handshakeId: 'env', jobKinds: ['depackage'] }]) } as never
    const out = loadLinkedTopology(persisted, env, [])
    expect(out).toHaveLength(1)
    expect(out[0].handshakeId).toBe('env')
  })

  test('argv override wins when no env', () => {
    const argv = ['--topology-linked=' + JSON.stringify([{ role: 'appliance', handshakeId: 'argv', jobKinds: ['depackage'] }])]
    const out = loadLinkedTopology(persisted, {} as never, argv)
    expect(out[0].handshakeId).toBe('argv')
  })

  test('falls back to persisted', () => {
    const out = loadLinkedTopology(persisted, {} as never, [])
    expect(out[0].handshakeId).toBe('persisted')
  })

  test('malformed env JSON → [] (fail closed)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = loadLinkedTopology(persisted, { WRDESK_TOPOLOGY_LINKED: '{not json' } as never, [])
    expect(out).toEqual([])
    warn.mockRestore()
  })
})
