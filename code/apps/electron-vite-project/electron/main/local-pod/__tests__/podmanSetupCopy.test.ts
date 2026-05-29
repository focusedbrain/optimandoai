/**
 * Podman setup user-facing copy
 */

import { describe, expect, test } from 'vitest'

import {
  buildWindowsWslManualInstruction,
  wslIssueRequiresManualInstall,
  wslManualInstallCommand,
} from '../podmanSetupCopy.js'

describe('Windows WSL manual install copy', () => {
  test('not_installed requires manual install', () => {
    expect(wslIssueRequiresManualInstall('not_installed')).toBe(true)
    expect(wslManualInstallCommand('not_installed')).toBe('wsl --install')
  })

  test('manual instruction is English with copy command', () => {
    const manual = buildWindowsWslManualInstruction('not_installed')
    expect(manual.headline).toMatch(/container feature/i)
    expect(manual.copyCommand).toBe('wsl --install')
    expect(manual.instruction).toMatch(/Admin/i)
    expect(manual.instruction).toMatch(/Restart your computer/)
    expect(manual.instruction).not.toMatch(/nicht installiert/)
  })

  test('needs_update uses wsl --update command', () => {
    expect(wslManualInstallCommand('needs_update')).toBe('wsl --update')
  })
})
