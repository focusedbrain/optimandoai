/**
 * One-click Podman setup orchestrator
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const refreshPodmanSetupProbe = vi.hoisted(() => vi.fn())
const runPodmanInstallAction = vi.hoisted(() => vi.fn())
const broadcastPodmanSetupState = vi.hoisted(() => vi.fn())
const getInstallActionsForPlatform = vi.hoisted(() => vi.fn())

vi.mock('../podmanSetupProbe.js', () => ({
  refreshPodmanSetupProbe,
}))

vi.mock('../podmanInstallRunner.js', () => ({
  runPodmanInstallAction,
  getInstallActionsForPlatform,
}))

vi.mock('../podmanSetupBroadcast.js', () => ({
  broadcastPodmanSetupState,
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
    refreshPodmanSetupProbe.mockReset()
    runPodmanInstallAction.mockReset()
    broadcastPodmanSetupState.mockReset()
    getInstallActionsForPlatform.mockReturnValue({
      canAutoInstall: true,
      installAction: 'winget_install',
      installLabel: 'Install & set up Podman',
      installCommand: 'winget install ...',
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

  test('full path: install → init → start → ready', async () => {
    refreshPodmanSetupProbe
      .mockResolvedValueOnce({ code: 'not_installed' })
      .mockResolvedValueOnce({ code: 'machine_not_initialized' })
      .mockResolvedValueOnce({ code: 'machine_not_running' })
      .mockResolvedValueOnce(null)

    runPodmanInstallAction
      .mockResolvedValueOnce(okResult('winget install'))
      .mockResolvedValueOnce(okResult('podman machine init'))
      .mockResolvedValueOnce(okResult('podman machine start'))

    const result = await runFullPodmanSetup()
    expect(result.ok).toBe(true)
    expect(runPodmanInstallAction).toHaveBeenCalledTimes(3)
    expect(runPodmanInstallAction.mock.calls.map((c) => c[0])).toEqual([
      'winget_install',
      'machine_init',
      'machine_start',
    ])
  })

  test('partial state: package present, machine stopped — skips install', async () => {
    refreshPodmanSetupProbe
      .mockResolvedValueOnce({ code: 'machine_not_running' })
      .mockResolvedValueOnce(null)

    runPodmanInstallAction.mockResolvedValueOnce(okResult('podman machine start'))

    const result = await runFullPodmanSetup()
    expect(result.ok).toBe(true)
    expect(runPodmanInstallAction).toHaveBeenCalledTimes(1)
    expect(runPodmanInstallAction.mock.calls[0]?.[0]).toBe('machine_start')
  })

  test('install failure surfaces hard error', async () => {
    refreshPodmanSetupProbe.mockResolvedValueOnce({ code: 'not_installed' })
    runPodmanInstallAction.mockResolvedValueOnce({
      ok: false,
      command: 'winget install',
      stdout: '',
      stderr: 'Network error',
      exitCode: 1,
    })

    const result = await runFullPodmanSetup()
    expect(result.ok).toBe(false)
    expect(result.failure?.message).toMatch(/could not be installed/i)
    expect(result.failure?.detail).toMatch(/Network error/)
  })
})
