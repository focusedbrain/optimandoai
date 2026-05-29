/**
 * WSL classification helpers
 */

import { describe, expect, test } from 'vitest'

import {
  classifyWslOutput,
  issueUserMessage,
  outputImpliesReboot,
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

  test('detects no distro', () => {
    expect(classifyWslOutput('Windows Subsystem for Linux has no installed distributions.')).toBe(
      'no_distro',
    )
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
