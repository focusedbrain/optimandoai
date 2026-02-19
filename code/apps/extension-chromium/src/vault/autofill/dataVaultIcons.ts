// ============================================================================
// WRVault DataVault — Inline Field Icons (PII/Company Fields)
// ============================================================================
//
// Places a small DataVault icon inside every detected identity/company field.
// Clicking the icon opens the DataVault popup for that field.
//
// IMPORTANT: This is SEPARATE from fieldIcons.ts which handles password-manager
// shield icons.  DataVault icons use the same WR shield visual but are placed
// on identity/company fields only (not login/password fields).
//
// Design:
//   - Icons are fixed-position overlays (like fieldIcons.ts)
//   - Each icon lives in its own Shadow DOM (mode: 'closed')
//   - Icon color per-field:
//       green = matched vaultKey AND active profile has a value for that key
//       grey  = matched vaultKey but no value in profile, or no profile selected
//   - Repositions on scroll/resize via rAF watchdog
//   - Cleaned up on teardown or rescan
//
// ============================================================================

import type { FieldCandidate } from '../../../../../packages/shared/src/vault/insertionPipeline'
import type { FieldKind } from '../../../../../packages/shared/src/vault/fieldTaxonomy'

// ============================================================================
// §1  Types
// ============================================================================

export interface DvIconHandle {
  /** The form field element this icon belongs to. */
  element: HTMLElement
  /** The host <div> injected into the DOM (contains the Shadow DOM). */
  host: HTMLElement
  /** The candidate data for this field. */
  candidate: FieldCandidate
  /** Remove this icon from the DOM. */
  remove: () => void
}

export type DvIconClickHandler = (
  element: HTMLElement,
  candidate: FieldCandidate,
  iconRect: DOMRect,
) => void

// ============================================================================
// §2  State
// ============================================================================

let _icons: DvIconHandle[] = []
let _rafId: number | null = null
let _onClick: DvIconClickHandler | null = null
const _iconElements = new WeakSet<HTMLElement>()
/** Per-field FieldKinds that the active profile has values for. */
let _availableKinds: Set<FieldKind> = new Set()
const _iconBtns = new Map<HTMLElement, HTMLButtonElement>()

// ============================================================================
// §3  SVG Icons
// ============================================================================

/** Grey WR shield — no matching data for this field. Same icon as login. */
const DV_ICON_GREY = `<svg width="18" height="18" viewBox="0 0 64 72" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M32 2 L6 16 V38 C6 54 18 66 32 70 C46 66 58 54 58 38 V16 Z" fill="#6b7280" stroke="#9ca3af" stroke-width="2.5"/>
  <text x="32" y="36" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="20" fill="#ffffff" letter-spacing="-0.5">WR</text>
</svg>`

/** Green WR shield — matching data found for this field. Same icon as login. */
const DV_ICON_GREEN = `<svg width="18" height="18" viewBox="0 0 64 72" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M32 2 L6 16 V38 C6 54 18 66 32 70 C46 66 58 54 58 38 V16 Z" fill="#22c55e" stroke="#16a34a" stroke-width="2.5"/>
  <text x="32" y="36" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-weight="900" font-size="20" fill="#ffffff" letter-spacing="-0.5">WR</text>
</svg>`

// ============================================================================
// §4  Public API
// ============================================================================

/**
 * Place DataVault icons on all detected identity/company candidate fields.
 */
export function syncDvFieldIcons(
  candidates: FieldCandidate[],
  onClick: DvIconClickHandler,
): void {
  _onClick = onClick

  const currentElements = new Set(candidates.map(c => c.element as HTMLElement))
  const toRemove: DvIconHandle[] = []
  const toKeep: DvIconHandle[] = []

  for (const icon of _icons) {
    if (currentElements.has(icon.element) && document.contains(icon.element)) {
      toKeep.push(icon)
    } else {
      toRemove.push(icon)
    }
  }

  for (const icon of toRemove) {
    _iconElements.delete(icon.element)
    _iconBtns.delete(icon.element)
    icon.remove()
  }

  _icons = toKeep

  for (const candidate of candidates) {
    const el = candidate.element as HTMLElement
    if (_iconElements.has(el)) continue
    if (!document.contains(el)) continue

    const handle = createDvIcon(el, candidate)
    if (handle) {
      _icons.push(handle)
      _iconElements.add(el)
    }
  }

  startPositionWatchdog()
}

/** Remove all DataVault icons. */
export function clearAllDvIcons(): void {
  for (const icon of _icons) {
    _iconElements.delete(icon.element)
    _iconBtns.delete(icon.element)
    icon.remove()
  }
  _icons = []
  _availableKinds = new Set()
  stopPositionWatchdog()
}

/** Get current DataVault icon count. */
export function getDvIconCount(): number {
  return _icons.length
}

/**
 * Update icon colors per-field based on which FieldKinds the active
 * profile has values for.
 *
 * @param availableKinds Set of FieldKinds that the active profile provides.
 *   Icons whose candidate.matchedKind is in this set → green.
 *   All other icons → grey.
 *   Empty set → all icons grey (no profile or no values).
 */
export function setDvIconMatchData(availableKinds: Set<FieldKind>): void {
  _availableKinds = availableKinds
  for (const icon of _icons) {
    const btn = _iconBtns.get(icon.element)
    if (!btn) continue
    const kind = icon.candidate.matchedKind
    const hasValue = kind !== null && availableKinds.has(kind)
    btn.innerHTML = hasValue ? DV_ICON_GREEN : DV_ICON_GREY
    btn.className = hasValue ? 'dv-matched' : 'dv-unmatched'
  }
}

/**
 * Legacy convenience: set ALL icons green or grey based on a boolean.
 * Prefer `setDvIconMatchData()` for per-field color control.
 */
export function setDvProfileDataAvailable(available: boolean): void {
  if (available) {
    // Caller hasn't provided per-field data; mark all green
    for (const [, btn] of _iconBtns) {
      btn.innerHTML = DV_ICON_GREEN
    }
  } else {
    _availableKinds = new Set()
    for (const [, btn] of _iconBtns) {
      btn.innerHTML = DV_ICON_GREY
    }
  }
}

// ============================================================================
// §5  Icon Creation
// ============================================================================

function createDvIcon(
  element: HTMLElement,
  candidate: FieldCandidate,
): DvIconHandle | null {
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null

  const host = document.createElement('div')
  host.setAttribute('data-wrv-dv-icon', '')
  host.setAttribute('data-wrv-no-autofill', '')
  host.style.cssText = `
    position: fixed;
    z-index: 2147483644;
    pointer-events: auto;
    margin: 0;
    padding: 0;
  `
  const shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = `
    :host { all: initial; display: block; }
    button {
      all: unset;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      cursor: pointer;
      transition: opacity 0.15s ease, transform 0.1s ease;
      border-radius: 3px;
      background: transparent;
    }
    button.dv-matched {
      opacity: 1;
    }
    button.dv-unmatched {
      opacity: 0.55;
    }
    button:hover {
      opacity: 1;
      transform: scale(1.12);
      background: rgba(99, 102, 241, 0.08);
    }
    button:focus-visible {
      outline: 2px solid rgba(99, 102, 241, 0.5);
      outline-offset: 1px;
    }
  `

  // Determine initial color: green if active profile has value for this field
  const kind = candidate.matchedKind
  const hasValue = kind !== null && _availableKinds.has(kind)

  const btn = document.createElement('button')
  btn.className = hasValue ? 'dv-matched' : 'dv-unmatched'
  btn.setAttribute('aria-label', 'WRVault DataVault autofill')
  btn.setAttribute('tabindex', '-1')
  btn.setAttribute('type', 'button')
  btn.innerHTML = hasValue ? DV_ICON_GREEN : DV_ICON_GREY

  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    e.preventDefault()
    if (!e.isTrusted) return
    const btnRect = btn.getBoundingClientRect()
    _onClick?.(element, candidate, btnRect)
  }, { passive: false })

  shadow.appendChild(style)
  shadow.appendChild(btn)
  document.body.appendChild(host)

  _iconBtns.set(element, btn)

  positionDvIcon(host, element)

  return {
    element,
    host,
    candidate,
    remove: () => {
      host.remove()
      _iconBtns.delete(element)
    },
  }
}

// ============================================================================
// §6  Positioning
// ============================================================================

function positionDvIcon(host: HTMLElement, target: HTMLElement): void {
  const rect = target.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    host.style.display = 'none'
    return
  }
  host.style.display = ''

  // Position inside the field, on the right side, offset from the password icon
  // The password icon (if any) takes the rightmost position.  DataVault icon
  // goes 26px further left to avoid overlap.
  const hasPasswordIcon = target.hasAttribute('data-wrv-icon')
  const rightOffset = hasPasswordIcon ? 48 : 22
  const top = rect.top + (rect.height - 20) / 2
  const left = rect.right - rightOffset

  host.style.top = `${top}px`
  host.style.left = `${left}px`
}

function startPositionWatchdog(): void {
  if (_rafId !== null) return
  const tick = () => {
    reposAll()
    _rafId = requestAnimationFrame(tick)
  }
  _rafId = requestAnimationFrame(tick)
}

/**
 * Reposition all icons using the stored host reference.
 *
 * Each DvIconHandle now holds a direct `host` reference, so we don't need
 * a fragile querySelectorAll-based index correlation.
 */
function reposAll(): void {
  for (const icon of _icons) {
    if (!document.contains(icon.host)) continue
    positionDvIcon(icon.host, icon.element)
  }
}

function stopPositionWatchdog(): void {
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId)
    _rafId = null
  }
}
