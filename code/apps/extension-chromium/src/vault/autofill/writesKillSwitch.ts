// ============================================================================
// WRVault — Global Writes Kill-Switch
// ============================================================================
//
// A single source of truth for whether ALL DOM write operations (autofill
// inserts) are disabled across the extension.
//
// Storage: chrome.storage.local key "wrvault_writes_disabled" (boolean)
// Cache:   in-memory boolean for zero-overhead synchronous reads
//
// Consumers:
//   committer.ts     — hard gate before Phase 2 sync writes (server-side enforcement)
//   overlayManager   — disables Insert button + shows badge (UX enforcement)
//   inlinePopover    — blocks fillFromItem (UX enforcement)
//
// Operator control:
//   background.ts    — VAULT_SET_WRITES_DISABLED message handler
//   sidepanel        — settings toggle (future)
//
// Fail-closed: if storage read fails, the in-memory default is false (writes
// allowed).  However, once set to true, the flag persists in storage and
// survives extension restarts.
//
// ============================================================================

const STORAGE_KEY = 'wrvault_writes_disabled'
const MSG_WRITES_DISABLED_CHANGED = 'AUTOFILL_WRITES_DISABLED_CHANGED'

// ============================================================================
// §1  In-Memory Cache (Content Script + Background)
// ============================================================================

let _writesDisabled = false

/**
 * Synchronous check: are DOM writes globally disabled?
 *
 * This is the hot-path query used by committer.ts before Phase 2.
 * Returns the in-memory cached value (zero async overhead).
 */
export function areWritesDisabled(): boolean {
  return _writesDisabled
}

// ============================================================================
// §2  Initialization (Content Script)
// ============================================================================

/**
 * Initialize the kill-switch state in the content script.
 *
 * 1. Reads cached value from chrome.storage.local
 * 2. Listens for live broadcast updates from background
 *
 * Call once during content script initialization (alongside initContentToggleSync).
 */
export function initWritesKillSwitch(): void {
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      if (typeof result[STORAGE_KEY] === 'boolean') {
        _writesDisabled = result[STORAGE_KEY]
        _notifyListeners()
      }
    })
  }

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message: any) => {
      if (message?.type === MSG_WRITES_DISABLED_CHANGED && typeof message.disabled === 'boolean') {
        _writesDisabled = message.disabled
        _notifyListeners()
      }
    })
  }
}

// ============================================================================
// §3  Background Script API
// ============================================================================

/**
 * Set the kill-switch state (background script only).
 *
 * Writes to chrome.storage.local and broadcasts to all content scripts.
 */
export async function setWritesDisabled(disabled: boolean): Promise<void> {
  _writesDisabled = disabled
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    await chrome.storage.local.set({ [STORAGE_KEY]: disabled })
  }
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    try {
      chrome.runtime.sendMessage({
        type: MSG_WRITES_DISABLED_CHANGED,
        disabled,
      })
    } catch {
      // Content scripts may not be listening yet — storage is the durable source
    }
  }
}

// ============================================================================
// §4  Change Listeners
// ============================================================================

type WritesDisabledListener = (disabled: boolean) => void
const _listeners: Set<WritesDisabledListener> = new Set()

/**
 * Register a listener for kill-switch state changes.
 * Returns an unsubscribe function.
 */
export function onWritesDisabledChange(listener: WritesDisabledListener): () => void {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

function _notifyListeners(): void {
  for (const fn of _listeners) {
    try { fn(_writesDisabled) } catch { /* listener error must not propagate */ }
  }
}

// ============================================================================
// §5  Test Helpers (do not use in production)
// ============================================================================

/** Override the in-memory cache directly (for unit tests only). */
export function _testSetWritesDisabled(disabled: boolean): void {
  _writesDisabled = disabled
}
