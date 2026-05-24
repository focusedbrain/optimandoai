/**
 * Podman feature-detect — unit tests
 */

import { describe, test, expect } from 'vitest'
import {
  assertPodmanReady,
  PodmanSetupError,
  PODMAN_SETUP_MESSAGES,
  type ExecFileFn,
} from '../podmanDetect.js'

function makeExecFile(responses: Record<string, string | Error>): ExecFileFn {
  return async (file, args) => {
    const key = `${file} ${args.join(' ')}`
    const altKey = file === 'podman' ? `podman ${args[0]}` : key
    const response = responses[key] ?? responses[altKey]
    if (response instanceof Error) throw response
    if (response === undefined) {
      throw new Error(`unexpected exec: ${key}`)
    }
    return { stdout: response, stderr: '' }
  }
}

describe('assertPodmanReady', () => {
  test('linux: podman on PATH passes without machine check', async () => {
    const execFile = makeExecFile({
      'which podman': '/usr/bin/podman',
    })

    await expect(
      assertPodmanReady({ platform: 'linux', execFile }),
    ).resolves.toBeUndefined()
  })

  test('linux: podman missing throws not_installed', async () => {
    const execFile: ExecFileFn = async () => {
      throw new Error('not found')
    }

    await expect(assertPodmanReady({ platform: 'linux', execFile })).rejects.toMatchObject({
      code: 'not_installed',
      userMessage: PODMAN_SETUP_MESSAGES.not_installed,
    } satisfies Partial<PodmanSetupError>)
  })

  test('win32: podman on PATH and running machine passes', async () => {
    const execFile = makeExecFile({
      'where podman': 'C:\\Program Files\\RedHat\\Podman\\podman.exe',
      'podman machine': '[{"Name":"podman-machine-default","Running":true}]',
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

    await expect(assertPodmanReady({ platform: 'win32', execFile })).rejects.toMatchObject({
      code: 'not_installed',
    })
  })

  test('win32: no running machine throws machine_not_running', async () => {
    const execFile = makeExecFile({
      'where podman': 'C:\\Program Files\\RedHat\\Podman\\podman.exe',
      'podman machine': '[{"Name":"podman-machine-default","Running":false}]',
    })

    await expect(assertPodmanReady({ platform: 'win32', execFile })).rejects.toMatchObject({
      code: 'machine_not_running',
      userMessage: PODMAN_SETUP_MESSAGES.machine_not_running,
    })
  })

  test('darwin: requires running machine like win32', async () => {
    const execFile = makeExecFile({
      'which podman': '/opt/homebrew/bin/podman',
      'podman machine': '[{"Name":"podman-machine-default","Running":true}]',
    })

    await expect(
      assertPodmanReady({ platform: 'darwin', execFile }),
    ).resolves.toBeUndefined()
  })
})
