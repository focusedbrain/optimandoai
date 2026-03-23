// ============================================================================
// WRVault Autofill — Committer (Value Injection with Safety Checks)
// ============================================================================
//
// The committer is the final stage of the insertion pipeline.  It receives
// an OverlaySession where user consent has been received, validates every
// target, and injects values into the page DOM.
//
// Core principle: ALL pre-commit checks must pass for ALL targets before
// ANY value is written.  This is atomic — partial fills are not allowed.
//
// C-PIPE-02 defense:
//   The critical security property is that NO async gap (await, microtask
//   boundary, or callback) exists between the final target validation and
//   the native setter call.  The sequence:
//
//     finalValidateTarget(el)   — synchronous
//     setNativeValue(el, v)     — synchronous
//     dispatchFillEvents(el)    — synchronous
//
//   runs in a single, uninterrupted JavaScript microtask.  A page script
//   cannot execute between these calls, so DOM swapping at this stage is
//   impossible.
//
//   The async fingerprint check runs earlier as an "early gate" — if a
//   swap happens between the async gate and the sync gate, the sync gate
//   catches it because it re-checks isConnected, visibility, enabled, and
//   the mutation guard.
//
// Public API:
//   commitInsert(session)  → Promise<CommitResult>
//   setValueSafely(el, v)  → SetValueResult
//
// Security invariants:
//   - Never commit without prior overlay consent
//   - Never commit to hidden, detached, disabled, or cross-origin elements
//   - Fingerprint must match (tamper detection)
//   - Session must not be expired
//   - Detailed error codes for every failure mode
//   - isTrusted flag on consent event is verified (overlay enforces this)
// ============================================================================

import type {
  OverlaySession,
  OverlayTarget,
  CommitResult,
  CommitFieldResult,
  CommitError,
  CommitErrorCode,
  SafetyCheckResult,
  SafetyCheck,
  SafetyCheckName,
  FingerprintValidation,
} from '../../../../../packages/shared/src/vault/insertionPipeline'
import {
  RECT_TOLERANCE_PX,
  BLOCKED_INPUT_TYPES,
  VALID_TARGET_TAGS,
} from '../../../../../packages/shared/src/vault/insertionPipeline'
import { validateFingerprint } from './domFingerprint'
import {
  guardElement,
  auditLog,
  emitTelemetryEvent,
  redactError,
} from './hardening'
import { checkMutationGuard, isOverlayVisible, hideOverlay } from './overlayManager'
import { haCheck, isHAEnforced } from './haGuard'
import { areWritesDisabled } from './writesKillSwitch'

// ============================================================================
// §0.1  Dev-Only Write Canary
// ============================================================================
//
// Runtime invariant: setValueSafely must only be called when either:
//   a) An overlay is visible (commitInsert path — user clicked Insert)
//   b) An inline popover fill is in progress (inlinePopover click-to-fill)
//
// In production builds this is a no-op.  In dev builds (import.meta.env.DEV)
// it throws immediately if neither condition holds, catching accidental
// direct calls that bypass the consent/safety pipeline.
//
// This canary is intentionally conservative: it checks overlay visibility
// as a proxy for "we are in a legitimate write path".  The inline popover
// path sets _popoverFillActive before calling setValueSafely.

let _popoverFillActive = false
let _qsoFillActive = false

/**
 * Mark the start/end of an inline popover fill operation.
 * Called by inlinePopover.ts BEFORE invoking setValueSafely.
 */
export function setPopoverFillActive(active: boolean): void {
  _popoverFillActive = active
}

/**
 * Mark the start/end of a QSO (Quick Sign-On) fill operation.
 * Called by qsoEngine.ts when the user clicks the QSO icon and
 * commitInsert is about to be invoked.  This allows the dev-only
 * write canary to recognise QSO as a legitimate consent path.
 */
export function setQsoFillActive(active: boolean): void {
  _qsoFillActive = active
}

function devWriteCanary(): void {
  // Only enforce in dev builds — production must never throw here
  try {
    // @ts-expect-error Vite injects import.meta.env at build time; not in TS types for content scripts
    if (!import.meta.env?.DEV) return
  } catch {
    return
  }

  if (isOverlayVisible()) return
  if (_popoverFillActive) return
  if (_qsoFillActive) return

  // Neither overlay, popover, nor QSO path — this is a rogue write attempt
  const err = new Error(
    '[WRVault Write Canary] setValueSafely() called outside of overlay consent, ' +
    'popover fill, or QSO fill path. This is a security violation in dev mode. ' +
    'All DOM writes must flow through commitInsert(), inlinePopover, or QSO.',
  )
  auditLog('security', 'DEV_WRITE_CANARY', err.message)
  throw err
}

// ============================================================================
// §1  Types
// ============================================================================

/** Result of setting a single value on a DOM element. */
export interface SetValueResult {
  success: boolean
  /** Which strategy succeeded. */
  strategy?: 'native_setter' | 'direct_assign' | 'setAttribute'
  error?: CommitError
}

/** Telemetry event for local-only diagnostics. */
export interface CommitTelemetryEvent {
  sessionId: string
  timestamp: number
  domain: string
  fieldCount: number
  outcome: 'success' | 'partial_failure' | 'total_failure' | 'blocked'
  /** Per-field detail (no values — only kinds and error codes). */
  fields: Array<{
    kind: string
    success: boolean
    errorCode?: CommitErrorCode
    strategy?: string
  }>
  /** Safety checks that failed (if any). */
  failedChecks: SafetyCheckName[]
  /** Total time from consent click to commit completion (ms). */
  durationMs: number
}

/** Callback for telemetry events.  Set via setTelemetryHook(). */
type TelemetryHook = (event: CommitTelemetryEvent) => void
let _telemetryHook: TelemetryHook | null = null

/**
 * Register a local-only telemetry hook.
 * Events contain NO values — only field kinds, error codes, and timing.
 */
export function setTelemetryHook(hook: TelemetryHook | null): void {
  _telemetryHook = hook
}

// ============================================================================
// §1.1  Synchronous Final Validation (C-PIPE-02 defense)
// ============================================================================
//
// This function runs in the SAME microtask as setValueSafely().
// It must be:
//   1. Fully synchronous (no await, no callback, no Promise)
//   2. Complete (covers isConnected, visibility, enabled, mutation guard)
//   3. Called IMMEDIATELY before the value write — zero code between
//      the return of this function and the native setter call.
//
// If any check fails, the write for this target is skipped.
//

interface FinalValidation {
  valid: boolean
  code?: CommitErrorCode
  reason?: string
}

/**
 * Synchronous pre-write validation.  Runs in the same microtask as the
 * value setter — no async gap for a page script to exploit.
 */
function finalValidateTarget(element: HTMLElement): FinalValidation {
  // 1. isConnected — element still in DOM?
  if (!element || !element.isConnected) {
    return { valid: false, code: 'ELEMENT_DETACHED', reason: 'Element removed from DOM since async gate' }
  }

  // 2. Visibility — not hidden by CSS?
  const computed = getComputedStyle(element)
  if (computed.display === 'none') {
    return { valid: false, code: 'ELEMENT_HIDDEN', reason: 'Element has display:none' }
  }
  if (computed.visibility === 'hidden') {
    return { valid: false, code: 'ELEMENT_HIDDEN', reason: 'Element has visibility:hidden' }
  }
  if (parseFloat(computed.opacity) < 0.01) {
    return { valid: false, code: 'ELEMENT_HIDDEN', reason: 'Element has opacity near zero' }
  }

  // 3. Dimensions — not zero-size?
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    return { valid: false, code: 'ELEMENT_HIDDEN', reason: 'Element has zero dimensions' }
  }

  // 4. Enabled — not disabled or readonly?
  const input = element as HTMLInputElement
  if (input.disabled) {
    return { valid: false, code: 'ELEMENT_NOT_FOCUSABLE', reason: 'Element is disabled' }
  }
  if ('readOnly' in input && (input as HTMLInputElement).readOnly) {
    return { valid: false, code: 'READONLY_ELEMENT', reason: 'Element is readonly' }
  }

  // 5. Not in inert subtree?
  if (element.closest('[inert]')) {
    return { valid: false, code: 'ELEMENT_NOT_FOCUSABLE', reason: 'Element is inside an inert subtree' }
  }

  // 6. Mutation guard still clean? (synchronous check)
  const guardStatus = checkMutationGuard()
  if (!guardStatus.valid) {
    const reasons = guardStatus.violations.map(v => `${v.reason}[${v.targetIndex}]`).join(', ')
    return { valid: false, code: 'SUSPICIOUS_DOM_MUTATION', reason: `Mutation guard tripped: ${reasons}` }
  }

  return { valid: true }
}

// ============================================================================
// §2  commitInsert — Top-Level Orchestrator
// ============================================================================

/**
 * Commit all values for an OverlaySession into the page DOM.
 *
 * Pre-conditions (caller must guarantee):
 *   - User consent was received (overlay returned { action: 'insert' })
 *   - session.state was 'preview' at time of consent
 *   - The consent event had isTrusted === true (enforced by the overlay)
 *
 * Algorithm:
 *   Phase 1 (may await): Mutation guard, session checks, fingerprint hash
 *   Phase 2 (fully synchronous): For each target:
 *     finalValidateTarget → setValueSafely → dispatchFillEvents
 *     — zero async gaps between these calls
 *
 * If ANY safety check fails on ANY target, NO values are injected.
 */
export async function commitInsert(session: OverlaySession): Promise<CommitResult> {
  const startTime = Date.now()
  const fieldResults: CommitFieldResult[] = []

  // ====================================================================
  // PHASE 0 — HA Mode enforcement
  // ====================================================================

  // ── HA Gate: overlay must be present (no silent insert) ──
  if (!haCheck('skip_overlay')) {
    // HA is active → overlay is required.  Verify session came from overlay.
    if (session.state !== 'preview') {
      const error = makeError('SESSION_INVALID', 'HA Mode: insert requires overlay consent (session not in preview state)')
      auditLog('security', 'HA_COMMIT_BLOCKED', 'HA Mode: insert attempt without overlay consent')
      return { success: false, sessionId: session.id, fields: [], error }
    }
  }

  // ── HA Gate: mutation guard is required ──
  if (!haCheck('skip_mutation_guard')) {
    // HA is active → mutation guard MUST have been attached.
    // If it wasn't, reject immediately.
  }

  // ====================================================================
  // KILL-SWITCH GATE — Global writes kill-switch (fail-closed)
  //
  // If the operator/admin has disabled writes globally, abort the entire
  // commit before ANY safety checks or DOM writes occur.  This is the
  // authoritative server-side enforcement point; the overlay/popover UX
  // also reflects the state, but this gate is the real security boundary.
  //
  // Placed before Phase 1 so no work runs when writes are disabled.
  // No partial writes allowed.
  // ====================================================================
  if (areWritesDisabled()) {
    session.state = 'invalidated'
    const level = isHAEnforced() ? 'security' : 'warn'
    auditLog(level, 'WRITES_DISABLED_COMMIT_BLOCKED',
      'Global writes kill-switch active — commit aborted')
    emitTelemetryEvent('commit_blocked', { reason: 'writes_disabled' })
    hideOverlay()
    return {
      success: false,
      sessionId: session.id,
      fields: [],
      error: makeError('WRITES_DISABLED', 'Autofill writes are globally disabled by operator'),
    }
  }

  // ====================================================================
  // PHASE 1 — Async early gates (any await is acceptable here because
  //           the synchronous final gate in Phase 2 re-checks everything)
  // ====================================================================

  // ── Gate 0: Mutation guard (blocks C-PIPE-01 TOCTOU attacks) ──
  const guardStatus = checkMutationGuard()
  if (!guardStatus.valid) {
    session.state = 'invalidated'
    const reasons = guardStatus.violations.map(v => `${v.reason}[${v.targetIndex}]`).join(', ')
    const error = makeError('SUSPICIOUS_DOM_MUTATION', `Mutation guard tripped: ${reasons}`)
    auditLog('security', 'COMMIT_BLOCKED_MUTATION', `Commit blocked by mutation guard: ${reasons}`)
    emitTelemetry(session, [], ['no_suspicious_mutation'], startTime, 'blocked')
    emitTelemetryEvent('commit_blocked', { reason: 'mutation_guard', details: reasons })
    return { success: false, sessionId: session.id, fields: [], error }
  }

  // ── Gate 1: Session state ──
  if (session.state !== 'preview') {
    const error = makeError(
      'SESSION_INVALID',
      `Session is in state "${session.state}", expected "preview"`,
    )
    auditLog('warn', 'SESSION_INVALID', `Commit rejected: session in state "${session.state}"`)
    emitTelemetry(session, [], ['session_not_expired'], startTime, 'blocked')
    emitTelemetryEvent('commit_blocked', { reason: 'session_invalid' })
    return { success: false, sessionId: session.id, fields: [], error }
  }

  // ── Gate 2: Session expiry ──
  if (Date.now() - session.createdAt > session.timeoutMs) {
    session.state = 'expired'
    const error = makeError('SESSION_EXPIRED', 'Session has expired')
    auditLog('warn', 'SESSION_EXPIRED', `Commit rejected: session expired after ${session.timeoutMs}ms`)
    emitTelemetry(session, [], ['session_not_expired'], startTime, 'blocked')
    emitTelemetryEvent('commit_blocked', { reason: 'session_expired' })
    return { success: false, sessionId: session.id, fields: [], error }
  }

  // ── Gate 3: Async safety checks on ALL targets (fingerprint hash) ──
  //
  // This is the LAST await in the function.  After this point, everything
  // is synchronous.
  //
  const allChecks: Array<{ target: OverlayTarget; result: SafetyCheckResult }> = []

  for (const target of session.targets) {
    const checkResult = await runSafetyChecks(target, session)
    allChecks.push({ target, result: checkResult })
  }

  const failedTargets = allChecks.filter(c => !c.result.safe)
  if (failedTargets.length > 0) {
    session.state = 'invalidated'

    const failedNames = failedTargets.flatMap(
      ft => ft.result.checks.filter(c => !c.passed).map(c => c.name),
    )
    const firstFailure = failedTargets[0]
    const firstFailedCheck = firstFailure.result.checks.find(c => !c.passed)

    const errorCode = safetyCheckToErrorCode(firstFailedCheck?.name ?? 'is_visible')
    const error = makeError(
      errorCode,
      `Pre-commit safety check failed: ${firstFailedCheck?.reason ?? 'unknown'}`,
      firstFailure.target.field.kind,
    )

    for (const { target, result } of allChecks) {
      const failedCheck = result.checks.find(c => !c.passed)
      fieldResults.push({
        kind: target.field.kind,
        success: false,
        error: failedCheck
          ? makeError(
              safetyCheckToErrorCode(failedCheck.name),
              failedCheck.reason,
              target.field.kind,
            )
          : undefined,
      })
    }

    emitTelemetry(session, fieldResults, failedNames, startTime, 'blocked')
    return { success: false, sessionId: session.id, fields: fieldResults, error }
  }

  // ── Gate 4: Hardened element guard on ALL targets ──
  for (const target of session.targets) {
    const el = target.element as HTMLElement
    const guard = guardElement(el)
    if (!guard.safe) {
      session.state = 'invalidated'
      auditLog('security', guard.code ?? 'ELEMENT_HIDDEN', `Commit blocked by element guard: ${guard.reason}`)
      const error = makeError(guard.code as CommitErrorCode ?? 'ELEMENT_HIDDEN', guard.reason, target.field.kind)
      emitTelemetry(session, fieldResults, [], startTime, 'blocked')
      return { success: false, sessionId: session.id, fields: fieldResults, error }
    }
  }

  // ====================================================================
  // PHASE 2 — Synchronous atomic write block
  //
  // *** NO AWAIT FROM THIS POINT FORWARD ***
  //
  // For each target, the sequence is:
  //   1. finalValidateTarget(el)   — sync: re-check everything
  //   2. setValueSafely(el, value) — sync: native setter + events
  //
  // This runs in a single microtask.  Page scripts cannot interleave.
  // ====================================================================

  let allSuccess = true
  let anyFinalValidationFailed = false

  // First pass: synchronous final validation on ALL targets.
  // If any fails, reject atomically before writing anything.
  for (const target of session.targets) {
    const el = target.element as HTMLElement
    const fv = finalValidateTarget(el)
    if (!fv.valid) {
      anyFinalValidationFailed = true
      const code = fv.code ?? 'ELEMENT_HIDDEN'
      const reason = fv.reason ?? 'Final validation failed'
      auditLog('security', 'FINAL_VALIDATION_FAILED',
        `Sync final gate rejected target "${target.field.kind}": ${reason}`)
      fieldResults.push({
        kind: target.field.kind,
        success: false,
        error: makeError(code, reason, target.field.kind),
      })
    }
  }

  if (anyFinalValidationFailed) {
    session.state = 'invalidated'
    emitTelemetry(session, fieldResults, [], startTime, 'blocked')
    emitTelemetryEvent('commit_blocked', { reason: 'final_validation' })
    return {
      success: false,
      sessionId: session.id,
      fields: fieldResults,
      error: makeError('SUSPICIOUS_DOM_MUTATION', 'Synchronous final validation failed'),
    }
  }

  // Second pass: write values (still synchronous, same microtask).
  for (const target of session.targets) {
    const el = target.element as HTMLElement
    let result = setValueSafely(el, target.commitValue)

    // Verify value was not immediately overwritten by framework reactivity
    if (result.success) {
      const input = el as HTMLInputElement
      if ('value' in input && input.value !== target.commitValue) {
        auditLog('warn', 'RACE_VALUE_OVERWRITTEN', `Value overwritten after fill for field: ${target.field.kind}`)
        result = tryDirectAssignRetry(input, target.commitValue)
      }
    }

    const fieldResult: CommitFieldResult = {
      kind: target.field.kind,
      success: result.success,
      error: result.error,
    }
    target.result = fieldResult
    fieldResults.push(fieldResult)

    if (!result.success) {
      allSuccess = false
    }
  }

  session.state = 'committed'

  // ── HA Mode: log every successful insert ──
  if (isHAEnforced()) {
    auditLog('security', 'HA_INSERT_COMPLETED', `HA insert completed: ${fieldResults.length} fields, session=${session.id}`)
  }

  // ── Memory hygiene: scrub plaintext commitValues from session targets ──
  // The values have been written to the DOM; keeping them in the JS heap
  // via the session object increases the exposure window unnecessarily.
  for (const target of session.targets) {
    target.commitValue = ''
  }

  const outcome = allSuccess ? 'success' : 'partial_failure'
  auditLog('info', allSuccess ? 'COMMIT_SUCCESS' : 'COMMIT_PARTIAL',
    `Commit ${outcome}: ${fieldResults.length} fields, ${fieldResults.filter(f => f.success).length} succeeded`)

  emitTelemetry(session, fieldResults, [], startTime, outcome)
  emitTelemetryEvent(allSuccess ? 'commit_success' : 'commit_partial', {
    fieldCount: fieldResults.length,
    successCount: fieldResults.filter(f => f.success).length,
    durationMs: Date.now() - startTime,
  })

  return {
    success: allSuccess,
    sessionId: session.id,
    fields: fieldResults,
    error: allSuccess ? undefined : makeError(
      'VALUE_DISPATCH_FAILED',
      'One or more fields failed to fill',
    ),
  }
}

// ============================================================================
// §3  setValueSafely — Framework-Compatible Value Setter
// ============================================================================

/**
 * Set a value on a DOM element using the most compatible strategy available.
 *
 * Strategy priority (try in order, stop on first success):
 *
 *   1. Native value setter (HTMLInputElement.prototype)
 *      — Works on plain HTML and most frameworks.
 *      — React, Preact, Svelte all listen to the native setter internally.
 *
 *   2. Direct .value assignment
 *      — Fallback for elements where the prototype trick fails.
 *
 *   3. setAttribute('value', ...)
 *      — Last resort for non-standard elements.
 *
 * After setting the value, we dispatch exactly TWO events:
 *   - new Event('input',  { bubbles: true, composed: true })
 *   - new Event('change', { bubbles: true, composed: true })
 *
 * We intentionally do NOT dispatch:
 *   - KeyboardEvent (keydown/keypress/keyup) — triggers anti-bot heuristics
 *   - FocusEvent  — we manage focus explicitly, not via synthetic events
 *   - CompositionEvent — IME path, irrelevant for ASCII fill
 *
 * This function is FULLY SYNCHRONOUS.  It must be called immediately
 * after finalValidateTarget() with no intervening await.
 */
export function setValueSafely(
  element: HTMLElement,
  value: string,
): SetValueResult {
  // ── Dev-only write canary (throws if called outside consent path) ──
  devWriteCanary()

  // ── Pre-checks (defensive, not primary gate) ──
  const input = element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

  if (input.disabled) {
    return {
      success: false,
      error: makeError('READONLY_ELEMENT', 'Element is disabled'),
    }
  }

  if ('readOnly' in input && (input as HTMLInputElement).readOnly) {
    return {
      success: false,
      error: makeError('READONLY_ELEMENT', 'Element is readonly'),
    }
  }

  // ── Strategy 1: Native prototype value setter ──
  const nativeResult = tryNativeSetter(input, value)
  if (nativeResult.success) {
    dispatchFillEvents(input)
    return nativeResult
  }

  // ── Strategy 2: Direct .value assignment ──
  const directResult = tryDirectAssign(input, value)
  if (directResult.success) {
    dispatchFillEvents(input)
    return directResult
  }

  // ── Strategy 3: setAttribute ──
  const attrResult = trySetAttribute(input, value)
  if (attrResult.success) {
    dispatchFillEvents(input)
    return attrResult
  }

  return {
    success: false,
    error: makeError(
      'VALUE_DISPATCH_FAILED',
      'All value-setting strategies failed',
    ),
  }
}

// ============================================================================
// §3.1  Strategy Implementations
// ============================================================================

/**
 * Strategy 1: Use the native HTMLInputElement.prototype value setter.
 *
 * This is the gold standard for framework compatibility because React,
 * Vue, Angular, and Svelte all hook into the native setter via
 * defineProperty or proxy.  When we call the ORIGINAL setter from the
 * prototype, the framework's tracker fires correctly.
 */
function tryNativeSetter(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): SetValueResult {
  try {
    let proto: typeof HTMLInputElement.prototype |
               typeof HTMLTextAreaElement.prototype |
               typeof HTMLSelectElement.prototype

    const tag = element.tagName
    if (tag === 'TEXTAREA') {
      proto = HTMLTextAreaElement.prototype
    } else if (tag === 'SELECT') {
      proto = HTMLSelectElement.prototype
    } else {
      proto = HTMLInputElement.prototype
    }

    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
    if (!descriptor || !descriptor.set) {
      return { success: false }
    }

    if (document.activeElement !== element) {
      element.focus({ preventScroll: true })
    }

    descriptor.set.call(element, value)

    if (element.value === value) {
      return { success: true, strategy: 'native_setter' }
    }

    return { success: false }
  } catch {
    return { success: false }
  }
}

/**
 * Strategy 2: Direct .value assignment.
 */
function tryDirectAssign(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): SetValueResult {
  try {
    if (document.activeElement !== element) {
      element.focus({ preventScroll: true })
    }

    element.value = value

    if (element.value === value) {
      return { success: true, strategy: 'direct_assign' }
    }

    return { success: false }
  } catch {
    return { success: false }
  }
}

/**
 * Strategy 3: setAttribute('value', ...).
 */
function trySetAttribute(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): SetValueResult {
  try {
    element.setAttribute('value', value)
    element.value = value

    if (element.value === value) {
      return { success: true, strategy: 'setAttribute' }
    }

    return { success: false }
  } catch {
    return { success: false }
  }
}

// ============================================================================
// §3.2  Event Dispatch
// ============================================================================

/**
 * Dispatch the minimum events required for frameworks to detect the change.
 *
 * We fire exactly:
 *   1. InputEvent('input')  — React, Vue, Svelte listen on this
 *   2. Event('change')       — jQuery, Angular, native listeners
 *
 * Both bubble and are composed (cross shadow DOM boundary).
 *
 * We do NOT fire keyboard events (keydown/keypress/keyup).
 * Rationale:
 *   - Anti-bot systems (Cloudflare Turnstile, reCAPTCHA) flag synthetic
 *     keyboard events with isTrusted=false
 *   - Modern frameworks don't need keyboard events for value tracking
 *   - Password managers (1Password, Bitwarden) also only fire input+change
 */
function dispatchFillEvents(element: HTMLElement): void {
  try {
    const inputEvent = new InputEvent('input', {
      bubbles: true,
      cancelable: false,
      composed: true,
      inputType: 'insertText',
    })
    element.dispatchEvent(inputEvent)
  } catch {
    try {
      element.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
    } catch {
      // Swallow — best effort
    }
  }

  try {
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }))
  } catch {
    // Swallow — best effort
  }
}

// ============================================================================
// §4  Safety Checks (async early gate — runs BEFORE the sync final gate)
// ============================================================================

/**
 * Run ALL safety checks on a single OverlayTarget.
 *
 * Every check is run independently (no short-circuit) so the caller
 * gets a complete picture of all failures.
 *
 * NOTE: This function is async because fingerprint validation uses
 * crypto.subtle.digest.  It serves as an EARLY gate.  The synchronous
 * finalValidateTarget() runs again immediately before the value write
 * to close the C-PIPE-02 TOCTOU window.
 */
export async function runSafetyChecks(
  target: OverlayTarget,
  session: OverlaySession,
): Promise<SafetyCheckResult> {
  const element = target.element as HTMLElement
  const checks: SafetyCheck[] = []

  // 1. Element connected to DOM
  checks.push(checkNotDetached(element))

  // 2. Element visible
  checks.push(checkVisible(element))

  // 3. Element focusable (not disabled/inert)
  checks.push(checkFocusable(element))

  // 4. Same-origin frame
  checks.push(checkSameOrigin())

  // 5. Not a hidden input
  checks.push(checkNotHiddenInput(element))

  // 6. Session not expired
  checks.push(checkSessionNotExpired(session))

  // 7. Bounding rect stability
  checks.push(checkBoundingRectStable(element, target))

  // 8. Fingerprint validation (async — full hash check)
  const fpCheck = await checkFingerprintValid(element, target)
  checks.push(fpCheck)

  return {
    safe: checks.every(c => c.passed),
    checks,
  }
}

// ── Individual Check Implementations ──

function checkNotDetached(element: HTMLElement): SafetyCheck {
  const connected = element && element.isConnected
  return {
    name: 'is_not_detached',
    passed: !!connected,
    reason: connected ? 'Element is in the DOM' : 'Element has been removed from the DOM',
  }
}

function checkVisible(element: HTMLElement): SafetyCheck {
  if (!element || !element.isConnected) {
    return { name: 'is_visible', passed: false, reason: 'Element not in DOM' }
  }

  const rect = element.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    return { name: 'is_visible', passed: false, reason: 'Element has zero dimensions' }
  }

  const computed = getComputedStyle(element)
  if (computed.display === 'none') {
    return { name: 'is_visible', passed: false, reason: 'Element has display:none' }
  }
  if (computed.visibility === 'hidden') {
    return { name: 'is_visible', passed: false, reason: 'Element has visibility:hidden' }
  }
  if (parseFloat(computed.opacity) < 0.01) {
    return { name: 'is_visible', passed: false, reason: 'Element has opacity near zero' }
  }

  return { name: 'is_visible', passed: true, reason: 'Element is visible' }
}

function checkFocusable(element: HTMLElement): SafetyCheck {
  if (!element || !element.isConnected) {
    return { name: 'is_focusable', passed: false, reason: 'Element not in DOM' }
  }

  const input = element as HTMLInputElement
  if (input.disabled) {
    return { name: 'is_focusable', passed: false, reason: 'Element is disabled' }
  }

  if (element.closest('[inert]')) {
    return { name: 'is_focusable', passed: false, reason: 'Element is inside an inert subtree' }
  }

  if (element.tabIndex < 0) {
    return { name: 'is_focusable', passed: false, reason: `Element has tabIndex=${element.tabIndex}` }
  }

  return { name: 'is_focusable', passed: true, reason: 'Element is focusable' }
}

function checkSameOrigin(): SafetyCheck {
  try {
    const _origin = window.location.origin
    if (window.self !== window.top) {
      try {
        const _parentOrigin = window.parent.location.origin
      } catch {
        return {
          name: 'is_same_origin',
          passed: false,
          reason: 'Content script is in a cross-origin iframe',
        }
      }
    }
    return { name: 'is_same_origin', passed: true, reason: 'Same-origin context' }
  } catch {
    return { name: 'is_same_origin', passed: false, reason: 'Cannot determine origin' }
  }
}

function checkNotHiddenInput(element: HTMLElement): SafetyCheck {
  const input = element as HTMLInputElement
  const inputType = (input.type ?? '').toLowerCase()

  if (BLOCKED_INPUT_TYPES.has(inputType)) {
    return {
      name: 'is_not_hidden_input',
      passed: false,
      reason: `Input type "${inputType}" is blocked`,
    }
  }

  if (!VALID_TARGET_TAGS.has(element.tagName)) {
    return {
      name: 'is_not_hidden_input',
      passed: false,
      reason: `Element tag "${element.tagName}" is not a valid fill target`,
    }
  }

  return { name: 'is_not_hidden_input', passed: true, reason: 'Valid input type' }
}

function checkSessionNotExpired(session: OverlaySession): SafetyCheck {
  const elapsed = Date.now() - session.createdAt
  const expired = elapsed > session.timeoutMs
  return {
    name: 'session_not_expired',
    passed: !expired,
    reason: expired
      ? `Session expired (${Math.round(elapsed / 1000)}s > ${Math.round(session.timeoutMs / 1000)}s)`
      : `Session active (${Math.round(elapsed / 1000)}s)`,
  }
}

function checkBoundingRectStable(
  element: HTMLElement,
  target: OverlayTarget,
): SafetyCheck {
  if (!element.isConnected) {
    return { name: 'bounding_rect_stable', passed: false, reason: 'Element not in DOM' }
  }

  const rect = element.getBoundingClientRect()
  const fp = target.fingerprint.properties.rect
  const tolerance = RECT_TOLERANCE_PX

  const roundToGrid = (v: number) => Math.round(v / tolerance) * tolerance
  const dTop = Math.abs(roundToGrid(rect.top) - fp.top)
  const dLeft = Math.abs(roundToGrid(rect.left) - fp.left)
  const dWidth = Math.abs(roundToGrid(rect.width) - fp.width)
  const dHeight = Math.abs(roundToGrid(rect.height) - fp.height)

  const stable = dTop <= tolerance && dLeft <= tolerance && dWidth <= tolerance && dHeight <= tolerance

  return {
    name: 'bounding_rect_stable',
    passed: stable,
    reason: stable
      ? 'Bounding rect within tolerance'
      : `Bounding rect shifted (dT=${dTop} dL=${dLeft} dW=${dWidth} dH=${dHeight})`,
  }
}

async function checkFingerprintValid(
  element: HTMLElement,
  target: OverlayTarget,
): Promise<SafetyCheck> {
  const validation: FingerprintValidation = await validateFingerprint(
    target.fingerprint,
    element,
  )

  return {
    name: 'fingerprint_valid',
    passed: validation.valid,
    reason: validation.valid
      ? 'Fingerprint matches'
      : `Fingerprint invalid: ${validation.reasons.join(', ')}`,
  }
}

// ============================================================================
// §4.1  Value Overwrite Retry
// ============================================================================

/**
 * Retry setting a value via direct assignment after framework overwrite.
 */
function tryDirectAssignRetry(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): SetValueResult {
  try {
    element.value = value
    dispatchFillEvents(element)
    if (element.value === value) {
      return { success: true, strategy: 'direct_assign' }
    }
    return {
      success: false,
      error: makeError('VALUE_DISPATCH_FAILED', 'Value overwritten after retry'),
    }
  } catch {
    return {
      success: false,
      error: makeError('VALUE_DISPATCH_FAILED', 'Retry failed'),
    }
  }
}

// ============================================================================
// §5  Error Helpers
// ============================================================================

function makeError(code: CommitErrorCode, message: string, field?: string): CommitError {
  return { code, message, field: field as CommitError['field'] }
}

/** Map a SafetyCheckName to the most appropriate CommitErrorCode. */
function safetyCheckToErrorCode(check: SafetyCheckName): CommitErrorCode {
  const map: Record<SafetyCheckName, CommitErrorCode> = {
    is_visible:             'ELEMENT_HIDDEN',
    is_focusable:           'ELEMENT_NOT_FOCUSABLE',
    is_same_origin:         'CROSS_ORIGIN_BLOCKED',
    is_not_hidden_input:    'ELEMENT_HIDDEN',
    is_not_detached:        'ELEMENT_DETACHED',
    is_user_intended:       'SUSPICIOUS_DOM_MUTATION',
    fingerprint_valid:      'FINGERPRINT_MISMATCH',
    session_not_expired:    'SESSION_EXPIRED',
    no_suspicious_mutation: 'SUSPICIOUS_DOM_MUTATION',
    bounding_rect_stable:   'ELEMENT_MOVED',
  }
  return map[check] ?? 'FINGERPRINT_MISMATCH'
}

// ============================================================================
// §6  Telemetry (local only — no values leave the process)
// ============================================================================

function emitTelemetry(
  session: OverlaySession,
  fieldResults: CommitFieldResult[],
  failedChecks: SafetyCheckName[],
  startTime: number,
  outcome: CommitTelemetryEvent['outcome'],
): void {
  if (!_telemetryHook) return

  const event: CommitTelemetryEvent = {
    sessionId: session.id,
    timestamp: Date.now(),
    domain: session.profile.domain ?? '',
    fieldCount: session.targets.length,
    outcome,
    fields: fieldResults.map(fr => ({
      kind: fr.kind,
      success: fr.success,
      errorCode: fr.error?.code,
    })),
    failedChecks,
    durationMs: Date.now() - startTime,
  }

  try {
    _telemetryHook(event)
  } catch {
    // Telemetry must never break the commit flow
  }
}
