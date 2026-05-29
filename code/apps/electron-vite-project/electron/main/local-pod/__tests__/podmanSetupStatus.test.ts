/**
 * Podman setup status phases
 */

import { describe, expect, test } from 'vitest'

import {
  derivePodmanSetupPhase,
  setupPhaseHeadline,
  setupPhaseSummary,
} from '../podmanSetupStatus.js'

describe('derivePodmanSetupPhase', () => {
  test('package installed but machine not init', () => {
    expect(derivePodmanSetupPhase(false, 'machine_not_initialized')).toBe('need_machine_init')
  })

  test('winget already installed path — not stuck on need_package when machine required', () => {
    expect(derivePodmanSetupPhase(false, 'not_installed')).toBe('need_package')
    expect(derivePodmanSetupPhase(false, 'machine_not_running')).toBe('need_machine_start')
  })
})

describe('customer copy', () => {
  test('headlines and summaries avoid internal terms', () => {
    const phases = [
      'checking',
      'need_package',
      'need_machine_init',
      'need_machine_start',
      'need_engine',
    ] as const
    for (const phase of phases) {
      const text = `${setupPhaseHeadline(phase)} ${setupPhaseSummary(phase)}`.toLowerCase()
      expect(text).not.toMatch(/relay|websocket|capsule|beap/)
      expect(text).toMatch(/podman|container|isol/)
    }
  })
})
