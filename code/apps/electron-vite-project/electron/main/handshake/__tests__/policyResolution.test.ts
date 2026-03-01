import { describe, test, expect } from 'vitest'
import { resolveEffectivePolicyFn } from '../steps/policyResolution'
import { buildReceiverPolicy } from './helpers'
import type { CapsulePolicy } from '../types'

describe('Policy Resolution', () => {
  test('capsule elevates scope → RECEIVER_POLICY_UNSATISFIABLE when receiver has specific scopes', () => {
    const receiver = buildReceiverPolicy({ allowedScopes: ['read'] })
    const capsule: CapsulePolicy = { requestedScopes: ['write'] }
    const result = resolveEffectivePolicyFn(capsule, receiver)
    expect('unsatisfiable' in result).toBe(true)
  })

  test('capsule restricts → narrowed', () => {
    const receiver = buildReceiverPolicy({ allowedScopes: ['read', 'write', 'admin'] })
    const capsule: CapsulePolicy = { requestedScopes: ['read', 'write'] }
    const result = resolveEffectivePolicyFn(capsule, receiver)
    expect('unsatisfiable' in result).toBe(false)
    if (!('unsatisfiable' in result)) {
      expect(result.allowedScopes).toEqual(['read', 'write'])
    }
  })

  test('no capsule policy → receiver policy unchanged', () => {
    const receiver = buildReceiverPolicy({ allowedScopes: ['*'] })
    const result = resolveEffectivePolicyFn(null, receiver)
    expect('unsatisfiable' in result).toBe(false)
    if (!('unsatisfiable' in result)) {
      expect(result.allowedScopes).toEqual(['*'])
    }
  })

  test('capsule reciprocalAllowed=false → only receive-only in effective modes', () => {
    const receiver = buildReceiverPolicy({ allowedSharingModes: ['receive-only', 'reciprocal'] })
    const capsule: CapsulePolicy = { reciprocalAllowed: false }
    const result = resolveEffectivePolicyFn(capsule, receiver)
    expect('unsatisfiable' in result).toBe(false)
    if (!('unsatisfiable' in result)) {
      expect(result.effectiveSharingModes).toEqual(['receive-only'])
      expect(result.reciprocalAllowed).toBe(false)
    }
  })

  test('capsule maxExternalProcessing=none → cloud denied', () => {
    const receiver = buildReceiverPolicy({ allowsCloudEscalation: true })
    const capsule: CapsulePolicy = { maxExternalProcessing: 'none' }
    const result = resolveEffectivePolicyFn(capsule, receiver)
    expect('unsatisfiable' in result).toBe(false)
    if (!('unsatisfiable' in result)) {
      expect(result.allowsCloudEscalation).toBe(false)
    }
  })

  test('minimum tier = max of receiver and capsule', () => {
    const receiver = buildReceiverPolicy({ minimumTier: 'pro' })
    const capsule: CapsulePolicy = { minimumReceiverTier: 'publisher' }
    const result = resolveEffectivePolicyFn(capsule, receiver)
    expect('unsatisfiable' in result).toBe(false)
    if (!('unsatisfiable' in result)) {
      expect(result.effectiveTier).toBe('publisher')
    }
  })

  test('wildcard scopes allow any capsule scopes', () => {
    const receiver = buildReceiverPolicy({ allowedScopes: ['*'] })
    const capsule: CapsulePolicy = { requestedScopes: ['any-scope', 'custom-scope'] }
    const result = resolveEffectivePolicyFn(capsule, receiver)
    expect('unsatisfiable' in result).toBe(false)
    if (!('unsatisfiable' in result)) {
      expect(result.allowedScopes).toEqual(['any-scope', 'custom-scope'])
    }
  })
})
