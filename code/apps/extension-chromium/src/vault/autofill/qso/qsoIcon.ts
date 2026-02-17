// ============================================================================
// WRVault Autofill — QSO Icon (Shadow DOM UI)
// ============================================================================
//
// Renders a small clickable icon near login forms.  The icon is anchored
// to the password field (or username if no password field).
//
// Visual states:
//   - "active" (colored): EXACT_MATCH — one-click fill+submit ready
//   - "neutral" (gray):   HAS_CANDIDATES — picker will open on click
//   - "disabled" (red):   BLOCKED — tooltip explains reason
//
// The icon lives inside a closed Shadow DOM to prevent page interference.
// Click events are validated for isTrusted before invoking any action.
// ============================================================================

import type { QsoState } from './qsoEngine'

// ============================================================================
// §1  Types
// ============================================================================

export type QsoIconVisualState = 'active' | 'neutral' | 'disabled'

export interface QsoIconHandle {
  /** Remove the icon from the DOM and clean up. */
  remove: () => void
  /** Update visual state without rebuilding. */
  updateState: (state: QsoIconVisualState) => void
  /** The host element (for positioning reference). */
  host: HTMLElement
}

export type QsoIconClickHandler = (e: MouseEvent) => void

// ============================================================================
// §2  State
// ============================================================================

let _activeIcon: QsoIconHandle | null = null
let _positionRaf: number | null = null

// ============================================================================
// §3  Public API
// ============================================================================

/**
 * Show the QSO icon anchored to the given element (typically a password field).
 *
 * Replaces any existing QSO icon (singleton pattern).
 */
export function showQsoIcon(
  anchor: HTMLElement,
  visualState: QsoIconVisualState,
  onClick: QsoIconClickHandler,
): QsoIconHandle {
  // Remove existing icon
  hideQsoIcon()

  // Create host
  const host = document.createElement('div')
  host.id = 'wrv-qso-icon'
  host.setAttribute('data-wrv-qso', 'true')
  host.style.cssText = 'position:fixed;z-index:2147483644;pointer-events:auto;'

  const shadow = host.attachShadow({ mode: 'closed' })

  // Styles
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(buildIconCSS())
  shadow.adoptedStyleSheets = [sheet]

  // Icon button
  const btn = document.createElement('button')
  btn.className = `wrv-qso-btn wrv-qso-${visualState}`
  btn.setAttribute('aria-label', 'Quick Sign-On')
  btn.setAttribute('title', getTooltip(visualState))
  btn.innerHTML = QSO_SVG
  btn.tabIndex = -1

  // Click handler — validates isTrusted (hard gate)
  btn.addEventListener('click', (e: MouseEvent) => {
    if (!e.isTrusted) {
      // Swallow untrusted clicks silently — audit emitted by engine layer
      e.preventDefault()
      e.stopImmediatePropagation()
      return
    }
    onClick(e)
  }, { capture: true })

  // Prevent page from capturing our clicks
  btn.addEventListener('mousedown', (e) => { e.stopPropagation() }, { capture: true })
  btn.addEventListener('pointerdown', (e) => { e.stopPropagation() }, { capture: true })

  shadow.appendChild(btn)
  document.documentElement.appendChild(host)

  // Position near anchor
  positionIcon(host, anchor)

  // Position watchdog (rAF loop)
  function watchdog() {
    if (!host.isConnected || !anchor.isConnected) {
      hideQsoIcon()
      return
    }
    positionIcon(host, anchor)
    _positionRaf = requestAnimationFrame(watchdog)
  }
  _positionRaf = requestAnimationFrame(watchdog)

  const handle: QsoIconHandle = {
    host,
    remove: () => {
      if (_positionRaf !== null) {
        cancelAnimationFrame(_positionRaf)
        _positionRaf = null
      }
      host.remove()
      if (_activeIcon === handle) _activeIcon = null
    },
    updateState: (newState: QsoIconVisualState) => {
      btn.className = `wrv-qso-btn wrv-qso-${newState}`
      btn.setAttribute('title', getTooltip(newState))
    },
  }

  _activeIcon = handle
  return handle
}

/** Remove the active QSO icon. */
export function hideQsoIcon(): void {
  if (_activeIcon) {
    _activeIcon.remove()
    _activeIcon = null
  }
}

/** Whether a QSO icon is currently displayed. */
export function isQsoIconVisible(): boolean {
  return _activeIcon !== null && _activeIcon.host.isConnected
}

/** Map QSO state to visual icon state. */
export function qsoStateToVisual(state: QsoState): QsoIconVisualState {
  switch (state.status) {
    case 'EXACT_MATCH': return 'active'
    case 'HAS_CANDIDATES': return 'neutral'
    case 'NONE':
    case 'BLOCKED':
    default: return 'disabled'
  }
}

// ============================================================================
// §4  Positioning
// ============================================================================

function positionIcon(host: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return

  // Position to the left of the field, vertically centered
  const iconSize = 24
  const gap = 4
  const top = rect.top + (rect.height - iconSize) / 2
  const left = rect.left - iconSize - gap

  // If left is negative (not enough space), position inside the field on the right
  if (left < 0) {
    host.style.top = `${top}px`
    host.style.left = `${rect.right - iconSize - gap}px`
  } else {
    host.style.top = `${top}px`
    host.style.left = `${left}px`
  }
}

// ============================================================================
// §5  Visual Assets
// ============================================================================

function getTooltip(state: QsoIconVisualState): string {
  switch (state) {
    case 'active': return 'Quick Sign-On — click to fill and sign in'
    case 'neutral': return 'Quick Sign-On — click to choose credentials'
    case 'disabled': return 'Quick Sign-On unavailable'
  }
}

const QSO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>`

function buildIconCSS(): string {
  return `
:host { all: initial; display: block; }
.wrv-qso-btn {
  all: unset;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s, box-shadow 0.15s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.12);
  background: #fff;
  border: 1px solid #ddd;
}
.wrv-qso-btn:hover {
  box-shadow: 0 2px 6px rgba(0,0,0,0.18);
}
.wrv-qso-btn:focus-visible {
  outline: 2px solid #4f8cff;
  outline-offset: 1px;
}
.wrv-qso-active {
  color: #2563eb;
  border-color: #2563eb;
  background: #eff6ff;
}
.wrv-qso-active:hover {
  background: #dbeafe;
}
.wrv-qso-neutral {
  color: #6b7280;
  border-color: #d1d5db;
  background: #f9fafb;
}
.wrv-qso-neutral:hover {
  background: #f3f4f6;
}
.wrv-qso-disabled {
  color: #dc2626;
  border-color: #fecaca;
  background: #fef2f2;
  cursor: not-allowed;
  opacity: 0.7;
}
`
}
