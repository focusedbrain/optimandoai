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

// ============================================================================
// §2  State
// ============================================================================

let _icons: FieldIconHandle[] = []
let _rafId: number | null = null
let _onClick: IconClickHandler | null = null
/** Track which elements already have icons to avoid duplicates. */
const _iconElements = new WeakSet<HTMLElement>()

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
 * Remove all field icons and stop watchdog.
 */
export function clearAllFieldIcons(): void {
  for (const icon of _icons) {
    _iconElements.delete(icon.element)
    icon.remove()
  }
  _icons = []
  _onClick = null
  stopPositionWatchdog()
}

/**
 * Get the number of active field icons.
 */
export function getFieldIconCount(): number {
  return _icons.length
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

  // Build icon button
  const btn = document.createElement('button')
  btn.className = 'wrv-fi'
  btn.setAttribute('aria-label', 'WRVault — Fill this field')
  btn.setAttribute('title', 'WRVault')
  btn.setAttribute('type', 'button')
  btn.innerHTML = WR_LOGO_SVG
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
  shadow.appendChild(btn)

  // Append and position
  document.documentElement.appendChild(host)
  positionIcon(host, element)

  const remove = () => {
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

  // Position inside the right edge of the input field, vertically centered
  host.style.top = `${rect.top + (rect.height / 2) - (iconSize / 2)}px`
  host.style.left = `${rect.right - iconSize - padding}px`

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

const WR_LOGO_SVG = `<svg width="18" height="18" viewBox="0 0 64 72" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Shield body -->
  <path d="M32 2 L6 16 V38 C6 54 18 66 32 70 C46 66 58 54 58 38 V16 Z" fill="#2d2d2d" stroke="#3a3a3a" stroke-width="2.5"/>
  <!-- WR text -->
  <text x="32" y="36" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="20" fill="#ffffff" letter-spacing="-0.5">WR</text>
  <!-- Briefcase mini icon -->
  <rect x="22" y="44" width="20" height="12" rx="2" fill="none" stroke="#ffffff" stroke-width="1.8"/>
  <path d="M27 44v-3a3 3 0 013-3h4a3 3 0 013 3v3" fill="none" stroke="#ffffff" stroke-width="1.8"/>
</svg>`

// ============================================================================
// §7  CSS
// ============================================================================

function buildIconCSS(): string {
  return `
    :host { all: initial; display: block; }
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
      opacity: 0.65;
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
  `
}
