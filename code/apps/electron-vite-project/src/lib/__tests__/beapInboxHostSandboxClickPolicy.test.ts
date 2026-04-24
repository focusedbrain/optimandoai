import { describe, test, expect } from 'vitest'
import {
  resolveHostSandboxCloneClickAction,
  sandboxCloneUnavailableDialogVariant,
} from '../beapInboxHostSandboxClickPolicy'

describe('beapInboxHostSandboxClickPolicy (Host Sandbox row + detail)', () => {
  test('3: loading with zero eligible targets => refresh path (button stays enabled in UI; no dialog)', () => {
    expect(
      resolveHostSandboxCloneClickAction({ internalListLoading: true, cloneEligibleTargetCount: 0 }),
    ).toBe('loading_refresh')
  })

  test('4: not_configured (no eligible sandboxes) => unavailable dialog', () => {
    expect(
      resolveHostSandboxCloneClickAction({ internalListLoading: false, cloneEligibleTargetCount: 0 }),
    ).toBe('open_unavailable_dialog')
  })

  test('5: same zero-target path; offline is distinguished only by dialog copy (availability), not this resolver', () => {
    expect(
      sandboxCloneUnavailableDialogVariant({ status: 'exists_but_offline' }),
    ).toBe('exists_but_offline')
    expect(
      sandboxCloneUnavailableDialogVariant({ status: 'not_configured' }),
    ).toBe('not_configured')
  })

  test('6a: one eligible sandbox => direct clone (single send)', () => {
    expect(
      resolveHostSandboxCloneClickAction({ internalListLoading: false, cloneEligibleTargetCount: 1 }),
    ).toBe('direct_clone')
  })

  test('6b: multiple eligible sandboxes => target picker / multi dialog', () => {
    expect(
      resolveHostSandboxCloneClickAction({ internalListLoading: false, cloneEligibleTargetCount: 2 }),
    ).toBe('open_target_picker')
  })

  test('loading + already has targets => direct_clone or picker (not stuck on loading branch)', () => {
    expect(
      resolveHostSandboxCloneClickAction({ internalListLoading: true, cloneEligibleTargetCount: 1 }),
    ).toBe('direct_clone')
  })
})
