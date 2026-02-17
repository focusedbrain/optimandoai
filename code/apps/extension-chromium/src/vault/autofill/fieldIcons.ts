// ============================================================================
// WRVault Autofill — Field Icons (Inline Input Icons)
// ============================================================================
//
// Places a small WRVault shield icon inside every detected form field.
// Clicking the icon opens the inline popover for that field.
//
// Design:
//   - Icons are fixed-position overlays, not injected into the DOM tree
//     of the input itself (avoids breaking page layouts)
//   - Each icon lives in its own Shadow DOM (mode: 'closed')
//   - Semi-transparent (40%) when idle, fully opaque on hover
//   - Repositions on scroll/resize via rAF watchdog
//   - Cleaned up on teardown or rescan
//
// ============================================================================

import { CSS_TOKENS } from './overlayStyles'
import type { FieldCandidate } from '../../../../../packages/shared/src/vault/insertionPipeline'
import { auditLog } from './hardening'

// ============================================================================
// §1  Types
// ============================================================================

export interface FieldIconHandle {
  /** The input element this icon is anchored to. */
  element: HTMLElement
  /** The matched candidate info. */
  candidate: FieldCandidate
  /** Remove this icon from the DOM. */
  remove: () => void
}

export type IconClickHandler = (
  element: HTMLElement,
  candidate: FieldCandidate,
  iconRect: DOMRect,
) => void

export type QsoClickHandler = (
  element: HTMLElement,
  candidate: FieldCandidate,
  iconRect: DOMRect,
) => void

// ============================================================================
// §2  State
// ============================================================================

let _icons: FieldIconHandle[] = []
let _rafId: number | null = null
let _onClick: IconClickHandler | null = null
let _onQsoClick: QsoClickHandler | null = null
/** Track which elements already have icons to avoid duplicates. */
const _iconElements = new WeakSet<HTMLElement>()
/** Whether the current domain has at least one matching credential. */
let _hasMatch = false
/** Map: input element → icon button (for SVG color updates via closed shadow). */
const _iconBtns = new Map<HTMLElement, HTMLButtonElement>()
/** Map: input element → QSO button (for show/hide via closed shadow). */
const _qsoBtns = new Map<HTMLElement, HTMLButtonElement>()

// ============================================================================
// §3  Public API
// ============================================================================

/**
 * Place icons on all detected candidate fields.
 *
 * Removes stale icons for fields no longer in the candidate list.
 * Adds icons for new fields. Preserves existing ones that are still valid.
 */
export function syncFieldIcons(
  candidates: FieldCandidate[],
  onClick: IconClickHandler,
): void {
  _onClick = onClick

  // Build set of current candidate elements
  const currentElements = new Set(candidates.map(c => c.element as HTMLElement))

  // Remove icons for fields no longer in candidates
  const toRemove: FieldIconHandle[] = []
  const toKeep: FieldIconHandle[] = []

  for (const icon of _icons) {
    if (currentElements.has(icon.element) && document.contains(icon.element)) {
      toKeep.push(icon)
    } else {
      toRemove.push(icon)
    }
  }

  for (const icon of toRemove) {
    _iconElements.delete(icon.element)
    icon.remove()
  }

  _icons = toKeep

  // Add icons for new candidates
  for (const candidate of candidates) {
    const el = candidate.element as HTMLElement
    if (_iconElements.has(el)) continue
    if (!document.contains(el)) continue

    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue

    const handle = createFieldIcon(el, candidate)
    if (handle) {
      _icons.push(handle)
      _iconElements.add(el)
    }
  }

  // Start position watchdog if we have icons
  if (_icons.length > 0 && !_rafId) {
    startPositionWatchdog()
  } else if (_icons.length === 0 && _rafId) {
    stopPositionWatchdog()
  }
}

/**
 * Register the QSO (Quick Sign-On) click handler.
 * Called by the orchestrator to wire up direct-fill behavior.
 */
export function setQsoClickHandler(handler: QsoClickHandler | null): void {
  _onQsoClick = handler
}

/**
 * Remove all field icons and stop watchdog.
 */
export function clearAllFieldIcons(): void {
  for (const icon of _icons) {
    _iconElements.delete(icon.element)
    icon.remove()
  }
  _icons = []
  _onClick = null
  _onQsoClick = null
  _iconBtns.clear()
  _qsoBtns.clear()
  _hasMatch = false
  stopPositionWatchdog()
}

/**
 * Get the number of active field icons.
 */
export function getFieldIconCount(): number {
  return _icons.length
}

/**
 * Update the match state of all field icons (icon color only).
 *
 * When `hasMatch` is true, icons turn green (credential found for this domain).
 * When false, icons are grey (no matching credential).
 *
 * QSO button visibility is controlled separately via `setQsoButtonVisible()`.
 */
export function setFieldIconMatchState(hasMatch: boolean): void {
  _hasMatch = hasMatch
  const svg = hasMatch ? WR_LOGO_SVG_GREEN : WR_LOGO_SVG
  for (const btn of _iconBtns.values()) {
    btn.innerHTML = svg
  }
}

/**
 * Show or hide the QSO button on all field icons.
 *
 * The QSO button should only be visible when BOTH conditions are met:
 *   1. A matching credential exists for this domain (hasMatch)
 *   2. Auto mode is globally consented (autoConsented)
 *
 * Call this after `setFieldIconMatchState()` with the combined condition.
 */
export function setQsoButtonVisible(visible: boolean): void {
  for (const qsoBtn of _qsoBtns.values()) {
    qsoBtn.style.display = visible ? '' : 'none'
  }
}

/**
 * Whether the current domain has matching vault credentials.
 */
export function hasVaultMatch(): boolean {
  return _hasMatch
}

// ============================================================================
// §4  Icon Creation
// ============================================================================

function createFieldIcon(
  element: HTMLElement,
  candidate: FieldCandidate,
): FieldIconHandle | null {
  const host = document.createElement('div')
  host.setAttribute('data-wrv-field-icon', '')
  host.style.cssText = 'position:fixed;z-index:2147483644;pointer-events:auto;'

  const shadow = host.attachShadow({ mode: 'closed' })

  // Inject styles
  const style = document.createElement('style')
  style.textContent = buildIconCSS()
  shadow.appendChild(style)

  // Flex container for QSO button + shield icon
  const container = document.createElement('div')
  container.className = 'wrv-fi-container'

  // QSO (Quick Sign-On) button — hidden by default, shown via setQsoButtonVisible()
  const qsoBtn = document.createElement('button')
  qsoBtn.className = 'wrv-fi-qso'
  qsoBtn.setAttribute('aria-label', 'Quick Sign-On — auto-fill and submit')
  qsoBtn.setAttribute('title', 'Quick Sign-On')
  qsoBtn.setAttribute('type', 'button')
  qsoBtn.textContent = 'QSO'
  qsoBtn.style.display = 'none'
  qsoBtn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const iconRect = host.getBoundingClientRect()
    _onQsoClick?.(element, candidate, iconRect)
  })
  qsoBtn.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
  container.appendChild(qsoBtn)

  // Shield icon button (opens popover)
  const btn = document.createElement('button')
  btn.className = 'wrv-fi'
  btn.setAttribute('aria-label', 'WRVault — Fill this field')
  btn.setAttribute('title', 'WRVault')
  btn.setAttribute('type', 'button')
  btn.innerHTML = _hasMatch ? WR_LOGO_SVG_GREEN : WR_LOGO_SVG
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    const iconRect = host.getBoundingClientRect()
    _onClick?.(element, candidate, iconRect)
  })
  btn.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
  })
  container.appendChild(btn)

  shadow.appendChild(container)

  // Store refs for dynamic updates via closed shadow
  _iconBtns.set(element, btn)
  _qsoBtns.set(element, qsoBtn)

  // Append and position
  document.documentElement.appendChild(host)
  positionIcon(host, element)

  const remove = () => {
    _iconBtns.delete(element)
    _qsoBtns.delete(element)
    try { host.remove() } catch { /* noop */ }
  }

  return { element, candidate, remove }
}

function positionIcon(host: HTMLElement, anchor: HTMLElement): void {
  if (!host.isConnected) return
  const rect = anchor.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    host.style.display = 'none'
    return
  }
  host.style.display = ''

  const iconSize = 22
  const padding = 5
  const hostWidth = host.offsetWidth || iconSize

  // Position inside the right edge of the input field, vertically centered
  host.style.top = `${rect.top + (rect.height / 2) - (iconSize / 2)}px`
  host.style.left = `${rect.right - hostWidth - padding}px`

  // If field is too narrow, don't show
  if (rect.width < 60) {
    host.style.display = 'none'
  }
}

// ============================================================================
// §5  Position Watchdog
// ============================================================================

function startPositionWatchdog(): void {
  if (_rafId) return

  function tick() {
    // Remove icons whose anchors have been removed from DOM
    const stillValid: FieldIconHandle[] = []
    for (const icon of _icons) {
      if (!document.contains(icon.element)) {
        _iconElements.delete(icon.element)
        icon.remove()
      } else {
        stillValid.push(icon)
      }
    }
    _icons = stillValid

    if (_icons.length === 0) {
      _rafId = null
      return
    }

    // Reposition all icons
    const allHosts = document.querySelectorAll<HTMLElement>('[data-wrv-field-icon]')
    let hostIndex = 0
    for (const icon of _icons) {
      if (hostIndex < allHosts.length) {
        positionIcon(allHosts[hostIndex], icon.element)
      }
      hostIndex++
    }

    _rafId = requestAnimationFrame(tick)
  }

  _rafId = requestAnimationFrame(tick)
}

function stopPositionWatchdog(): void {
  if (_rafId) {
    cancelAnimationFrame(_rafId)
    _rafId = null
  }
}

// ============================================================================
// §6  SVG Icon — Mini WR Desk Logo
// ============================================================================
//
// Recreated from the original WR Desk logo: shield shape with "WR" text
// and a briefcase icon. Designed for 22x22px display inside form fields.

/** Grey shield icon — no matching credential for current domain. */
const WR_LOGO_SVG = `<svg width="18" height="18" viewBox="0 0 64 72" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M32 2 L6 16 V38 C6 54 18 66 32 70 C46 66 58 54 58 38 V16 Z" fill="#6b7280" stroke="#9ca3af" stroke-width="2.5"/>
  <text x="32" y="36" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="20" fill="#ffffff" letter-spacing="-0.5">WR</text>
  <rect x="22" y="44" width="20" height="12" rx="2" fill="none" stroke="#ffffff" stroke-width="1.8"/>
  <path d="M27 44v-3a3 3 0 013-3h4a3 3 0 013 3v3" fill="none" stroke="#ffffff" stroke-width="1.8"/>
</svg>`

/** Green shield icon — matching credential found for current domain. */
const WR_LOGO_SVG_GREEN = `<svg width="18" height="18" viewBox="0 0 64 72" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M32 2 L6 16 V38 C6 54 18 66 32 70 C46 66 58 54 58 38 V16 Z" fill="#22c55e" stroke="#16a34a" stroke-width="2.5"/>
  <text x="32" y="36" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="20" fill="#ffffff" letter-spacing="-0.5">WR</text>
  <rect x="22" y="44" width="20" height="12" rx="2" fill="none" stroke="#ffffff" stroke-width="1.8"/>
  <path d="M27 44v-3a3 3 0 013-3h4a3 3 0 013 3v3" fill="none" stroke="#ffffff" stroke-width="1.8"/>
</svg>`

// ============================================================================
// §7  CSS
// ============================================================================

function buildIconCSS(): string {
  return `
    :host { all: initial; display: block; }
    .wrv-fi-container {
      display: flex;
      align-items: center;
      gap: 3px;
    }
    .wrv-fi {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 22px;
      height: 22px;
      border-radius: 4px;
      border: none;
      background: transparent;
      cursor: pointer;
      padding: 0;
      opacity: 0.85;
      transition: opacity 0.15s ease, transform 0.12s ease, filter 0.15s ease;
      outline: none;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.15));
    }
    .wrv-fi:hover {
      opacity: 1;
      transform: scale(1.18);
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.25));
    }
    .wrv-fi:focus-visible {
      opacity: 1;
      outline: 2px solid #6366f1;
      outline-offset: 1px;
    }
    .wrv-fi:active {
      transform: scale(0.93);
    }
    .wrv-fi-qso {
      font-family: Arial, Helvetica, sans-serif;
      font-size: 9px;
      font-weight: 700;
      line-height: 1;
      letter-spacing: 0.5px;
      padding: 3px 5px;
      border-radius: 3px;
      border: none;
      background: #22c55e;
      color: #ffffff;
      cursor: pointer;
      white-space: nowrap;
      opacity: 0.9;
      transition: opacity 0.15s ease, transform 0.12s ease, background 0.15s ease;
      outline: none;
      filter: drop-shadow(0 1px 2px rgba(0,0,0,0.15));
    }
    .wrv-fi-qso:hover {
      opacity: 1;
      background: #16a34a;
      transform: scale(1.08);
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.25));
    }
    .wrv-fi-qso:focus-visible {
      opacity: 1;
      outline: 2px solid #6366f1;
      outline-offset: 1px;
    }
    .wrv-fi-qso:active {
      transform: scale(0.93);
    }
  `
}
