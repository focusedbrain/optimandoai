/**
 * Podman setup status phases
 */

import { describe, expect, test } from 'vitest'

import {
  derivePodmanSetupPhase,
  resolveTerminalAction,
  setupPhaseHeadline,
  setupPhaseSummary,
} from '../podmanSetupStatus.js'

describe('derivePodmanSetupPhase', () => {
  test('linux not installed → operator phase', () => {
    expect(derivePodmanSetupPhase(false, 'not_installed', 'linux')).toBe('need_operator_install')
  })

  test('windows package missing', () => {
    expect(derivePodmanSetupPhase(false, 'not_installed', 'win32')).toBe('need_package')
  })
})

describe('resolveTerminalAction', () => {
  test('linux operator install — no one click', () => {
    expect(resolveTerminalAction('need_operator_install', 'linux', false)).toBe('operator_install')
  })

  test('windows package — one click when auto install available', () => {
    expect(resolveTerminalAction('need_package', 'win32', true)).toBe('one_click')
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
      'need_operator_install',
      'need_restart',
      'need_virtualization',
    ] as const
    for (const phase of phases) {
      const text = `${setupPhaseHeadline(phase)} ${setupPhaseSummary(phase, 'win32')}`.toLowerCase()
      expect(text).not.toMatch(/relay|websocket|capsule|beap/)
    }
  })
})
