/**
 * One-click Podman setup orchestrator
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const refreshPodmanSetupProbe = vi.hoisted(() => vi.fn())
const invalidatePodmanSetupProbeCache = vi.hoisted(() => vi.fn())
const runPodmanInstallAction = vi.hoisted(() => vi.fn())
const broadcastPodmanSetupState = vi.hoisted(() => vi.fn())
const getInstallActionsForPlatform = vi.hoisted(() => vi.fn())
const refreshWslStatusCache = vi.hoisted(() => vi.fn())
const platformMock = vi.hoisted(() => vi.fn(() => 'darwin' as NodeJS.Platform))

vi.mock('node:os', () => ({
  platform: platformMock,
}))

vi.mock('../podmanSetupProbe.js', () => ({
  refreshPodmanSetupProbe,
  invalidatePodmanSetupProbeCache,
}))

vi.mock('../podmanInstallRunner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../podmanInstallRunner.js')>()
  return {
    ...actual,
    runPodmanInstallAction,
    getInstallActionsForPlatform,
  }
})

vi.mock('../podmanSetupBroadcast.js', () => ({
  broadcastPodmanSetupState,
}))

vi.mock('../wslProbe.js', () => ({
  outputImpliesReboot: (text: string) => text.toLowerCase().includes('restart'),
  rebootRequiredMessage: (context?: string) =>
    context === 'wsl_fresh_install'
      ? {
          message: 'Restart your computer to finish installing WSL',
          detail: 'After restarting, open WR Desk again.',
        }
      : {
          message: 'Restart your computer to finish Windows setup',
          detail: 'After restarting, open WR Desk again.',
        },
  virtualizationRequiredMessage: () => ({
    message: 'Enable virtualization',
    detail: 'Enable VT-x/AMD-V in firmware.',
  }),
  runWslInstall: vi.fn(),
  runWslInstallWithDistro: vi.fn(),
  runWslUpdate: vi.fn(),
}))

vi.mock('../podmanWslStatusCache.js', () => ({
  refreshWslStatusCache,
}))

vi.mock('../podStatus.js', () => ({
  getPodSetupErrorRef: () => null,
}))

import {
  resetPodmanSetupRunStateForTest,
  runFullPodmanSetup,
} from '../podmanSetupOrchestrator.js'

function okResult(command: string) {
  return { ok: true, command, stdout: '', stderr: '', exitCode: 0 }
}

describe('runFullPodmanSetup', () => {
  beforeEach(() => {
    resetPodmanSetupRunStateForTest()
    platformMock.mockReturnValue('darwin')
    refreshPodmanSetupProbe.mockReset()
    invalidatePodmanSetupProbeCache.mockReset()
    runPodmanInstallAction.mockReset()
    broadcastPodmanSetupState.mockReset()
    refreshWslStatusCache.mockResolvedValue({
      issue: 'ready',
      rebootRequired: false,
      userMessage: 'ready',
      logSummary: [],
    })
    getInstallActionsForPlatform.mockReturnValue({
      canAutoInstall: true,
      installAction: 'brew_install',
      installLabel: 'Install & set up Podman',
      installCommand: 'brew install podman',
      manualHint: 'podman.io',
      linuxDistroHints: [],
    })
  })

  test('already ready — no commands', async () => {
    refreshPodmanSetupProbe.mockResolvedValue(null)
    const result = await runFullPodmanSetup()
    expect(result.ok).toBe(true)
    expect(runPodmanInstallAction).not.toHaveBeenCalled()
  })

  test('macOS full path: install → init → start → ready', async () => {
    refreshPodmanSetupProbe
      .mockResolvedValueOnce({ code: 'not_installed' })
      .mockResolvedValueOnce({ code: 'machine_not_initialized' })
      .mockResolvedValueOnce({ code: 'machine_not_running' })
      .mockResolvedValueOnce(null)

    runPodmanInstallAction
      .mockResolvedValueOnce(okResult('brew install'))
      .mockResolvedValueOnce(okResult('podman machine init'))
      .mockResolvedValueOnce(okResult('podman machine start'))

    const result = await runFullPodmanSetup()
    expect(result.ok).toBe(true)
    expect(runPodmanInstallAction).toHaveBeenCalledTimes(3)
  })

  test('Windows checks WSL before Podman', async () => {
    platformMock.mockReturnValue('win32')
    getInstallActionsForPlatform.mockReturnValue({
      canAutoInstall: true,
      installAction: 'winget_install',
      installLabel: 'Install & set up Podman',
      installCommand: 'winget install',
      manualHint: 'podman.io',
      linuxDistroHints: [],
    })
    refreshWslStatusCache.mockResolvedValue({
      issue: 'not_installed',
      rebootRequired: true,
      userMessage: 'WSL required',
      logSummary: ['status: empty'],
    })

    const { runWslInstall } = await import('../wslProbe.js')
    vi.mocked(runWslInstall).mockResolvedValue({
      ok: true,
      command: 'wsl --install',
      stdout: 'Changes will not be effective until the system is rebooted',
      stderr: '',
      exitCode: 0,
    })

    refreshPodmanSetupProbe.mockResolvedValue({ code: 'not_installed' })

    const result = await runFullPodmanSetup()
    expect(result.ok).toBe(false)
    expect(result.failure?.kind).toBe('restart_required')
    expect(result.failure?.message).toMatch(/restart/i)
  })

  test('Linux returns operator instruction — no install action', async () => {
    platformMock.mockReturnValue('linux')
    refreshPodmanSetupProbe.mockResolvedValue({ code: 'not_installed' })

    const result = await runFullPodmanSetup()
    expect(result.ok).toBe(false)
    expect(result.failure?.kind).toBe('operator_instruction')
    expect(result.failure?.detail).toMatch(/operator must run/i)
    expect(runPodmanInstallAction).not.toHaveBeenCalled()
  })

  test('install failure surfaces plain error without raw stderr', async () => {
    refreshPodmanSetupProbe
      .mockResolvedValueOnce({ code: 'not_installed' })
      .mockResolvedValueOnce({ code: 'not_installed' })

    runPodmanInstallAction.mockResolvedValueOnce({
      ok: false,
      command: 'brew install',
      stdout: '',
      stderr: 'DΦeΦrΦ Network error',
      exitCode: 1,
    })

    const result = await runFullPodmanSetup()
    expect(result.ok).toBe(false)
    expect(result.failure?.message).toMatch(/could not be installed/i)
    expect(result.failure?.detail).not.toMatch(/DΦ/)
  })
})
