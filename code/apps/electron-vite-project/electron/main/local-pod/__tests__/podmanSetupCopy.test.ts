/**
 * Podman setup user-facing copy
 */

import { describe, expect, test } from 'vitest'

import { resolveWslInstallFailureCopy } from '../podmanSetupCopy.js'
import { WSL_UAC_CANCELLED_EXIT } from '../wslProbe.js'

describe('resolveWslInstallFailureCopy', () => {
  test('UAC denied — retry + manual path', () => {
    const copy = resolveWslInstallFailureCopy('not_installed', {
      ok: false,
      command: 'wsl.exe --install',
      stdout: '',
      stderr: 'UAC_CANCELLED',
      exitCode: WSL_UAC_CANCELLED_EXIT,
    })
    expect(copy.message).toMatch(/Administrator permission/i)
    expect(copy.detail).toMatch(/UAC prompt/i)
    expect(copy.detail).toMatch(/wsl --install/)
  })

  test('install failed — admin terminal steps', () => {
    const copy = resolveWslInstallFailureCopy('not_installed', {
      ok: false,
      command: 'wsl.exe --install',
      stdout: '',
      stderr: '',
      exitCode: 1,
    })
    expect(copy.message).toMatch(/administrator terminal/i)
    expect(copy.detail).toMatch(/exit code 1/)
    expect(copy.detail).toMatch(/Restart your computer/)
    expect(copy.detail).not.toMatch(/nicht installiert/)
  })
})
