// ============================================================================
// WRVault Autofill — Pipeline Orchestrator
// ============================================================================
//
// Wires together:
//   toggleSync      (live toggle state from vault settings)
//   fieldScanner    (DOM field detection + scoring)
//   overlayManager  (preview + insert)
//   submitWatcher   (credential capture → save-password flow)
//   credentialStore (vault handoff + duplicate detection)
//   saveBar         (disk icon + store credential dialog)
//   quickSelect     (manual vault search dropdown)
//   vaultIndex      (in-memory search index)
//
// Lifecycle:
//   initAutofill()       — call once from content-script.tsx on DOM ready
//   teardownAutofill()   — call on extension unload or vault lock
//
// The orchestrator reacts to toggle changes in real time:
//   - Global toggle OFF  → stop scanner + watcher, hide UI, teardown observer
//   - Global toggle ON   → start scanner + watcher, resume observer
//   - Section toggle flip → invalidate cache, re-scan with new toggles
//
// ============================================================================

import {
  collectCandidates,
  invalidateScanCache,
  startWatching,
  stopWatching,
} from './fieldScanner'
import type { ScanResult } from './fieldScanner'
import {
  initContentToggleSync,
  getEffectiveToggles,
  isAutofillActive,
  onToggleChange,
} from './toggleSync'
import type { AutofillToggleState } from './toggleSync'
import {
  startSubmitWatcher,
  stopSubmitWatcher,
  onCredentialSubmit,
} from './submitWatcher'
import { showSaveBar, hideSaveBar } from './saveBar'
import {
  findExistingCredentials,
  executeCredentialSave,
  isNeverSaveDomain,
} from './credentialStore'
import {
  quickSelectOpen,
  quickSelectClose,
  showTriggerIcon,
  registerShortcut,
  unregisterShortcut,
  hideTriggerIcon,
} from './quickSelect'
import { clearIndex } from './vaultIndex'
import {
  evaluateSafeMode,
  startSPAWatcher,
  stopSPAWatcher,
  auditLog,
  emitTelemetryEvent,
  clearAuditLog,
  clearTelemetry,
  redactError,
} from './hardening'
import type { ExtractedCredentials } from '../../../../../packages/shared/src/vault/insertionPipeline'
import { initHASync, haCheck, haCheckSilent, isHAEnforced, onHAChange } from './haGuard'
import { syncFieldIcons, clearAllFieldIcons, setFieldIconMatchState, setQsoButtonVisible, hasVaultMatch, setQsoClickHandler } from './fieldIcons'
import {
  showPopover,
  hidePopover,
  isPopoverVisible,
  fillFieldsFromVaultItem,
  autoSubmitAfterFill,
  loadQsoAutoConsent,
} from './inlinePopover'
import { showFillPreview } from './fillPreview'
import { safeSubmitAfterFill, resolveSubmitTarget } from './submitGuard'
import type { SubmitSafetyInput } from './submitGuard'
// overlayManager preview overlay removed — autofill now uses icon-click flow
import { initWritesKillSwitch, areWritesDisabled } from './writesKillSwitch'
import { setPopoverFillActive } from './committer'
import { resolveQsoState, executeQsoFill } from './qso/qsoEngine'
import type { QsoState, QsoCandidate } from './qso/qsoEngine'
import { showQsoIcon, hideQsoIcon, qsoStateToVisual } from './qso/qsoIcon'
import { showQsoPicker, hideQsoPicker } from './qso/qsoPicker'
import { updateRemapState, teardownRemap } from './qso/remapManager'
import { hideRemapIcon } from './qso/remapIcon'
import { hideMappingWizard } from './qso/mappingWizard'
import { listItemsForIndex } from '../api'
import * as vaultAPI from '../api'
import { findMatchingItemsForDomain } from './credentialStore'
import type { VaultItem } from '../types'

// ── DataVault PII Autofill Layer ──
import {
  initDataVault,
  processScanForDataVault,
  teardownDataVault,
  handleDvSPANavigation,
  cacheDvCandidates,
} from './dataVaultOrchestrator'

// ============================================================================
// §1  State
// ============================================================================

let _initialized = false
let _unsubscribeToggles: (() => void) | null = null
let _unsubscribeCredentials: (() => void) | null = null
let _unsubscribeShortcut: (() => void) | null = null
let _unsubscribeHA: (() => void) | null = null
let _lastScan: ScanResult | null = null
let _lastQsoState: QsoState | null = null

/** Callback for consumers (e.g., overlay manager) to receive scan results. */
let _onScanResult: ((result: ScanResult) => void) | null = null

/** Vault items that match the current domain (for direct-fill). */
let _matchedItems: VaultItem[] = []

// ============================================================================
// §2  Public API
// ============================================================================

/**
 * Initialize the autofill pipeline.
 *
 * Call once from the content script after DOM is ready.
 * Sets up toggle sync, initial field scan, MutationObserver, and
 * the submit watcher for save-password flows.
 *
 * @param onScanResult — optional callback invoked on every scan (initial + mutations)
 */
export function initAutofill(
  onScanResult?: (result: ScanResult) => void,
): void {
  if (_initialized) return
  _initialized = true
  _onScanResult = onScanResult ?? null

  // 1. Initialize HA mode sync (fail-closed: active until proven otherwise)
  initHASync()

  // 2. Initialize toggle sync (reads chrome.storage.local + subscribes)
  initContentToggleSync()

  // 2b. Initialize writes kill-switch sync (reads chrome.storage.local + subscribes)
  initWritesKillSwitch()

  // 3. Subscribe to toggle changes
  _unsubscribeToggles = onToggleChange(handleToggleChange)

  // 4. Subscribe to HA state changes (react in real time)
  _unsubscribeHA = onHAChange(handleHAStateChange)

  // 5. Register QuickSelect keyboard shortcut (Ctrl+Shift+.)
  _unsubscribeShortcut = registerShortcut(handleQuickSelectShortcut)

  // 6. Start SPA navigation watcher (handles pushState/replaceState/popstate)
  startSPAWatcher({
    onNavigate: handleSPANavigation,
    debounceMs: 300,
    maxNavigationsPerWindow: 5,
    windowMs: 2000,
  })

  auditLog('info', 'AUTOFILL_INIT', `Autofill pipeline initialized (HA=${isHAEnforced() ? 'ON' : 'OFF'})`)

  // 7. Always start field scanning and icon placement.
  //    Icons are shown regardless of vault lock state (like other password managers).
  //    The popover handles vault-locked state by prompting the user.
  runScan()
  startObserver()

  // 8. Always start the submit watcher for credential capture (password field
  //    tracking, form submit hooks, XHR/fetch interception).  This must run
  //    even when the vault is locked so we can capture registration credentials.
  //    The save-bar + vault operations are gated inside the callback.
  startSavePasswordWatcher()

  // 9. Initialize DataVault PII autofill layer.
  //    Checks denylist + profile availability and prepares icon placement.
  //    Non-blocking — errors are swallowed (DataVault is optional UX).
  initDataVault().catch(() => {})
}

/**
 * Teardown the autofill pipeline.
 *
 * Call on extension unload or when the vault locks.
 */
export function teardownAutofill(): void {
  stopWatching()
  stopSubmitWatcher()
  stopSPAWatcher()
  hideSaveBar()
  quickSelectClose()
  hideTriggerIcon()
  hidePopover()
  clearAllFieldIcons()
  hideQsoIcon()
  hideQsoPicker()
  teardownRemap()
  teardownDataVault()
  unregisterShortcut()
  clearIndex()
  clearAuditLog()
  clearTelemetry()
  _unsubscribeToggles?.()
  _unsubscribeCredentials?.()
  _unsubscribeShortcut?.()
  _unsubscribeHA?.()
  _unsubscribeToggles = null
  _unsubscribeCredentials = null
  _unsubscribeShortcut = null
  _unsubscribeHA = null
  _lastScan = null
  _lastQsoState = null
  _matchedItems = []
  _onScanResult = null
  _initialized = false
  auditLog('info', 'AUTOFILL_TEARDOWN', 'Autofill pipeline torn down')
}

/**
 * Force a fresh scan with current toggles.
 * Useful when QuickSelect opens or after navigation.
 */
export function forceScan(): ScanResult | null {
  if (!isAutofillActive()) return null
  invalidateScanCache()
  return runScan()
}

/**
 * Get the last scan result (if any).
 */
export function getLastScan(): ScanResult | null {
  return _lastScan
}

// ============================================================================
// §3  Internal Handlers
// ============================================================================

/** React to toggle state changes pushed from the background script. */
function handleToggleChange(state: AutofillToggleState): void {
  if (!state.vaultUnlocked || !state.enabled) {
    auditLog('info', 'TOGGLES_OFF', `Autofill disabled (vault=${state.vaultUnlocked ? 'unlocked' : 'locked'}, enabled=${state.enabled})`)
    // Global off or vault locked → stop UI overlays, but keep submit watcher
    // running for credential capture (registration save prompts).
    stopWatching()
    // NOTE: Do NOT stopSubmitWatcher() here — it must keep running to
    // capture credentials from registration forms even when vault is locked.
    hideSaveBar()
    quickSelectClose()
    hideTriggerIcon()
    hidePopover()
    clearAllFieldIcons()
    hideQsoIcon()
    hideQsoPicker()
    teardownRemap()
    teardownDataVault()
    clearIndex()
    _lastScan = null
    _lastQsoState = null
    _matchedItems = []
    return
  }

  auditLog('info', 'TOGGLES_CHANGED', 'Autofill toggles updated, rescanning')

  // Active: invalidate cache and re-scan with new section toggles
  invalidateScanCache()
  runScan()

  // Restart observer with new toggles (observer uses toggles for rescan)
  startObserver()

  // Ensure submit watcher is running (only starts once per page)
  startSavePasswordWatcher()

  // Re-initialize DataVault layer (may have been torn down when vault locked)
  initDataVault().catch(() => {})
}

// ============================================================================
// §3.4  QSO (Quick Sign-On) Integration
// ============================================================================

/**
 * Fetch vault items and resolve QSO state.  Places or hides the QSO icon
 * based on the result.  Non-blocking — errors are swallowed.
 */
async function updateQsoAsync(): Promise<void> {
  try {
    const items = await listItemsForIndex()
    // listItemsForIndex returns IndexProjection[]; resolveQsoState accepts
    // FillProjection[] (superset).  For state resolution only metadata is
    // needed — the actual fill fetches via getItemForFill at commit time.
    const state = await resolveQsoState(items as any)
    _lastQsoState = state

    if (state.status === 'BLOCKED' || state.status === 'NONE') {
      hideQsoIcon()
      return
    }

    // Find an anchor element for the QSO icon (prefer password field)
    const anchor = findQsoAnchor(state)
    if (!anchor) {
      hideQsoIcon()
      return
    }

    const visual = qsoStateToVisual(state)
    showQsoIcon(anchor, visual, handleQsoIconClick)
  } catch {
    // Non-fatal — QSO is optional UX; autofill still works via field icons
    hideQsoIcon()
  }
}

// ============================================================================
// §3.3  Domain Match Detection (Icon Color State)
// ============================================================================

/**
 * Check if the current domain has matching vault credentials.
 *
 * Updates:
 *   - Field icon colors (grey ↔ green)
 *   - _matchedItems cache (for direct-fill on green icon click)
 *
 * Non-blocking — errors are swallowed (icons stay grey on failure).
 */
async function checkDomainMatchesAsync(): Promise<void> {
  try {
    const currentOrigin = window.location.origin
    const [matches, autoConsented] = await Promise.all([
      findMatchingItemsForDomain(currentOrigin),
      loadQsoAutoConsent(),
    ])
    _matchedItems = matches
    const hasMatch = matches.length > 0

    setFieldIconMatchState(hasMatch)
    setQsoButtonVisible(hasMatch && autoConsented)

    if (hasMatch) {
      auditLog('info', 'DOMAIN_MATCH_FOUND', `Found ${matches.length} credential(s) matching ${window.location.hostname}`)
    }
  } catch {
    // Non-fatal — icons remain grey, QSO hidden
    _matchedItems = []
    setFieldIconMatchState(false)
    setQsoButtonVisible(false)
  }
}

/**
 * Find the best anchor element for the QSO icon.
 * Prefers the password field of the exact match, then any password candidate.
 */
function findQsoAnchor(state: QsoState): HTMLElement | null {
  if (state.exactMatch?.passwordEl) return state.exactMatch.passwordEl
  if (state.exactMatch?.usernameEl) return state.exactMatch.usernameEl

  for (const c of state.candidates) {
    if (c.passwordEl) return c.passwordEl
    if (c.usernameEl) return c.usernameEl
  }

  return null
}

/**
 * Handle click on the QSO icon.
 *
 * - EXACT_MATCH: fill+submit immediately
 * - HAS_CANDIDATES: open picker for user selection
 * - BLOCKED: no action (icon is disabled)
 */
async function handleQsoIconClick(e: MouseEvent): Promise<void> {
  const ha = isHAEnforced()

  // ── Hard gate: trusted click only ──
  if (!e.isTrusted) {
    auditLog(ha ? 'security' : 'warn', 'QSO_REJECT_UNTRUSTED', 'QSO rejected: untrusted click')
    return
  }

  const state = _lastQsoState
  if (!state) return

  if (state.status === 'EXACT_MATCH' && state.exactMatch) {
    const result = await executeQsoFill(state.exactMatch, e.isTrusted)
    auditLog('info', 'QSO_CLICK_EXACT', 'QSO exact-match action completed')
    emitTelemetryEvent('qso_click', { mode: 'exact', filled: result.filled, submitted: result.submitted })
    return
  }

  if (state.status === 'HAS_CANDIDATES' && state.candidates.length > 0) {
    const iconHost = document.getElementById('wrv-qso-icon')
    if (!iconHost) return

    showQsoPicker(iconHost, state.candidates, async (candidate: QsoCandidate, selectEvent: MouseEvent) => {
      if (!selectEvent.isTrusted) {
        auditLog(ha ? 'security' : 'warn', 'QSO_REJECT_UNTRUSTED', 'QSO picker rejected: untrusted click')
        return
      }
      const result = await executeQsoFill(candidate, selectEvent.isTrusted)
      auditLog('info', 'QSO_PICK_COMPLETE', 'QSO picker action completed')
      emitTelemetryEvent('qso_click', { mode: 'picker', filled: result.filled, submitted: result.submitted })
    })
    return
  }

  // BLOCKED or NONE — no action
}

/**
 * Handle SPA navigation events (pushState/replaceState/popstate).
 * Auto-dismiss any open UI and trigger a fresh scan.
 */
function handleSPANavigation(): void {
  auditLog('info', 'SPA_NAVIGATION', `SPA navigation detected: ${window.location.pathname}`)
  emitTelemetryEvent('safe_mode_fallback', { reason: 'spa_navigation' })

  // Dismiss any open UI (popover, quickselect, save bar, field icons, QSO, DataVault)
  quickSelectClose()
  hideTriggerIcon()
  hideSaveBar()
  hidePopover()
  clearAllFieldIcons()
  hideQsoIcon()
  hideQsoPicker()
  teardownRemap()
  handleDvSPANavigation()
  _lastQsoState = null
  _matchedItems = []

  // Invalidate and rescan
  invalidateScanCache()
  if (isAutofillActive()) {
    runScan()
  }
}

/**
 * Run a scan, place field icons, and notify consumer.
 *
 * IMPORTANT: Scanning always runs with all sections enabled so that
 * icons appear on ALL detected fields (login, identity, company, etc.)
 * regardless of vault lock state. This matches the UX of other password
 * managers where icons are always visible and the vault-locked state
 * is handled at interaction time (popover shows "unlock" prompt).
 */
/** Field kinds that get the WRVault icon (password-manager fields only). */
const PASSWORD_FIELD_KINDS = new Set([
  'login.password',
  'login.new_password',
  'login.username',
  'login.email',
])

/** Form contexts where autofill login icons should NOT appear. */
const ICON_SUPPRESSED_CONTEXTS = new Set<string>(['signup', 'password_change'])

/** Filter candidates to only password/login fields on login forms for icon placement. */
function filterPasswordCandidates(candidates: FieldCandidate[]): FieldCandidate[] {
  return candidates.filter(c => {
    if (!c.matchedKind || !PASSWORD_FIELD_KINDS.has(c.matchedKind)) return false
    if (ICON_SUPPRESSED_CONTEXTS.has(c.formContext)) return false
    return true
  })
}

function runScan(): ScanResult {
  const startTime = performance.now()
  // Always scan with all sections ON for field detection + icon placement.
  // The toggles only gate actual data retrieval in the popover.
  const scanToggles = { login: true, identity: true, company: true, custom: true }
  const result = collectCandidates(scanToggles)
  const durationMs = performance.now() - startTime
  _lastScan = result
  _onScanResult?.(result)

  // Place WRVault icons only on password/login fields
  const iconCandidates = filterPasswordCandidates(result.candidates)
  syncFieldIcons(iconCandidates, handleFieldIconClick)
  setQsoClickHandler(handleQsoButtonClick)

  emitTelemetryEvent('scan_complete', {
    candidateCount: result.candidates.length,
    hintCount: result.hints.length,
    elementsEvaluated: result.elementsEvaluated,
  }, durationMs)

  // ── DataVault PII Autofill: place identity/company icons on detected fields ──
  // processScanForDataVault is async (site learning + NLP booster) but non-blocking.
  cacheDvCandidates(result.candidates)
  processScanForDataVault(result).catch(() => {})

  // ── Domain match check: determine if current domain has matching credentials ──
  // This updates field icon colors (grey → green) based on vault matches.
  checkDomainMatchesAsync().catch(() => {})

  // ── QSO: resolve state after scan if autofill is active ──
  // QSO icon placement is async (vault API call) but non-blocking.
  if (isAutofillActive()) {
    updateQsoAsync().catch(() => {})
    // Remap detection runs after QSO to handle unmapped/missing credentials
    updateRemapState().catch(() => {})
  }

  return result
}

/** Start the MutationObserver. Always uses all-sections-enabled for icon placement. */
function startObserver(): void {
  const scanToggles = { login: true, identity: true, company: true, custom: true }
  startWatching(scanToggles, (result) => {
    _lastScan = result
    _onScanResult?.(result)
    // Update field icons only on password/login fields
    const iconCandidates = filterPasswordCandidates(result.candidates)
    syncFieldIcons(iconCandidates, handleFieldIconClick)
    setQsoClickHandler(handleQsoButtonClick)
    // Update DataVault PII icons on identity/company fields
    cacheDvCandidates(result.candidates)
    processScanForDataVault(result).catch(() => {})
  })
}

// ============================================================================
// §3.5  Field Icon → Inline Popover Pipeline
// ============================================================================

/**
 * Handle a click on a WRVault shield icon inside a form field.
 *
 * Always opens the inline popover regardless of match state.
 * Direct fill + auto-submit is handled by the separate QSO button.
 */
import type { FieldCandidate } from '../../../../../packages/shared/src/vault/insertionPipeline'

async function handleFieldIconClick(
  element: HTMLElement,
  candidate: FieldCandidate,
  iconRect: DOMRect,
): Promise<void> {
  // Close any existing popover
  if (isPopoverVisible()) {
    hidePopover()
  }

  const allCandidates = _lastScan?.candidates ?? []
  const domainHasMatch = hasVaultMatch()

  openPopoverForField(element, candidate, allCandidates, iconRect, domainHasMatch)
}

/**
 * Handle a click on the QSO (Quick Sign-On) button next to a field icon.
 *
 * The QSO button is only visible when match + auto mode are both active
 * (State D). Performs direct fill + guarded auto-submit.
 * If security guards block the submit, degrades to fill-only.
 */
async function handleQsoButtonClick(
  element: HTMLElement,
  candidate: FieldCandidate,
  iconRect: DOMRect,
): Promise<void> {
  const allCandidates = _lastScan?.candidates ?? []

  if (_matchedItems.length === 0) {
    auditLog('warn', 'QSO_NO_MATCHES', 'QSO button clicked but no matched items')
    return
  }

  const item = _matchedItems[0]

  try {
    const fullItem = await vaultAPI.getItemForFill(item.id) as VaultItem

    if (areWritesDisabled()) {
      auditLog('warn', 'WRITES_DISABLED_QSO', 'QSO fill blocked — writes disabled')
      return
    }

    // ── Fill fields directly ──
    setPopoverFillActive(true)
    let filledCount = 0
    try {
      filledCount = fillFieldsFromVaultItem(fullItem, allCandidates, element)
    } finally {
      setPopoverFillActive(false)
    }

    auditLog('info', 'QSO_FILL', `QSO filled ${filledCount} fields from "${item.title}"`)
    emitTelemetryEvent('direct_fill', { itemId: item.id, fieldCount: filledCount })

    // ── Guarded auto-submit: use safeSubmitAfterFill with security gates ──
    if (filledCount > 0) {
      guardedAutoSubmit(allCandidates, 'qso_button')
    }
  } catch (err) {
    auditLog('error', 'QSO_FILL_ERROR', `QSO fill failed: ${redactError(err)}`)
    // Fallback: open popover so user can fill manually
    openPopoverForField(element, candidate, allCandidates, iconRect, true)
  }
}

/**
 * Attempt a guarded form submit after fill. Uses the 12-gate security
 * pipeline from submitGuard.ts. If any gate fails, the form is NOT
 * submitted (values remain filled — degrade to fill-only).
 */
function guardedAutoSubmit(
  candidates: FieldCandidate[],
  source: string,
): void {
  // Resolve the form from filled candidates
  let form: HTMLFormElement | null = null
  for (const c of candidates) {
    const el = c.element as HTMLElement
    if (el && document.contains(el)) {
      form = el.closest('form')
      if (form) break
    }
  }

  const submitEl = form ? resolveSubmitTarget(form) : null
  if (!submitEl) {
    auditLog('info', 'GUARDED_SUBMIT_NO_BUTTON',
      `No submit button found for guarded submit (source: ${source})`)
    return
  }

  const input: SubmitSafetyInput = {
    form,
    submitEl,
    submitFingerprint: null,
    originTier: _matchedItems.length > 0 ? 'exact' : 'none',
    partialScan: _lastScan?.partial ?? false,
    isTrusted: true,
    mutationGuard: null,
  }

  const result = safeSubmitAfterFill(input)

  if (result.submitted) {
    auditLog('info', 'GUARDED_SUBMIT_OK',
      `Guarded submit succeeded (source: ${source})`)
    emitTelemetryEvent('guarded_submit', { source, code: result.code })
  } else {
    auditLog('warn', 'GUARDED_SUBMIT_BLOCKED',
      `Guarded submit blocked: ${result.reason ?? result.code} (source: ${source}). Degrading to fill-only.`)
    emitTelemetryEvent('guarded_submit_blocked', {
      source,
      code: result.code,
      reason: result.reason,
    })
  }
}

/**
 * Open the inline popover for a given field.
 */
async function openPopoverForField(
  element: HTMLElement,
  candidate: FieldCandidate,
  allCandidates: FieldCandidate[],
  iconRect: DOMRect,
  hasMatch: boolean,
): Promise<void> {
  try {
    const result = await showPopover({
      anchorElement: element,
      candidate,
      allCandidates,
      iconRect,
      hasMatch,
      onModeChange: (mode) => {
        // When user toggles Auto/Manual in popover, update QSO button visibility
        const isAuto = mode === 'auto'
        const hasMatchNow = _matchedItems.length > 0
        setQsoButtonVisible(hasMatchNow && isAuto)
      },
    })

    if (result.action === 'filled') {
      auditLog('info', 'INLINE_FILL', `Inline popover filled ${result.fieldCount} fields from item ${result.itemId}`)
      // Re-check domain matches after fill (the remap may have updated)
      checkDomainMatchesAsync().catch(() => {})
    } else if (result.action === 'open_manager') {
      try {
        // Open the vault lightbox directly on the current page (not the
        // full orchestrator sidebar).  Dynamic import keeps the vault UI
        // chunk out of the autofill critical path.
        const { openVaultLightbox } = await import('../vault-ui-typescript')
        openVaultLightbox()
      } catch (e) {
        auditLog('error', 'OPEN_MANAGER_FAIL', `Failed to open vault lightbox: ${redactError(e)}`)
      }
      auditLog('info', 'OPEN_MANAGER', 'User requested to open vault manager from popover')
    }
  } catch (err) {
    auditLog('error', 'POPOVER_ERROR', `Inline popover error: ${redactError(err)}`)
  }
}

// ============================================================================
// §4  QuickSelect Pipeline
// ============================================================================

/**
 * Handle the QuickSelect keyboard shortcut (Ctrl+Shift+.).
 *
 * Flow:
 *   1. Find the currently focused input/textarea
 *   2. Open QuickSelect dropdown anchored to it
 *   3. On entry selection → (future) open overlay preview → consent → commit
 */
function handleQuickSelectShortcut(): void {
  if (!isAutofillActive()) return

  const activeEl = document.activeElement as HTMLElement | null
  if (!activeEl) return

  // Only open for fillable elements
  const tag = activeEl.tagName?.toLowerCase()
  if (tag !== 'input' && tag !== 'textarea' && !activeEl.isContentEditable) return

  // Don't open if already open
  const { quickSelectIsOpen } = require('./quickSelect') as typeof import('./quickSelect')
  if (quickSelectIsOpen()) return

  openQuickSelectForElement(activeEl)
}

/**
 * Open QuickSelect for a specific element.
 * Exported for use by the field scanner (trigger icon click).
 */
export async function openQuickSelectForElement(anchor: HTMLElement): Promise<void> {
  const domain = window.location.origin

  try {
    const result = await quickSelectOpen({ anchor, domain })

    if (result.action === 'selected') {
      auditLog('info', 'QUICKSELECT_FLOW', `QuickSelect → entry selected: ${result.entry.title}`)
      // TODO: Phase 2 — create an OverlaySession from the selected entry,
      // show the overlay preview for consent, then commit insert.
      // For now, log the selection. The overlay integration depends on
      // resolving the selected IndexEntry into a VaultProfile and building
      // a session with the target field + profile fields.
    }
  } catch (err) {
    auditLog('error', 'QUICKSELECT_ERROR', `QuickSelect pipeline: ${redactError(err)}`)
  }
}

// ============================================================================
// §5  Save Password Pipeline
// ============================================================================

/**
 * Start the submit watcher and wire the credential → save-bar → vault flow.
 *
 * Flow:
 *   1. submitWatcher detects credential submission
 *   2. Check "never save" blocklist — abort if blocked
 *   3. Check toggles — abort if login section is off
 *   4. Find existing vault matches (duplicate detection)
 *   5. Show save-bar (disk icon → dialog)
 *   6. On user decision → execute save/update via credentialStore
 */
/**
 * React to HA mode state changes in real time.
 *
 * When HA activates:
 *   - Stop submit watcher (no auto-save)
 *   - Hide save bar (if visible)
 *   - Log the transition
 *
 * When HA deactivates:
 *   - Re-start submit watcher if login toggles are on
 */
function handleHAStateChange(active: boolean): void {
  if (active) {
    // HA activated — stop auto-save features
    stopSubmitWatcher()
    hideSaveBar()
    if (_unsubscribeCredentials) {
      _unsubscribeCredentials()
      _unsubscribeCredentials = null
    }
    auditLog('warn', 'HA_SAVE_WATCHER_STOPPED', 'HA Mode activated: save-password watcher stopped')
  } else {
    // HA deactivated — re-enable auto-save if toggles allow
    const toggles = getEffectiveToggles()
    if (toggles.login) {
      startSavePasswordWatcher()
      auditLog('info', 'HA_SAVE_WATCHER_RESUMED', 'HA Mode deactivated: save-password watcher resumed')
    }
  }
}

function startSavePasswordWatcher(): void {
  // Only register once
  if (_unsubscribeCredentials) return

  // Always start the submit watcher hooks (password field tracking, form
  // submit capture, XHR/fetch interception, history hooks).  These must run
  // even when the vault is locked so we can capture registration credentials.
  startSubmitWatcher()

  _unsubscribeCredentials = onCredentialSubmit(async (creds: ExtractedCredentials) => {
    try {
      // Gate: password must be non-trivial
      if (!creds.password || creds.password.length < 2) return

      // Gate: HA Mode blocks automatic credential capture
      if (!haCheckSilent('auto_save')) return

      // Gate: is this domain in the "never save" list?
      const blocked = await isNeverSaveDomain(creds.domain)
      if (blocked) {
        auditLog('info', 'SAVE_BLOCKED_NEVER', `Save blocked: domain in never-save list (${creds.domain})`)
        return
      }

      auditLog('info', 'SAVE_CREDENTIAL_DETECTED', `Credential submit detected for ${creds.domain} (form: ${creds.formType})`)

      // Find existing matches in the vault (may fail if vault is locked — that's ok)
      let existingMatches: Array<{ itemId: string; username: string }> = []
      try {
        existingMatches = await findExistingCredentials(creds.domain, creds.username)
      } catch {
        // Vault may be locked — proceed without duplicate check
      }

      // If exact duplicate (same username + password), don't bother prompting
      if (existingMatches.length > 0) {
        const isDuplicate = await checkExactDuplicate(existingMatches, creds)
        if (isDuplicate) return
      }

      // Find anchor element (password field) for icon positioning
      const anchor = findPasswordFieldOnPage()

      emitTelemetryEvent('save_bar_shown', {
        domain: creds.domain,
        formType: creds.formType,
        existingMatchCount: existingMatches.length,
      })

      // Show save bar and wait for decision
      const decision = await showSaveBar({
        credentials: creds,
        anchor: anchor ?? undefined,
        existingMatches,
      })

      // Telemetry for user decision
      if (decision.action === 'save') {
        emitTelemetryEvent('save_bar_save', { domain: creds.domain })
      } else if (decision.action === 'update') {
        emitTelemetryEvent('save_bar_update', { domain: creds.domain })
      } else if (decision.action === 'never') {
        emitTelemetryEvent('save_bar_never', { domain: creds.domain })
      } else {
        emitTelemetryEvent('save_bar_cancel', {})
      }

      // Execute the decision (may fail if vault is locked — save bar handles this)
      const result = await executeCredentialSave(decision, creds)
      if (result.success && (result.action === 'created' || result.action === 'updated')) {
        auditLog('info', 'CREDENTIAL_SAVED', `Credential ${result.action}: ${result.itemId}`)
      }
    } catch (err) {
      auditLog('error', 'SAVE_PIPELINE_ERROR', `Save password pipeline: ${redactError(err)}`)
    }
  })
}

/**
 * Check if the credentials are an exact match for an existing vault item
 * (same username AND same password).  If so, no prompt is needed.
 */
async function checkExactDuplicate(
  matches: Array<{ itemId: string; username: string }>,
  creds: ExtractedCredentials,
): Promise<boolean> {
  // We can't check the password without decrypting, and we don't want
  // to fetch+decrypt all matches on every form submit.  So we only
  // suppress if the username exactly matches AND there's a recent match
  // (within the last 5 minutes — likely the user just saved this).
  // A full password comparison would require a round-trip per match.
  return false
}

/** Find the first visible password field on the page (for icon anchoring). */
function findPasswordFieldOnPage(): HTMLElement | null {
  const fields = document.querySelectorAll<HTMLInputElement>('input[type="password"]')
  for (const field of fields) {
    const rect = field.getBoundingClientRect()
    if (rect.width > 0 && rect.height > 0) return field
  }
  return null
}
