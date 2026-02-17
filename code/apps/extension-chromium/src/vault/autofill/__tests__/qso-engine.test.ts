/**
 * Tests: QSO (Quick Sign-On) Engine
 *
 * Validates:
 *   1. QSO state machine resolves correctly: EXACT_MATCH, HAS_CANDIDATES, NONE, BLOCKED
 *   2. Exact match requires exact origin, single candidate, all targets + submit resolved
 *   3. HA mode blocks on PSL domains
 *   4. Partial scan blocks submit
 *   5. isTrusted gate on fill
 *   6. Writes kill-switch blocks fill
 *   7. No new write path: QSO uses commitInsert, not setValueSafely
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock modules BEFORE importing ──

vi.mock('../toggleSync', () => ({
  isAutofillActive: vi.fn(() => true),
}))

vi.mock('../../api', () => ({
  getItemForFill: vi.fn(),
  listItemsForIndex: vi.fn(() => []),
}))

vi.mock('../fieldScanner', () => ({
  collectCandidates: vi.fn(() => ({
    candidates: [],
    hints: [],
    formContext: {},
    domain: 'example.com',
    scannedAt: Date.now(),
    elementsEvaluated: 0,
    durationMs: 1,
    partial: false,
    partialReason: undefined,
  })),
}))

vi.mock('../hardening', () => ({
  guardElement: vi.fn(() => ({ safe: true, code: null, reason: '' })),
  auditLog: vi.fn(),
  auditLogSafe: vi.fn(),
  emitTelemetryEvent: vi.fn(),
  redactError: vi.fn((e: any) => String(e)),
}))

vi.mock('../haGuard', () => ({
  haCheck: vi.fn(() => true),
  isHAEnforced: vi.fn(() => false),
}))

vi.mock('../domFingerprint', () => ({
  takeFingerprint: vi.fn(async () => ({
    hash: 'mock_hash_1234',
    capturedAt: Date.now(),
    maxAge: 60000,
    properties: { tagName: 'INPUT', inputType: 'text', name: 'username' },
  })),
  validateFingerprint: vi.fn(async () => ({ valid: true, reasons: [] })),
}))

vi.mock('../../../../../../packages/shared/src/vault/originPolicy', () => ({
  matchOrigin: vi.fn(() => ({ matches: true, matchType: 'exact', confidence: 100 })),
  isPublicSuffix: vi.fn(() => false),
}))

vi.mock('../../../../../../packages/shared/src/vault/insertionPipeline', () => ({
  computeDisplayValue: vi.fn((v: string, s: boolean) => s ? '••••••••' : v),
  DEFAULT_MASKING: { maskChar: '\u2022', maskLength: 8 },
}))

vi.mock('../committer', () => ({
  commitInsert: vi.fn(async () => ({
    success: true,
    sessionId: '00000000-0000-0000-0000-000000000000',
    fields: [],
  })),
  setQsoFillActive: vi.fn(),
}))

vi.mock('../mutationGuard', () => ({
  attachGuard: vi.fn(() => ({
    check: () => ({ valid: true, violations: [] }),
    detach: vi.fn(),
    tripped: false,
    violations: [],
    onTrip: null,
  })),
}))

vi.mock('../submitGuard', () => ({
  resolveSubmitTarget: vi.fn(() => null),
  safeSubmitAfterFill: vi.fn(() => ({ submitted: false, code: 'SUBMIT_NO_FORM', reason: 'no_submit_element' })),
}))

vi.mock('../writesKillSwitch', () => ({
  areWritesDisabled: vi.fn(() => false),
}))

// ── Global polyfills for JSDOM ──
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = {}
}
if (!globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => '00000000-0000-0000-0000-000000000000'
}

// ── Import AFTER mocks ──
import { resolveQsoState, executeQsoFill } from '../qso/qsoEngine'
import { isAutofillActive } from '../toggleSync'
import * as vaultAPI from '../../api'
import { collectCandidates } from '../fieldScanner'
import { guardElement, auditLogSafe } from '../hardening'
import { isHAEnforced } from '../haGuard'
import { matchOrigin, isPublicSuffix } from '../../../../../../packages/shared/src/vault/originPolicy'
import { commitInsert, setQsoFillActive } from '../committer'
import { resolveSubmitTarget, safeSubmitAfterFill } from '../submitGuard'
import { areWritesDisabled } from '../writesKillSwitch'

// ============================================================================
// Helpers
// ============================================================================

function makeInput(opts?: { name?: string; type?: string }): HTMLInputElement {
  const el = document.createElement('input')
  el.type = opts?.type ?? 'text'
  el.name = opts?.name ?? 'username'
  document.body.appendChild(el)
  return el
}

function makeButton(form?: HTMLFormElement): HTMLButtonElement {
  const btn = document.createElement('button')
  btn.type = 'submit'
  btn.textContent = 'Login'
  if (form) form.appendChild(btn)
  else document.body.appendChild(btn)
  return btn
}

function makeForm(): HTMLFormElement {
  const form = document.createElement('form')
  document.body.appendChild(form)
  return form
}

function makeVaultItem(overrides?: Record<string, any>) {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    category: 'password',
    title: 'Test Login',
    fields: [
      { key: 'username', value: 'testuser', encrypted: false, type: 'text' },
      { key: 'password', value: 'secret123', encrypted: true, type: 'password' },
    ],
    domain: 'example.com',
    ...overrides,
  }
}

function makeScanResult(overrides?: Record<string, any>) {
  return {
    candidates: [],
    hints: [],
    formContext: {},
    domain: 'example.com',
    scannedAt: Date.now(),
    elementsEvaluated: 0,
    durationMs: 1,
    partial: false,
    partialReason: undefined,
    ...overrides,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('QSO Engine — State Resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    ;(isAutofillActive as any).mockReturnValue(true)
    ;(isHAEnforced as any).mockReturnValue(false)
    ;(areWritesDisabled as any).mockReturnValue(false)
    ;(guardElement as any).mockReturnValue({ safe: true, code: null, reason: '' })
    ;(matchOrigin as any).mockReturnValue({ matches: true, matchType: 'exact', confidence: 100 })
    ;(isPublicSuffix as any).mockReturnValue(false)
    ;(resolveSubmitTarget as any).mockReturnValue(null)
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('returns BLOCKED when autofill is inactive', async () => {
    ;(isAutofillActive as any).mockReturnValue(false)
    const state = await resolveQsoState([makeVaultItem()])
    expect(state.status).toBe('BLOCKED')
    expect(state.blockReason).toBe('autofill_disabled')
  })

  it('returns BLOCKED when writes are disabled', async () => {
    ;(areWritesDisabled as any).mockReturnValue(true)
    const state = await resolveQsoState([makeVaultItem()])
    expect(state.status).toBe('BLOCKED')
    expect(state.blockReason).toBe('writes_disabled')
  })

  it('returns BLOCKED when no candidates found', async () => {
    ;(collectCandidates as any).mockReturnValue(makeScanResult())
    const state = await resolveQsoState([makeVaultItem()])
    expect(state.status).toBe('BLOCKED')
    expect(state.blockReason).toBe('no_candidates')
  })

  it('returns EXACT_MATCH when single exact-origin candidate with all targets', async () => {
    const form = makeForm()
    const usernameEl = makeInput({ name: 'username' })
    const passwordEl = makeInput({ name: 'password', type: 'password' })
    form.appendChild(usernameEl)
    form.appendChild(passwordEl)
    const submitBtn = makeButton(form)

    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [
        { element: usernameEl, matchedKind: 'login.username', match: { confidence: 90, accepted: true, bestKind: 'login.username', runnerUp: null }, crossOrigin: false },
        { element: passwordEl, matchedKind: 'login.password', match: { confidence: 95, accepted: true, bestKind: 'login.password', runnerUp: null }, crossOrigin: false },
      ],
    }))
    ;(resolveSubmitTarget as any).mockReturnValue(submitBtn)

    const state = await resolveQsoState([makeVaultItem()])
    expect(state.status).toBe('EXACT_MATCH')
    expect(state.exactMatch).toBeDefined()
    expect(state.exactMatch!.itemId).toBe('11111111-2222-3333-4444-555555555555')
    expect(state.submitEligible).toBe(true)
  })

  it('returns HAS_CANDIDATES when multiple exact matches (ambiguous)', async () => {
    const form = makeForm()
    const usernameEl = makeInput({ name: 'username' })
    const passwordEl = makeInput({ name: 'password', type: 'password' })
    form.appendChild(usernameEl)
    form.appendChild(passwordEl)
    const submitBtn = makeButton(form)

    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [
        { element: usernameEl, matchedKind: 'login.username', match: { confidence: 90, accepted: true, bestKind: 'login.username', runnerUp: null }, crossOrigin: false },
        { element: passwordEl, matchedKind: 'login.password', match: { confidence: 95, accepted: true, bestKind: 'login.password', runnerUp: null }, crossOrigin: false },
      ],
    }))
    ;(resolveSubmitTarget as any).mockReturnValue(submitBtn)

    const items = [
      makeVaultItem({ id: '11111111-2222-3333-4444-555555555555', title: 'Login A' }),
      makeVaultItem({ id: '22222222-3333-4444-5555-666666666666', title: 'Login B' }),
    ]
    const state = await resolveQsoState(items)
    expect(state.status).toBe('HAS_CANDIDATES')
    expect(state.candidates.length).toBe(2)
  })

  it('returns HAS_CANDIDATES when origin is www_equivalent', async () => {
    const form = makeForm()
    const usernameEl = makeInput({ name: 'username' })
    const passwordEl = makeInput({ name: 'password', type: 'password' })
    form.appendChild(usernameEl)
    form.appendChild(passwordEl)
    const submitBtn = makeButton(form)

    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [
        { element: usernameEl, matchedKind: 'login.username', match: { confidence: 90, accepted: true, bestKind: 'login.username', runnerUp: null }, crossOrigin: false },
        { element: passwordEl, matchedKind: 'login.password', match: { confidence: 95, accepted: true, bestKind: 'login.password', runnerUp: null }, crossOrigin: false },
      ],
    }))
    ;(matchOrigin as any).mockReturnValue({ matches: true, matchType: 'www_equivalent', confidence: 95 })
    ;(resolveSubmitTarget as any).mockReturnValue(submitBtn)

    const state = await resolveQsoState([makeVaultItem()])
    // www_equivalent is not 'exact', so EXACT_MATCH won't trigger
    expect(state.status).toBe('HAS_CANDIDATES')
  })

  it('skips vault items when HA + PSL domain', async () => {
    ;(isHAEnforced as any).mockReturnValue(true)
    ;(isPublicSuffix as any).mockReturnValue(true)
    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [
        { element: makeInput(), matchedKind: 'login.password', match: { confidence: 90, accepted: true, bestKind: 'login.password', runnerUp: null }, crossOrigin: false },
      ],
    }))

    const state = await resolveQsoState([makeVaultItem()])
    // All items skipped due to HA+PSL
    expect(state.status).toBe('BLOCKED')
    expect(state.blockReason).toBe('no_candidates')
  })

  it('submitEligible is false when scan is partial', async () => {
    const form = makeForm()
    const usernameEl = makeInput({ name: 'username' })
    const passwordEl = makeInput({ name: 'password', type: 'password' })
    form.appendChild(usernameEl)
    form.appendChild(passwordEl)
    const submitBtn = makeButton(form)

    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [
        { element: usernameEl, matchedKind: 'login.username', match: { confidence: 90, accepted: true, bestKind: 'login.username', runnerUp: null }, crossOrigin: false },
        { element: passwordEl, matchedKind: 'login.password', match: { confidence: 95, accepted: true, bestKind: 'login.password', runnerUp: null }, crossOrigin: false },
      ],
      partial: true,
      partialReason: 'element_cap',
    }))
    ;(resolveSubmitTarget as any).mockReturnValue(submitBtn)

    const state = await resolveQsoState([makeVaultItem()])
    expect(state.status).toBe('EXACT_MATCH')
    expect(state.submitEligible).toBe(false)
    expect(state.partialScan).toBe(true)
  })

  it('EXACT_MATCH requires guardElement to pass on all targets', async () => {
    const form = makeForm()
    const usernameEl = makeInput({ name: 'username' })
    const passwordEl = makeInput({ name: 'password', type: 'password' })
    form.appendChild(usernameEl)
    form.appendChild(passwordEl)
    const submitBtn = makeButton(form)

    ;(collectCandidates as any).mockReturnValue(makeScanResult({
      candidates: [
        { element: usernameEl, matchedKind: 'login.username', match: { confidence: 90, accepted: true, bestKind: 'login.username', runnerUp: null }, crossOrigin: false },
        { element: passwordEl, matchedKind: 'login.password', match: { confidence: 95, accepted: true, bestKind: 'login.password', runnerUp: null }, crossOrigin: false },
      ],
    }))
    ;(resolveSubmitTarget as any).mockReturnValue(submitBtn)

    // Password field guard fails
    ;(guardElement as any).mockImplementation((el: HTMLElement) => {
      if (el === passwordEl) return { safe: false, code: 'ELEMENT_HIDDEN', reason: 'off-screen' }
      return { safe: true, code: null, reason: '' }
    })

    const state = await resolveQsoState([makeVaultItem()])
    // Candidate has allGuardsPass=false, so no exact match
    expect(state.status).toBe('HAS_CANDIDATES')
  })
})

describe('QSO Engine — Fill Execution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    ;(isAutofillActive as any).mockReturnValue(true)
    ;(isHAEnforced as any).mockReturnValue(false)
    ;(areWritesDisabled as any).mockReturnValue(false)
    ;(guardElement as any).mockReturnValue({ safe: true, code: null, reason: '' })
    ;(vaultAPI.getItemForFill as any).mockResolvedValue(makeVaultItem())
    ;(commitInsert as any).mockResolvedValue({
      success: true,
      sessionId: '00000000-0000-0000-0000-000000000000',
      fields: [],
    })
    ;(safeSubmitAfterFill as any).mockReturnValue({ submitted: false, reason: 'no_submit_element' })
    ;(matchOrigin as any).mockReturnValue({ matches: true, matchType: 'exact', confidence: 100 })
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('blocks fill when isTrusted is false', async () => {
    const candidate = {
      itemId: '11111111-2222-3333-4444-555555555555',
      title: 'Test',
      usernameEl: makeInput(),
      passwordEl: makeInput({ type: 'password' }),
      allGuardsPass: true,
      originTier: 'exact' as const,
    }

    const result = await executeQsoFill(candidate, false)
    expect(result.filled).toBe(false)
    expect(commitInsert).not.toHaveBeenCalled()
  })

  it('blocks fill when autofill is inactive', async () => {
    ;(isAutofillActive as any).mockReturnValue(false)
    const candidate = {
      itemId: '11111111-2222-3333-4444-555555555555',
      title: 'Test',
      usernameEl: makeInput(),
      allGuardsPass: true,
      originTier: 'exact' as const,
    }

    const result = await executeQsoFill(candidate, true)
    expect(result.filled).toBe(false)
  })

  it('blocks fill when writes are disabled', async () => {
    ;(areWritesDisabled as any).mockReturnValue(true)
    const candidate = {
      itemId: '11111111-2222-3333-4444-555555555555',
      title: 'Test',
      usernameEl: makeInput(),
      allGuardsPass: true,
      originTier: 'exact' as const,
    }

    const result = await executeQsoFill(candidate, true)
    expect(result.filled).toBe(false)
  })

  it('calls commitInsert with a session in preview state', async () => {
    const candidate = {
      itemId: '11111111-2222-3333-4444-555555555555',
      title: 'Test',
      usernameEl: makeInput({ name: 'username' }),
      passwordEl: makeInput({ name: 'password', type: 'password' }),
      allGuardsPass: true,
      originTier: 'exact' as const,
    }

    await executeQsoFill(candidate, true)

    expect(commitInsert).toHaveBeenCalledTimes(1)
    const session = (commitInsert as any).mock.calls[0][0]
    expect(session.state).toBe('preview')
    expect(session.targets.length).toBe(2)
  })

  it('sets and clears qsoFillActive around commitInsert', async () => {
    const candidate = {
      itemId: '11111111-2222-3333-4444-555555555555',
      title: 'Test',
      usernameEl: makeInput(),
      allGuardsPass: true,
      originTier: 'exact' as const,
    }

    await executeQsoFill(candidate, true)

    expect(setQsoFillActive).toHaveBeenCalledWith(true)
    expect(setQsoFillActive).toHaveBeenCalledWith(false)
    // true before false
    const calls = (setQsoFillActive as any).mock.calls
    const trueIdx = calls.findIndex((c: any) => c[0] === true)
    const falseIdx = calls.findIndex((c: any) => c[0] === false)
    expect(trueIdx).toBeLessThan(falseIdx)
  })

  it('calls safeSubmitAfterFill after successful commit', async () => {
    const candidate = {
      itemId: '11111111-2222-3333-4444-555555555555',
      title: 'Test',
      usernameEl: makeInput(),
      passwordEl: makeInput({ type: 'password' }),
      allGuardsPass: true,
      originTier: 'exact' as const,
    }

    await executeQsoFill(candidate, true)

    expect(safeSubmitAfterFill).toHaveBeenCalledTimes(1)
  })

  it('does not call safeSubmitAfterFill when commit fails', async () => {
    ;(commitInsert as any).mockResolvedValue({
      success: false,
      sessionId: '00000000-0000-0000-0000-000000000000',
      fields: [],
      error: { code: 'SESSION_INVALID', message: 'test' },
    })

    const candidate = {
      itemId: '11111111-2222-3333-4444-555555555555',
      title: 'Test',
      usernameEl: makeInput(),
      allGuardsPass: true,
      originTier: 'exact' as const,
    }

    const result = await executeQsoFill(candidate, true)
    expect(result.filled).toBe(false)
    expect(safeSubmitAfterFill).not.toHaveBeenCalled()
  })

  it('returns filled=true, submitted=true when submit succeeds', async () => {
    ;(safeSubmitAfterFill as any).mockReturnValue({ submitted: true, code: 'SUBMIT_OK' })

    const candidate = {
      itemId: '11111111-2222-3333-4444-555555555555',
      title: 'Test',
      usernameEl: makeInput(),
      allGuardsPass: true,
      originTier: 'exact' as const,
    }

    const result = await executeQsoFill(candidate, true)
    expect(result.filled).toBe(true)
    expect(result.submitted).toBe(true)
    expect(result.submitCode).toBe('SUBMIT_OK')
  })

  it('never calls setValueSafely directly (uses commitInsert)', async () => {
    const candidate = {
      itemId: '11111111-2222-3333-4444-555555555555',
      title: 'Test',
      usernameEl: makeInput(),
      allGuardsPass: true,
      originTier: 'exact' as const,
    }

    await executeQsoFill(candidate, true)

    // setValueSafely is not imported or called by qsoEngine
    // This test just ensures commitInsert is the write path
    expect(commitInsert).toHaveBeenCalled()
  })

  it('returns submitCode from safeSubmitAfterFill', async () => {
    ;(safeSubmitAfterFill as any).mockReturnValue({ submitted: false, code: 'SUBMIT_MUTATION', reason: 'mutation_guard_tripped' })
    const candidate = {
      itemId: '11111111-2222-3333-4444-555555555555',
      title: 'Test',
      usernameEl: makeInput(),
      allGuardsPass: true,
      originTier: 'exact' as const,
    }
    const result = await executeQsoFill(candidate, true)
    expect(result.filled).toBe(true)
    expect(result.submitted).toBe(false)
    expect(result.submitCode).toBe('SUBMIT_MUTATION')
    expect(result.submitBlockReason).toBe('mutation_guard_tripped')
  })

  it('passes mutation guard to safeSubmitAfterFill', async () => {
    const candidate = {
      itemId: '11111111-2222-3333-4444-555555555555',
      title: 'Test',
      usernameEl: makeInput(),
      allGuardsPass: true,
      originTier: 'exact' as const,
    }
    await executeQsoFill(candidate, true)
    const callArgs = (safeSubmitAfterFill as any).mock.calls[0][0]
    expect(callArgs.mutationGuard).toBeDefined()
    expect(typeof callArgs.mutationGuard.check).toBe('function')
  })
})

// ============================================================================
// §3 — Versioned QSO Contract
// ============================================================================

import {
  QSO_RESULT_VERSION, QSO_STATUSES, QSO_ERROR_CODES,
  isQsoResultV1, buildQsoStateResult, buildQsoFillActionResult,
} from '../qso/qsoEngine'
import type { QsoActionResult } from '../qso/qsoEngine'

describe('QSO Versioned Contract', () => {
  it('QSO_RESULT_VERSION is "qso-v1"', () => {
    expect(QSO_RESULT_VERSION).toBe('qso-v1')
  })

  it('QSO_STATUSES contains all status values', () => {
    expect(QSO_STATUSES.has('EXACT_MATCH')).toBe(true)
    expect(QSO_STATUSES.has('HAS_CANDIDATES')).toBe(true)
    expect(QSO_STATUSES.has('NONE')).toBe(true)
    expect(QSO_STATUSES.has('BLOCKED')).toBe(true)
    expect(QSO_STATUSES.size).toBe(4)
  })

  it('QSO_ERROR_CODES contains all error codes', () => {
    const expected = [
      'INVALID_PARAMS', 'AUTOFILL_DISABLED', 'WRITES_DISABLED',
      'ORIGIN_MISMATCH', 'PSL_BLOCKED', 'PARTIAL_SCAN', 'NO_TARGETS',
      'ELEMENT_HIDDEN', 'HA_BLOCKED', 'INTERNAL_ERROR',
    ]
    for (const code of expected) {
      expect(QSO_ERROR_CODES.has(code)).toBe(true)
    }
    expect(QSO_ERROR_CODES.size).toBe(10)
  })

  it('buildQsoStateResult produces valid contract for EXACT_MATCH', () => {
    const state = {
      status: 'EXACT_MATCH' as const,
      candidates: [{ itemId: 'x', title: 'T', allGuardsPass: true, originTier: 'exact' as const }],
      exactMatch: { itemId: 'x', title: 'T', allGuardsPass: true, originTier: 'exact' as const },
      submitEligible: true,
      originTier: 'exact' as const,
      partialScan: false,
    }
    const result = buildQsoStateResult(state)
    expect(result.resultVersion).toBe('qso-v1')
    expect(result.success).toBe(true)
    expect(result.state).toBe('EXACT_MATCH')
    expect(result.candidateCount).toBe(1)
    expect(result.submitEligible).toBe(true)
    expect(result.error).toBeUndefined()
    expect(isQsoResultV1(result)).toBe(true)
  })

  it('buildQsoStateResult produces valid contract for BLOCKED', () => {
    const state = {
      status: 'BLOCKED' as const,
      blockReason: 'autofill_disabled' as const,
      candidates: [],
      submitEligible: false,
      originTier: 'none' as const,
      partialScan: false,
    }
    const result = buildQsoStateResult(state)
    expect(result.resultVersion).toBe('qso-v1')
    expect(result.success).toBe(false)
    expect(result.state).toBe('BLOCKED')
    expect(result.error).toBeDefined()
    expect(result.error!.code).toBe('AUTOFILL_DISABLED')
    expect(isQsoResultV1(result)).toBe(true)
  })

  it('buildQsoFillActionResult includes fill and submit info', () => {
    const state = {
      status: 'EXACT_MATCH' as const,
      candidates: [{ itemId: 'x', title: 'T', allGuardsPass: true, originTier: 'exact' as const }],
      submitEligible: true,
      originTier: 'exact' as const,
      partialScan: false,
    }
    const fillResult = {
      filled: true,
      submitted: true,
      submitCode: 'SUBMIT_OK' as const,
    }
    const result = buildQsoFillActionResult(state, fillResult)
    expect(result.resultVersion).toBe('qso-v1')
    expect(result.success).toBe(true)
    expect(result.fillAttempted).toBe(true)
    expect(result.submitAttempted).toBe(true)
    expect(result.submitResult).toBe('SUBMITTED')
    expect(isQsoResultV1(result)).toBe(true)
  })

  it('buildQsoFillActionResult for failed fill includes error code', () => {
    const state = {
      status: 'EXACT_MATCH' as const,
      candidates: [],
      submitEligible: false,
      originTier: 'exact' as const,
      partialScan: false,
    }
    const fillResult = {
      filled: false,
      submitted: false,
      fillError: 'Autofill disabled',
    }
    const result = buildQsoFillActionResult(state, fillResult)
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(result.error!.code).toBe('AUTOFILL_DISABLED')
    expect(isQsoResultV1(result)).toBe(true)
  })
})

// ============================================================================
// §4 — isQsoResultV1 Validator
// ============================================================================

describe('isQsoResultV1 Validator', () => {
  it('rejects null/undefined', () => {
    expect(isQsoResultV1(null)).toBe(false)
    expect(isQsoResultV1(undefined)).toBe(false)
  })

  it('rejects wrong resultVersion', () => {
    expect(isQsoResultV1({ resultVersion: 'qso-v2', success: true, state: 'EXACT_MATCH', candidateCount: 0, submitEligible: false })).toBe(false)
  })

  it('rejects unknown state', () => {
    expect(isQsoResultV1({ resultVersion: 'qso-v1', success: true, state: 'UNKNOWN', candidateCount: 0, submitEligible: false })).toBe(false)
  })

  it('rejects non-finite candidateCount', () => {
    expect(isQsoResultV1({ resultVersion: 'qso-v1', success: true, state: 'EXACT_MATCH', candidateCount: Infinity, submitEligible: false })).toBe(false)
  })

  it('rejects error with unknown code', () => {
    expect(isQsoResultV1({ resultVersion: 'qso-v1', success: false, state: 'BLOCKED', candidateCount: 0, submitEligible: false, error: { code: 'BOGUS' } })).toBe(false)
  })

  it('rejects invalid submitResult', () => {
    expect(isQsoResultV1({ resultVersion: 'qso-v1', success: true, state: 'EXACT_MATCH', candidateCount: 1, submitEligible: true, submitResult: 'UNKNOWN' })).toBe(false)
  })

  it('accepts valid success result', () => {
    expect(isQsoResultV1({
      resultVersion: 'qso-v1', success: true, state: 'EXACT_MATCH',
      candidateCount: 1, submitEligible: true, submitResult: 'SUBMITTED',
    })).toBe(true)
  })

  it('accepts valid error result', () => {
    expect(isQsoResultV1({
      resultVersion: 'qso-v1', success: false, state: 'BLOCKED',
      candidateCount: 0, submitEligible: false, error: { code: 'AUTOFILL_DISABLED' },
    })).toBe(true)
  })
})

// ============================================================================
// §5 — Serialization Safety (no PII in JSON.stringify)
// ============================================================================

describe('QSO Serialization Safety', () => {
  const PII_PATTERNS = [
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,  // UUID
    /[\w.-]+@[\w.-]+\.\w{2,}/,                                           // email
    /https?:\/\/[^\s"]+/,                                                 // URL
    /\.[a-z]{2,}$/m,                                                      // domain suffix
    /querySelector|getElement|\.closest/,                                  // selector-like
  ]

  function assertNoPII(obj: unknown) {
    const json = JSON.stringify(obj)
    for (const pattern of PII_PATTERNS) {
      expect(json).not.toMatch(pattern)
    }
  }

  it('buildQsoStateResult for EXACT_MATCH has no PII', () => {
    const state = {
      status: 'EXACT_MATCH' as const,
      candidates: [{ itemId: 'x', title: 'T', allGuardsPass: true, originTier: 'exact' as const }],
      exactMatch: { itemId: 'x', title: 'T', allGuardsPass: true, originTier: 'exact' as const },
      submitEligible: true,
      originTier: 'exact' as const,
      partialScan: false,
    }
    assertNoPII(buildQsoStateResult(state))
  })

  it('buildQsoStateResult for BLOCKED has no PII', () => {
    const state = {
      status: 'BLOCKED' as const,
      blockReason: 'psl_blocked' as const,
      candidates: [],
      submitEligible: false,
      originTier: 'none' as const,
      partialScan: false,
    }
    assertNoPII(buildQsoStateResult(state))
  })

  it('buildQsoFillActionResult has no PII', () => {
    const state = {
      status: 'EXACT_MATCH' as const,
      candidates: [{ itemId: 'x', title: 'T', allGuardsPass: true, originTier: 'exact' as const }],
      submitEligible: true,
      originTier: 'exact' as const,
      partialScan: false,
    }
    const fill = { filled: true, submitted: false, submitCode: 'SUBMIT_BLOCKED' as const, submitBlockReason: 'no_form' as const }
    assertNoPII(buildQsoFillActionResult(state, fill))
  })

  it('all QSO_ERROR_CODES are PII-free', () => {
    for (const code of QSO_ERROR_CODES) {
      for (const pattern of PII_PATTERNS) {
        expect(code).not.toMatch(pattern)
      }
    }
  })
})
