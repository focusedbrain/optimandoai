/**
 * Podman setup status phases
 */

import { describe, expect, test, vi } from 'vitest'

vi.mock('../podmanInstallRunner.js', () => ({
  getInstallActionsForPlatform: () => ({
    canAutoInstall: true,
    installAction: 'winget_install',
    installLabel: 'Install & set up Podman',
    installCommand: 'winget install RedHat.Podman',
    manualHint: 'podman.io',
    linuxDistroHints: [],
  }),
}))

vi.mock('../podStatus.js', () => ({
  getPodSetupErrorRef: () => null,
  isPodmanProbeComplete: () => true,
}))

vi.mock('../podmanWslStatusCache.js', () => ({
  getWslStatusCache: () => null,
}))

vi.mock('../podmanMachineRecovery.js', () => ({
  isPodmanMachineRecoveryActive: () => false,
}))

vi.mock('../linuxDistroDetect.js', () => ({
  buildLinuxEngineOperatorInstruction: () => 'engine instruction',
  buildLinuxOperatorInstruction: () => 'operator instruction',
  detectLinuxDistroHint: () => ({
    id: 'debian',
    label: 'Debian',
    installCommand: 'apt install podman',
  }),
}))

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
    expect(resolveTerminalAction('need_operator_install', 'linux')).toBe('operator_install')
  })

  test('stopped machine maps to engine attention, not setup modal phase', () => {
    expect(derivePodmanSetupPhase(false, 'machine_not_running', 'win32')).toBe('need_engine')
    expect(resolveTerminalAction('need_engine', 'win32')).toBe('one_click')
  })

  test('linux engine — operator not one click on win32', () => {
    expect(resolveTerminalAction('need_engine', 'win32')).toBe('one_click')
    expect(resolveTerminalAction('need_engine', 'linux')).toBe('operator_install')
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
