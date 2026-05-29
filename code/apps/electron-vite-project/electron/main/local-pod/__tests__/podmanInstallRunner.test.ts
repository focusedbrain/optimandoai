/**
 * Podman install runner — winget already-installed normalization
 */

import { describe, expect, test } from 'vitest'

import {
  isWingetAlreadyInstalledOutput,
  normalizeInstallCommandResult,
} from '../podmanInstallRunner.js'

describe('normalizeInstallCommandResult', () => {
  test('winget already installed is treated as success', () => {
    const raw = {
      ok: false,
      command: 'winget install ...',
      stdout: '',
      stderr:
        'Found an existing package already installed. No available upgrade found.',
      exitCode: 2316632107,
    }
    expect(isWingetAlreadyInstalledOutput(raw.stderr)).toBe(true)
    const normalized = normalizeInstallCommandResult('winget_install', raw)
    expect(normalized.ok).toBe(true)
  })

  test('winget genuine failure stays failed', () => {
    const raw = {
      ok: false,
      command: 'winget install ...',
      stdout: '',
      stderr: 'Network error',
      exitCode: 1,
    }
    expect(normalizeInstallCommandResult('winget_install', raw).ok).toBe(false)
  })
})
