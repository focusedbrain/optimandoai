// ============================================================================
// WRVault Autofill — High Assurance Mode Guard (Content Script)
// ============================================================================
//
// Central enforcement point for HA mode in the content script.
//
// All subsystems (committer, overlay, orchestrator, quickSelect, saveBar,
// submitWatcher, fieldScanner) import this module and call `haCheck()`
// before performing gated actions.
//
// State synchronization:
//   The HA state is stored in the vault settings (Electron side) and
//   synchronized to the content script via chrome.storage.local + message
//   passing, identical to the toggle sync mechanism.
//
// Fail-closed:
//   If the HA state is unknown or corrupt, `isHAEnforced()` returns true.
//   This means ALL gated actions are blocked by default until a valid
//   state is received from the background script.
//
// ============================================================================

import {
  isHAActive,
  haAllows,
  haDenyReason,
  type HAModeState,
  type HAGatedAction,
  type HAConfig,
  HA_CONFIG,
  DEFAULT_HA_STATE,
} from '../../../../../packages/shared/src/vault/haMode'
import { auditLog, emitTelemetryEvent } from './hardening'

// ============================================================================
// §1  State
// ============================================================================

/**
 * The locally cached HA state.
 * Initialized to DEFAULT_HA_STATE (active) — fail-closed.
 */
let _haState: HAModeState = { ...DEFAULT_HA_STATE }

/** Timestamp of last sync from background script. */
let _lastSyncAt = 0

/** Listeners for HA state changes. */
const _listeners: Array<(active: boolean) => void> = []

/** chrome.storage.local key for HA state cache. */
const HA_STORAGE_KEY = 'wrv_ha_mode_state'

/** Message types for HA state synchronization. */
export const MSG_HA_STATE_CHANGED = 'AUTOFILL_HA_STATE_CHANGED'
export const MSG_HA_STATE_REQUEST = 'AUTOFILL_HA_STATE_REQUEST'

// ============================================================================
// §2  Public API — Queries
// ============================================================================

/**
 * Whether HA mode is currently enforced.
 *
 * Fail-closed: returns true if state is missing, corrupt, or unsynced.
 */
export function isHAEnforced(): boolean {
  return isHAActive(_haState)
}

/**
 * Get the current HA config (frozen, immutable).
 *
 * When HA is active, returns the canonical HA_CONFIG.
 * When HA is off, returns null (defer to tier config).
 */
export function getHAConfig(): Readonly<HAConfig> | null {
  return isHAEnforced() ? HA_CONFIG : null
}

/**
 * Get the raw HA state (for UI display / settings panel).
 */
export function getHAState(): Readonly<HAModeState> {
  return _haState
}

// ============================================================================
// §3  Public API — Enforcement
// ============================================================================

/**
 * Check whether a gated action is allowed.
 *
 * If HA is active and the action is blocked, this function:
 *   1. Logs the denial to the audit log.
 *   2. Emits a telemetry event.
 *   3. Returns `false`.
 *
 * If HA is off, returns `true` (defer to tier/toggle checks).
 *
 * Usage:
 * ```ts
 * if (!haCheck('silent_insert')) {
 *   // Action blocked by HA mode — abort or show overlay
 *   return
 * }
 * ```
 */
export function haCheck(action: HAGatedAction): boolean {
  if (haAllows(_haState, action)) return true

  // Denied — log and reject
  const reason = haDenyReason(action)
  auditLog('warn', `HA_DENY_${action.toUpperCase()}`, reason)
  emitTelemetryEvent('ha_deny', { action })
  return false
}

/**
 * Check whether a gated action is allowed WITHOUT logging.
 *
 * Use this for UI-level checks (e.g., hiding a toggle) where
 * denial is expected and logging would be noisy.
 */
export function haCheckSilent(action: HAGatedAction): boolean {
  return haAllows(_haState, action)
}

// ============================================================================
// §4  State Synchronization
// ============================================================================

/**
 * Initialize HA state synchronization.
 *
 * 1. Reads cached state from chrome.storage.local.
 * 2. Subscribes to runtime messages for live updates.
 * 3. Requests fresh state from background script.
 *
 * Call this once during content script initialization.
 */
export function initHASync(): void {
  // Read cached state
  try {
    chrome.storage.local.get(HA_STORAGE_KEY, (result) => {
      const stored = result?.[HA_STORAGE_KEY]
      if (stored && typeof stored === 'object' && typeof stored.state === 'string') {
        _haState = stored as HAModeState
        _lastSyncAt = Date.now()
        notifyListeners()
      }
      // If missing → _haState remains DEFAULT_HA_STATE (active, fail-closed)
    })
  } catch {
    // Storage unavailable — keep fail-closed default
  }

  // Listen for live updates from background
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === MSG_HA_STATE_CHANGED && msg.haState) {
        updateHAState(msg.haState)
      }
    })
  } catch {
    // Runtime unavailable — keep fail-closed default
  }

  // Request fresh state from background
  try {
    chrome.runtime.sendMessage({ type: MSG_HA_STATE_REQUEST })
  } catch {
    // Ignore — background may not be ready yet
  }
}

/**
 * Update the local HA state (called by background sync or settings change).
 */
export function updateHAState(newState: HAModeState): void {
  const wasActive = isHAActive(_haState)
  _haState = { ...newState }
  _lastSyncAt = Date.now()

  // Persist to chrome.storage.local
  try {
    chrome.storage.local.set({ [HA_STORAGE_KEY]: _haState })
  } catch {
    // Storage write failed — state is still updated in memory
  }

  const nowActive = isHAActive(_haState)
  if (wasActive !== nowActive) {
    auditLog(
      'warn',
      nowActive ? 'HA_MODE_ACTIVATED' : 'HA_MODE_DEACTIVATED',
      `High Assurance Mode ${nowActive ? 'activated' : 'deactivated'}`,
    )
    notifyListeners()
  }
}

/**
 * Subscribe to HA state changes.
 * Returns an unsubscribe function.
 */
export function onHAChange(listener: (active: boolean) => void): () => void {
  _listeners.push(listener)
  return () => {
    const idx = _listeners.indexOf(listener)
    if (idx >= 0) _listeners.splice(idx, 1)
  }
}

/**
 * Handle HA state request from another script (background → content).
 */
export function handleHARequest(): void {
  try {
    chrome.runtime.sendMessage({
      type: MSG_HA_STATE_CHANGED,
      haState: _haState,
    })
  } catch {
    // Ignore
  }
}

// ============================================================================
// §5  Internal Helpers
// ============================================================================

function notifyListeners(): void {
  const active = isHAEnforced()
  for (const listener of _listeners) {
    try { listener(active) } catch { /* noop */ }
  }
}
