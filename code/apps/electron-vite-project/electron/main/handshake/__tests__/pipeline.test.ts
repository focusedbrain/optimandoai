import { describe, test, expect } from 'vitest'
import { runHandshakeVerification } from '../pipeline'
import { ReasonCode } from '../types'
import type { PipelineStep } from '../types'
import { buildVerifiedCapsuleInput, buildReceiverPolicy, buildSSOSession } from './helpers'

describe('Pipeline Runner', () => {
  const passStep: PipelineStep = { name: 'pass', execute: () => ({ passed: true }) }
  const failStep: PipelineStep = { name: 'fail', execute: () => ({ passed: false, reason: ReasonCode.INTERNAL_ERROR }) }
  const throwStep: PipelineStep = { name: 'throw', execute: () => { throw new Error('boom') } }
  const nullStep: PipelineStep = { name: 'null_result', execute: () => null as any }
  const undefinedStep: PipelineStep = { name: 'undef_result', execute: () => undefined as any }

  const input = buildVerifiedCapsuleInput()
  const policy = buildReceiverPolicy()
  const session = buildSSOSession()
  const lookups = { seenCapsuleHashes: new Set<string>(), contextBlockVersions: new Map(), existingHandshakes: [] as any[], localUserId: 'local-user-001' }

  test('all steps must pass', () => {
    const result = runHandshakeVerification([passStep, passStep], input, policy, session, null, lookups)
    expect(result.success).toBe(true)
  })

  test('exception → INTERNAL_ERROR', () => {
    const result = runHandshakeVerification([throwStep], input, policy, session, null, lookups)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.reason).toBe(ReasonCode.INTERNAL_ERROR)
      expect(result.failedStep).toBe('throw')
    }
  })

  test('frozen pipeline', () => {
    const pipeline = Object.freeze([passStep])
    const result = runHandshakeVerification(pipeline, input, policy, session, null, lookups)
    expect(result.success).toBe(true)
  })

  test('null/undefined step result → INTERNAL_ERROR', () => {
    const r1 = runHandshakeVerification([nullStep], input, policy, session, null, lookups)
    expect(r1.success).toBe(false)
    if (!r1.success) expect(r1.reason).toBe(ReasonCode.INTERNAL_ERROR)

    const r2 = runHandshakeVerification([undefinedStep], input, policy, session, null, lookups)
    expect(r2.success).toBe(false)
    if (!r2.success) expect(r2.reason).toBe(ReasonCode.INTERNAL_ERROR)
  })

  test('first failure stops pipeline', () => {
    let secondRan = false
    const trackStep: PipelineStep = { name: 'track', execute: () => { secondRan = true; return { passed: true } } }
    runHandshakeVerification([failStep, trackStep], input, policy, session, null, lookups)
    expect(secondRan).toBe(false)
  })
})

describe('Pipeline Order', () => {
  test('schema first', async () => {
    const { HANDSHAKE_PIPELINE } = await import('../steps')
    expect(HANDSHAKE_PIPELINE[0].name).toBe('check_schema_version')
  })

  test('dedup before ownership', async () => {
    const { HANDSHAKE_PIPELINE } = await import('../steps')
    const names = HANDSHAKE_PIPELINE.map(s => s.name)
    expect(names.indexOf('check_duplicate_capsule')).toBeLessThan(names.indexOf('verify_handshake_ownership'))
  })

  test('ownership before state transition', async () => {
    const { HANDSHAKE_PIPELINE } = await import('../steps')
    const names = HANDSHAKE_PIPELINE.map(s => s.name)
    expect(names.indexOf('verify_handshake_ownership')).toBeLessThan(names.indexOf('check_state_transition'))
  })

  test('sharing mode after state transition, before context binding', async () => {
    const { HANDSHAKE_PIPELINE } = await import('../steps')
    const names = HANDSHAKE_PIPELINE.map(s => s.name)
    expect(names.indexOf('verify_sharing_mode')).toBeGreaterThan(names.indexOf('check_state_transition'))
    expect(names.indexOf('verify_sharing_mode')).toBeLessThan(names.indexOf('verify_context_binding'))
  })

  test('external processing before policy resolution', async () => {
    const { HANDSHAKE_PIPELINE } = await import('../steps')
    const names = HANDSHAKE_PIPELINE.map(s => s.name)
    expect(names.indexOf('verify_external_processing')).toBeLessThan(names.indexOf('resolve_effective_policy'))
  })

  test('minimum tier after classification', async () => {
    const { HANDSHAKE_PIPELINE } = await import('../steps')
    const names = HANDSHAKE_PIPELINE.map(s => s.name)
    expect(names.indexOf('enforce_minimum_tier')).toBeGreaterThan(names.indexOf('classify_tier'))
  })
})
