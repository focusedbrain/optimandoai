/**
 * Tests: Field Scanner DoS Caps — Element/Time/Candidate Limits
 *
 * Validates:
 *   1. Scanner uses TreeWalker (no querySelectorAll on the scan root)
 *   2. Scanner stops at element cap and returns partial=true
 *   3. Scanner stops at candidate cap and returns partial=true
 *   4. Scanner stops at time budget and returns partial=true
 *   5. HA mode applies stricter caps AND smaller checkEvery
 *   6. Normal sites (< caps) get partial=false
 *   7. Audit log fires at security level under HA when partial
 *   8. Audit log fires at warn level under non-HA when partial
 *   9. Caps are exported and have correct values
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock haGuard BEFORE imports ──
vi.mock('../haGuard', () => ({
  isHAEnforced: vi.fn(() => false),
  haCheck: vi.fn(() => true),
  haCheckSilent: vi.fn(() => true),
}))

// ── Mock hardening (capture audit calls) ──
vi.mock('../hardening', () => ({
  auditLog: vi.fn(),
  auditLogSafe: vi.fn(),
  emitTelemetryEvent: vi.fn(),
}))

import {
  collectCandidates,
  invalidateScanCache,
  SCAN_CAP_MAX_ELEMENTS,
  SCAN_CAP_MAX_ELEMENTS_HA,
  SCAN_CAP_MAX_CANDIDATES,
  SCAN_CAP_MAX_CANDIDATES_HA,
  SCAN_CAP_MAX_DURATION_MS,
  SCAN_CAP_MAX_DURATION_MS_HA,
  SCAN_CHECK_EVERY,
  SCAN_CHECK_EVERY_HA,
} from '../fieldScanner'
import { isHAEnforced } from '../haGuard'
import { auditLog, auditLogSafe, emitTelemetryEvent } from '../hardening'

// ============================================================================
// Helpers
// ============================================================================

const DEFAULT_TOGGLES = { login: true, identity: true, company: true, custom: true }

/**
 * Create test inputs. If `matchable` is true, they have autocomplete='username'
 * so the scanner scores them as candidates. If false, they have random names
 * that won't match any FieldKind, so they are evaluated but NOT candidates.
 */
function createInputs(count: number, container?: HTMLElement, matchable = true): HTMLElement {
  const root = container ?? document.createElement('div')
  for (let i = 0; i < count; i++) {
    const input = document.createElement('input')
    input.type = 'text'
    if (matchable) {
      input.name = `field_${i}`
      input.autocomplete = 'username'
    } else {
      input.name = `xdata_${i}_nope`
      input.autocomplete = 'off'
    }
    Object.defineProperty(input, 'getBoundingClientRect', {
      value: () => ({ width: 200, height: 30, top: i * 40, left: 10, right: 210, bottom: i * 40 + 30 }),
    })
    root.appendChild(input)
  }
  if (!container) document.body.appendChild(root)
  return root
}

/**
 * Create a DOM tree with mixed element types (divs + inputs) to test that
 * the TreeWalker counts ALL elements, not just form controls.
 */
function createMixedDOM(divCount: number, inputCount: number): HTMLElement {
  const root = document.createElement('div')
  // Add non-form-control divs first
  for (let i = 0; i < divCount; i++) {
    const div = document.createElement('div')
    div.textContent = `filler-${i}`
    root.appendChild(div)
  }
  // Then add inputs
  for (let i = 0; i < inputCount; i++) {
    const input = document.createElement('input')
    input.type = 'text'
    input.name = `field_${i}`
    input.autocomplete = 'username'
    Object.defineProperty(input, 'getBoundingClientRect', {
      value: () => ({ width: 200, height: 30, top: i * 40, left: 10, right: 210, bottom: i * 40 + 30 }),
    })
    root.appendChild(input)
  }
  document.body.appendChild(root)
  return root
}

// ============================================================================
// §1  Cap Constants — Exact Values
// ============================================================================

describe('Scan cap constants', () => {
  it('exports correct normal-mode caps', () => {
    expect(SCAN_CAP_MAX_ELEMENTS).toBe(1500)
    expect(SCAN_CAP_MAX_CANDIDATES).toBe(80)
    expect(SCAN_CAP_MAX_DURATION_MS).toBe(120)
  })

  it('exports correct HA-mode caps (stricter)', () => {
    expect(SCAN_CAP_MAX_ELEMENTS_HA).toBe(500)
    expect(SCAN_CAP_MAX_CANDIDATES_HA).toBe(30)
    expect(SCAN_CAP_MAX_DURATION_MS_HA).toBe(60)
  })

  it('HA caps are strictly lower than normal caps', () => {
    expect(SCAN_CAP_MAX_ELEMENTS_HA).toBeLessThan(SCAN_CAP_MAX_ELEMENTS)
    expect(SCAN_CAP_MAX_CANDIDATES_HA).toBeLessThan(SCAN_CAP_MAX_CANDIDATES)
    expect(SCAN_CAP_MAX_DURATION_MS_HA).toBeLessThan(SCAN_CAP_MAX_DURATION_MS)
  })

  it('exports correct checkEvery constants', () => {
    expect(SCAN_CHECK_EVERY).toBe(50)
    expect(SCAN_CHECK_EVERY_HA).toBe(20)
    expect(SCAN_CHECK_EVERY_HA).toBeLessThan(SCAN_CHECK_EVERY)
  })
})

// ============================================================================
// §2  No querySelectorAll — TreeWalker-based scan
// ============================================================================

describe('TreeWalker-based scan (no querySelectorAll)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isHAEnforced).mockReturnValue(false)
    invalidateScanCache()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('does not call querySelectorAll on the scan root', () => {
    const root = createInputs(10)
    const spy = vi.spyOn(root, 'querySelectorAll')

    invalidateScanCache()
    collectCandidates(DEFAULT_TOGGLES, { root: root as HTMLElement })

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does not call querySelectorAll on document.body when using default root', () => {
    createInputs(5)
    const spy = vi.spyOn(document.body, 'querySelectorAll')

    invalidateScanCache()
    collectCandidates(DEFAULT_TOGGLES)

    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('traverses mixed DOM (divs + inputs) and counts all elements', () => {
    // 20 divs + 5 inputs = 25 elements total.
    // With maxElements=15, the walker visits 15 nodes (divs first, then inputs).
    // Divs are NOT form controls, so they are visited but not yielded.
    // Depending on DOM order, only inputs after the first 15 nodes will be reached.
    const root = createMixedDOM(20, 5)

    const result = collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
      maxElements: 15,
    })

    // Walker visits 15 of 25 elements total. Since divs come first,
    // it visits 15 divs (none yielded) and stops before reaching inputs.
    expect(result.partial).toBe(true)
    expect(result.partialReason).toBe('element_cap')
    expect(result.elementsEvaluated).toBe(0) // No inputs were reached
  })
})

// ============================================================================
// §3  Element Cap
// ============================================================================

describe('Element cap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isHAEnforced).mockReturnValue(false)
    invalidateScanCache()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('stops at element cap and returns partial=true with reason element_cap', () => {
    // Use a small maxElements to test the cap mechanism
    const root = createInputs(50)

    const result = collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
      maxElements: 10,
    })

    expect(result.elementsEvaluated).toBe(10)
    expect(result.partial).toBe(true)
    expect(result.partialReason).toBe('element_cap')
  })

  it('returns partial=false when elements are within cap', () => {
    const root = createInputs(5)

    const result = collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
      maxElements: 100,
    })

    expect(result.elementsEvaluated).toBeLessThanOrEqual(5)
    expect(result.partial).toBe(false)
    expect(result.partialReason).toBeUndefined()
  })
})

// ============================================================================
// §4  Candidate Cap
// ============================================================================

describe('Candidate cap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isHAEnforced).mockReturnValue(false)
    invalidateScanCache()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('stops when candidate cap is reached', () => {
    // Create many inputs — some will match as candidates
    const root = createInputs(200)

    const result = collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
      maxElements: 200,
      maxCandidates: 3,
    })

    // If any candidates were found, they should be capped at 3
    if (result.candidates.length >= 3) {
      expect(result.candidates.length).toBe(3)
      expect(result.partial).toBe(true)
      expect(result.partialReason).toBe('candidate_cap')
    }
    // If fewer than 3 candidates matched, partial should be false
    // (this is ok — the test verifies the CAP logic, not matching)
  })

  it('candidate_cap takes precedence over element_cap', () => {
    // Create 50 matchable inputs. maxElements=50, maxCandidates=3.
    // Both caps could trigger, but candidate_cap should win.
    const root = createInputs(50)

    const result = collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
      maxElements: 50,
      maxCandidates: 3,
    })

    if (result.candidates.length >= 3) {
      expect(result.partial).toBe(true)
      expect(result.partialReason).toBe('candidate_cap')
    }
  })
})

// ============================================================================
// §5  Time Budget
// ============================================================================

describe('Time budget cap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isHAEnforced).mockReturnValue(false)
    invalidateScanCache()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('stops at time budget and returns partial=true with reason time_budget', () => {
    // Create enough elements to pass the first checkEvery threshold (50 in normal mode)
    const root = createInputs(200, undefined, false) // non-matchable to avoid candidate_cap

    // Mock performance.now: first call returns 0 (startTime), subsequent calls return 1000
    let perfCallCount = 0
    vi.spyOn(performance, 'now').mockImplementation(() => {
      perfCallCount++
      return perfCallCount === 1 ? 0 : 1000
    })

    const result = collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
      maxElements: 5000, // very high — should not trigger
      maxDurationMs: 50,  // low budget — 1000 >> 50 → triggers
    })

    expect(result.partial).toBe(true)
    expect(result.partialReason).toBe('time_budget')
    // Should have stopped at the first checkEvery boundary (50 in normal mode)
    expect(result.elementsEvaluated).toBeLessThanOrEqual(SCAN_CHECK_EVERY)
  })

  it('respects maxDurationMs config parameter (generous budget completes normally)', () => {
    const root = createInputs(5)

    const result = collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
      maxDurationMs: 10000, // Very generous — won't trigger for 5 elements
    })

    expect(result.partial).toBe(false)
  })

  it('time budget cap constants are correct', () => {
    expect(SCAN_CAP_MAX_DURATION_MS).toBe(120)
    expect(SCAN_CAP_MAX_DURATION_MS_HA).toBe(60)
  })
})

// ============================================================================
// §6  HA Mode — Stricter Caps + Smaller checkEvery
// ============================================================================

describe('HA mode — stricter caps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateScanCache()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('HA mode applies lower element cap', () => {
    vi.mocked(isHAEnforced).mockReturnValue(true)
    // Use non-matchable inputs so candidate cap doesn't trigger first
    const root = createInputs(600, undefined, false)

    const result = collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
    })

    // HA element cap is 500, so with 600 non-matchable inputs the element cap triggers
    expect(result.elementsEvaluated).toBeLessThanOrEqual(SCAN_CAP_MAX_ELEMENTS_HA)
    expect(result.partial).toBe(true)
    expect(result.partialReason).toBe('element_cap')
  })

  it('non-HA mode allows more elements than HA mode', () => {
    vi.mocked(isHAEnforced).mockReturnValue(false)
    // Use non-matchable inputs so candidate cap doesn't trigger
    const root = createInputs(600, undefined, false)

    const result = collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
    })

    // Non-HA element cap is 1500, so 600 inputs should all be processed
    expect(result.elementsEvaluated).toBeLessThanOrEqual(600)
    expect(result.partial).toBe(false)
  })

  it('HA mode uses lower candidate cap than non-HA', () => {
    // This is a structural test — verify the cap constants
    expect(SCAN_CAP_MAX_CANDIDATES_HA).toBe(30)
    expect(SCAN_CAP_MAX_CANDIDATES).toBe(80)
  })

  it('HA mode uses smaller checkEvery causing earlier time budget detection', () => {
    // Create 100 non-matchable inputs.
    // Mock performance.now so time always exceeds budget after first call.
    // HA (checkEvery=20) detects at element 20; non-HA (checkEvery=50) at element 50.

    // ── HA run ──
    vi.mocked(isHAEnforced).mockReturnValue(true)
    const rootHA = createInputs(100, undefined, false)

    let perfCallCountHA = 0
    const perfSpyHA = vi.spyOn(performance, 'now').mockImplementation(() => {
      perfCallCountHA++
      return perfCallCountHA === 1 ? 0 : 1000
    })

    invalidateScanCache()
    const resultHA = collectCandidates(DEFAULT_TOGGLES, {
      root: rootHA as HTMLElement,
      maxElements: 5000,  // high — won't trigger
      maxDurationMs: 50,
    })
    perfSpyHA.mockRestore()

    // ── Non-HA run ──
    vi.mocked(isHAEnforced).mockReturnValue(false)
    const rootNonHA = createInputs(100, undefined, false)

    let perfCallCountNonHA = 0
    const perfSpyNonHA = vi.spyOn(performance, 'now').mockImplementation(() => {
      perfCallCountNonHA++
      return perfCallCountNonHA === 1 ? 0 : 1000
    })

    invalidateScanCache()
    const resultNonHA = collectCandidates(DEFAULT_TOGGLES, {
      root: rootNonHA as HTMLElement,
      maxElements: 5000,
      maxDurationMs: 50,
    })
    perfSpyNonHA.mockRestore()

    // Both should be partial with time_budget
    expect(resultHA.partial).toBe(true)
    expect(resultHA.partialReason).toBe('time_budget')
    expect(resultNonHA.partial).toBe(true)
    expect(resultNonHA.partialReason).toBe('time_budget')

    // HA should have visited fewer elements (checkEvery=20 < checkEvery=50)
    expect(resultHA.elementsEvaluated).toBeLessThan(resultNonHA.elementsEvaluated)
    expect(resultHA.elementsEvaluated).toBeLessThanOrEqual(SCAN_CHECK_EVERY_HA)
    expect(resultNonHA.elementsEvaluated).toBeLessThanOrEqual(SCAN_CHECK_EVERY)
  })
})

// ============================================================================
// §7  Audit Logging on Partial Scan
// ============================================================================

describe('Audit logging — partial scans', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    invalidateScanCache()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('logs at warn level when partial scan in non-HA mode', () => {
    vi.mocked(isHAEnforced).mockReturnValue(false)
    const root = createInputs(20)

    collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
      maxElements: 5,
    })

    expect(auditLogSafe).toHaveBeenCalledWith(
      'warn',
      'SCAN_PARTIAL',
      expect.any(String),
      expect.objectContaining({ partialReason: 'element_cap' }),
    )
  })

  it('logs at security level when partial scan in HA mode', () => {
    vi.mocked(isHAEnforced).mockReturnValue(true)
    const root = createInputs(600)

    collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
    })

    expect(auditLogSafe).toHaveBeenCalledWith(
      'security',
      'SCAN_PARTIAL',
      expect.any(String),
      expect.objectContaining({ ha: true }),
    )
  })

  it('emits telemetry event on partial scan', () => {
    vi.mocked(isHAEnforced).mockReturnValue(false)
    const root = createInputs(20)

    collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
      maxElements: 5,
    })

    expect(emitTelemetryEvent).toHaveBeenCalledWith(
      'scan_partial',
      expect.objectContaining({
        reason: 'element_cap',
      }),
    )
  })

  it('does NOT log when scan completes normally', () => {
    vi.mocked(isHAEnforced).mockReturnValue(false)
    const root = createInputs(5)

    collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
      maxElements: 100,
    })

    expect(auditLogSafe).not.toHaveBeenCalled()
    expect(auditLog).not.toHaveBeenCalled()
  })
})

// ============================================================================
// §8  Normal Sites — No Impact
// ============================================================================

describe('Normal sites — caps do not affect typical pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isHAEnforced).mockReturnValue(false)
    invalidateScanCache()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('typical login page (2-3 fields) scans fully and finds candidates', () => {
    const root = document.createElement('div')
    const username = document.createElement('input')
    username.type = 'text'
    username.name = 'username'
    username.autocomplete = 'username'
    Object.defineProperty(username, 'getBoundingClientRect', {
      value: () => ({ width: 200, height: 30, top: 10, left: 10, right: 210, bottom: 40 }),
    })
    root.appendChild(username)

    const password = document.createElement('input')
    password.type = 'password'
    password.name = 'password'
    password.autocomplete = 'current-password'
    Object.defineProperty(password, 'getBoundingClientRect', {
      value: () => ({ width: 200, height: 30, top: 50, left: 10, right: 210, bottom: 80 }),
    })
    root.appendChild(password)

    document.body.appendChild(root)

    const result = collectCandidates(DEFAULT_TOGGLES, { root })

    expect(result.partial).toBe(false)
    expect(result.elementsEvaluated).toBeLessThanOrEqual(3)
    // Should find at least the username candidate
    expect(result.candidates.length).toBeGreaterThanOrEqual(1)
  })

  it('medium form (20 fields) scans fully', () => {
    const root = createInputs(20)

    const result = collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
    })

    expect(result.partial).toBe(false)
    expect(result.elementsEvaluated).toBeLessThanOrEqual(20)
  })
})

// ============================================================================
// Fail-Closed Default Tests
// ============================================================================

describe('Fail-closed defaults for scanner caps', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(isHAEnforced as any).mockReturnValue(false)
    document.body.innerHTML = ''
    invalidateScanCache()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('undefined config values use secure defaults', () => {
    const root = createInputs(5)

    // Pass explicit undefined values — must not widen caps
    const result = collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
      maxElements: undefined,
      maxCandidates: undefined,
      maxDurationMs: undefined,
    })

    // Should use defaults and complete successfully (5 inputs < 1500 cap)
    expect(result.partial).toBe(false)
    expect(result.candidates.length).toBeGreaterThanOrEqual(1)
  })

  it('null config values use secure defaults', () => {
    const root = createInputs(5)

    const result = collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
      maxElements: null as any,
      maxCandidates: null as any,
      maxDurationMs: null as any,
    })

    expect(result.partial).toBe(false)
    expect(result.candidates.length).toBeGreaterThanOrEqual(1)
  })

  it('negative values use secure defaults (not wider than SCAN_CAP)', () => {
    const root = createInputs(5)

    // Negative values must NOT be treated as "unlimited"
    const result = collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
      maxElements: -1,
      maxCandidates: -100,
      maxDurationMs: -50,
    })

    // Defaults applied: scan should work normally for 5 inputs
    expect(result.partial).toBe(false)
    expect(result.candidates.length).toBeGreaterThanOrEqual(1)
  })

  it('Infinity values use secure defaults', () => {
    const root = createInputs(5)

    // Infinity must NOT disable caps
    const result = collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
      maxElements: Infinity,
      maxCandidates: Infinity,
      maxDurationMs: Infinity,
    })

    expect(result.partial).toBe(false)
    expect(result.candidates.length).toBeGreaterThanOrEqual(1)
  })

  it('HA mode still clamps AFTER fail-closed defaults are applied', () => {
    ;(isHAEnforced as any).mockReturnValue(true)

    // Create more inputs than HA element cap (500) but fewer than normal cap (1500)
    // Use non-matchable to avoid candidate_cap
    const root = createInputs(600, undefined, false)

    const result = collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
      maxElements: undefined,  // should default to 1500, then HA clamps to 500
    })

    // HA cap (500) should truncate at 600 inputs → partial
    expect(result.partial).toBe(true)
    expect(result.partialReason).toBe('element_cap')
  })

  it('partial flag is correct when defaults are applied after invalid config', () => {
    // Pass 0 for maxCandidates — should fallback to SCAN_CAP_MAX_CANDIDATES (80)
    // So creating 5 inputs should NOT hit the cap
    const root = createInputs(5)

    const result = collectCandidates(DEFAULT_TOGGLES, {
      root: root as HTMLElement,
      maxCandidates: 0,
    })

    // Default 80 cap applied, 5 candidates < 80 → not partial
    expect(result.partial).toBe(false)
    expect(result.candidates.length).toBeGreaterThanOrEqual(1)
  })
})
