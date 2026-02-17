// ============================================================================
// WRVault Autofill — Submit Guard
// ============================================================================
//
// Fail-closed helper that optionally submits a login form AFTER values have
// been committed by commitInsert().  The submit is only attempted when a
// strict set of safety conditions pass; otherwise submission is blocked and
// the caller receives a structured result with a stable enum code.
//
// This module does NOT perform any DOM writes to input fields.  It only
// triggers form submission (requestSubmit / click) on a verified submit
// button after all safety gates pass.
//
// Security contract:
//   - MUST NOT call setValueSafely()
//   - MUST NOT import committer.ts or writeBoundary.ts
//   - Submit ONLY via form.requestSubmit() or submitEl.click()
//   - Fail-closed: any gate failure → block submit
//   - HA mode → strictest rules
// ============================================================================

import { guardElement, auditLogSafe } from './hardening'
import { isHAEnforced } from './haGuard'
import type { DOMFingerprint } from '../../../../../packages/shared/src/vault/insertionPipeline'

// ============================================================================
// §1  Types
// ============================================================================

export interface SubmitSafetyInput {
  /** The <form> element containing the login fields. */
  form: HTMLFormElement | null
  /** The resolved submit button/input. */
  submitEl: HTMLElement | null
  /** Fingerprint of the submit element captured at session build time. */
  submitFingerprint: DOMFingerprint | null
  /** Origin match tier from the QSO engine resolution. */
  originTier: 'exact' | 'www_equivalent' | 'subdomain_parent' | 'subdomain_child' | 'scheme_upgrade' | 'none'
  /** Whether the scan was partial (DoS caps hit). */
  partialScan: boolean
  /** Whether the user click event was trusted. */
  isTrusted: boolean
  /** Mutation guard handle — check() must return valid if provided. */
  mutationGuard?: { check: () => { valid: boolean } } | null
}

/**
 * Stable submit outcome codes (internal — audit/meta only, not user-facing).
 * These codes are enums used for deterministic UI state mapping.
 */
export type SubmitCode =
  | 'SUBMIT_OK'
  | 'SUBMIT_BLOCKED'
  | 'SUBMIT_UNSAFE'
  | 'SUBMIT_NO_FORM'
  | 'SUBMIT_MUTATION'

/**
 * Stable, fine-grained reason for submit rejection (audit-level).
 */
export type SubmitBlockReason =
  | 'no_form'
  | 'no_submit_element'
  | 'not_in_same_form'
  | 'origin_not_exact'
  | 'partial_scan'
  | 'guard_failed'
  | 'fingerprint_invalid'
  | 'not_trusted'
  | 'ha_blocked'
  | 'mutation_guard_tripped'
  | 'submit_not_visible'
  | 'submit_disabled'
  | 'request_submit_failed'

export const SUBMIT_BLOCK_REASONS: ReadonlySet<string> = new Set<SubmitBlockReason>([
  'no_form', 'no_submit_element', 'not_in_same_form', 'origin_not_exact',
  'partial_scan', 'guard_failed', 'fingerprint_invalid', 'not_trusted',
  'ha_blocked', 'mutation_guard_tripped', 'submit_not_visible',
  'submit_disabled', 'request_submit_failed',
])

export interface SubmitResult {
  submitted: boolean
  code: SubmitCode
  reason?: SubmitBlockReason
}

// ============================================================================
// §2  Submit Target Resolution
// ============================================================================

/**
 * Find the submit button for a given form element.
 *
 * Strategy (in order):
 *   1. Explicit submit button: input[type=submit] or button[type=submit]
 *   2. Default button: first <button> without type="button" or type="reset"
 *   3. input[type=image] (rare but valid)
 *
 * Returns null if no suitable submit element is found (fail-closed).
 */
export function resolveSubmitTarget(form: HTMLFormElement | null): HTMLElement | null {
  if (!form || !(form instanceof HTMLFormElement)) return null

  // 1. Explicit submit
  const explicit = form.querySelector<HTMLElement>(
    'input[type="submit"], button[type="submit"]',
  )
  if (explicit) return explicit

  // 2. Default button (button without explicit type, or type="" which defaults to submit)
  const buttons = form.querySelectorAll<HTMLButtonElement>('button')
  for (const btn of buttons) {
    const t = btn.type.toLowerCase()
    if (t === '' || t === 'submit') return btn
  }

  // 3. input[type=image]
  const imageInput = form.querySelector<HTMLElement>('input[type="image"]')
  if (imageInput) return imageInput

  return null
}

// ============================================================================
// §3  Safe Submit After Fill
// ============================================================================

/**
 * Attempt a safe form submission after commitInsert() has succeeded.
 *
 * All gates must pass (fail-closed).  The submit is performed synchronously
 * in the same call stack as the user gesture to preserve isTrusted chain.
 *
 * Returns a structured result with a stable SubmitCode enum.
 */
export function safeSubmitAfterFill(input: SubmitSafetyInput): SubmitResult {
  const ha = isHAEnforced()
  const logLevel = ha ? 'security' : 'info'

  // ── Gate 1: Trusted event ──
  if (!input.isTrusted) {
    auditLogSafe(ha ? 'security' : 'warn', 'QSO_SUBMIT_BLOCKED', 'Submit blocked: untrusted event', { reason: 'not_trusted', ha })
    return { submitted: false, code: 'SUBMIT_BLOCKED', reason: 'not_trusted' }
  }

  // ── Gate 2: Form exists ──
  if (!input.form) {
    auditLogSafe(logLevel, 'QSO_SUBMIT_BLOCKED', 'Submit blocked: no form element', { reason: 'no_form', ha })
    return { submitted: false, code: 'SUBMIT_NO_FORM', reason: 'no_form' }
  }

  // ── Gate 3: Submit element exists ──
  if (!input.submitEl) {
    auditLogSafe(logLevel, 'QSO_SUBMIT_BLOCKED', 'Submit blocked: no submit element', { reason: 'no_submit_element', ha })
    return { submitted: false, code: 'SUBMIT_NO_FORM', reason: 'no_submit_element' }
  }

  // ── Gate 4: Submit element belongs to the same form ──
  const submitForm = (input.submitEl as HTMLButtonElement).form
    ?? input.submitEl.closest('form')
  if (submitForm !== input.form) {
    auditLogSafe(ha ? 'security' : 'warn', 'QSO_SUBMIT_BLOCKED', 'Submit blocked: element not in same form', { reason: 'not_in_same_form', ha })
    return { submitted: false, code: 'SUBMIT_UNSAFE', reason: 'not_in_same_form' }
  }

  // ── Gate 5: Origin must be exact (strictest tier) ──
  if (input.originTier !== 'exact') {
    auditLogSafe(logLevel, 'QSO_SUBMIT_BLOCKED', 'Submit blocked: origin not exact match', { reason: 'origin_not_exact', ha })
    return { submitted: false, code: 'SUBMIT_BLOCKED', reason: 'origin_not_exact' }
  }

  // ── Gate 6: Scan must not be partial ──
  if (input.partialScan) {
    auditLogSafe(logLevel, 'QSO_SUBMIT_BLOCKED', 'Submit blocked: scan was partial', { reason: 'partial_scan', ha })
    return { submitted: false, code: 'SUBMIT_BLOCKED', reason: 'partial_scan' }
  }

  // ── Gate 7: guardElement on submit element ──
  const guard = guardElement(input.submitEl)
  if (!guard.safe) {
    auditLogSafe(ha ? 'security' : 'warn', 'QSO_SUBMIT_BLOCKED', 'Submit blocked: guard check failed', { reason: 'guard_failed', ha })
    return { submitted: false, code: 'SUBMIT_UNSAFE', reason: 'guard_failed' }
  }

  // ── Gate 8: Submit element must be visible and have non-zero rect ──
  const rect = input.submitEl.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    auditLogSafe(ha ? 'security' : 'warn', 'QSO_SUBMIT_BLOCKED', 'Submit blocked: element not visible', { reason: 'submit_not_visible', ha })
    return { submitted: false, code: 'SUBMIT_UNSAFE', reason: 'submit_not_visible' }
  }

  // ── Gate 9: Submit element must not be disabled ──
  if ((input.submitEl as HTMLButtonElement).disabled === true) {
    auditLogSafe(logLevel, 'QSO_SUBMIT_BLOCKED', 'Submit blocked: element disabled', { reason: 'submit_disabled', ha })
    return { submitted: false, code: 'SUBMIT_BLOCKED', reason: 'submit_disabled' }
  }

  // ── Gate 10: Fingerprint validation (if captured) ──
  if (input.submitFingerprint) {
    const fpResult = validateFingerprintSync(input.submitFingerprint, input.submitEl)
    if (!fpResult.valid) {
      auditLogSafe(ha ? 'security' : 'warn', 'QSO_SUBMIT_BLOCKED', 'Submit blocked: fingerprint mismatch', { reason: 'fingerprint_invalid', ha })
      return { submitted: false, code: 'SUBMIT_MUTATION', reason: 'fingerprint_invalid' }
    }
  }

  // ── Gate 11: Mutation guard (if attached) ──
  if (input.mutationGuard) {
    try {
      const guardStatus = input.mutationGuard.check()
      if (!guardStatus.valid) {
        auditLogSafe(ha ? 'security' : 'warn', 'QSO_SUBMIT_BLOCKED', 'Submit blocked: mutation guard tripped', { reason: 'mutation_guard_tripped', ha })
        return { submitted: false, code: 'SUBMIT_MUTATION', reason: 'mutation_guard_tripped' }
      }
    } catch {
      // Fail-closed: if guard check throws, treat as tripped
      auditLogSafe(ha ? 'security' : 'warn', 'QSO_SUBMIT_BLOCKED', 'Submit blocked: mutation guard error', { reason: 'mutation_guard_tripped', ha })
      return { submitted: false, code: 'SUBMIT_MUTATION', reason: 'mutation_guard_tripped' }
    }
  }

  // ── Gate 12: HA mode — extra strictness ──
  if (ha) {
    const tag = input.submitEl.tagName
    const type = (input.submitEl as HTMLInputElement).type?.toLowerCase() ?? ''
    const isStandardSubmit = (
      (tag === 'INPUT' && (type === 'submit' || type === 'image')) ||
      (tag === 'BUTTON' && (type === '' || type === 'submit'))
    )
    if (!isStandardSubmit) {
      auditLogSafe('security', 'QSO_SUBMIT_BLOCKED', 'Submit blocked: non-standard submit element under HA', { reason: 'ha_blocked', ha })
      return { submitted: false, code: 'SUBMIT_BLOCKED', reason: 'ha_blocked' }
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // All gates passed — attempt submission
  // ══════════════════════════════════════════════════════════════════════

  try {
    if (typeof input.form.requestSubmit === 'function') {
      if (input.submitEl instanceof HTMLButtonElement || input.submitEl instanceof HTMLInputElement) {
        input.form.requestSubmit(input.submitEl)
      } else {
        input.form.requestSubmit()
      }
    } else {
      input.submitEl.click()
    }

    auditLogSafe(logLevel, 'QSO_SUBMIT_SUCCESS', 'Form submitted via QSO', { ha })
    return { submitted: true, code: 'SUBMIT_OK' }
  } catch {
    auditLogSafe(ha ? 'security' : 'warn', 'QSO_SUBMIT_BLOCKED', 'Submit failed: requestSubmit threw', { reason: 'request_submit_failed', ha })
    return { submitted: false, code: 'SUBMIT_BLOCKED', reason: 'request_submit_failed' }
  }
}

// ============================================================================
// §4  Helpers
// ============================================================================

/**
 * Synchronous fingerprint validation (lite version).
 * Uses the captured properties to do a quick structural check without
 * the async SHA-256 hash.  Checks: connected, visible, same tag/type/name.
 */
function validateFingerprintSync(fp: DOMFingerprint, el: HTMLElement): { valid: boolean } {
  if (!el.isConnected) return { valid: false }
  const elRect = el.getBoundingClientRect()
  if (elRect.width === 0 && elRect.height === 0) return { valid: false }

  const props = fp.properties
  if (props.tagName && el.tagName !== props.tagName) return { valid: false }
  if (props.inputType && (el as HTMLInputElement).type !== props.inputType) return { valid: false }
  if (props.name && (el as HTMLInputElement).name !== props.name) return { valid: false }

  // Check fingerprint age
  if (fp.maxAge > 0 && Date.now() - fp.capturedAt > fp.maxAge) return { valid: false }

  return { valid: true }
}
