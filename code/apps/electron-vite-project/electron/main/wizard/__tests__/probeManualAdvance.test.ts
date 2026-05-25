/**
 * Probe step advances only on explicit Continue (A3).
 */

import { describe, test, expect } from 'vitest'

import { INITIAL_WIZARD_STATE, wizardReducer } from '../stateMachine.js'

describe('wizard probe manual advance', () => {
  test('PROBE_SUCCESS does not leave probe step', () => {
    const afterProbe = wizardReducer(INITIAL_WIZARD_STATE, {
      type: 'PROBE_SUCCESS',
      probe: {
        distro: 'ubuntu',
        version: '22.04',
        family: 'debian',
        podman_installed: true,
        package_manager: 'dpkg',
        is_root: true,
        has_passwordless_sudo: true,
        verdict: { ok: true },
      },
    })
    expect(afterProbe.step).toBe('probe_and_prepare')
    expect(afterProbe.podmanReady).toBe(true)
  })

  test('PODMAN_READY advances first replica to replica_count', () => {
    const afterContinue = wizardReducer(
      wizardReducer(INITIAL_WIZARD_STATE, {
        type: 'PROBE_SUCCESS',
        probe: {
          distro: 'ubuntu',
          version: '22.04',
          family: 'debian',
          podman_installed: true,
          package_manager: 'dpkg',
          is_root: true,
          has_passwordless_sudo: true,
          verdict: { ok: true },
        },
      }),
      { type: 'PODMAN_READY' },
    )
    expect(afterContinue.step).toBe('replica_count')
  })
})
