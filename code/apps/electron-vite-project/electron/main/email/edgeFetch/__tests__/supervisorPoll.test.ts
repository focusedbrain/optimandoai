/**
 * Supervisor SSH session cache zeroing — unit tests (P4.5.12)
 */

import { describe, test, expect, beforeEach } from 'vitest'

import {
  rememberSupervisorSshSession,
  clearSupervisorSshSessions,
  _getSupervisorCachedSessionForTest,
  _expireSupervisorSessionForTest,
} from '../supervisorPoll.js'

beforeEach(() => {
  clearSupervisorSshSessions()
})

describe('supervisorPoll SSH cache', () => {
  test('zero-fills credentials when session expires', () => {
    rememberSupervisorSshSession('replica-1', {
      sshUser: 'root',
      sshPort: 22,
      sshKey: 'cached-secret-key',
      passphrase: 'cached-pass',
    })

    const cached = _getSupervisorCachedSessionForTest('replica-1')
    expect(cached).not.toBeNull()
    const keyRef = cached!.sshKey
    const passRef = cached!.passphrase!

    _expireSupervisorSessionForTest('replica-1')

    expect(keyRef.every((b) => b === 0)).toBe(true)
    expect(passRef.every((b) => b === 0)).toBe(true)
    expect(_getSupervisorCachedSessionForTest('replica-1')).toBeNull()
  })

  test('clearSupervisorSshSessions zero-fills all entries', () => {
    rememberSupervisorSshSession('replica-a', {
      sshUser: 'root',
      sshPort: 22,
      sshKey: 'key-a',
    })
    rememberSupervisorSshSession('replica-b', {
      sshUser: 'root',
      sshPort: 22,
      sshKey: 'key-b',
    })

    const keyA = _getSupervisorCachedSessionForTest('replica-a')!.sshKey
    const keyB = _getSupervisorCachedSessionForTest('replica-b')!.sshKey

    clearSupervisorSshSessions()

    expect(keyA.every((b) => b === 0)).toBe(true)
    expect(keyB.every((b) => b === 0)).toBe(true)
  })
})
