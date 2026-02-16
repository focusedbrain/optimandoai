// ============================================================================
// WRVault Autofill — Toggle Synchronization Layer
// ============================================================================
//
// Bridges vault settings (autofillEnabled + autofillSections) between:
//   Vault DB → Electron HTTP API → Background script → Content script
//
// Architecture:
//   ┌───────────┐   HTTP    ┌────────────┐  storage  ┌──────────────┐
//   │ Vault DB  │ ────────> │ Background │ ────────> │ Content Sript│
//   │ (Electron)│           │ (cache)    │  message  │ (fieldScanner│
//   └───────────┘           └────────────┘ ────────> │  consumer)   │
//                                                    └──────────────┘
//
// Sync strategy:
//   1. On vault unlock: background fetches settings, caches in chrome.storage.local
//   2. On settings change (from vault UI): background pushes update to storage + broadcasts
//   3. Content script reads from chrome.storage.local (instant, no HTTP round-trip)
//   4. Content script listens for runtime messages for live updates (no reload)
//   5. If chrome.storage.local has no toggles → use safe defaults (all ON)
//
// Message types:
//   AUTOFILL_TOGGLES_CHANGED  — background → content (broadcast on change)
//   AUTOFILL_TOGGLES_REQUEST  — content → background (pull on demand)
//
// ============================================================================

import type { AutofillSectionToggles } from '../../../../../packages/shared/src/vault/fieldTaxonomy'
import { DEFAULT_SECTION_TOGGLES } from '../../../../../packages/shared/src/vault/fieldTaxonomy'

// ============================================================================
// §1  Types
// ============================================================================

/** The resolved toggle state used by the content script. */
export interface AutofillToggleState {
  /** Global kill-switch.  When false, all autofill is disabled. */
  enabled: boolean
  /** Per-section toggles.  Only effective when enabled === true. */
  sections: AutofillSectionToggles
  /** When these toggles were last synced from the vault (ms epoch). */
  syncedAt: number
  /** Whether the vault is currently unlocked. */
  vaultUnlocked: boolean
}

/** Safe default: everything ON, vault assumed locked until proven otherwise. */
export const DEFAULT_TOGGLE_STATE: AutofillToggleState = {
  enabled: true,
  sections: { ...DEFAULT_SECTION_TOGGLES },
  syncedAt: 0,
  vaultUnlocked: false,
}

/** chrome.storage.local key for cached toggle state. */
const STORAGE_KEY = 'wrv_autofill_toggles'

/** Message type constants. */
export const MSG_TOGGLES_CHANGED = 'AUTOFILL_TOGGLES_CHANGED' as const
export const MSG_TOGGLES_REQUEST = 'AUTOFILL_TOGGLES_REQUEST' as const
export const MSG_VAULT_LOCK_STATE = 'AUTOFILL_VAULT_LOCK_STATE' as const

export interface ToggleChangedMessage {
  type: typeof MSG_TOGGLES_CHANGED
  state: AutofillToggleState
}

export interface ToggleRequestMessage {
  type: typeof MSG_TOGGLES_REQUEST
}

export interface VaultLockStateMessage {
  type: typeof MSG_VAULT_LOCK_STATE
  unlocked: boolean
}

export type ToggleSyncMessage =
  | ToggleChangedMessage
  | ToggleRequestMessage
  | VaultLockStateMessage

// ============================================================================
// §2  Background Script API
// ============================================================================
//
// These functions run in the BACKGROUND SCRIPT (service worker).
// They manage the authoritative toggle cache and broadcast changes.
//

/**
 * Fetch current autofill settings from the vault (via HTTP API) and
 * cache them in chrome.storage.local.
 *
 * Call this:
 *   - On vault unlock
 *   - After a settings update from the vault UI
 *
 * @returns The resolved toggle state.
 */
export async function syncTogglesFromVault(
  fetcher: () => Promise<{ autofillEnabled: boolean; autofillSections: AutofillSectionToggles }>,
): Promise<AutofillToggleState> {
  try {
    const settings = await fetcher()
    const state: AutofillToggleState = {
      enabled: settings.autofillEnabled ?? true,
      sections: {
        ...DEFAULT_SECTION_TOGGLES,
        ...(settings.autofillSections ?? {}),
      },
      syncedAt: Date.now(),
      vaultUnlocked: true,
    }
    await writeToggleCache(state)
    await broadcastToggleChange(state)
    return state
  } catch (err) {
    console.warn('[TOGGLE-SYNC] Failed to fetch toggles from vault, using cached/defaults:', err)
    return await readToggleCache()
  }
}

/**
 * Write a toggle update directly (e.g., from a settings change pushed
 * via WebSocket or after updateSettings() call).
 */
export async function pushToggleUpdate(
  partial: Partial<Pick<AutofillToggleState, 'enabled' | 'sections'>>,
): Promise<AutofillToggleState> {
  const current = await readToggleCache()
  const updated: AutofillToggleState = {
    ...current,
    ...partial,
    sections: {
      ...current.sections,
      ...(partial.sections ?? {}),
    },
    syncedAt: Date.now(),
  }
  await writeToggleCache(updated)
  await broadcastToggleChange(updated)
  return updated
}

/**
 * Mark vault as locked.  Toggles are preserved in cache but
 * vaultUnlocked is set to false (content script should disable scanning).
 */
export async function markVaultLocked(): Promise<void> {
  const current = await readToggleCache()
  current.vaultUnlocked = false
  current.syncedAt = Date.now()
  await writeToggleCache(current)
  await broadcastToggleChange(current)
}

/**
 * Handle incoming toggle request from a content script.
 * Returns the current cached state.
 */
export async function handleToggleRequest(): Promise<AutofillToggleState> {
  return await readToggleCache()
}

// ============================================================================
// §3  Content Script API
// ============================================================================
//
// These functions run in CONTENT SCRIPTS.
// They consume the toggle state and subscribe to live updates.
//

/** In-memory toggle state for the content script (avoids async reads in hot paths). */
let _contentState: AutofillToggleState = { ...DEFAULT_TOGGLE_STATE }

/** Registered listeners for toggle changes. */
const _listeners: Set<(state: AutofillToggleState) => void> = new Set()

/**
 * Initialize toggle sync in the content script.
 *
 * 1. Reads cached state from chrome.storage.local (instant).
 * 2. Registers a runtime message listener for live updates.
 * 3. Sends a pull request to the background for latest state.
 *
 * Call once during content script initialization.
 */
export function initContentToggleSync(): void {
  // Read from storage.local (fast, synchronous-ish)
  if (typeof chrome !== 'undefined' && chrome.storage?.local) {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      if (result[STORAGE_KEY]) {
        _contentState = result[STORAGE_KEY] as AutofillToggleState
        notifyListeners()
      }
    })
  }

  // Listen for live broadcast updates from background
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message: any) => {
      if (message?.type === MSG_TOGGLES_CHANGED && message.state) {
        _contentState = message.state as AutofillToggleState
        notifyListeners()
      }
    })
  }

  // Pull latest from background (handles race condition where storage
  // was written between our storage.local read and listener registration)
  requestTogglesFromBackground()
}

/**
 * Get the current toggle state (synchronous, from in-memory cache).
 * Always returns a valid state — defaults if nothing has been synced.
 */
export function getToggles(): AutofillToggleState {
  return _contentState
}

/**
 * Get the effective section toggles for the field scanner.
 *
 * Returns all-false if:
 *   - Global toggle is OFF
 *   - Vault is locked
 *
 * Otherwise returns the per-section toggles.
 */
export function getEffectiveToggles(): AutofillSectionToggles {
  if (!_contentState.vaultUnlocked || !_contentState.enabled) {
    return { login: false, identity: false, company: false, custom: false }
  }
  return { ..._contentState.sections }
}

/**
 * Check if autofill is globally active (vault unlocked + global toggle ON).
 */
export function isAutofillActive(): boolean {
  return _contentState.vaultUnlocked && _contentState.enabled
}

/**
 * Register a listener for toggle state changes.
 * Called whenever the background pushes an update.
 *
 * Returns an unsubscribe function.
 */
export function onToggleChange(
  listener: (state: AutofillToggleState) => void,
): () => void {
  _listeners.add(listener)
  return () => _listeners.delete(listener)
}

/** Request fresh toggles from the background script. */
function requestTogglesFromBackground(): void {
  if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
    chrome.runtime.sendMessage(
      { type: MSG_TOGGLES_REQUEST } satisfies ToggleRequestMessage,
      (response: any) => {
        if (chrome.runtime.lastError) {
          // Background not available (e.g., during extension startup)
          return
        }
        if (response?.state) {
          _contentState = response.state as AutofillToggleState
          notifyListeners()
        }
      },
    )
  }
}

/** Notify all registered listeners. */
function notifyListeners(): void {
  for (const listener of _listeners) {
    try {
      listener(_contentState)
    } catch (err) {
      console.error('[TOGGLE-SYNC] Listener error:', err)
    }
  }
}

// ============================================================================
// §4  Storage Helpers (chrome.storage.local)
// ============================================================================

/** Read toggle state from chrome.storage.local. Returns defaults if missing. */
async function readToggleCache(): Promise<AutofillToggleState> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve({ ...DEFAULT_TOGGLE_STATE })
      return
    }
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      if (chrome.runtime.lastError || !result[STORAGE_KEY]) {
        resolve({ ...DEFAULT_TOGGLE_STATE })
      } else {
        // Merge with defaults for forward-compatibility
        const stored = result[STORAGE_KEY] as Partial<AutofillToggleState>
        resolve({
          ...DEFAULT_TOGGLE_STATE,
          ...stored,
          sections: {
            ...DEFAULT_TOGGLE_STATE.sections,
            ...(stored.sections ?? {}),
          },
        })
      }
    })
  })
}

/** Write toggle state to chrome.storage.local. */
async function writeToggleCache(state: AutofillToggleState): Promise<void> {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) {
      resolve()
      return
    }
    chrome.storage.local.set({ [STORAGE_KEY]: state }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[TOGGLE-SYNC] Failed to write cache:', chrome.runtime.lastError)
      }
      resolve()
    })
  })
}

/** Broadcast toggle change to all content scripts. */
async function broadcastToggleChange(state: AutofillToggleState): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.tabs?.query) return

  const message: ToggleChangedMessage = {
    type: MSG_TOGGLES_CHANGED,
    state,
  }

  try {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (tab.id != null) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {
          // Tab may not have a content script; ignore silently
        })
      }
    }
  } catch {
    // tabs.query may fail in some contexts; non-critical
  }
}
