// ============================================================================
// WRVault QSO Remap — State Machine & Orchestrator
// ============================================================================
//
// Orchestrates the "Add & Map" and "Remap" flows:
//
//  State machine:
//    IDLE → DETECTING → ADD_MAP_READY | REMAP_READY | NO_ACTION
//    ADD_MAP_READY → (click) → WIZARD_ACTIVE → SAVING → FILL_SUBMIT → IDLE
//    REMAP_READY   → (click) → PICKER? → WIZARD_ACTIVE → SAVING → FILL_SUBMIT → IDLE
//
//  Detection runs after each page scan and resolves which icon to show.
//
//  Security contract:
//    - All user actions require isTrusted click.
//    - Cross-origin iframes rejected.
//    - Rate-limited: max 1 QSO execution per 3s.
//    - Double-submit prevention via _lastExecuteTs.
//    - No PII in audit logs.
//    - No DOM writes — fill/submit delegates to commitInsert + safeSubmitAfterFill.
// ============================================================================

import { collectCandidates } from '../fieldScanner'
import type { ScanResult } from '../fieldScanner'
import { auditLogSafe, emitTelemetryEvent, guardElement } from '../hardening'
import { isHAEnforced } from '../haGuard'
import { isAutofillActive } from '../toggleSync'
import { areWritesDisabled } from '../writesKillSwitch'
import { showRemapIcon, hideRemapIcon } from './remapIcon'
import type { RemapIconMode } from './remapIcon'
import { showMappingWizard, hideMappingWizard } from './mappingWizard'
import type { WizardResult } from './mappingWizard'
import { showQsoPicker, hideQsoPicker } from './qsoPicker'
import {
  findCredentialsForOrigin,
  createCredentialFromPageInput,
  saveMapping,
  loadMapping,
  deleteMapping,
  effectiveOrigin,
  validateMapping,
  buildElementMapping,
} from './mappingStore'
import type {
  OriginCredential,
  LoginFormMapping,
} from './mappingStore'
import { resolveSubmitTarget } from '../submitGuard'
import { executeQsoFill } from './qsoEngine'
import type { QsoCandidate } from './qsoEngine'

// ============================================================================
// §1  Types
// ============================================================================

export type RemapState =
  | 'IDLE'
  | 'DETECTING'
  | 'ADD_MAP_READY'
  | 'REMAP_READY'
  | 'WIZARD_ACTIVE'
  | 'SAVING'
  | 'FILL_SUBMIT'
  | 'NO_ACTION'

export interface RemapDetectionResult {
  state: RemapState
  mode: RemapIconMode | null
  /** Anchor element for the icon (submit button or password field). */
  anchor: HTMLElement | null
  /** Detected login form elements (pre-detected for wizard). */
  detectedElements: {
    username?: HTMLElement
    password?: HTMLElement
    submit?: HTMLElement
    form?: HTMLFormElement
  }
  /** Credentials found for the origin. */
  credentials: OriginCredential[]
  /** Whether the form looks like signup (2 password fields). */
  isSignupForm: boolean
}

// ============================================================================
// §2  State
// ============================================================================

let _currentState: RemapState = 'IDLE'
let _lastDetection: RemapDetectionResult | null = null
let _lastExecuteTs = 0

/** Rate limit: minimum ms between QSO fill+submit executions. */
const EXECUTE_RATE_LIMIT_MS = 3_000

// ============================================================================
// §3  Public API — Detection
// ============================================================================

/**
 * Run remap detection after a page scan.
 *
 * This is called by the autofill orchestrator after each scan.
 * It determines whether to show Add&Map, Remap, or nothing.
 *
 * Non-blocking: errors are swallowed. Icon state is updated.
 */
export async function updateRemapState(): Promise<RemapDetectionResult> {
  if (_currentState === 'WIZARD_ACTIVE' || _currentState === 'SAVING' || _currentState === 'FILL_SUBMIT') {
    // Don't interrupt active flows
    return _lastDetection ?? idleDetection()
  }

  _currentState = 'DETECTING'

  try {
    if (!isAutofillActive() || areWritesDisabled()) {
      hideRemapIcon()
      _currentState = 'NO_ACTION'
      return idleDetection()
    }

    // Scan for login form
    const scan = collectCandidates({ login: true, identity: false, company: false, custom: false })

    const passwordCandidates = scan.candidates.filter(
      c => c.matchedKind === 'login.password',
    )
    const usernameCandidates = scan.candidates.filter(
      c => c.matchedKind === 'login.username' || c.matchedKind === 'login.email',
    )

    // No login form detected
    if (passwordCandidates.length === 0) {
      hideRemapIcon()
      _currentState = 'NO_ACTION'
      return idleDetection()
    }

    // Check for signup form (2+ password fields → don't offer Add & Map)
    const isSignupForm = passwordCandidates.length >= 2 || scan.formContext === 'signup'

    // Resolve detected elements
    const passwordEl = passwordCandidates[0]?.element as HTMLElement | undefined
    const usernameEl = usernameCandidates[0]?.element as HTMLElement | undefined
    const form = (passwordEl ?? usernameEl)?.closest('form') as HTMLFormElement | null
    const submitEl = resolveSubmitTarget(form) ?? undefined

    const detectedElements = {
      username: usernameEl,
      password: passwordEl,
      submit: submitEl,
      form: form ?? undefined,
    }

    // Find the best anchor for the icon (prefer submit button, then password field)
    const anchor = submitEl ?? passwordEl
    if (!anchor) {
      hideRemapIcon()
      _currentState = 'NO_ACTION'
      return idleDetection()
    }

    // Check vault credentials for this origin
    const origin = effectiveOrigin()
    const credentials = await findCredentialsForOrigin(origin)

    let mode: RemapIconMode | null = null
    let state: RemapState = 'NO_ACTION'

    if (credentials.length === 0) {
      // No credentials → Add & Map (unless signup form)
      if (!isSignupForm) {
        // Only show if user has interacted (at least one field is non-empty)
        const hasUserInput = hasNonEmptyLoginField(passwordEl, usernameEl)
        if (hasUserInput) {
          mode = 'add_map'
          state = 'ADD_MAP_READY'
        }
      }
    } else {
      // Credentials exist → check if any mapping is valid
      const anyValidMapping = credentials.some(c => c.mappingValid)
      if (!anyValidMapping) {
        // No valid mapping → show Remap icon
        mode = 'remap'
        state = 'REMAP_READY'
      }
      // If a valid mapping exists, the normal QSO flow handles it — no remap needed
    }

    const detection: RemapDetectionResult = {
      state,
      mode,
      anchor,
      detectedElements,
      credentials,
      isSignupForm,
    }

    _lastDetection = detection
    _currentState = state

    // Show/hide icon
    if (mode && anchor) {
      showRemapIcon(anchor, mode, handleRemapIconClick)
    } else {
      hideRemapIcon()
    }

    return detection
  } catch {
    hideRemapIcon()
    _currentState = 'IDLE'
    return idleDetection()
  }
}

/**
 * Tear down all remap UI (icon, wizard, picker).
 * Called on SPA navigation, toggle change, or extension teardown.
 */
export function teardownRemap(): void {
  hideRemapIcon()
  hideMappingWizard()
  hideQsoPicker()
  _currentState = 'IDLE'
  _lastDetection = null
}

/** Get the current remap state (for testing/debugging). */
export function getRemapState(): RemapState {
  return _currentState
}

// ============================================================================
// §4  Icon Click Handler
// ============================================================================

/**
 * Handle click on the remap icon.
 * Dispatches to Add & Map or Remap flow based on current mode.
 */
async function handleRemapIconClick(e: MouseEvent, mode: RemapIconMode): Promise<void> {
  const ha = isHAEnforced()

  if (!e.isTrusted) {
    auditLogSafe(
      ha ? 'security' : 'warn',
      'QSO_REMAP_REJECT_UNTRUSTED',
      'Remap click rejected: untrusted event',
      { ha, op: 'remap' },
    )
    return
  }

  if (!_lastDetection) return

  if (mode === 'add_map') {
    await handleAddAndMap(e)
  } else {
    await handleRemap(e)
  }
}

// ============================================================================
// §5  "Add & Map" Flow
// ============================================================================

async function handleAddAndMap(e: MouseEvent): Promise<void> {
  const ha = isHAEnforced()
  const det = _lastDetection
  if (!det || !det.detectedElements.password) return

  hideRemapIcon()
  _currentState = 'WIZARD_ACTIVE'

  auditLogSafe(ha ? 'security' : 'info', 'QSO_ADD_MAP_START', 'Add and Map flow started', { ha, op: 'add_map' })

  showMappingWizard({
    anchor: det.anchor!,
    includeUsername: !!det.detectedElements.username,
    preDetected: {
      username: det.detectedElements.username,
      password: det.detectedElements.password,
      submit: det.detectedElements.submit,
    },
    onComplete: async (wizardResult) => {
      _currentState = 'SAVING'

      try {
        // Read current field values
        const usernameValue = det.detectedElements.username
          ? (det.detectedElements.username as HTMLInputElement).value
          : ''
        const passwordValue = det.detectedElements.password
          ? (det.detectedElements.password as HTMLInputElement).value
          : ''

        if (!passwordValue) {
          auditLogSafe(ha ? 'security' : 'warn', 'QSO_ADD_MAP_EMPTY', 'Add and Map aborted: password empty', { ha, op: 'add_map' })
          _currentState = 'IDLE'
          return
        }

        // Build mapping
        const origin = effectiveOrigin()
        const now = new Date().toISOString()
        const mapping: LoginFormMapping = {
          mapping_version: 1,
          origin,
          username: wizardResult.username ?? undefined,
          password: wizardResult.password,
          submit: wizardResult.submit,
          last_verified_at: now,
          created_at: now,
          label: window.location.hostname,
        }

        // Create credential + save mapping
        const credentialId = await createCredentialFromPageInput({
          origin,
          username: usernameValue,
          password: passwordValue,
          mapping,
        })

        auditLogSafe(ha ? 'security' : 'info', 'QSO_ADD_MAP_COMPLETE', 'Add and Map completed', { ha, op: 'add_map' })
        emitTelemetryEvent('qso_remap', { mode: 'add_map', ha })

        _currentState = 'IDLE'
      } catch {
        auditLogSafe(ha ? 'security' : 'warn', 'QSO_ADD_MAP_FAILED', 'Add and Map failed', { ha, op: 'add_map' })
        _currentState = 'IDLE'
      }
    },
    onCancel: () => {
      _currentState = 'IDLE'
      auditLogSafe(ha ? 'security' : 'info', 'QSO_ADD_MAP_CANCEL', 'Add and Map cancelled', { ha, op: 'add_map' })
    },
  })
}

// ============================================================================
// §6  "Remap" Flow
// ============================================================================

async function handleRemap(e: MouseEvent): Promise<void> {
  const ha = isHAEnforced()
  const det = _lastDetection
  if (!det) return

  hideRemapIcon()
  _currentState = 'WIZARD_ACTIVE'

  auditLogSafe(ha ? 'security' : 'info', 'QSO_REMAP_START', 'Remap flow started', { ha, op: 'remap' })

  // If multiple credentials, show picker first
  if (det.credentials.length > 1) {
    const pickerCandidates: QsoCandidate[] = det.credentials.map(c => ({
      itemId: c.item.id,
      title: c.item.title,
      domain: c.item.domain,
      allGuardsPass: true,
      originTier: 'exact' as const,
    }))

    showQsoPicker(det.anchor!, pickerCandidates, async (selected, selectEvent) => {
      if (!selectEvent.isTrusted) return
      hideQsoPicker()
      const credential = det.credentials.find(c => c.item.id === selected.itemId)
      if (credential) {
        await startRemapWizard(credential, det)
      }
    })
  } else if (det.credentials.length === 1) {
    await startRemapWizard(det.credentials[0], det)
  } else {
    _currentState = 'IDLE'
  }
}

async function startRemapWizard(
  credential: OriginCredential,
  det: RemapDetectionResult,
): Promise<void> {
  const ha = isHAEnforced()

  showMappingWizard({
    anchor: det.anchor!,
    includeUsername: !!det.detectedElements.username,
    preDetected: {
      username: det.detectedElements.username,
      password: det.detectedElements.password,
      submit: det.detectedElements.submit,
    },
    onComplete: async (wizardResult) => {
      _currentState = 'SAVING'

      try {
        const origin = effectiveOrigin()
        const now = new Date().toISOString()
        const mapping: LoginFormMapping = {
          mapping_version: 1,
          origin,
          username: wizardResult.username ?? undefined,
          password: wizardResult.password,
          submit: wizardResult.submit,
          last_verified_at: now,
          created_at: credential.mapping?.created_at ?? now,
          label: credential.mapping?.label ?? window.location.hostname,
        }

        await saveMapping(credential.item.id, mapping)

        auditLogSafe(ha ? 'security' : 'info', 'QSO_REMAP_COMPLETE', 'Remap completed', { ha, op: 'remap' })
        emitTelemetryEvent('qso_remap', { mode: 'remap', ha })

        // After successful remap, try QSO fill+submit if rate limit allows
        if (canExecuteQso()) {
          _currentState = 'FILL_SUBMIT'
          await attemptQsoAfterRemap(credential, mapping)
        }

        _currentState = 'IDLE'
      } catch {
        auditLogSafe(ha ? 'security' : 'warn', 'QSO_REMAP_SAVE_FAILED', 'Remap save failed', { ha, op: 'remap' })
        _currentState = 'IDLE'
      }
    },
    onCancel: () => {
      _currentState = 'IDLE'
      auditLogSafe(ha ? 'security' : 'info', 'QSO_REMAP_CANCEL', 'Remap cancelled', { ha, op: 'remap' })
    },
  })
}

// ============================================================================
// §7  QSO Execution After Remap
// ============================================================================

/**
 * Attempt QSO fill+submit after a successful remap.
 * Uses the existing executeQsoFill pipeline (commitInsert + safeSubmitAfterFill).
 */
async function attemptQsoAfterRemap(
  credential: OriginCredential,
  mapping: LoginFormMapping,
): Promise<void> {
  const ha = isHAEnforced()

  // Validate the mapping (should be fresh, but be defensive)
  const validation = validateMapping(mapping)
  if (!validation.valid || !validation.password.element) {
    auditLogSafe(ha ? 'security' : 'warn', 'QSO_POST_REMAP_INVALID', 'Post-remap validation failed', { ha, op: 'fill_submit' })
    return
  }

  // Build a QsoCandidate from the mapping resolution
  const candidate: QsoCandidate = {
    itemId: credential.item.id,
    title: credential.item.title,
    domain: credential.item.domain,
    usernameEl: validation.username?.element ?? undefined,
    passwordEl: validation.password.element ?? undefined,
    form: validation.password.element?.closest('form') as HTMLFormElement | undefined,
    submitEl: validation.submit.element ?? undefined,
    allGuardsPass: true,
    originTier: 'exact',
  }

  try {
    _lastExecuteTs = Date.now()
    const result = await executeQsoFill(candidate, true)
    auditLogSafe(ha ? 'security' : 'info', 'QSO_POST_REMAP_FILL', 'Post-remap QSO executed', { ha, op: 'fill_submit' })
    emitTelemetryEvent('qso_remap_fill', { filled: result.filled, submitted: result.submitted, ha })
  } catch {
    auditLogSafe(ha ? 'security' : 'warn', 'QSO_POST_REMAP_ERROR', 'Post-remap QSO failed', { ha, op: 'fill_submit' })
  }
}

// ============================================================================
// §8  Rate Limiting & Helpers
// ============================================================================

/** Check if QSO execution is allowed (rate limit). */
function canExecuteQso(): boolean {
  return Date.now() - _lastExecuteTs >= EXECUTE_RATE_LIMIT_MS
}

/** Check if at least one login field has user-typed content. */
function hasNonEmptyLoginField(
  passwordEl?: HTMLElement,
  usernameEl?: HTMLElement,
): boolean {
  if (passwordEl && (passwordEl as HTMLInputElement).value) return true
  if (usernameEl && (usernameEl as HTMLInputElement).value) return true
  return false
}

/** Create an empty detection result. */
function idleDetection(): RemapDetectionResult {
  return {
    state: 'NO_ACTION',
    mode: null,
    anchor: null,
    detectedElements: {},
    credentials: [],
    isSignupForm: false,
  }
}

/**
 * Delete the mapping for a credential (Forget mapping).
 * Exposed for the UI "Forget mapping" option.
 */
export async function forgetMapping(credentialId: string): Promise<void> {
  await deleteMapping(credentialId)
  _currentState = 'IDLE'
  _lastDetection = null
}
