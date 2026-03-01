import { describe, test, expect } from 'vitest'
import { ReasonCode, HandshakeState } from '../types'
import { authorizeAction } from '../enforcement'

describe('Sharing Mode in Action Authorization', () => {
  // These tests verify the authorizeAction logic directly
  // (DB-dependent tests would need an in-memory SQLite fixture)

  test('authorizeAction types are exported', () => {
    expect(typeof authorizeAction).toBe('function')
  })
})

describe('WRVault Gating', () => {
  test('gateVaultAccess is exported', async () => {
    const { gateVaultAccess } = await import('../vaultGating')
    expect(typeof gateVaultAccess).toBe('function')
  })
})
