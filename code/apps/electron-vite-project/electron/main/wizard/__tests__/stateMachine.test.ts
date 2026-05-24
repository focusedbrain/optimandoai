/**
 * Wizard state machine — unit tests (P4.4)
 */

import { describe, test, expect } from 'vitest'

import { INITIAL_WIZARD_STATE, wizardReducer } from '../stateMachine.js'
import type { TargetProbe } from '../../edge-tier/ssh/types.js'

function okProbe(overrides: Partial<TargetProbe> = {}): TargetProbe {
  return {
    distro: 'ubuntu',
    version: '22.04',
    family: 'debian',
    podman_installed: true,
    package_manager: 'dpkg',
    is_root: false,
    has_passwordless_sudo: true,
    verdict: { ok: true },
    ...overrides,
  }
}

describe('wizardReducer', () => {
  test('authenticate success moves to provide_vm', () => {
    const next = wizardReducer(INITIAL_WIZARD_STATE, {
      type: 'AUTH_SUCCESS',
      plan: 'pro',
      sub: 'user-123',
    })
    expect(next.step).toBe('provide_vm')
    expect(next.authenticate?.sub).toBe('user-123')
  })

  test('authenticate failure records error', () => {
    const next = wizardReducer(INITIAL_WIZARD_STATE, {
      type: 'AUTH_FAILED',
      message: 'not paid',
    })
    expect(next.step).toBe('authenticate')
    expect(next.error?.message).toBe('not paid')
  })

  test('vm credentials move to probe_and_prepare', () => {
    const state = wizardReducer(INITIAL_WIZARD_STATE, {
      type: 'AUTH_SUCCESS',
      plan: 'pro',
      sub: 'user-123',
    })
    const next = wizardReducer(state, {
      type: 'VM_CREDENTIALS_SET',
      credentials: { host: '1.2.3.4', port: 22, username: 'root' },
    })
    expect(next.step).toBe('probe_and_prepare')
    expect(next.vmCredentials?.host).toBe('1.2.3.4')
  })

  test('probe success with podman moves first replica to replica_count', () => {
    let state = wizardReducer(INITIAL_WIZARD_STATE, {
      type: 'AUTH_SUCCESS',
      plan: 'pro',
      sub: 'u',
    })
    state = wizardReducer(state, {
      type: 'VM_CREDENTIALS_SET',
      credentials: { host: 'h', port: 22, username: 'u' },
    })
    state = wizardReducer(state, { type: 'PROBE_SUCCESS', probe: okProbe() })
    state = wizardReducer(state, { type: 'PODMAN_READY' })
    expect(state.step).toBe('replica_count')
  })

  test('replica count advances to generate_and_deploy', () => {
    let state = wizardReducer(INITIAL_WIZARD_STATE, { type: 'REPLICA_COUNT_SET', count: 2 })
    expect(state.step).toBe('generate_and_deploy')
    expect(state.totalReplicas).toBe(2)
  })

  test('deploy success moves to verify_and_switch', () => {
    const next = wizardReducer(INITIAL_WIZARD_STATE, {
      type: 'DEPLOY_SUCCESS',
      replica: { host: 'h', port: 18100, podId: 'p', publicKey: 'ed25519:aa' },
    })
    expect(next.step).toBe('verify_and_switch')
    expect(next.deployedReplicas).toHaveLength(1)
  })

  test('verify success with more replicas returns to provide_vm', () => {
    let state = {
      ...INITIAL_WIZARD_STATE,
      replicaIndex: 0,
      totalReplicas: 2,
      step: 'verify_and_switch' as const,
    }
    state = wizardReducer(state, { type: 'VERIFY_SUCCESS' })
    expect(state.step).toBe('provide_vm')
    expect(state.replicaIndex).toBe(1)
    expect(state.vmCredentials).toBeUndefined()
  })

  test('verify success on last replica completes wizard', () => {
    let state = {
      ...INITIAL_WIZARD_STATE,
      replicaIndex: 1,
      totalReplicas: 2,
      step: 'verify_and_switch' as const,
    }
    state = wizardReducer(state, { type: 'VERIFY_SUCCESS' })
    expect(state.step).toBe('complete')
    expect(state.lastVerify?.verified).toBe(true)
  })

  test('verify failure records reason', () => {
    const state = {
      ...INITIAL_WIZARD_STATE,
      step: 'verify_and_switch' as const,
    }
    const next = wizardReducer(state, {
      type: 'VERIFY_FAILED',
      message: 'edge unreachable',
    })
    expect(next.step).toBe('verify_and_switch')
    expect(next.lastVerify?.verified).toBe(false)
    expect(next.error?.message).toBe('edge unreachable')
  })
})
