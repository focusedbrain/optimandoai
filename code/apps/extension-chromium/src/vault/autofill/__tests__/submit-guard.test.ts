/**
 * Tests: Submit Guard — Safe Form Submission
 *
 * Validates:
 *   1. Submit blocked when no form exists
 *   2. Submit blocked when no submit element
 *   3. Submit blocked when submit not in same form
 *   4. Submit blocked when origin not exact
 *   5. Submit blocked when scan is partial
 *   6. Submit blocked when guard fails
 *   7. Submit blocked when untrusted event
 *   8. Submit succeeds on valid fixture login page
 *   9. resolveSubmitTarget finds correct button
 *  10. HA mode extra strictness
 *  11. Stable SubmitCode enum on all return paths
 *  12. Mutation guard gate
 *  13. Visibility/disabled gates
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock modules ──

vi.mock('../hardening', () => ({
  guardElement: vi.fn(() => ({ safe: true, code: null, reason: '' })),
  auditLog: vi.fn(),
  auditLogSafe: vi.fn(),
}))

vi.mock('../haGuard', () => ({
  isHAEnforced: vi.fn(() => false),
}))

vi.mock('../domFingerprint', () => ({
  takeFingerprint: vi.fn(async () => ({
    hash: 'mock_hash',
    capturedAt: Date.now(),
    maxAge: 60000,
    properties: { tagName: 'BUTTON', inputType: '', name: '' },
  })),
  validateFingerprint: vi.fn(async () => ({ valid: true, reasons: [] })),
}))

// ── Import AFTER mocks ──
import { resolveSubmitTarget, safeSubmitAfterFill, SUBMIT_BLOCK_REASONS } from '../submitGuard'
import type { SubmitSafetyInput, SubmitCode } from '../submitGuard'
import { guardElement, auditLogSafe } from '../hardening'
import { isHAEnforced } from '../haGuard'

// ============================================================================
// Helpers
// ============================================================================

function makeForm(): HTMLFormElement {
  const form = document.createElement('form')
  document.body.appendChild(form)
  return form
}

function makeSubmitButton(form: HTMLFormElement): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'submit'
  btn.textContent = 'Sign In'
  form.appendChild(btn)
  // Mock non-zero rect (JSDOM returns 0 for all dimensions)
  btn.getBoundingClientRect = () => ({
    x: 100, y: 100, width: 80, height: 32, top: 100, right: 180, bottom: 132, left: 100,
    toJSON: () => {},
  })
  return btn
}

function makeDefaultInput(): SubmitSafetyInput {
  const form = makeForm()
  const submitEl = makeSubmitButton(form)
  return {
    form,
    submitEl,
    submitFingerprint: null,
    originTier: 'exact',
    partialScan: false,
    isTrusted: true,
  }
}

// ============================================================================
// Tests: resolveSubmitTarget
// ============================================================================

describe('resolveSubmitTarget', () => {
  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { document.body.innerHTML = '' })

  it('returns null for null form', () => {
    expect(resolveSubmitTarget(null)).toBeNull()
  })

  it('finds input[type=submit]', () => {
    const form = makeForm()
    const input = document.createElement('input')
    input.type = 'submit'
    input.value = 'Go'
    form.appendChild(input)
    expect(resolveSubmitTarget(form)).toBe(input)
  })

  it('finds button[type=submit]', () => {
    const form = makeForm()
    const btn = document.createElement('button')
    btn.type = 'submit'
    form.appendChild(btn)
    expect(resolveSubmitTarget(form)).toBe(btn)
  })

  it('finds default button (no type attribute)', () => {
    const form = makeForm()
    const btn = document.createElement('button')
    form.appendChild(btn)
    expect(resolveSubmitTarget(form)).toBe(btn)
  })

  it('skips button[type=button]', () => {
    const form = makeForm()
    const btn = document.createElement('button')
    btn.type = 'button'
    form.appendChild(btn)
    expect(resolveSubmitTarget(form)).toBeNull()
  })

  it('skips button[type=reset]', () => {
    const form = makeForm()
    const btn = document.createElement('button')
    btn.type = 'reset'
    form.appendChild(btn)
    expect(resolveSubmitTarget(form)).toBeNull()
  })

  it('returns null when form has no submit elements', () => {
    const form = makeForm()
    const input = document.createElement('input')
    input.type = 'text'
    form.appendChild(input)
    expect(resolveSubmitTarget(form)).toBeNull()
  })
})

// ============================================================================
// Tests: safeSubmitAfterFill
// ============================================================================

describe('safeSubmitAfterFill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    ;(isHAEnforced as any).mockReturnValue(false)
    ;(guardElement as any).mockReturnValue({ safe: true, code: null, reason: '' })
  })

  afterEach(() => { document.body.innerHTML = '' })

  // ── Gate tests ──

  it('blocks when isTrusted is false', () => {
    const input = makeDefaultInput()
    input.isTrusted = false
    const result = safeSubmitAfterFill(input)
    expect(result.submitted).toBe(false)
    expect(result.code).toBe('SUBMIT_BLOCKED')
    expect(result.reason).toBe('not_trusted')
  })

  it('blocks when no form', () => {
    const input = makeDefaultInput()
    input.form = null
    const result = safeSubmitAfterFill(input)
    expect(result.submitted).toBe(false)
    expect(result.code).toBe('SUBMIT_NO_FORM')
    expect(result.reason).toBe('no_form')
  })

  it('blocks when no submit element', () => {
    const input = makeDefaultInput()
    input.submitEl = null
    const result = safeSubmitAfterFill(input)
    expect(result.submitted).toBe(false)
    expect(result.code).toBe('SUBMIT_NO_FORM')
    expect(result.reason).toBe('no_submit_element')
  })

  it('blocks when submit element is not in same form', () => {
    const form1 = makeForm()
    const form2 = makeForm()
    const btn = makeSubmitButton(form2)
    const result = safeSubmitAfterFill({
      form: form1,
      submitEl: btn,
      submitFingerprint: null,
      originTier: 'exact',
      partialScan: false,
      isTrusted: true,
    })
    expect(result.submitted).toBe(false)
    expect(result.code).toBe('SUBMIT_UNSAFE')
    expect(result.reason).toBe('not_in_same_form')
  })

  it('blocks when origin is not exact', () => {
    const input = makeDefaultInput()
    input.originTier = 'www_equivalent'
    const result = safeSubmitAfterFill(input)
    expect(result.submitted).toBe(false)
    expect(result.code).toBe('SUBMIT_BLOCKED')
    expect(result.reason).toBe('origin_not_exact')
  })

  it('blocks when origin is subdomain', () => {
    const input = makeDefaultInput()
    input.originTier = 'subdomain_parent'
    const result = safeSubmitAfterFill(input)
    expect(result.submitted).toBe(false)
    expect(result.reason).toBe('origin_not_exact')
  })

  it('blocks when origin is none', () => {
    const input = makeDefaultInput()
    input.originTier = 'none'
    const result = safeSubmitAfterFill(input)
    expect(result.submitted).toBe(false)
    expect(result.reason).toBe('origin_not_exact')
  })

  it('blocks when scan is partial', () => {
    const input = makeDefaultInput()
    input.partialScan = true
    const result = safeSubmitAfterFill(input)
    expect(result.submitted).toBe(false)
    expect(result.reason).toBe('partial_scan')
  })

  it('blocks when guard check fails on submit element', () => {
    ;(guardElement as any).mockReturnValue({ safe: false, code: 'ELEMENT_HIDDEN', reason: 'test' })
    const input = makeDefaultInput()
    const result = safeSubmitAfterFill(input)
    expect(result.submitted).toBe(false)
    expect(result.code).toBe('SUBMIT_UNSAFE')
    expect(result.reason).toBe('guard_failed')
  })

  it('blocks when submit element is disabled', () => {
    const input = makeDefaultInput()
    const btn = input.submitEl as HTMLButtonElement
    btn.disabled = true
    const result = safeSubmitAfterFill(input)
    expect(result.submitted).toBe(false)
    expect(result.code).toBe('SUBMIT_BLOCKED')
    expect(result.reason).toBe('submit_disabled')
  })

  it('blocks when mutation guard is tripped', () => {
    const input = makeDefaultInput()
    input.mutationGuard = { check: () => ({ valid: false }) }
    input.form!.requestSubmit = vi.fn()
    const result = safeSubmitAfterFill(input)
    expect(result.submitted).toBe(false)
    expect(result.code).toBe('SUBMIT_MUTATION')
    expect(result.reason).toBe('mutation_guard_tripped')
  })

  it('blocks when mutation guard check throws (fail-closed)', () => {
    const input = makeDefaultInput()
    input.mutationGuard = { check: () => { throw new Error('boom') } }
    input.form!.requestSubmit = vi.fn()
    const result = safeSubmitAfterFill(input)
    expect(result.submitted).toBe(false)
    expect(result.code).toBe('SUBMIT_MUTATION')
    expect(result.reason).toBe('mutation_guard_tripped')
  })

  it('blocks under HA mode with non-standard submit element', () => {
    ;(isHAEnforced as any).mockReturnValue(true)
    const form = makeForm()
    const div = document.createElement('div')
    div.setAttribute('role', 'button')
    form.appendChild(div)
    // Mock non-zero rect to pass visibility gate
    div.getBoundingClientRect = () => ({
      x: 100, y: 100, width: 80, height: 32, top: 100, right: 180, bottom: 132, left: 100,
      toJSON: () => {},
    })

    const result = safeSubmitAfterFill({
      form,
      submitEl: div,
      submitFingerprint: null,
      originTier: 'exact',
      partialScan: false,
      isTrusted: true,
    })
    expect(result.submitted).toBe(false)
    expect(result.reason).toBe('ha_blocked')
  })

  it('blocks when fingerprint is expired', () => {
    const input = makeDefaultInput()
    input.submitFingerprint = {
      hash: 'abc',
      capturedAt: Date.now() - 120_000,
      maxAge: 60_000,
      properties: { tagName: 'BUTTON', inputType: '', name: '' },
    }
    const result = safeSubmitAfterFill(input)
    expect(result.submitted).toBe(false)
    expect(result.code).toBe('SUBMIT_MUTATION')
    expect(result.reason).toBe('fingerprint_invalid')
  })

  // ── Success test ──

  it('succeeds when all gates pass', () => {
    const input = makeDefaultInput()
    input.form!.requestSubmit = vi.fn()

    const result = safeSubmitAfterFill(input)
    expect(result.submitted).toBe(true)
    expect(result.code).toBe('SUBMIT_OK')
    expect(result.reason).toBeUndefined()
    expect(input.form!.requestSubmit).toHaveBeenCalled()
  })

  it('passes with mutation guard when guard is clean', () => {
    const input = makeDefaultInput()
    input.mutationGuard = { check: () => ({ valid: true }) }
    input.form!.requestSubmit = vi.fn()

    const result = safeSubmitAfterFill(input)
    expect(result.submitted).toBe(true)
    expect(result.code).toBe('SUBMIT_OK')
  })

  // ── Audit logging ──

  it('logs audit on every block', () => {
    const input = makeDefaultInput()
    input.isTrusted = false
    safeSubmitAfterFill(input)
    expect(auditLogSafe).toHaveBeenCalledWith(
      expect.any(String),
      'QSO_SUBMIT_BLOCKED',
      expect.any(String),
      expect.objectContaining({ reason: 'not_trusted' }),
    )
  })

  it('logs audit on success', () => {
    const input = makeDefaultInput()
    input.form!.requestSubmit = vi.fn()
    safeSubmitAfterFill(input)
    expect(auditLogSafe).toHaveBeenCalledWith(
      expect.any(String),
      'QSO_SUBMIT_SUCCESS',
      expect.any(String),
      expect.objectContaining({ ha: false }),
    )
  })

  // ── Stable code enum coverage ──

  it('every SubmitCode is a string', () => {
    const validCodes: SubmitCode[] = ['SUBMIT_OK', 'SUBMIT_BLOCKED', 'SUBMIT_UNSAFE', 'SUBMIT_NO_FORM', 'SUBMIT_MUTATION']
    for (const c of validCodes) {
      expect(typeof c).toBe('string')
    }
  })

  it('SUBMIT_BLOCK_REASONS set contains all reason enums', () => {
    expect(SUBMIT_BLOCK_REASONS.has('no_form')).toBe(true)
    expect(SUBMIT_BLOCK_REASONS.has('not_trusted')).toBe(true)
    expect(SUBMIT_BLOCK_REASONS.has('mutation_guard_tripped')).toBe(true)
    expect(SUBMIT_BLOCK_REASONS.has('submit_not_visible')).toBe(true)
    expect(SUBMIT_BLOCK_REASONS.has('submit_disabled')).toBe(true)
    expect(SUBMIT_BLOCK_REASONS.has('request_submit_failed')).toBe(true)
    expect(SUBMIT_BLOCK_REASONS.size).toBe(13)
  })
})
