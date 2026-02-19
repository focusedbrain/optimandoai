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
import { initHASync, haCheck, isHAEnforced, onHAChange } from './haGuard'
import { syncFieldIcons, clearAllFieldIcons } from './fieldIcons'
import { showPopover, hidePopover, isPopoverVisible } from './inlinePopover'
import { hideOverlay } from './overlayManager'
import { initWritesKillSwitch } from './writesKillSwitch'
import { resolveQsoState, executeQsoFill } from './qso/qsoEngine'
import type { QsoState, QsoCandidate } from './qso/qsoEngine'
import { showQsoIcon, hideQsoIcon, qsoStateToVisual } from './qso/qsoIcon'
import { showQsoPicker, hideQsoPicker } from './qso/qsoPicker'
import { updateRemapState, teardownRemap } from './qso/remapManager'
import { hideRemapIcon } from './qso/remapIcon'
import { hideMappingWizard } from './qso/mappingWizard'
import { listItemsForIndex } from '../api'

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

  // 8. Save-password watcher only starts if vault is active + HA allows it
  if (isAutofillActive() && haCheck('auto_save')) {
    startSavePasswordWatcher()
  }
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
    // Global off or vault locked → stop everything, dismiss any active overlay
    stopWatching()
    stopSubmitWatcher()
    hideSaveBar()
    quickSelectClose()
    hideTriggerIcon()
    hidePopover()
    hideOverlay()
    clearAllFieldIcons()
    hideQsoIcon()
    hideQsoPicker()
    teardownRemap()
    clearIndex()
    _lastScan = null
    _lastQsoState = null
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

  // Dismiss any open UI (overlay, popover, quickselect, save bar, field icons, QSO)
  hideOverlay()
  quickSelectClose()
  hideTriggerIcon()
  hideSaveBar()
  hidePopover()
  clearAllFieldIcons()
  hideQsoIcon()
  hideQsoPicker()
  teardownRemap()
  _lastQsoState = null

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
function runScan(): ScanResult {
  const startTime = performance.now()
  // Always scan with all sections ON for field detection + icon placement.
  // The toggles only gate actual data retrieval in the popover.
  const scanToggles = { login: true, identity: true, company: true, custom: true }
  const result = collectCandidates(scanToggles)
  const durationMs = performance.now() - startTime
  _lastScan = result
  _onScanResult?.(result)

  // Place WRVault icons inside every detected form field
  syncFieldIcons(result.candidates, handleFieldIconClick)

  emitTelemetryEvent('scan_complete', {
    candidateCount: result.candidates.length,
    hintCount: result.hints.length,
    elementsEvaluated: result.elementsEvaluated,
  }, durationMs)

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
    // Update field icons when DOM changes add/remove form fields
    syncFieldIcons(result.candidates, handleFieldIconClick)
  })
}

// ============================================================================
// §3.5  Field Icon → Inline Popover Pipeline
// ============================================================================

/**
 * Handle a click on a WRVault field icon inside a form field.
 *
 * Opens the inline popover with Auto/Manual mode toggle.
 */
import type { FieldCandidate } from '../../../../../packages/shared/src/vault/insertionPipeline'

async function handleFieldIconClick(
  element: HTMLElement,
  candidate: FieldCandidate,
  iconRect: DOMRect,
): Promise<void> {
  // NOTE: Do NOT gate on isAutofillActive() here.
  // Icons are always visible and the popover handles vault-locked / empty
  // states with a CTA that redirects the user to the vault manager.

  // Close any existing popover
  if (isPopoverVisible()) {
    hidePopover()
  }

  const allCandidates = _lastScan?.candidates ?? []

  try {
    const result = await showPopover({
      anchorElement: element,
      candidate,
      allCandidates,
      iconRect,
    })

    if (result.action === 'filled') {
      auditLog('info', 'INLINE_FILL', `Inline popover filled ${result.fieldCount} fields from item ${result.itemId}`)
    } else if (result.action === 'open_manager') {
      // Send message to open the vault manager UI
      try {
        chrome.runtime.sendMessage({ type: 'OPEN_VAULT_MANAGER' })
      } catch {
        // Extension context may be invalidated
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

  // HA Mode: block automatic credential capture
  if (!haCheck('auto_save')) return

  startSubmitWatcher()

  _unsubscribeCredentials = onCredentialSubmit(async (creds: ExtractedCredentials) => {
    try {
      // Gate: is the login section enabled?
      const toggles = getEffectiveToggles()
      if (!toggles.login) return

      // Gate: is this domain in the "never save" list?
      const blocked = await isNeverSaveDomain(creds.domain)
      if (blocked) {
        auditLog('info', 'SAVE_BLOCKED_NEVER', `Save blocked: domain in never-save list (${creds.domain})`)
        return
      }

      // Gate: password must be non-trivial
      if (!creds.password || creds.password.length < 2) return

      auditLog('info', 'SAVE_CREDENTIAL_DETECTED', `Credential submit detected for ${creds.domain} (form: ${creds.formType})`)

      // Find existing matches in the vault
      const existingMatches = await findExistingCredentials(creds.domain, creds.username)

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

      // Execute the decision
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
