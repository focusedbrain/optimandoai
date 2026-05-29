/**
 * Podman install runner — winget already-installed normalization
 */

import { describe, expect, test } from 'vitest'

import {
  isMachineAlreadyExistsOutput,
  isMachineAlreadyRunningOutput,
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

  test('machine init already exists is treated as success', () => {
    const raw = {
      ok: false,
      command: 'podman machine init',
      stdout: '',
      stderr: 'VM already exists',
      exitCode: 1,
    }
    expect(isMachineAlreadyExistsOutput(raw.stderr)).toBe(true)
    expect(normalizeInstallCommandResult('machine_init', raw).ok).toBe(true)
  })

  test('machine start already running is treated as success', () => {
    const raw = {
      ok: false,
      command: 'podman machine start',
      stdout: '',
      stderr: 'Machine already running',
      exitCode: 1,
    }
    expect(isMachineAlreadyRunningOutput(raw.stderr)).toBe(true)
    expect(normalizeInstallCommandResult('machine_start', raw).ok).toBe(true)
  })
})
