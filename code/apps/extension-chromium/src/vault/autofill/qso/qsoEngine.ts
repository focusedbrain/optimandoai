// ============================================================================
// WRVault Autofill — QSO (Quick Sign-On) Engine
// ============================================================================
//
// Leaf module: resolves QSO state, builds sessions, and orchestrates
// fill+submit for the password-manager sign-in flow.
//
// Security contract:
//   - MUST NOT call setValueSafely() directly
//   - MUST NOT import committer.ts directly except for setQsoFillActive
//   - Writes flow through commitInsert() via writeBoundary
//   - Submit flows through safeSubmitAfterFill()
//   - isTrusted validated at the QSO click handler before any action
//   - No PII in audit/telemetry — uses auditLogSafe + sanitizeMeta
//
// Leaf status: no reverse dependencies.
// ============================================================================

import { collectCandidates } from '../fieldScanner'
import type { ScanResult } from '../fieldScanner'
import { commitInsert, setQsoFillActive } from '../committer'
import { guardElement, auditLogSafe, emitTelemetryEvent, redactError } from '../hardening'
import { isHAEnforced } from '../haGuard'
import { isAutofillActive } from '../toggleSync'
import { takeFingerprint } from '../domFingerprint'
import { matchOrigin, isPublicSuffix } from '../../../../../../packages/shared/src/vault/originPolicy'
import { computeDisplayValue, DEFAULT_MASKING } from '../../../../../../packages/shared/src/vault/insertionPipeline'
import type {
  OverlaySession,
  OverlayTarget,
  CommitResult,
  FieldCandidate,
} from '../../../../../../packages/shared/src/vault/insertionPipeline'
import type {
  FieldKind,
  VaultProfile,
  FieldEntry,
} from '../../../../../../packages/shared/src/vault/fieldTaxonomy'
import * as vaultAPI from '../../api'
import type { FillProjection } from '../../api'
import { attachGuard } from '../mutationGuard'
import { resolveSubmitTarget, safeSubmitAfterFill } from '../submitGuard'
import type { SubmitBlockReason, SubmitCode } from '../submitGuard'
import { areWritesDisabled } from '../writesKillSwitch'

// ============================================================================
// §1  Types & Versioned Contract
// ============================================================================

/**
 * QSO result version — immutable for this major contract.
 * Callers that receive a result without this version must reject it.
 */
export const QSO_RESULT_VERSION = 'qso-v1' as const

export type QsoStatus =
  | 'EXACT_MATCH'
  | 'HAS_CANDIDATES'
  | 'NONE'
  | 'BLOCKED'

export const QSO_STATUSES: ReadonlySet<string> = new Set<QsoStatus>([
  'EXACT_MATCH', 'HAS_CANDIDATES', 'NONE', 'BLOCKED',
])

export type QsoErrorCode =
  | 'INVALID_PARAMS'
  | 'AUTOFILL_DISABLED'
  | 'WRITES_DISABLED'
  | 'ORIGIN_MISMATCH'
  | 'PSL_BLOCKED'
  | 'PARTIAL_SCAN'
  | 'NO_TARGETS'
  | 'ELEMENT_HIDDEN'
  | 'HA_BLOCKED'
  | 'INTERNAL_ERROR'

export const QSO_ERROR_CODES: ReadonlySet<string> = new Set<QsoErrorCode>([
  'INVALID_PARAMS', 'AUTOFILL_DISABLED', 'WRITES_DISABLED', 'ORIGIN_MISMATCH',
  'PSL_BLOCKED', 'PARTIAL_SCAN', 'NO_TARGETS', 'ELEMENT_HIDDEN',
  'HA_BLOCKED', 'INTERNAL_ERROR',
])

export type QsoBlockReason =
  | 'autofill_disabled'
  | 'writes_disabled'
  | 'ha_blocked'
  | 'psl_blocked'
  | 'origin_mismatch'
  | 'partial_scan'
  | 'no_candidates'
  | 'guard_failed'

/**
 * Map internal block reasons to stable QSO error codes for the UI contract.
 */
function blockReasonToErrorCode(reason: QsoBlockReason): QsoErrorCode {
  switch (reason) {
    case 'autofill_disabled': return 'AUTOFILL_DISABLED'
    case 'writes_disabled': return 'WRITES_DISABLED'
    case 'ha_blocked': return 'HA_BLOCKED'
    case 'psl_blocked': return 'PSL_BLOCKED'
    case 'origin_mismatch': return 'ORIGIN_MISMATCH'
    case 'partial_scan': return 'PARTIAL_SCAN'
    case 'no_candidates': return 'NO_TARGETS'
    case 'guard_failed': return 'ELEMENT_HIDDEN'
    default: return 'INTERNAL_ERROR'
  }
}

export interface QsoState {
  status: QsoStatus
  blockReason?: QsoBlockReason
  /** Candidates available for selection (username+password pairs). */
  candidates: QsoCandidate[]
  /** The exact match candidate, if status === EXACT_MATCH. */
  exactMatch?: QsoCandidate
  /** Whether auto-submit is eligible (all submit safety conditions met). */
  submitEligible: boolean
  /** Origin match tier resolved during state computation. */
  originTier: 'exact' | 'www_equivalent' | 'subdomain_parent' | 'subdomain_child' | 'scheme_upgrade' | 'none'
  /** Whether the scan was partial. */
  partialScan: boolean
}

/**
 * Versioned, UI-ready result contract for QSO actions.
 * No free-form error messages.  No UUID/domain/selector/url anywhere.
 * Numbers + enums only.
 */
export interface QsoActionResult {
  resultVersion: typeof QSO_RESULT_VERSION
  success: boolean
  state: QsoStatus
  /** Stable error code — present when !success or state=BLOCKED. */
  error?: { code: QsoErrorCode }
  /** Number of candidates found (always a number, never PII). */
  candidateCount: number
  /** Whether auto-submit is eligible. */
  submitEligible: boolean
  /** Whether fill was attempted. */
  fillAttempted?: boolean
  /** Whether submit was attempted. */
  submitAttempted?: boolean
  /** Stable submit outcome. */
  submitResult?: 'SUBMITTED' | 'BLOCKED'
}

/**
 * Runtime validator for QsoActionResult.
 * Pure function, no side effects, no dependencies.
 */
export function isQsoResultV1(x: unknown): x is QsoActionResult {
  if (!x || typeof x !== 'object') return false
  const obj = x as Record<string, unknown>
  if (obj.resultVersion !== QSO_RESULT_VERSION) return false
  if (typeof obj.success !== 'boolean') return false
  if (typeof obj.state !== 'string' || !QSO_STATUSES.has(obj.state)) return false
  if (typeof obj.candidateCount !== 'number' || !Number.isFinite(obj.candidateCount)) return false
  if (typeof obj.submitEligible !== 'boolean') return false

  if (obj.success === false && obj.error) {
    if (typeof obj.error !== 'object') return false
    const err = obj.error as Record<string, unknown>
    if (typeof err.code !== 'string' || !QSO_ERROR_CODES.has(err.code)) return false
  }

  if (obj.submitResult !== undefined) {
    if (obj.submitResult !== 'SUBMITTED' && obj.submitResult !== 'BLOCKED') return false
  }

  return true
}

/**
 * Build a QsoActionResult from QsoState (state resolution only, no fill).
 */
export function buildQsoStateResult(state: QsoState): QsoActionResult {
  const success = state.status !== 'BLOCKED' && state.status !== 'NONE'
  const result: QsoActionResult = {
    resultVersion: QSO_RESULT_VERSION,
    success,
    state: state.status,
    candidateCount: state.candidates.length,
    submitEligible: state.submitEligible,
  }
  if (!success && state.blockReason) {
    result.error = { code: blockReasonToErrorCode(state.blockReason) }
  }
  return result
}

/**
 * Build a QsoActionResult from a fill execution.
 */
export function buildQsoFillActionResult(
  state: QsoState,
  fillResult: QsoFillResult,
): QsoActionResult {
  const result: QsoActionResult = {
    resultVersion: QSO_RESULT_VERSION,
    success: fillResult.filled,
    state: state.status,
    candidateCount: state.candidates.length,
    submitEligible: state.submitEligible,
    fillAttempted: true,
    submitAttempted: fillResult.submitCode !== undefined,
    submitResult: fillResult.submitted ? 'SUBMITTED' : 'BLOCKED',
  }
  if (!fillResult.filled && fillResult.fillError) {
    result.error = { code: mapFillErrorToCode(fillResult.fillError) }
  }
  return result
}

function mapFillErrorToCode(fillError: string): QsoErrorCode {
  switch (fillError) {
    case 'Untrusted event': return 'INVALID_PARAMS'
    case 'Autofill disabled': return 'AUTOFILL_DISABLED'
    case 'Writes disabled': return 'WRITES_DISABLED'
    case 'Item not found': return 'INTERNAL_ERROR'
    case 'Username field guard failed':
    case 'Password field guard failed': return 'ELEMENT_HIDDEN'
    case 'No targets resolved': return 'NO_TARGETS'
    case 'Internal error': return 'INTERNAL_ERROR'
    default: return 'INTERNAL_ERROR'
  }
}

export interface QsoCandidate {
  /** Vault item ID. */
  itemId: string
  /** Display title. */
  title: string
  /** Domain from vault item. */
  domain?: string
  /** The resolved username target element. */
  usernameEl?: HTMLElement
  /** The resolved password target element. */
  passwordEl?: HTMLElement
  /** The form containing the login fields. */
  form?: HTMLFormElement
  /** The submit button in the form. */
  submitEl?: HTMLElement
  /** Whether all three elements (user, pass, submit) have guard checks passing. */
  allGuardsPass: boolean
  /** Origin match result. */
  originTier: 'exact' | 'www_equivalent' | 'subdomain_parent' | 'subdomain_child' | 'scheme_upgrade' | 'none'
}

export interface QsoFillResult {
  /** Whether values were committed to the DOM. */
  filled: boolean
  /** Whether the form was submitted. */
  submitted: boolean
  /** If fill failed, reason. */
  fillError?: string
  /** Stable submit outcome code. */
  submitCode?: SubmitCode
  /** If submit was blocked, fine-grained reason. */
  submitBlockReason?: SubmitBlockReason
}

// ============================================================================
// §2  QSO State Resolution
// ============================================================================

/**
 * Resolve the QSO state for the current page.
 *
 * Scans the page for login form fields, matches against vault items,
 * and determines whether an exact match exists for one-click sign-on.
 */
export async function resolveQsoState(
  vaultItems: FillProjection[],
): Promise<QsoState> {
  const ha = isHAEnforced()

  // ── Gate: autofill must be active ──
  if (!isAutofillActive()) {
    return blocked('autofill_disabled')
  }

  // ── Gate: writes must not be globally disabled ──
  if (areWritesDisabled()) {
    return blocked('writes_disabled')
  }

  // ── Scan for login form fields ──
  const scan = collectCandidates({ login: true, identity: false, company: false, custom: false })

  // Find username and password candidates
  const usernameCandidates = scan.candidates.filter(
    c => c.matchedKind === 'login.username' || c.matchedKind === 'login.email',
  )
  const passwordCandidates = scan.candidates.filter(
    c => c.matchedKind === 'login.password',
  )

  if (usernameCandidates.length === 0 && passwordCandidates.length === 0) {
    return blocked('no_candidates')
  }

  // ── Build candidates per vault item ──
  const candidates: QsoCandidate[] = []

  for (const item of vaultItems) {
    if (item.category !== 'password') continue

    const profile = itemToProfile(item)
    const originResult = matchOrigin(item.domain ?? '', window.location.origin)
    const originTier = originResult.matchType
    const psl = isPublicSuffix(window.location.hostname)

    // PSL + HA → block
    if (psl && ha) continue

    // Origin must at least match
    if (!originResult.matches && originTier === 'none') continue

    // Find the best username + password targets for this item
    const usernameField = profile.fields.find(f =>
      f.kind === 'login.username' || f.kind === 'login.email',
    )
    const passwordField = profile.fields.find(f =>
      f.kind === 'login.password',
    )

    if (!usernameField && !passwordField) continue

    // Match candidates to profile fields
    const usernameEl = usernameField
      ? findBestCandidate(usernameCandidates, usernameField.kind)?.element as HTMLElement | undefined
      : undefined
    const passwordEl = passwordField
      ? findBestCandidate(passwordCandidates, 'login.password')?.element as HTMLElement | undefined
      : undefined

    if (!usernameEl && !passwordEl) continue

    // Resolve form and submit button
    const anchorEl = (passwordEl ?? usernameEl)!
    const form = anchorEl.closest('form') as HTMLFormElement | null
    const submitEl = resolveSubmitTarget(form) ?? undefined

    // Guard checks on all resolved elements
    let allGuardsPass = true
    if (usernameEl && !guardElement(usernameEl).safe) allGuardsPass = false
    if (passwordEl && !guardElement(passwordEl).safe) allGuardsPass = false
    if (submitEl && !guardElement(submitEl).safe) allGuardsPass = false

    candidates.push({
      itemId: item.id,
      title: item.title,
      domain: item.domain,
      usernameEl,
      passwordEl,
      form: form ?? undefined,
      submitEl,
      allGuardsPass,
      originTier,
    })
  }

  if (candidates.length === 0) {
    // If we had scan candidates but no vault matches
    if (scan.partial) return blocked('partial_scan')
    return blocked('no_candidates')
  }

  // ── Determine exact match ──
  const exactCandidates = candidates.filter(c =>
    c.originTier === 'exact' &&
    c.usernameEl && c.passwordEl &&
    c.submitEl && c.form &&
    c.allGuardsPass,
  )

  const partialScan = scan.partial

  if (exactCandidates.length === 1) {
    const exact = exactCandidates[0]
    return {
      status: 'EXACT_MATCH',
      candidates,
      exactMatch: exact,
      submitEligible: !partialScan && exact.allGuardsPass,
      originTier: exact.originTier,
      partialScan,
    }
  }

  // Multiple exact matches → ambiguous, user must pick
  if (exactCandidates.length > 1) {
    return {
      status: 'HAS_CANDIDATES',
      candidates,
      submitEligible: false,
      originTier: candidates[0]?.originTier ?? 'none',
      partialScan,
    }
  }

  // No exact match but have candidates
  return {
    status: 'HAS_CANDIDATES',
    candidates,
    submitEligible: false,
    originTier: candidates[0]?.originTier ?? 'none',
    partialScan,
  }
}

// ============================================================================
// §3  QSO Fill + Submit
// ============================================================================

/**
 * Execute the QSO fill+submit flow for a selected candidate.
 *
 * This is called when the user clicks the QSO icon (exact match) or
 * selects an item from the picker.
 *
 * The click event's isTrusted flag MUST have been validated by the caller
 * before invoking this function.
 *
 * Flow:
 *   1. Validate isTrusted (must be true — caller asserts this)
 *   2. Fetch vault item via API
 *   3. Build OverlaySession with fingerprints
 *   4. Attach mutation guard
 *   5. Call commitInsert() via existing pipeline
 *   6. If commit succeeds, attempt safeSubmitAfterFill()
 */
export async function executeQsoFill(
  candidate: QsoCandidate,
  isTrusted: boolean,
): Promise<QsoFillResult> {
  const ha = isHAEnforced()
  const logLevel = ha ? 'security' : 'info'

  // ── Gate: isTrusted ──
  if (!isTrusted) {
    auditLogSafe(ha ? 'security' : 'warn', 'QSO_FILL_BLOCKED', 'QSO fill blocked: untrusted event', { reason: 'not_trusted', ha })
    return { filled: false, submitted: false, fillError: 'Untrusted event' }
  }

  // ── Gate: autofill active ──
  if (!isAutofillActive()) {
    return { filled: false, submitted: false, fillError: 'Autofill disabled' }
  }

  // ── Gate: writes not disabled ──
  if (areWritesDisabled()) {
    return { filled: false, submitted: false, fillError: 'Writes disabled' }
  }

  try {
    // ── Fetch vault item ──
    const item = await vaultAPI.getItemForFill(candidate.itemId)
    if (!item) {
      auditLogSafe(logLevel, 'QSO_FILL_FAILED', 'Vault item not found', { ha })
      return { filled: false, submitted: false, fillError: 'Item not found' }
    }

    const profile = itemToProfile(item)

    // ── Build targets with fingerprints ──
    const overlayTargets: OverlayTarget[] = []
    const targetElements: HTMLElement[] = []

    const usernameField = profile.fields.find(f =>
      f.kind === 'login.username' || f.kind === 'login.email',
    )
    const passwordField = profile.fields.find(f => f.kind === 'login.password')

    if (usernameField && candidate.usernameEl) {
      const el = candidate.usernameEl
      const guard = guardElement(el)
      if (!guard.safe) {
        return { filled: false, submitted: false, fillError: 'Username field guard failed' }
      }
      const fp = await takeFingerprint(el, ha ? 15_000 : undefined)
      overlayTargets.push({
        field: usernameField,
        element: el,
        fingerprint: fp,
        displayValue: computeDisplayValue(usernameField.value, false, 'masked', DEFAULT_MASKING),
        commitValue: usernameField.value,
      })
      targetElements.push(el)
    }

    if (passwordField && candidate.passwordEl) {
      const el = candidate.passwordEl
      const guard = guardElement(el)
      if (!guard.safe) {
        return { filled: false, submitted: false, fillError: 'Password field guard failed' }
      }
      const fp = await takeFingerprint(el, ha ? 15_000 : undefined)
      overlayTargets.push({
        field: passwordField,
        element: el,
        fingerprint: fp,
        displayValue: computeDisplayValue(passwordField.value, true, 'masked', DEFAULT_MASKING),
        commitValue: passwordField.value,
      })
      targetElements.push(el)
    }

    if (overlayTargets.length === 0) {
      return { filled: false, submitted: false, fillError: 'No targets resolved' }
    }

    // ── Build session ──
    const sessionId = crypto.randomUUID()
    const session: OverlaySession = {
      id: sessionId,
      profile,
      targets: overlayTargets,
      createdAt: Date.now(),
      timeoutMs: ha ? 30_000 : 60_000,
      origin: 'quickselect',
      state: 'preview',
    }

    // ── Attach mutation guard ──
    const guardHandle = attachGuard(targetElements)

    // ── Capture submit fingerprint ──
    let submitFingerprint = null
    if (candidate.submitEl) {
      try {
        submitFingerprint = await takeFingerprint(candidate.submitEl, ha ? 15_000 : undefined)
      } catch {
        // Non-fatal: submit will be blocked by missing fingerprint
      }
    }

    // ── Signal QSO fill active (dev canary) ──
    setQsoFillActive(true)

    // ── Commit via existing pipeline ──
    let commitResult: CommitResult
    try {
      commitResult = await commitInsert(session)
    } finally {
      setQsoFillActive(false)
    }

    if (!commitResult.success) {
      guardHandle.detach()
      auditLogSafe(logLevel, 'QSO_FILL_FAILED', 'Commit failed', {
        code: commitResult.error?.code ?? 'unknown',
        ha,
      })
      return { filled: false, submitted: false, fillError: commitResult.error?.code ?? 'Commit failed' }
    }

    // ── Fill succeeded — attempt submit ──
    auditLogSafe(logLevel, 'QSO_FILL_SUCCESS', 'QSO fill completed', {
      fieldCount: overlayTargets.length,
      ha,
    })
    emitTelemetryEvent('qso_fill', { fieldCount: overlayTargets.length, ha })

    // Resolve origin tier for submit safety
    const originResult = matchOrigin(item.domain ?? '', window.location.origin)

    const submitResult = safeSubmitAfterFill({
      form: candidate.form ?? null,
      submitEl: candidate.submitEl ?? null,
      submitFingerprint,
      originTier: originResult.matchType,
      partialScan: false,
      isTrusted,
      mutationGuard: guardHandle,
    })

    // Detach guard after submit attempt (regardless of outcome)
    guardHandle.detach()

    if (submitResult.submitted) {
      emitTelemetryEvent('qso_submit', { ha })
    }

    return {
      filled: true,
      submitted: submitResult.submitted,
      submitCode: submitResult.code,
      submitBlockReason: submitResult.reason,
    }
  } catch (err) {
    const redacted = redactError(err)
    auditLogSafe('error', 'QSO_FILL_ERROR', 'Unexpected error during QSO fill', { ha })
    return { filled: false, submitted: false, fillError: 'Internal error' }
  }
}

// ============================================================================
// §4  Helpers
// ============================================================================

function blocked(reason: QsoBlockReason): QsoState {
  return {
    status: 'BLOCKED',
    blockReason: reason,
    candidates: [],
    submitEligible: false,
    originTier: 'none',
    partialScan: false,
  }
}

function findBestCandidate(
  candidates: FieldCandidate[],
  kind: FieldKind,
): FieldCandidate | undefined {
  let best: FieldCandidate | undefined
  let bestConf = 0

  for (const c of candidates) {
    if (c.matchedKind === kind && c.match.confidence > bestConf) {
      best = c
      bestConf = c.match.confidence
    }
  }

  return best
}

// ── FillProjection → VaultProfile conversion ──
// (Same logic as webMcpAdapter, kept local to avoid coupling)

function itemToProfile(item: FillProjection): VaultProfile {
  const section = categoryToSection(item.category)
  const kindPrefix = sectionToKindPrefix(section)
  const fields: FieldEntry[] = []

  for (const f of item.fields) {
    if (!f.value) continue
    const kind = mapFieldKeyToKind(f.key, kindPrefix)
    if (!kind) continue
    fields.push({
      kind,
      label: f.key.replace(/_/g, ' '),
      value: f.value,
      sensitive: f.type === 'password',
    })
  }

  return {
    itemId: item.id,
    title: item.title,
    section,
    domain: item.domain,
    fields,
    updatedAt: Date.now(),
  }
}

function categoryToSection(category: string): 'login' | 'identity' | 'company' | 'custom' {
  switch (category) {
    case 'password': return 'login'
    case 'identity': return 'identity'
    case 'company': return 'company'
    default: return 'custom'
  }
}

function sectionToKindPrefix(section: string): string {
  switch (section) {
    case 'login': return 'login'
    case 'identity': return 'identity'
    case 'company': return 'company'
    default: return 'custom'
  }
}

function mapFieldKeyToKind(key: string, prefix: string): FieldKind | null {
  const FIELD_MAP: Record<string, Record<string, FieldKind>> = {
    login: {
      username: 'login.username',
      email: 'login.email',
      password: 'login.password',
    },
  }
  const sectionMap = FIELD_MAP[prefix]
  if (!sectionMap) return null
  return sectionMap[key] ?? null
}
