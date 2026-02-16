// ============================================================================
// WRVault Autofill — QuickSelect (Manual Field Picker Dropdown)
// ============================================================================
//
// When auto-insert can't find a high-confidence match, QuickSelect provides
// a manual fallback: a searchable dropdown anchored to the focused input.
//
// Activation:
//   1. Trigger icon — small key/search icon shown near low-confidence fields
//   2. Keyboard shortcut — Ctrl+Shift+. (configurable)
//   3. Programmatic — quickSelectOpen() from orchestrator
//
// UX:
//   ┌──────────────────────────────┐
//   │ 🔍 Search vault...          │  ← search input
//   ├──────────────────────────────┤
//   │ ★ GitHub Login               │  ← domain match (highlighted)
//   │   user@github.com            │
//   ├──────────────────────────────┤
//   │   GitLab CI Token            │  ← global match
//   │   deploy-bot@gitlab.com      │
//   ├──────────────────────────────┤
//   │   Personal Email             │
//   │   john@example.com           │
//   └──────────────────────────────┘
//
// Selection flow:
//   User selects entry → overlay preview shown → consent → commit insert
//
// Accessibility:
//   - role="combobox" + role="listbox" pattern (ARIA 1.2)
//   - Arrow keys navigate, Enter selects, Esc closes
//   - Focus returns to the original input on close
//   - Screen reader announces: item count, selected item, domain match
//   - Does NOT trap focus on the page (input keeps focus; dropdown is aria-owned)
//
// Shadow DOM (mode: 'closed') for CSS isolation.
// ============================================================================

import { CSS_TOKENS } from './overlayStyles'
import {
  buildIndex,
  searchIndexFiltered,
  hasOriginMatches,
  isIndexStale,
} from './vaultIndex'
import type { SearchResult, IndexEntry } from './vaultIndex'
import { classifyRelevance, type RelevanceTier } from '../../../../../../packages/shared/src/vault/originPolicy'
import {
  guardElement,
  auditLog,
  emitTelemetryEvent,
  redactError,
} from './hardening'
import { haCheckSilent } from './haGuard'

// ============================================================================
// §1  Types
// ============================================================================

/** Result of a QuickSelect interaction. */
export type QuickSelectResult =
  | { action: 'selected'; entry: IndexEntry }
  | { action: 'dismissed' }

/** Options for opening QuickSelect. */
export interface QuickSelectOptions {
  /** The input element to anchor the dropdown to. */
  anchor: HTMLElement
  /** Current page domain for relevance sorting. */
  domain: string
}

// ============================================================================
// §2  State
// ============================================================================

let _host: HTMLElement | null = null
let _shadow: ShadowRoot | null = null
let _resolve: ((result: QuickSelectResult) => void) | null = null
let _rafId: number | null = null
let _activeIndex = -1 // Currently highlighted item index
let _results: SearchResult[] = []
let _anchor: HTMLElement | null = null
let _domain = ''
/** Whether to show global (cross-domain) entries. Default: false (strict origin). */
let _includeGlobal = false
/**
 * Whether the user has explicitly interacted (typed, clicked search).
 * Until this is true, no results are shown — only a prompt.
 * This prevents passive enumeration of vault contents.
 */
let _userHasInteracted = false
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null
let _clickOutsideHandler: ((e: MouseEvent) => void) | null = null

// ============================================================================
// §3  Trigger Icon
// ============================================================================

let _iconHost: HTMLElement | null = null
let _iconShadow: ShadowRoot | null = null
let _iconRafId: number | null = null

/**
 * Show the QuickSelect trigger icon near a field.
 *
 * Call this when a field has no high-confidence auto-match but the vault
 * is unlocked and has entries.
 *
 * @param anchor — the input element to anchor the icon to
 * @param onClick — callback when the icon is clicked
 */
export function showTriggerIcon(anchor: HTMLElement, onClick: () => void): void {
  hideTriggerIcon()

  _iconHost = document.createElement('div')
  _iconHost.setAttribute('data-wrv-qs-icon', '')
  _iconHost.style.cssText = 'position:absolute;z-index:2147483643;pointer-events:auto;'
  document.body.appendChild(_iconHost)
  _iconShadow = _iconHost.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = buildIconCSS()
  _iconShadow.appendChild(style)

  const btn = document.createElement('button')
  btn.className = 'wrv-qs-icon'
  btn.setAttribute('aria-label', 'Open WRVault QuickSelect')
  btn.setAttribute('title', 'Search vault (Ctrl+Shift+.)')
  btn.innerHTML = KEY_SVG
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    onClick()
  })
  _iconShadow.appendChild(btn)

  positionIcon(anchor)
  _iconRafId = requestAnimationFrame(function watchdog() {
    if (!_iconHost) return
    positionIcon(anchor)
    _iconRafId = requestAnimationFrame(watchdog)
  })
}

/** Hide the trigger icon. */
export function hideTriggerIcon(): void {
  if (_iconRafId) { cancelAnimationFrame(_iconRafId); _iconRafId = null }
  if (_iconHost) { _iconHost.remove(); _iconHost = null; _iconShadow = null }
}

function positionIcon(anchor: HTMLElement): void {
  if (!_iconHost) return
  const rect = anchor.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return

  _iconHost.style.position = 'fixed'
  _iconHost.style.top = `${rect.top + (rect.height / 2) - 12}px`
  _iconHost.style.left = `${rect.right - 28}px`

  // If the icon would be off-screen, place to the right of the field
  if (rect.right + 6 > window.innerWidth) {
    _iconHost.style.left = `${rect.right - 28}px`
  }
}

// ============================================================================
// §4  Dropdown — Open / Close
// ============================================================================

/**
 * Open the QuickSelect dropdown anchored to a field.
 *
 * Builds the vault index if stale, renders the dropdown, and returns
 * a promise that resolves when the user selects or dismisses.
 */
export async function quickSelectOpen(
  options: QuickSelectOptions,
): Promise<QuickSelectResult> {
  quickSelectClose()
  hideTriggerIcon()

  // ── Hardening: verify anchor element is safe ──
  const guard = guardElement(options.anchor)
  if (!guard.safe) {
    auditLog('warn', guard.code ?? 'ELEMENT_HIDDEN', `QuickSelect blocked: ${guard.reason}`)
    return { action: 'dismissed' }
  }

  _anchor = options.anchor
  _domain = options.domain
  _includeGlobal = false
  _userHasInteracted = false

  // Build index if needed
  if (isIndexStale()) {
    const built = await buildIndex()
    if (!built) {
      auditLog('warn', 'INDEX_BUILD_FAILED', 'QuickSelect: vault index could not be built')
    }
  }

  emitTelemetryEvent('quickselect_open', { domain: options.domain })

  return new Promise<QuickSelectResult>((resolve) => {
    _resolve = resolve
    renderDropdown()
  })
}

/**
 * Close the QuickSelect dropdown and clean up.
 */
export function quickSelectClose(): void {
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null }
  if (_host) { _host.remove(); _host = null; _shadow = null }
  if (_keydownHandler) {
    document.removeEventListener('keydown', _keydownHandler, true)
    _keydownHandler = null
  }
  if (_clickOutsideHandler) {
    document.removeEventListener('mousedown', _clickOutsideHandler, true)
    _clickOutsideHandler = null
  }
  _activeIndex = -1
  _results = []
  _anchor = null
}

/**
 * Whether the dropdown is currently open.
 */
export function quickSelectIsOpen(): boolean {
  return _host !== null
}

// ============================================================================
// §5  Dropdown — Rendering
// ============================================================================

function renderDropdown(): void {
  if (!_anchor) return

  _host = document.createElement('div')
  _host.setAttribute('data-wrv-quickselect', '')
  _host.style.cssText = 'position:absolute;z-index:2147483645;pointer-events:auto;'
  document.body.appendChild(_host)
  _shadow = _host.attachShadow({ mode: 'closed' })

  // Stylesheet
  const style = document.createElement('style')
  style.textContent = buildDropdownCSS()
  _shadow.appendChild(style)

  // Container
  const container = document.createElement('div')
  container.className = 'wrv-qs'
  container.setAttribute('role', 'combobox')
  container.setAttribute('aria-expanded', 'true')
  container.setAttribute('aria-haspopup', 'listbox')

  // Search input
  const searchRow = document.createElement('div')
  searchRow.className = 'wrv-qs-search'
  const searchIcon = document.createElement('span')
  searchIcon.className = 'wrv-qs-search-icon'
  searchIcon.innerHTML = SEARCH_SVG
  const searchInput = document.createElement('input')
  searchInput.className = 'wrv-qs-search-input'
  searchInput.type = 'text'
  searchInput.placeholder = 'Search vault...'
  searchInput.setAttribute('role', 'searchbox')
  searchInput.setAttribute('aria-label', 'Search vault entries')
  searchInput.setAttribute('aria-autocomplete', 'list')
  searchInput.setAttribute('aria-controls', 'wrv-qs-list')
  searchRow.appendChild(searchIcon)
  searchRow.appendChild(searchInput)
  container.appendChild(searchRow)

  // Results list
  const list = document.createElement('div')
  list.className = 'wrv-qs-list'
  list.id = 'wrv-qs-list'
  list.setAttribute('role', 'listbox')
  list.setAttribute('aria-label', 'Vault entries')
  container.appendChild(list)

  // Status bar
  const status = document.createElement('div')
  status.className = 'wrv-qs-status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')
  container.appendChild(status)

  _shadow.appendChild(container)

  // ── Initial state: show prompt, not results ──
  // No results are revealed until the user explicitly interacts.
  showInteractionPrompt(list, status)

  // Position
  positionDropdown()
  _rafId = requestAnimationFrame(function watchdog() {
    if (!_host) return
    positionDropdown()
    _rafId = requestAnimationFrame(watchdog)
  })

  // Focus search input
  setTimeout(() => searchInput.focus(), 30)

  // ── Event handling ──

  // Search-as-you-type — marks interaction on first keystroke
  searchInput.addEventListener('input', () => {
    if (!_userHasInteracted) {
      _userHasInteracted = true
      emitTelemetryEvent('quickselect_interaction', { type: 'type' })
    }
    _activeIndex = -1
    updateResults(searchInput.value, list, status)
  })

  // Keyboard navigation (capture on document so it works even when input has focus)
  _keydownHandler = (e: KeyboardEvent) => {
    if (!_host) return
    handleKeyDown(e, searchInput, list)
  }
  document.addEventListener('keydown', _keydownHandler, true)

  // Click outside to close
  _clickOutsideHandler = (e: MouseEvent) => {
    if (!_host) return
    const target = e.target as Node
    // Check if click is inside our shadow host
    if (_host.contains(target)) return
    resolveAndClose({ action: 'dismissed' })
  }
  // Delay to avoid catching the click that opened us
  setTimeout(() => {
    document.addEventListener('mousedown', _clickOutsideHandler!, true)
  }, 50)
}

function positionDropdown(): void {
  if (!_host || !_anchor) return
  const rect = _anchor.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return

  const dropdownHeight = 320
  const dropdownWidth = Math.min(360, Math.max(rect.width, 280))

  // Prefer below the field; flip above if not enough space
  const spaceBelow = window.innerHeight - rect.bottom
  const placeBelow = spaceBelow >= dropdownHeight || spaceBelow > rect.top

  _host.style.position = 'fixed'
  _host.style.width = `${dropdownWidth}px`
  _host.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - dropdownWidth - 4))}px`

  if (placeBelow) {
    _host.style.top = `${rect.bottom + 4}px`
    _host.style.bottom = ''
  } else {
    _host.style.top = ''
    _host.style.bottom = `${window.innerHeight - rect.top + 4}px`
  }
}

// ============================================================================
// §6  Results Update
// ============================================================================

/**
 * Show the initial interaction prompt.  No vault data is revealed until
 * the user types or clicks the search input.
 */
function showInteractionPrompt(list: HTMLElement, status: HTMLElement): void {
  list.innerHTML = ''
  const prompt = document.createElement('div')
  prompt.className = 'wrv-qs-prompt'

  const hasMatches = hasOriginMatches(_domain)
  prompt.textContent = hasMatches
    ? 'Type to search credentials for this site\u2026'
    : 'Type to search your vault\u2026'

  list.appendChild(prompt)
  status.textContent = ''
}

function updateResults(query: string, list: HTMLElement, status: HTMLElement): void {
  // ── Interaction gate ──
  // Until the user has explicitly interacted, show nothing.
  if (!_userHasInteracted) {
    showInteractionPrompt(list, status)
    return
  }

  // Use filtered search with interaction requirement enforced at index level
  _results = searchIndexFiltered(query.trim(), _domain, _includeGlobal, true, 20)
  _activeIndex = -1

  list.innerHTML = ''

  if (_results.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'wrv-qs-empty'
    empty.textContent = query ? 'No matching entries' : 'Type to search your vault\u2026'
    list.appendChild(empty)
    status.textContent = query ? 'No results' : ''

    // If we're hiding global entries and there are some, show the expander
    if (!_includeGlobal && query) {
      appendShowAllButton(list, query, status)
    }
    return
  }

  _results.forEach((result, i) => {
    const item = document.createElement('div')
    item.className = 'wrv-qs-item'
    item.setAttribute('role', 'option')
    item.setAttribute('aria-selected', 'false')
    item.id = `wrv-qs-item-${i}`
    item.dataset.index = String(i)

    // Classify relevance using strict origin matching
    const tier: RelevanceTier = classifyRelevance(
      result.entry.domain || undefined, _domain,
    )
    const badge = tier === 'exact_origin' || tier === 'www_equivalent'
      ? '<span class="wrv-qs-item-badge">This site</span>'
      : tier === 'subdomain' || tier === 'same_domain'
        ? '<span class="wrv-qs-item-badge wrv-qs-item-badge--related">Related</span>'
        : ''

    // Display MASKED username — the index only stores the masked form.
    // Full credentials are never visible until the overlay consent stage.
    const displayMeta = escapeHtml(
      result.entry.maskedUsername || result.entry.domain || result.entry.category
    )

    item.innerHTML = `
      <div class="wrv-qs-item-main">
        <span class="wrv-qs-item-icon">${result.entry.favorite ? STAR_SVG : categoryIcon(result.entry.category)}</span>
        <div class="wrv-qs-item-text">
          <span class="wrv-qs-item-title">${escapeHtml(result.entry.title)}</span>
          <span class="wrv-qs-item-meta">${displayMeta}</span>
        </div>
        ${badge}
      </div>
    `

    item.addEventListener('mouseenter', () => {
      setActiveItem(list, i)
    })
    item.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      selectItem(i)
    })

    list.appendChild(item)
  })

  // Show "Show all credentials" expander if global entries are hidden
  if (!_includeGlobal) {
    appendShowAllButton(list, query, status)
  }

  // Coarsened result count — don't reveal exact vault size
  const count = _results.length
  const coarsened = count <= 5 ? count : count <= 20 ? '10+' : '20+'
  status.textContent = `${coarsened} ${count === 1 ? 'entry' : 'entries'}`
}

/**
 * Append a "Show all credentials" button at the bottom of the list.
 * Requires the user to have already interacted (typed) — this is a
 * secondary action, not a way to passively enumerate.
 */
function appendShowAllButton(list: HTMLElement, query: string, status: HTMLElement): void {
  if (!_userHasInteracted) return
  // HA Mode: cross-domain expansion is blocked
  if (!haCheckSilent('cross_domain_expand')) return

  const btn = document.createElement('div')
  btn.className = 'wrv-qs-show-all'
  btn.setAttribute('role', 'button')
  btn.setAttribute('tabindex', '0')
  btn.textContent = 'Include other sites\u2026'
  btn.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    _includeGlobal = true
    updateResults(query, list, status)
    auditLog('info', 'QUICKSELECT_SHOW_ALL', 'User expanded to cross-domain results')
    emitTelemetryEvent('quickselect_show_all', { domain: _domain })
  })
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      _includeGlobal = true
      updateResults(query, list, status)
    }
  })
  list.appendChild(btn)
}

// ============================================================================
// §7  Keyboard Navigation
// ============================================================================

function handleKeyDown(e: KeyboardEvent, searchInput: HTMLInputElement, list: HTMLElement): void {
  switch (e.key) {
    case 'ArrowDown': {
      e.preventDefault()
      e.stopPropagation()
      const next = _activeIndex < _results.length - 1 ? _activeIndex + 1 : 0
      setActiveItem(list, next)
      scrollItemIntoView(list, next)
      // Update aria
      searchInput.setAttribute('aria-activedescendant', `wrv-qs-item-${next}`)
      break
    }
    case 'ArrowUp': {
      e.preventDefault()
      e.stopPropagation()
      const prev = _activeIndex > 0 ? _activeIndex - 1 : _results.length - 1
      setActiveItem(list, prev)
      scrollItemIntoView(list, prev)
      searchInput.setAttribute('aria-activedescendant', `wrv-qs-item-${prev}`)
      break
    }
    case 'Enter': {
      e.preventDefault()
      e.stopPropagation()
      if (_activeIndex >= 0 && _activeIndex < _results.length) {
        selectItem(_activeIndex)
      } else if (_results.length === 1) {
        selectItem(0)
      }
      break
    }
    case 'Escape': {
      e.preventDefault()
      e.stopPropagation()
      resolveAndClose({ action: 'dismissed' })
      break
    }
    case 'Tab': {
      // Allow Tab to close the dropdown and move focus normally
      resolveAndClose({ action: 'dismissed' })
      break
    }
  }
}

function setActiveItem(list: HTMLElement, index: number): void {
  // Deactivate previous
  const prev = list.querySelector('.wrv-qs-item--active')
  if (prev) {
    prev.classList.remove('wrv-qs-item--active')
    prev.setAttribute('aria-selected', 'false')
  }

  _activeIndex = index
  const item = list.querySelector(`#wrv-qs-item-${index}`)
  if (item) {
    item.classList.add('wrv-qs-item--active')
    item.setAttribute('aria-selected', 'true')
  }
}

function scrollItemIntoView(list: HTMLElement, index: number): void {
  const item = list.querySelector(`#wrv-qs-item-${index}`) as HTMLElement | null
  if (item) {
    item.scrollIntoView({ block: 'nearest' })
  }
}

function selectItem(index: number): void {
  if (index >= 0 && index < _results.length) {
    resolveAndClose({ action: 'selected', entry: _results[index].entry })
  }
}

// ============================================================================
// §8  Lifecycle
// ============================================================================

function resolveAndClose(result: QuickSelectResult): void {
  const resolve = _resolve
  _resolve = null

  // Telemetry — only log item ID and category, never title or username
  if (result.action === 'selected') {
    emitTelemetryEvent('quickselect_select', {
      itemId: result.entry.itemId,
      category: result.entry.category,
    })
    auditLog('info', 'QUICKSELECT_SELECTED', `User selected entry: [${result.entry.category}:${result.entry.itemId.slice(0, 8)}]`)
  } else {
    emitTelemetryEvent('quickselect_dismiss', {})
  }

  const anchor = _anchor
  quickSelectClose()

  // Return focus to the original anchor
  if (anchor) {
    try { anchor.focus() } catch { /* noop */ }
  }

  resolve?.(result)
}

// ============================================================================
// §9  Global Keyboard Shortcut
// ============================================================================

let _shortcutHandler: ((e: KeyboardEvent) => void) | null = null
let _shortcutCallback: (() => void) | null = null

/**
 * Register the global keyboard shortcut (Ctrl+Shift+.) to open QuickSelect.
 *
 * @param callback — called when the shortcut is pressed.  The callback
 *   receives no arguments; the orchestrator should determine the focused
 *   field and call quickSelectOpen().
 *
 * Returns an unsubscribe function.
 */
export function registerShortcut(callback: () => void): () => void {
  unregisterShortcut()
  _shortcutCallback = callback
  _shortcutHandler = (e: KeyboardEvent) => {
    // Ctrl+Shift+. (or Cmd+Shift+. on Mac)
    if (e.key === '.' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      _shortcutCallback?.()
    }
  }
  document.addEventListener('keydown', _shortcutHandler, true)
  return unregisterShortcut
}

/** Unregister the global keyboard shortcut. */
export function unregisterShortcut(): void {
  if (_shortcutHandler) {
    document.removeEventListener('keydown', _shortcutHandler, true)
    _shortcutHandler = null
  }
  _shortcutCallback = null
}

// ============================================================================
// §10  SVG Icons
// ============================================================================

const KEY_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 11-7.778 7.778 5.5 5.5 0 017.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>`

const SEARCH_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`

const STAR_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`

function categoryIcon(category: string): string {
  switch (category) {
    case 'password':
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`
    case 'identity':
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`
    case 'company':
    case 'business':
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16"/></svg>`
    default:
      return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
  }
}

// ============================================================================
// §11  CSS
// ============================================================================

function buildIconCSS(): string {
  const t = CSS_TOKENS
  return `
    :host { all: initial; }
    .wrv-qs-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 4px;
      border: 1px solid ${t['--wrv-overlay-border']};
      background: ${t['--wrv-overlay-bg']};
      color: ${t['--wrv-text-secondary']};
      cursor: pointer;
      transition: all 0.15s;
      opacity: 0.7;
    }
    .wrv-qs-icon:hover {
      opacity: 1;
      color: ${t['--wrv-accent']};
      border-color: ${t['--wrv-overlay-border-focus']};
      background: ${t['--wrv-overlay-bg-hover']};
    }
    .wrv-qs-icon:focus-visible {
      outline: 2px solid ${t['--wrv-accent']};
      outline-offset: 2px;
      opacity: 1;
    }
  `
}

function buildDropdownCSS(): string {
  const t = CSS_TOKENS
  return `
    :host { all: initial; }

    .wrv-qs {
      background: ${t['--wrv-overlay-bg']};
      border: 1px solid ${t['--wrv-overlay-border']};
      border-radius: ${t['--wrv-overlay-radius']};
      box-shadow: ${t['--wrv-overlay-shadow']};
      font-family: ${t['--wrv-font-family']};
      color: ${t['--wrv-text-primary']};
      overflow: hidden;
      animation: wrv-qs-in ${t['--wrv-anim-duration']} ${t['--wrv-anim-easing']};
    }

    /* ── Search bar ── */
    .wrv-qs-search {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      border-bottom: 1px solid ${t['--wrv-field-border']};
    }
    .wrv-qs-search-icon {
      color: ${t['--wrv-text-muted']};
      flex-shrink: 0;
      display: flex;
    }
    .wrv-qs-search-input {
      flex: 1;
      background: transparent;
      border: none;
      color: ${t['--wrv-text-primary']};
      font-size: ${t['--wrv-font-size-base']};
      font-family: ${t['--wrv-font-family']};
      outline: none;
      padding: 0;
      min-width: 0;
    }
    .wrv-qs-search-input::placeholder {
      color: ${t['--wrv-text-muted']};
    }

    /* ── Results list ── */
    .wrv-qs-list {
      max-height: 240px;
      overflow-y: auto;
      padding: 4px 0;
      scrollbar-width: thin;
      scrollbar-color: ${t['--wrv-field-border']} transparent;
    }

    .wrv-qs-item {
      padding: 8px 12px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .wrv-qs-item:hover,
    .wrv-qs-item--active {
      background: ${t['--wrv-field-bg-hover']};
    }
    .wrv-qs-item--active {
      outline: none;
    }

    .wrv-qs-item-main {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .wrv-qs-item-icon {
      color: ${t['--wrv-text-muted']};
      flex-shrink: 0;
      display: flex;
      width: 18px;
      justify-content: center;
    }
    .wrv-qs-item--active .wrv-qs-item-icon,
    .wrv-qs-item:hover .wrv-qs-item-icon {
      color: ${t['--wrv-accent']};
    }

    .wrv-qs-item-text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .wrv-qs-item-title {
      font-size: ${t['--wrv-font-size-base']};
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wrv-qs-item-meta {
      font-size: ${t['--wrv-font-size-sm']};
      color: ${t['--wrv-text-muted']};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .wrv-qs-item-badge {
      font-size: 10px;
      background: rgba(99, 102, 241, 0.18);
      color: ${t['--wrv-accent']};
      padding: 2px 6px;
      border-radius: 4px;
      flex-shrink: 0;
      font-weight: 500;
    }

    /* ── Interaction prompt (shown before user types) ── */
    .wrv-qs-prompt {
      padding: 24px 16px;
      text-align: center;
      color: ${t['--wrv-text-muted']};
      font-size: ${t['--wrv-font-size-base']};
      font-style: italic;
      line-height: 1.4;
    }

    /* ── Empty state ── */
    .wrv-qs-empty {
      padding: 20px 12px;
      text-align: center;
      color: ${t['--wrv-text-muted']};
      font-size: ${t['--wrv-font-size-base']};
    }

    /* ── Show all / include other sites button ── */
    .wrv-qs-show-all {
      padding: 10px 12px;
      text-align: center;
      color: ${t['--wrv-accent']};
      font-size: ${t['--wrv-font-size-sm']};
      cursor: pointer;
      border-top: 1px solid ${t['--wrv-field-border']};
      transition: background 0.1s;
    }
    .wrv-qs-show-all:hover {
      background: ${t['--wrv-field-bg-hover']};
    }
    .wrv-qs-show-all:focus-visible {
      outline: 2px solid ${t['--wrv-accent']};
      outline-offset: -2px;
    }

    .wrv-qs-item-badge--related {
      background: rgba(245, 158, 11, 0.18);
      color: #b45309;
    }

    /* ── Status bar ── */
    .wrv-qs-status {
      padding: 6px 12px;
      border-top: 1px solid ${t['--wrv-field-border']};
      font-size: ${t['--wrv-font-size-sm']};
      color: ${t['--wrv-text-muted']};
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    /* ── Animation ── */
    @keyframes wrv-qs-in {
      from { opacity: 0; transform: translateY(-4px) scale(0.98); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }
    @media (prefers-reduced-motion: reduce) {
      .wrv-qs { animation: none; }
    }
  `
}

// ============================================================================
// §12  Helpers
// ============================================================================

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
