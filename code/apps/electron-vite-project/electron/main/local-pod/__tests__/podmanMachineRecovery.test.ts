/**
 * Podman machine auto-recovery — unit tests
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

const probePodmanMachineState = vi.hoisted(() => vi.fn())
const runPodmanInstallAction = vi.hoisted(() => vi.fn())
const broadcastPodmanSetupState = vi.hoisted(() => vi.fn())
const invalidatePodmanSetupProbeCache = vi.hoisted(() => vi.fn())

vi.mock('../podmanDetect.js', () => ({
  probePodmanMachineState,
}))

vi.mock('../podmanInstallRunner.js', () => ({
  runPodmanInstallAction,
}))

vi.mock('../podmanSetupBroadcast.js', () => ({
  broadcastPodmanSetupState,
}))

vi.mock('../podmanSetupProbe.js', () => ({
  invalidatePodmanSetupProbeCache,
}))

import {
  isPodmanMachineRecoveryActive,
  resetPodmanMachineRecoveryForTest,
  runPodmanMachineAutoRecoveryIfNeeded,
} from '../podmanMachineRecovery.js'

beforeEach(() => {
  resetPodmanMachineRecoveryForTest()
  probePodmanMachineState.mockReset()
  runPodmanInstallAction.mockReset()
  broadcastPodmanSetupState.mockReset()
  invalidatePodmanSetupProbeCache.mockReset()
})

describe('runPodmanMachineAutoRecoveryIfNeeded', () => {
  test('linux — no-op success', async () => {
    const ok = await runPodmanMachineAutoRecoveryIfNeeded({ platform: 'linux' })
    expect(ok).toBe(true)
    expect(runPodmanInstallAction).not.toHaveBeenCalled()
  })

  test('running machine — skips start', async () => {
    probePodmanMachineState.mockResolvedValue('running')
    const ok = await runPodmanMachineAutoRecoveryIfNeeded({ platform: 'win32' })
    expect(ok).toBe(true)
    expect(runPodmanInstallAction).not.toHaveBeenCalled()
  })

  test('no machine — does not auto-start', async () => {
    probePodmanMachineState.mockResolvedValue('none')
    const ok = await runPodmanMachineAutoRecoveryIfNeeded({ platform: 'win32' })
    expect(ok).toBe(false)
    expect(runPodmanInstallAction).not.toHaveBeenCalled()
  })

  test('stopped machine — runs podman machine start and waits for running', async () => {
    let releaseStart: (() => void) | undefined
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve
    })
    probePodmanMachineState
      .mockResolvedValueOnce('stopped')
      .mockResolvedValueOnce('stopped')
      .mockResolvedValueOnce('running')
    runPodmanInstallAction.mockImplementation(async () => {
      await startGate
      return { ok: true, command: 'podman machine start' }
    })

    const pending = runPodmanMachineAutoRecoveryIfNeeded({ platform: 'win32' })
    await new Promise((r) => setTimeout(r, 0))
    expect(isPodmanMachineRecoveryActive()).toBe(true)
    releaseStart?.()
    const ok = await pending
    expect(ok).toBe(true)
    expect(isPodmanMachineRecoveryActive()).toBe(false)
    expect(runPodmanInstallAction).toHaveBeenCalledWith('machine_start')
    expect(broadcastPodmanSetupState).toHaveBeenCalled()
  })

  test('stopped machine — start command failure returns false', async () => {
    probePodmanMachineState.mockResolvedValue('stopped')
    runPodmanInstallAction.mockResolvedValue({ ok: false, command: 'podman machine start' })

    const ok = await runPodmanMachineAutoRecoveryIfNeeded({ platform: 'win32' })
    expect(ok).toBe(false)
  })

  test('single-flight — concurrent callers share one recovery', async () => {
    probePodmanMachineState
      .mockResolvedValueOnce('stopped')
      .mockResolvedValueOnce('stopped')
      .mockResolvedValueOnce('running')
    runPodmanInstallAction.mockResolvedValue({ ok: true, command: 'podman machine start' })

    const [a, b] = await Promise.all([
      runPodmanMachineAutoRecoveryIfNeeded({ platform: 'win32' }),
      runPodmanMachineAutoRecoveryIfNeeded({ platform: 'win32' }),
    ])
    expect(a).toBe(true)
    expect(b).toBe(true)
    expect(runPodmanInstallAction).toHaveBeenCalledTimes(1)
  })
})
