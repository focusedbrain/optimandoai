/**
 * Podman feature-detect — unit tests
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'

const runPodmanMachineAutoRecoveryIfNeeded = vi.hoisted(() => vi.fn())

vi.mock('../podmanMachineRecovery.js', () => ({
  runPodmanMachineAutoRecoveryIfNeeded,
}))

import {
  assertPodmanReady,
  clearPodmanBinCacheForTest,
  PodmanSetupError,
  PODMAN_SETUP_MESSAGES,
  type ExecFileFn,
} from '../podmanDetect.js'

function makeExecFile(responses: Record<string, string | Error>): ExecFileFn {
  return async (file, args) => {
    const podKey = args.length > 0 ? `podman ${args[0]}` : 'podman'
    const whereKey = file.toLowerCase().includes('podman') ? podKey : `${file} ${args.join(' ')}`
    const key = `${file} ${args.join(' ')}`
    const response =
      responses[podKey] ??
      responses[whereKey] ??
      responses[key] ??
      (file === 'where' ? responses['where podman'] : undefined) ??
      (file === 'which' ? responses['which podman'] : undefined)
    if (response instanceof Error) throw response
    if (response === undefined) {
      throw new Error(`unexpected exec: ${file} ${args.join(' ')}`)
    }
    return { stdout: response, stderr: '' }
  }
}

beforeEach(() => {
  clearPodmanBinCacheForTest()
  runPodmanMachineAutoRecoveryIfNeeded.mockReset()
  runPodmanMachineAutoRecoveryIfNeeded.mockResolvedValue(false)
})

describe('assertPodmanReady', () => {
  test('linux: podman on PATH passes without machine check', async () => {
    const execFile = makeExecFile({
      'which podman': '/usr/bin/podman',
      'podman info': '{"host":{}}',
      'podman ps': '',
    })

    await expect(
      assertPodmanReady({ platform: 'linux', execFile }),
    ).resolves.toBeUndefined()
  })

  test('win32: machine missing is reported before engine failure', async () => {
    const execFile = makeExecFile({
      'where podman': 'C:\\Program Files\\RedHat\\Podman\\podman.exe',
      'podman machine': '[]',
      'podman info': '{"host":{}}',
    })

    await expect(assertPodmanReady({ platform: 'win32', execFile })).rejects.toMatchObject({
      code: 'machine_not_initialized',
      userMessage: PODMAN_SETUP_MESSAGES.machine_not_initialized,
    })
  })

  test('win32: stopped machine attempts auto-start before failing', async () => {
    const execFile = makeExecFile({
      'where podman': 'C:\\Program Files\\RedHat\\Podman\\podman.exe',
      'podman machine': '[{"Name":"podman-machine-default","Running":false}]',
    })
    runPodmanMachineAutoRecoveryIfNeeded.mockResolvedValue(false)

    await expect(assertPodmanReady({ platform: 'win32', execFile })).rejects.toMatchObject({
      code: 'machine_not_running',
    })
    expect(runPodmanMachineAutoRecoveryIfNeeded).toHaveBeenCalled()
  })

  test('win32: auto-start success allows readiness check to continue', async () => {
    let machineProbeCount = 0
    const execFile: ExecFileFn = async (file, args) => {
      if (file.toLowerCase().includes('podman') && args[0] === 'machine') {
        machineProbeCount++
        return {
          stdout:
            machineProbeCount >= 2
              ? '[{"Name":"podman-machine-default","Running":true}]'
              : '[{"Name":"podman-machine-default","Running":false}]',
          stderr: '',
        }
      }
      if (file === 'where') {
        return { stdout: 'C:\\Program Files\\RedHat\\Podman\\podman.exe', stderr: '' }
      }
      if (args[0] === 'info') return { stdout: '{"host":{}}', stderr: '' }
      if (args[0] === 'ps') return { stdout: '', stderr: '' }
      throw new Error(`unexpected exec: ${file} ${args.join(' ')}`)
    }

    runPodmanMachineAutoRecoveryIfNeeded.mockResolvedValue(true)

    await expect(
      assertPodmanReady({ platform: 'win32', execFile }),
    ).resolves.toBeUndefined()
  })

  test('win32: podman on PATH and running machine passes with pod ps', async () => {
    const execFile = makeExecFile({
      'where podman': 'C:\\Program Files\\RedHat\\Podman\\podman.exe',
      'podman info': '{"host":{}}',
      'podman machine': '[{"Name":"podman-machine-default","Running":true}]',
      'podman ps': '',
    })

    await expect(
      assertPodmanReady({ platform: 'win32', execFile }),
    ).resolves.toBeUndefined()
  })

  test('win32: podman missing throws not_installed', async () => {
    const execFile: ExecFileFn = async (file) => {
      if (file === 'where') throw new Error('not found')
      throw new Error('unexpected')
    }

    await expect(
      assertPodmanReady({ platform: 'win32', execFile, disableWellKnownPaths: true }),
    ).rejects.toMatchObject({
      code: 'not_installed',
    })
  })

  test('darwin: requires running machine like win32', async () => {
    const execFile = makeExecFile({
      'which podman': '/opt/homebrew/bin/podman',
      'podman info': '{"host":{}}',
      'podman machine': '[{"Name":"podman-machine-default","Running":true}]',
      'podman ps': '',
    })

    await expect(
      assertPodmanReady({ platform: 'darwin', execFile }),
    ).resolves.toBeUndefined()
  })
})

describe('PodmanSetupError codes', () => {
  test('customer-facing messages avoid internal architecture terms', () => {
    for (const msg of Object.values(PODMAN_SETUP_MESSAGES)) {
      expect(msg.toLowerCase()).not.toMatch(/relay|websocket|capsule|beap/)
    }
  })
})
