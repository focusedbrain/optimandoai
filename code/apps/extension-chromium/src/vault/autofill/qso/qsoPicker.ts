// ============================================================================
// WRVault Autofill — QSO Picker (Shadow DOM UI)
// ============================================================================
//
// A small dropdown anchored to the QSO icon that shows available vault
// candidates for the current login form.  The user can search and select
// an item, which triggers fill+submit via the QSO engine.
//
// Renders inside a closed Shadow DOM for page isolation.
// ============================================================================

import type { QsoCandidate } from './qsoEngine'

// ============================================================================
// §1  Types
// ============================================================================

export interface QsoPickerHandle {
  remove: () => void
  host: HTMLElement
}

export type QsoPickerSelectHandler = (candidate: QsoCandidate, e: MouseEvent) => void

// ============================================================================
// §2  State
// ============================================================================

let _activePicker: QsoPickerHandle | null = null

// ============================================================================
// §3  Public API
// ============================================================================

/**
 * Show the QSO picker anchored to the given element.
 *
 * Replaces any existing picker (singleton pattern).
 */
export function showQsoPicker(
  anchor: HTMLElement,
  candidates: QsoCandidate[],
  onSelect: QsoPickerSelectHandler,
): QsoPickerHandle {
  hideQsoPicker()

  const host = document.createElement('div')
  host.id = 'wrv-qso-picker'
  host.setAttribute('data-wrv-qso-picker', 'true')
  host.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:auto;'

  const shadow = host.attachShadow({ mode: 'closed' })

  // Styles
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(buildPickerCSS())
  shadow.adoptedStyleSheets = [sheet]

  // Container
  const container = document.createElement('div')
  container.className = 'wrv-qso-picker'

  // Search input
  const searchInput = document.createElement('input')
  searchInput.className = 'wrv-qso-search'
  searchInput.type = 'text'
  searchInput.placeholder = 'Search credentials...'
  searchInput.setAttribute('autocomplete', 'off')
  container.appendChild(searchInput)

  // List
  const listEl = document.createElement('div')
  listEl.className = 'wrv-qso-list'
  listEl.setAttribute('role', 'listbox')

  let filteredCandidates = [...candidates]
  let selectedIndex = 0

  function renderList() {
    listEl.innerHTML = ''
    if (filteredCandidates.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'wrv-qso-empty'
      empty.textContent = 'No matching credentials'
      listEl.appendChild(empty)
      return
    }

    filteredCandidates.forEach((c, i) => {
      const row = document.createElement('div')
      row.className = `wrv-qso-item${i === selectedIndex ? ' wrv-qso-selected' : ''}`
      row.setAttribute('role', 'option')
      row.setAttribute('data-index', String(i))

      const title = document.createElement('span')
      title.className = 'wrv-qso-item-title'
      title.textContent = c.title

      const domain = document.createElement('span')
      domain.className = 'wrv-qso-item-domain'
      domain.textContent = c.domain ?? ''

      const badge = document.createElement('span')
      badge.className = 'wrv-qso-item-badge'
      if (c.originTier === 'exact') {
        badge.textContent = 'Exact'
        badge.classList.add('wrv-qso-badge-exact')
      } else if (c.originTier === 'www_equivalent') {
        badge.textContent = 'www'
        badge.classList.add('wrv-qso-badge-www')
      }

      row.appendChild(title)
      row.appendChild(domain)
      if (badge.textContent) row.appendChild(badge)

      row.addEventListener('click', (e: MouseEvent) => {
        if (!e.isTrusted) return
        onSelect(c, e)
        hideQsoPicker()
      }, { capture: true })

      row.addEventListener('mousedown', (e) => { e.stopPropagation() }, { capture: true })

      listEl.appendChild(row)
    })
  }

  renderList()
  container.appendChild(listEl)

  // Search filtering
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim()
    filteredCandidates = q
      ? candidates.filter(c =>
          c.title.toLowerCase().includes(q) ||
          (c.domain ?? '').toLowerCase().includes(q))
      : [...candidates]
    selectedIndex = 0
    renderList()
  })

  // Keyboard navigation
  searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      selectedIndex = Math.min(selectedIndex + 1, filteredCandidates.length - 1)
      renderList()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectedIndex = Math.max(selectedIndex - 1, 0)
      renderList()
    } else if (e.key === 'Enter' && filteredCandidates.length > 0) {
      e.preventDefault()
      if (!e.isTrusted) return
      onSelect(filteredCandidates[selectedIndex], e as unknown as MouseEvent)
      hideQsoPicker()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      hideQsoPicker()
    }
  })

  shadow.appendChild(container)
  document.documentElement.appendChild(host)

  // Position below the anchor
  const anchorRect = anchor.getBoundingClientRect()
  host.style.top = `${anchorRect.bottom + 4}px`
  host.style.left = `${anchorRect.left}px`

  // Focus search
  searchInput.focus()

  // Dismiss on outside click
  const dismissHandler = (e: MouseEvent) => {
    if (host.contains(e.target as Node)) return
    hideQsoPicker()
  }
  setTimeout(() => document.addEventListener('click', dismissHandler, { capture: true }), 0)

  const handle: QsoPickerHandle = {
    host,
    remove: () => {
      document.removeEventListener('click', dismissHandler, { capture: true })
      host.remove()
      if (_activePicker === handle) _activePicker = null
    },
  }

  _activePicker = handle
  return handle
}

/** Hide the active QSO picker. */
export function hideQsoPicker(): void {
  if (_activePicker) {
    _activePicker.remove()
    _activePicker = null
  }
}

/** Whether the QSO picker is currently visible. */
export function isQsoPickerVisible(): boolean {
  return _activePicker !== null && _activePicker.host.isConnected
}

// ============================================================================
// §4  Styles
// ============================================================================

function buildPickerCSS(): string {
  return `
:host { all: initial; display: block; }
.wrv-qso-picker {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  width: 280px;
  max-height: 320px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
}
.wrv-qso-search {
  all: unset;
  box-sizing: border-box;
  width: 100%;
  padding: 8px 12px;
  border-bottom: 1px solid #e5e7eb;
  font-size: 13px;
  color: #111827;
}
.wrv-qso-search::placeholder {
  color: #9ca3af;
}
.wrv-qso-list {
  overflow-y: auto;
  max-height: 260px;
}
.wrv-qso-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  cursor: pointer;
  transition: background 0.1s;
}
.wrv-qso-item:hover, .wrv-qso-selected {
  background: #f3f4f6;
}
.wrv-qso-item-title {
  flex: 1;
  font-weight: 500;
  color: #111827;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.wrv-qso-item-domain {
  color: #9ca3af;
  font-size: 11px;
  flex-shrink: 0;
}
.wrv-qso-item-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  font-weight: 600;
  flex-shrink: 0;
}
.wrv-qso-badge-exact {
  background: #dcfce7;
  color: #166534;
}
.wrv-qso-badge-www {
  background: #dbeafe;
  color: #1e40af;
}
.wrv-qso-empty {
  padding: 16px 12px;
  text-align: center;
  color: #9ca3af;
}
`
}
