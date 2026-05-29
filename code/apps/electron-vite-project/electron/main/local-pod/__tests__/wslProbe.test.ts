/**
 * WSL classification helpers
 */

import { describe, expect, test } from 'vitest'

import {
  classifyWslOutput,
  issueUserMessage,
  outputImpliesReboot,
  wslSubsystemNotInstalled,
} from '../wslProbe.js'

describe('classifyWslOutput', () => {
  test('detects virtualization disabled', () => {
    expect(
      classifyWslOutput('Virtualization is not enabled in the firmware'),
    ).toBe('virtualization_disabled')
  })

  test('detects not installed', () => {
    expect(classifyWslOutput('WSL is not installed')).toBe('not_installed')
  })

  test('detects not installed (German OS text without literal wsl token)', () => {
    const german =
      'Der Windows-Subsystem für Linux ist nicht installiert. Führen Sie "wsl.exe --install" aus, um es zu installieren.'
    expect(wslSubsystemNotInstalled(german)).toBe(true)
    expect(classifyWslOutput(german)).toBe('not_installed')
  })

  test('detects no distro (German OS text)', () => {
    expect(
      classifyWslOutput('Windows-Subsystem für Linux hat keine installierten Distributionen.'),
    ).toBe('no_distro')
  })
})

describe('outputImpliesReboot', () => {
  test('detects restart wording', () => {
    expect(outputImpliesReboot('Changes will not be effective until the system is rebooted')).toBe(
      true,
    )
  })
})

describe('issueUserMessage', () => {
  test('plain readable messages', () => {
    expect(issueUserMessage('virtualization_disabled')).toMatch(/virtualization/i)
    expect(issueUserMessage('not_installed')).toMatch(/WSL/i)
  })
})
