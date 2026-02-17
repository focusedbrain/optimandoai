// ============================================================================
// WRVault QSO Remap — Icons (Shadow DOM UI)
// ============================================================================
//
// Renders small, unobtrusive icons near the login form submit button:
//   - "Add & Map" icon (+/key): no vault credential for this origin
//   - "Remap" icon (wrench): credential exists but mapping invalid
//
// Icons use closed Shadow DOM, absolute overlay positioning (no layout shift),
// and require isTrusted click to trigger any action.
//
// Security contract:
//   - No DOM writes to page inputs.
//   - isTrusted validated on every click.
//   - Untrusted events are swallowed with preventDefault + stopImmediatePropagation.
//   - DOM stability validated before invoking action callback.
// ============================================================================

import { guardElement, auditLogSafe } from '../hardening'
import { isHAEnforced } from '../haGuard'

// ============================================================================
// §1  Types
// ============================================================================

export type RemapIconMode = 'add_map' | 'remap'

export interface RemapIconHandle {
  remove: () => void
  host: HTMLElement
  mode: RemapIconMode
  updateMode: (mode: RemapIconMode) => void
}

export type RemapIconClickHandler = (e: MouseEvent, mode: RemapIconMode) => void

// ============================================================================
// §2  State
// ============================================================================

let _activeRemapIcon: RemapIconHandle | null = null
let _positionRaf: number | null = null

// ============================================================================
// §3  Public API
// ============================================================================

/**
 * Show the remap icon near the given anchor element (typically the submit button).
 *
 * Singleton: replaces any existing remap icon.
 * Does NOT shift layout — uses fixed positioning over the page.
 */
export function showRemapIcon(
  anchor: HTMLElement,
  mode: RemapIconMode,
  onClick: RemapIconClickHandler,
): RemapIconHandle {
  hideRemapIcon()

  const host = document.createElement('div')
  host.id = 'wrv-remap-icon'
  host.setAttribute('data-wrv-remap', 'true')
  host.style.cssText = 'position:fixed;z-index:2147483643;pointer-events:auto;'

  const shadow = host.attachShadow({ mode: 'closed' })

  const sheet = new CSSStyleSheet()
  sheet.replaceSync(buildRemapCSS())
  shadow.adoptedStyleSheets = [sheet]

  const btn = document.createElement('button')
  let currentMode = mode
  applyMode(btn, currentMode)

  // Snapshot anchor rect at icon creation for stability check
  const anchorRectAtCreate = anchor.getBoundingClientRect()

  btn.addEventListener('click', (e: MouseEvent) => {
    if (!e.isTrusted) {
      e.preventDefault()
      e.stopImmediatePropagation()
      auditLogSafe(
        isHAEnforced() ? 'security' : 'warn',
        'QSO_REMAP_REJECT_UNTRUSTED',
        'Remap icon rejected: untrusted click',
        { ha: isHAEnforced(), op: 'remap' },
      )
      return
    }

    // DOM stability check: verify anchor hasn't been heavily mutated
    const currentRect = anchor.getBoundingClientRect()
    const dx = Math.abs(currentRect.left - anchorRectAtCreate.left)
    const dy = Math.abs(currentRect.top - anchorRectAtCreate.top)
    if (dx > 100 || dy > 100 || !anchor.isConnected) {
      auditLogSafe(
        isHAEnforced() ? 'security' : 'warn',
        'QSO_REMAP_DOM_SHIFTED',
        'Remap icon aborted: anchor DOM shifted',
        { ha: isHAEnforced(), op: 'remap' },
      )
      return
    }

    // guardElement check on the anchor
    const guard = guardElement(anchor)
    if (!guard.safe) {
      auditLogSafe(
        isHAEnforced() ? 'security' : 'warn',
        'QSO_REMAP_GUARD_FAILED',
        'Remap icon aborted: anchor guard failed',
        { ha: isHAEnforced(), op: 'remap' },
      )
      return
    }

    onClick(e, currentMode)
  }, { capture: true })

  btn.addEventListener('mousedown', (e) => { e.stopPropagation() }, { capture: true })
  btn.addEventListener('pointerdown', (e) => { e.stopPropagation() }, { capture: true })

  shadow.appendChild(btn)
  document.documentElement.appendChild(host)

  positionNearAnchor(host, anchor)

  // Position watchdog (rAF loop)
  function watchdog() {
    if (!host.isConnected || !anchor.isConnected) {
      hideRemapIcon()
      return
    }
    positionNearAnchor(host, anchor)
    _positionRaf = requestAnimationFrame(watchdog)
  }
  _positionRaf = requestAnimationFrame(watchdog)

  const handle: RemapIconHandle = {
    host,
    mode: currentMode,
    remove: () => {
      if (_positionRaf !== null) {
        cancelAnimationFrame(_positionRaf)
        _positionRaf = null
      }
      host.remove()
      if (_activeRemapIcon === handle) _activeRemapIcon = null
    },
    updateMode: (newMode: RemapIconMode) => {
      currentMode = newMode
      handle.mode = newMode
      applyMode(btn, newMode)
    },
  }

  _activeRemapIcon = handle
  return handle
}

/** Remove the active remap icon. */
export function hideRemapIcon(): void {
  if (_activeRemapIcon) {
    _activeRemapIcon.remove()
    _activeRemapIcon = null
  }
}

/** Whether a remap icon is currently visible. */
export function isRemapIconVisible(): boolean {
  return _activeRemapIcon !== null && _activeRemapIcon.host.isConnected
}

/** Get the current remap icon mode, or null if hidden. */
export function getRemapIconMode(): RemapIconMode | null {
  return _activeRemapIcon?.mode ?? null
}

// ============================================================================
// §4  Positioning
// ============================================================================

/** Position the icon to the right of the anchor element (submit button). */
function positionNearAnchor(host: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return

  const iconSize = 22
  const gap = 6
  const top = rect.top + (rect.height - iconSize) / 2
  const left = rect.right + gap

  // If right side overflows viewport, position to the left
  if (left + iconSize > window.innerWidth) {
    host.style.top = `${top}px`
    host.style.left = `${rect.left - iconSize - gap}px`
  } else {
    host.style.top = `${top}px`
    host.style.left = `${left}px`
  }
}

// ============================================================================
// §5  Visual Assets
// ============================================================================

function applyMode(btn: HTMLButtonElement, mode: RemapIconMode): void {
  btn.className = `wrv-remap-btn wrv-remap-${mode}`
  btn.innerHTML = mode === 'add_map' ? SVG_ADD_MAP : SVG_REMAP
  btn.setAttribute('aria-label', mode === 'add_map' ? 'Add & map credentials' : 'Remap for this site')
  btn.setAttribute('title', mode === 'add_map' ? 'Add & map credentials' : 'Remap for this site')
  btn.tabIndex = -1
}

// Small key/plus icon for Add & Map
const SVG_ADD_MAP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 2.5a3.5 3.5 0 0 1 0 7h-1l-2 2H8v1.5H6.5V14.5H5v-2l4.5-4.5v-1a3.5 3.5 0 0 1 3-4.5z"/><circle cx="13" cy="5.5" r="0.75" fill="currentColor" stroke="none"/><line x1="15" y1="15" x2="15" y2="11"/><line x1="13" y1="13" x2="17" y2="13"/></svg>`

// Small wrench icon for Remap
const SVG_REMAP = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 3a4 4 0 0 0-3.9 4.9L4 14.5 5.5 16l6.6-6.6A4 4 0 1 0 14.5 3z"/></svg>`

function buildRemapCSS(): string {
  return `
:host { all: initial; display: block; }
.wrv-remap-btn {
  all: unset;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s, box-shadow 0.15s, opacity 0.15s;
  box-shadow: 0 1px 3px rgba(0,0,0,0.10);
  background: #fff;
  border: 1px solid #e5e7eb;
  opacity: 0.7;
}
.wrv-remap-btn:hover {
  opacity: 1;
  box-shadow: 0 2px 6px rgba(0,0,0,0.16);
}
.wrv-remap-btn:focus-visible {
  outline: 2px solid #4f8cff;
  outline-offset: 1px;
  opacity: 1;
}
.wrv-remap-add_map {
  color: #059669;
  border-color: #a7f3d0;
}
.wrv-remap-add_map:hover {
  background: #ecfdf5;
}
.wrv-remap-remap {
  color: #d97706;
  border-color: #fde68a;
}
.wrv-remap-remap:hover {
  background: #fffbeb;
}
`
}
