import { describe, test, expect } from 'vitest'
import {
  resolveHostSandboxCloneClickAction,
  sandboxCloneUnavailableDialogVariant,
} from '../beapInboxHostSandboxClickPolicy'

describe('beapInboxHostSandboxClickPolicy (Host Sandbox row + detail)', () => {
  const p = (o: { internalListLoading: boolean; sendableTargetCount: number; activeInternalHandshakeCount: number }) => o

  test('3: loading with no active handshakes yet => refresh path', () => {
    expect(resolveHostSandboxCloneClickAction(p({ internalListLoading: true, sendableTargetCount: 0, activeInternalHandshakeCount: 0 }))).toBe('loading_refresh')
  })

  test('4: no active internal handshakes => unavailable dialog', () => {
    expect(resolveHostSandboxCloneClickAction(p({ internalListLoading: false, sendableTargetCount: 0, activeInternalHandshakeCount: 0 }))).toBe('open_unavailable_dialog')
  })

  test('4b: active handshake but keying incomplete => keying_incomplete, not setup dialog', () => {
    expect(
      resolveHostSandboxCloneClickAction(p({ internalListLoading: false, sendableTargetCount: 0, activeInternalHandshakeCount: 1 })),
    ).toBe('keying_incomplete')
  })

  test('5: tri-state no longer changes unavailable variant (no-handshake copy only)', () => {
    expect(sandboxCloneUnavailableDialogVariant({ status: 'exists_but_offline' })).toBe('not_configured')
    expect(sandboxCloneUnavailableDialogVariant({ status: 'not_configured' })).toBe('not_configured')
  })

  test('6a: one sendable target => direct clone (single send)', () => {
    expect(
      resolveHostSandboxCloneClickAction(p({ internalListLoading: false, sendableTargetCount: 1, activeInternalHandshakeCount: 1 })),
    ).toBe('direct_clone')
  })

  test('6b: multiple sendable targets => target picker', () => {
    expect(
      resolveHostSandboxCloneClickAction(p({ internalListLoading: false, sendableTargetCount: 2, activeInternalHandshakeCount: 2 })),
    ).toBe('open_target_picker')
  })

  test('loading + one sendable => direct_clone (not stuck on loading branch)', () => {
    expect(
      resolveHostSandboxCloneClickAction(p({ internalListLoading: true, sendableTargetCount: 1, activeInternalHandshakeCount: 1 })),
    ).toBe('direct_clone')
  })
})
