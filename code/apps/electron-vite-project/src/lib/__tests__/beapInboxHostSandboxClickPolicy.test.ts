import { describe, test, expect } from 'vitest'
import {
  resolveHostSandboxCloneClickAction,
  sandboxCloneUnavailableDialogVariant,
  toProductSandboxTargetDecision,
} from '../beapInboxHostSandboxClickPolicy'

describe('beapInboxHostSandboxClickPolicy (Host Sandbox row + detail)', () => {
  const p = (o: {
    internalListLoading: boolean
    listLastSuccess: boolean
    sendableTargetCount: number
    activeIdentityCompleteHostSandboxCount: number
    identityIncompleteHostSandboxCount: number
  }) => o

  test('1: loading with no active handshakes yet => refresh path', () => {
    expect(
      resolveHostSandboxCloneClickAction(
        p({ internalListLoading: true, listLastSuccess: true, sendableTargetCount: 0, activeIdentityCompleteHostSandboxCount: 0, identityIncompleteHostSandboxCount: 0 }),
      ),
    ).toBe('loading_refresh')
  })

  test('2: list never succeeded, not loading => refresh (not “no sandbox”)', () => {
    expect(
      resolveHostSandboxCloneClickAction(
        p({ internalListLoading: false, listLastSuccess: false, sendableTargetCount: 0, activeIdentityCompleteHostSandboxCount: 0, identityIncompleteHostSandboxCount: 0 }),
      ),
    ).toBe('loading_refresh')
  })

  test('3: no active internal handshakes and list ok => unavailable dialog', () => {
    expect(
      resolveHostSandboxCloneClickAction(
        p({ internalListLoading: false, listLastSuccess: true, sendableTargetCount: 0, activeIdentityCompleteHostSandboxCount: 0, identityIncompleteHostSandboxCount: 0 }),
      ),
    ).toBe('open_unavailable_dialog')
  })

  test('3b: active identity-complete handshake but keying incomplete => keying, not setup', () => {
    expect(
      resolveHostSandboxCloneClickAction(
        p({ internalListLoading: false, listLastSuccess: true, sendableTargetCount: 0, activeIdentityCompleteHostSandboxCount: 1, identityIncompleteHostSandboxCount: 0 }),
      ),
    ).toBe('keying_incomplete')
  })

  test('3c: only identity-incomplete host↔sandbox row (incomplete list) => identity, not “no sandbox”', () => {
    expect(
      resolveHostSandboxCloneClickAction(
        p({ internalListLoading: false, listLastSuccess: true, sendableTargetCount: 0, activeIdentityCompleteHostSandboxCount: 0, identityIncompleteHostSandboxCount: 1 }),
      ),
    ).toBe('identity_incomplete')
  })

  test('4: tri-state no longer changes unavailable variant (no-handshake copy only)', () => {
    expect(sandboxCloneUnavailableDialogVariant({ status: 'exists_but_offline' })).toBe('not_configured')
    expect(sandboxCloneUnavailableDialogVariant({ status: 'not_configured' })).toBe('not_configured')
  })

  test('5: one sendable target => direct clone (single send)', () => {
    expect(
      resolveHostSandboxCloneClickAction(
        p({ internalListLoading: false, listLastSuccess: true, sendableTargetCount: 1, activeIdentityCompleteHostSandboxCount: 1, identityIncompleteHostSandboxCount: 0 }),
      ),
    ).toBe('direct_clone')
  })

  test('6: multiple sendable targets => target picker', () => {
    expect(
      resolveHostSandboxCloneClickAction(
        p({ internalListLoading: false, listLastSuccess: true, sendableTargetCount: 2, activeIdentityCompleteHostSandboxCount: 2, identityIncompleteHostSandboxCount: 0 }),
      ),
    ).toBe('open_target_picker')
  })

  test('7: loading + one sendable => direct_clone (not stuck on loading branch)', () => {
    expect(
      resolveHostSandboxCloneClickAction(
        p({ internalListLoading: true, listLastSuccess: true, sendableTargetCount: 1, activeIdentityCompleteHostSandboxCount: 1, identityIncompleteHostSandboxCount: 0 }),
      ),
    ).toBe('direct_clone')
  })

  test('toProductSandboxTargetDecision: direct_clone => send_now', () => {
    expect(toProductSandboxTargetDecision('direct_clone', 'host_active_target_send_now')).toBe('send_now')
  })

  test('toProductSandboxTargetDecision: hide sandbox mode', () => {
    expect(toProductSandboxTargetDecision(null, 'sandbox_mode_hide_action')).toBe('hidden_sandbox')
  })
})
