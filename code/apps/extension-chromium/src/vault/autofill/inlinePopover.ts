// ============================================================================
// WRVault Autofill — Inline Popover (Auto/Manual Toggle Dropdown)
// ============================================================================
//
// The primary user-facing UI for autofill. Shown when the user clicks
// a WRVault field icon inside a form field.
//
// UX:
//   ┌───────────────────────────────────────┐
//   │  🛡 WRVault          ○ Auto ● Manual  │  ← header + mode toggle
//   ├───────────────────────────────────────┤
//   │  🔍 Search vault...                   │  ← search (Manual mode)
//   ├───────────────────────────────────────┤
//   │  ★ Facebook Login          This site  │  ← domain match
//   │    oscarschreyer@web.de               │
//   ├───────────────────────────────────────┤
//   │    Gmail Login                        │  ← other entry
//   │    oscarschreyer@gmail.com            │
//   ├───────────────────────────────────────┤
//   │            Open Password Manager →    │  ← footer action
//   └───────────────────────────────────────┘
//
// Modes:
//   Auto:   Show domain matches. Click = instant fill of all matched fields.
//   Manual: Show search + all entries. Click = fill selected entry.
//
// Shadow DOM (mode: 'closed') for CSS isolation.
// ============================================================================

import { CSS_TOKENS } from './overlayStyles'
import * as vaultAPI from '../api'
import type { VaultItem, Field } from '../types'
import type { FieldCandidate } from '../../../../../packages/shared/src/vault/insertionPipeline'
import { setValueSafely, setPopoverFillActive } from './committer'
import { auditLog, emitTelemetryEvent } from './hardening'
import { areWritesDisabled } from './writesKillSwitch'

// ============================================================================
// §1  Types
// ============================================================================

export interface PopoverOptions {
  /** The input field the popover is anchored to. */
  anchorElement: HTMLElement
  /** The candidate info for this field. */
  candidate: FieldCandidate
  /** All candidates on the current page (for multi-field fill). */
  allCandidates: FieldCandidate[]
  /** Approximate rect of the icon that was clicked. */
  iconRect: DOMRect
}

export type PopoverResult =
  | { action: 'filled'; itemId: string; fieldCount: number }
  | { action: 'dismissed' }
  | { action: 'open_manager' }

type FillMode = 'auto' | 'manual'

// ============================================================================
// §2  State
// ============================================================================

let _host: HTMLElement | null = null
let _shadow: ShadowRoot | null = null
let _resolve: ((result: PopoverResult) => void) | null = null
let _rafId: number | null = null
let _options: PopoverOptions | null = null
let _mode: FillMode = 'auto'
let _items: VaultItem[] = []
let _filteredItems: VaultItem[] = []
let _loading = true
let _searchQuery = ''
let _clickOutsideHandler: ((e: MouseEvent) => void) | null = null
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null
let _activeIndex = -1

// Persist mode across opens
let _persistedMode: FillMode = 'auto'

// ============================================================================
// §3  Public API
// ============================================================================

/**
 * Show the inline popover anchored to a field icon.
 *
 * Returns a promise that resolves when the user interacts (fill, dismiss, or open manager).
 */
export function showPopover(options: PopoverOptions): Promise<PopoverResult> {
  hidePopover()
  _options = options
  _mode = _persistedMode
  _items = []
  _filteredItems = []
  _loading = true
  _searchQuery = ''
  _activeIndex = -1

  return new Promise<PopoverResult>((resolve) => {
    _resolve = resolve
    renderPopover()
    loadVaultItems()
  })
}

/**
 * Dismiss the popover if open.
 */
export function hidePopover(): void {
  if (_resolve) {
    const r = _resolve
    _resolve = null
    cleanupPopover()
    r({ action: 'dismissed' })
  } else {
    cleanupPopover()
  }
}

/**
 * Whether the popover is currently visible.
 */
export function isPopoverVisible(): boolean {
  return _host !== null
}

// ============================================================================
// §4  Rendering
// ============================================================================

function renderPopover(): void {
  if (!_options) return

  _host = document.createElement('div')
  _host.setAttribute('data-wrv-popover', '')
  _host.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:auto;'
  document.documentElement.appendChild(_host)
  _shadow = _host.attachShadow({ mode: 'closed' })

  // Styles
  const style = document.createElement('style')
  style.textContent = buildPopoverCSS()
  _shadow.appendChild(style)

  // Container
  const container = document.createElement('div')
  container.className = 'wrv-pop'
  container.setAttribute('role', 'dialog')
  container.setAttribute('aria-label', 'WRVault autofill')

  // Header
  container.appendChild(buildHeader())

  // Search bar (visible in manual mode)
  container.appendChild(buildSearchBar())

  // Items list
  const list = document.createElement('div')
  list.className = 'wrv-pop-list'
  list.setAttribute('role', 'listbox')
  list.setAttribute('aria-label', 'Vault entries')
  container.appendChild(list)

  // Footer
  container.appendChild(buildFooter())

  _shadow.appendChild(container)

  // Position
  positionPopover()
  _rafId = requestAnimationFrame(function watchdog() {
    if (!_host) return
    positionPopover()
    _rafId = requestAnimationFrame(watchdog)
  })

  // Update initial state
  updateListUI()
  updateModeUI()

  // Event handlers
  setTimeout(() => {
    _clickOutsideHandler = (e: MouseEvent) => {
      if (!_host) return
      const path = e.composedPath()
      if (path.includes(_host)) return
      // Also check if clicking on a field icon
      const target = e.target as HTMLElement
      if (target?.closest?.('[data-wrv-field-icon]')) return
      resolveAndClose({ action: 'dismissed' })
    }
    document.addEventListener('mousedown', _clickOutsideHandler, true)
  }, 50)

  _keydownHandler = (e: KeyboardEvent) => {
    if (!_host) return
    handleKeydown(e)
  }
  document.addEventListener('keydown', _keydownHandler, true)
}

function buildHeader(): HTMLElement {
  const header = document.createElement('div')
  header.className = 'wrv-pop-header'

  // Logo + branding
  const brand = document.createElement('div')
  brand.className = 'wrv-pop-brand'
  const logo = document.createElement('div')
  logo.className = 'wrv-pop-logo'
  logo.innerHTML = SHIELD_SM_SVG
  brand.appendChild(logo)
  const title = document.createElement('span')
  title.className = 'wrv-pop-title'
  title.textContent = 'WR Desk'
  brand.appendChild(title)
  header.appendChild(brand)

  // Mode toggle
  const toggle = document.createElement('div')
  toggle.className = 'wrv-pop-toggle'
  toggle.setAttribute('role', 'radiogroup')
  toggle.setAttribute('aria-label', 'Fill mode')

  const autoBtn = document.createElement('button')
  autoBtn.className = 'wrv-pop-toggle-btn'
  autoBtn.setAttribute('data-mode', 'auto')
  autoBtn.setAttribute('role', 'radio')
  autoBtn.setAttribute('type', 'button')
  autoBtn.textContent = 'Auto'
  autoBtn.addEventListener('click', () => switchMode('auto'))

  const manualBtn = document.createElement('button')
  manualBtn.className = 'wrv-pop-toggle-btn'
  manualBtn.setAttribute('data-mode', 'manual')
  manualBtn.setAttribute('role', 'radio')
  manualBtn.setAttribute('type', 'button')
  manualBtn.textContent = 'Manual'
  manualBtn.addEventListener('click', () => switchMode('manual'))

  toggle.appendChild(autoBtn)
  toggle.appendChild(manualBtn)
  header.appendChild(toggle)

  // Close button
  const closeBtn = document.createElement('button')
  closeBtn.className = 'wrv-pop-close'
  closeBtn.setAttribute('aria-label', 'Close')
  closeBtn.setAttribute('type', 'button')
  closeBtn.innerHTML = '&times;'
  closeBtn.addEventListener('click', () => resolveAndClose({ action: 'dismissed' }))
  header.appendChild(closeBtn)

  return header
}

function buildSearchBar(): HTMLElement {
  const bar = document.createElement('div')
  bar.className = 'wrv-pop-search'

  const icon = document.createElement('span')
  icon.className = 'wrv-pop-search-icon'
  icon.innerHTML = SEARCH_SVG
  bar.appendChild(icon)

  const input = document.createElement('input')
  input.className = 'wrv-pop-search-input'
  input.type = 'text'
  input.placeholder = 'Search vault...'
  input.setAttribute('aria-label', 'Search vault entries')
  input.addEventListener('input', () => {
    _searchQuery = input.value.trim().toLowerCase()
    _activeIndex = -1
    filterItems()
    updateListUI()
  })
  bar.appendChild(input)

  return bar
}

function buildFooter(): HTMLElement {
  const footer = document.createElement('div')
  footer.className = 'wrv-pop-footer'

  const openBtn = document.createElement('button')
  openBtn.className = 'wrv-pop-open-mgr'
  openBtn.setAttribute('type', 'button')
  openBtn.innerHTML = `Open Password Manager <span class="wrv-pop-arrow">&rarr;</span>`
  openBtn.addEventListener('click', () => {
    resolveAndClose({ action: 'open_manager' })
  })
  footer.appendChild(openBtn)

  return footer
}

// ============================================================================
// §5  Data Loading
// ============================================================================

async function loadVaultItems(): Promise<void> {
  try {
    _loading = true
    updateListUI()

    // First check if vault is accessible
    let vaultOk = false
    try {
      const status = await vaultAPI.getVaultStatus()
      vaultOk = status?.isUnlocked === true || status?.locked === false
    } catch {
      vaultOk = false
    }

    if (!vaultOk) {
      _loading = false
      _items = []
      _filteredItems = []
      updateListUI('vault_locked')
      return
    }

    // Fetch all items (password + identity for registration forms)
    const [passwords, identities] = await Promise.all([
      vaultAPI.listItems({ category: 'password' }).catch(() => [] as VaultItem[]),
      vaultAPI.listItems({ category: 'identity' }).catch(() => [] as VaultItem[]),
    ])

    _items = [...passwords, ...identities]

    // Sort: domain matches first, then favorites, then alphabetical
    const currentDomain = window.location.hostname.toLowerCase()
    _items.sort((a, b) => {
      const aDomain = matchesDomain(a.domain, currentDomain)
      const bDomain = matchesDomain(b.domain, currentDomain)
      if (aDomain && !bDomain) return -1
      if (!aDomain && bDomain) return 1
      if (a.favorite && !b.favorite) return -1
      if (!a.favorite && b.favorite) return 1
      return a.title.localeCompare(b.title)
    })

    _loading = false
    filterItems()
    updateListUI()

    auditLog('info', 'POPOVER_ITEMS_LOADED', `Loaded ${_items.length} vault items`)
  } catch (err) {
    _loading = false
    _items = []
    _filteredItems = []
    updateListUI()
    auditLog('warn', 'POPOVER_LOAD_FAILED', `Failed to load vault items: ${err}`)
  }
}

function filterItems(): void {
  const currentDomain = window.location.hostname.toLowerCase()

  if (_mode === 'auto') {
    // In auto mode: show domain matches only, or all if no matches
    const domainMatches = _items.filter(item => matchesDomain(item.domain, currentDomain))
    _filteredItems = domainMatches.length > 0 ? domainMatches : _items.slice(0, 5)
  } else {
    // In manual mode: filter by search query
    if (!_searchQuery) {
      _filteredItems = _items
    } else {
      _filteredItems = _items.filter(item => {
        const haystack = [
          item.title,
          item.domain || '',
          ...item.fields.filter(f => !f.encrypted && f.type !== 'password').map(f => f.value),
        ].join(' ').toLowerCase()
        return haystack.includes(_searchQuery)
      })
    }
  }
}

function matchesDomain(itemDomain: string | undefined, currentDomain: string): boolean {
  if (!itemDomain) return false
  const d = itemDomain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  return currentDomain === d
    || currentDomain.endsWith('.' + d)
    || d.endsWith('.' + currentDomain)
    || currentDomain.replace(/^www\./, '') === d.replace(/^www\./, '')
}

// ============================================================================
// §6  List Rendering
// ============================================================================

function updateListUI(specialState?: 'vault_locked'): void {
  if (!_shadow) return
  const list = _shadow.querySelector('.wrv-pop-list')
  if (!list) return
  list.innerHTML = ''

  if (_loading) {
    const loader = document.createElement('div')
    loader.className = 'wrv-pop-loading'
    loader.innerHTML = `<div class="wrv-pop-spinner"></div><span>Loading vault...</span>`
    list.appendChild(loader)
    return
  }

  if (specialState === 'vault_locked') {
    const locked = document.createElement('div')
    locked.className = 'wrv-pop-cta'
    locked.innerHTML = `
      <div class="wrv-pop-cta-icon">${LOCK_LG_SVG}</div>
      <div class="wrv-pop-cta-title">Vault is locked</div>
      <div class="wrv-pop-cta-desc">Unlock your WR Vault to autofill</div>
      <button class="wrv-pop-cta-btn" type="button">Open WR Vault</button>
    `
    locked.querySelector('.wrv-pop-cta-btn')?.addEventListener('click', () => {
      resolveAndClose({ action: 'open_manager' })
    })
    list.appendChild(locked)
    return
  }

  if (_filteredItems.length === 0) {
    if (_items.length === 0) {
      // No data at all → show setup CTA
      const empty = document.createElement('div')
      empty.className = 'wrv-pop-cta'
      empty.innerHTML = `
        <div class="wrv-pop-cta-icon">${SETUP_SVG}</div>
        <div class="wrv-pop-cta-title">Set up data for local autofill</div>
        <div class="wrv-pop-cta-desc">Save your passwords and personal data in WR Vault to autofill forms instantly.</div>
        <button class="wrv-pop-cta-btn" type="button">Open WR Vault</button>
      `
      empty.querySelector('.wrv-pop-cta-btn')?.addEventListener('click', () => {
        resolveAndClose({ action: 'open_manager' })
      })
      list.appendChild(empty)
    } else {
      const empty = document.createElement('div')
      empty.className = 'wrv-pop-empty'
      empty.textContent = _searchQuery ? 'No matching entries' : 'No entries for this site'
      list.appendChild(empty)
    }
    return
  }

  const currentDomain = window.location.hostname.toLowerCase()

  _filteredItems.forEach((item, i) => {
    const row = document.createElement('div')
    row.className = 'wrv-pop-item'
    row.setAttribute('role', 'option')
    row.setAttribute('aria-selected', i === _activeIndex ? 'true' : 'false')
    row.dataset.index = String(i)

    if (i === _activeIndex) row.classList.add('wrv-pop-item--active')

    const isDomainMatch = matchesDomain(item.domain, currentDomain)
    const username = getDisplayUsername(item)
    const categoryIcon = item.category === 'identity' ? IDENTITY_SVG : LOCK_SVG

    row.innerHTML = `
      <div class="wrv-pop-item-icon">${item.favorite ? STAR_SVG : categoryIcon}</div>
      <div class="wrv-pop-item-text">
        <div class="wrv-pop-item-title">${escapeHtml(item.title)}</div>
        <div class="wrv-pop-item-meta">${escapeHtml(username)}</div>
      </div>
      ${isDomainMatch ? '<span class="wrv-pop-item-badge">This site</span>' : ''}
    `

    row.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      fillFromItem(item)
    })
    row.addEventListener('mouseenter', () => {
      _activeIndex = i
      highlightItem(list as HTMLElement, i)
    })

    list.appendChild(row)
  })
}

function highlightItem(list: HTMLElement, index: number): void {
  const prev = list.querySelector('.wrv-pop-item--active')
  if (prev) {
    prev.classList.remove('wrv-pop-item--active')
    prev.setAttribute('aria-selected', 'false')
  }
  const item = list.children[index] as HTMLElement | undefined
  if (item) {
    item.classList.add('wrv-pop-item--active')
    item.setAttribute('aria-selected', 'true')
    item.scrollIntoView({ block: 'nearest' })
  }
}

function getDisplayUsername(item: VaultItem): string {
  for (const field of item.fields) {
    if (field.key === 'username' || field.key === 'email') {
      return field.value || ''
    }
  }
  // Fallback: show domain
  return item.domain || item.category
}

// ============================================================================
// §7  Mode Switching
// ============================================================================

function switchMode(mode: FillMode): void {
  _mode = mode
  _persistedMode = mode
  _searchQuery = ''
  _activeIndex = -1
  filterItems()
  updateListUI()
  updateModeUI()

  // Focus search in manual mode
  if (mode === 'manual' && _shadow) {
    const input = _shadow.querySelector<HTMLInputElement>('.wrv-pop-search-input')
    if (input) {
      input.value = ''
      setTimeout(() => input.focus(), 30)
    }
  }

  emitTelemetryEvent('popover_mode_switch', { mode })
}

function updateModeUI(): void {
  if (!_shadow) return

  // Toggle buttons
  const autoBtn = _shadow.querySelector('[data-mode="auto"]')
  const manualBtn = _shadow.querySelector('[data-mode="manual"]')
  if (autoBtn && manualBtn) {
    autoBtn.classList.toggle('wrv-pop-toggle-btn--active', _mode === 'auto')
    manualBtn.classList.toggle('wrv-pop-toggle-btn--active', _mode === 'manual')
    autoBtn.setAttribute('aria-checked', _mode === 'auto' ? 'true' : 'false')
    manualBtn.setAttribute('aria-checked', _mode === 'manual' ? 'true' : 'false')
  }

  // Search bar visibility
  const searchBar = _shadow.querySelector<HTMLElement>('.wrv-pop-search')
  if (searchBar) {
    searchBar.style.display = _mode === 'manual' ? '' : 'none'
  }
}

// ============================================================================
// §8  Fill Logic
// ============================================================================

function fillFromItem(item: VaultItem): void {
  if (!_options) return

  // ── Kill-switch gate: abort fill if writes are globally disabled ──
  if (areWritesDisabled()) {
    auditLog('warn', 'WRITES_DISABLED_POPOVER_BLOCKED',
      'Inline popover fill blocked — global writes kill-switch active')
    emitTelemetryEvent('popover_fill_blocked', { reason: 'writes_disabled' })
    return
  }

  // Signal to the dev-only write canary that this is a legitimate fill path
  setPopoverFillActive(true)

  const candidates = _options.allCandidates
  let filledCount = 0

  try {
    // Map item fields to page fields and fill
    for (const candidate of candidates) {
      const el = candidate.element as HTMLInputElement
      if (!el || !document.contains(el)) continue

      const matchedKind = candidate.matchedKind
      if (!matchedKind) continue

      // Find the best vault field for this candidate's kind
      const vaultField = findMatchingField(item, matchedKind)
      if (!vaultField || !vaultField.value) continue

      const result = setValueSafely(el, vaultField.value)
      if (result.success) {
        filledCount++
      }
    }

    // If no matches via kind mapping, try heuristic fill for the clicked field
    if (filledCount === 0 && _options.anchorElement) {
      const el = _options.anchorElement as HTMLInputElement
      const inputType = (el.type || '').toLowerCase()
      let value = ''

      if (inputType === 'password') {
        value = getFieldValue(item, 'password') || ''
      } else if (inputType === 'email' || el.name?.toLowerCase().includes('email')) {
        value = getFieldValue(item, 'email') || getFieldValue(item, 'username') || ''
      } else {
        value = getFieldValue(item, 'username') || getFieldValue(item, 'email') || ''
      }

      if (value) {
        const result = setValueSafely(el, value)
        if (result.success) filledCount++
      }
    }
  } finally {
    setPopoverFillActive(false)
  }

  auditLog('info', 'POPOVER_FILL', `Filled ${filledCount} fields from item "${item.title}"`)
  emitTelemetryEvent('popover_fill', { itemId: item.id, fieldCount: filledCount })

  resolveAndClose({ action: 'filled', itemId: item.id, fieldCount: filledCount })
}

function findMatchingField(item: VaultItem, kind: string): Field | null {
  const kindParts = kind.split('.')
  const fieldName = kindParts[kindParts.length - 1]

  // Direct key match
  for (const field of item.fields) {
    if (field.key === fieldName) return field
  }

  // Fuzzy match: login.password → password, login.email → email
  const keyMap: Record<string, string[]> = {
    'password': ['password', 'pass', 'pwd'],
    'new_password': ['password', 'new_password'],
    'username': ['username', 'user', 'login', 'email'],
    'email': ['email', 'e-mail', 'mail', 'username'],
    'first_name': ['first_name', 'firstName', 'vorname', 'given_name'],
    'last_name': ['last_name', 'lastName', 'nachname', 'family_name', 'surname'],
    'full_name': ['full_name', 'fullName', 'name'],
    'phone': ['phone', 'telephone', 'tel', 'mobile'],
    'street': ['street', 'address', 'address1', 'strasse'],
    'postal_code': ['postal_code', 'zip', 'plz', 'postcode'],
    'city': ['city', 'ort', 'stadt', 'town'],
    'country': ['country', 'land'],
    'company_name': ['company', 'company_name', 'firma', 'organization'],
  }

  const candidates = keyMap[fieldName] || [fieldName]
  for (const key of candidates) {
    for (const field of item.fields) {
      if (field.key.toLowerCase() === key.toLowerCase()) return field
    }
  }

  return null
}

function getFieldValue(item: VaultItem, key: string): string {
  const field = item.fields.find(f => f.key.toLowerCase() === key.toLowerCase())
  return field?.value || ''
}

// ============================================================================
// §9  Keyboard Navigation
// ============================================================================

function handleKeydown(e: KeyboardEvent): void {
  if (!_host || !_shadow) return

  switch (e.key) {
    case 'Escape':
      e.preventDefault()
      e.stopPropagation()
      resolveAndClose({ action: 'dismissed' })
      break

    case 'ArrowDown': {
      e.preventDefault()
      e.stopPropagation()
      const next = _activeIndex < _filteredItems.length - 1 ? _activeIndex + 1 : 0
      _activeIndex = next
      const list = _shadow.querySelector('.wrv-pop-list') as HTMLElement
      if (list) highlightItem(list, next)
      break
    }

    case 'ArrowUp': {
      e.preventDefault()
      e.stopPropagation()
      const prev = _activeIndex > 0 ? _activeIndex - 1 : _filteredItems.length - 1
      _activeIndex = prev
      const list = _shadow.querySelector('.wrv-pop-list') as HTMLElement
      if (list) highlightItem(list, prev)
      break
    }

    case 'Enter':
      e.preventDefault()
      e.stopPropagation()
      if (_activeIndex >= 0 && _activeIndex < _filteredItems.length) {
        fillFromItem(_filteredItems[_activeIndex])
      }
      break

    case 'Tab':
      if (_mode === 'auto') {
        e.preventDefault()
        switchMode('manual')
      }
      break
  }
}

// ============================================================================
// §10  Positioning
// ============================================================================

function positionPopover(): void {
  if (!_host || !_options) return

  const anchorRect = _options.anchorElement.getBoundingClientRect()
  if (anchorRect.width === 0 && anchorRect.height === 0) return

  const popoverWidth = Math.min(340, Math.max(anchorRect.width, 280))
  const popoverHeight = 360

  const spaceBelow = window.innerHeight - anchorRect.bottom
  const placeBelow = spaceBelow >= popoverHeight || spaceBelow > anchorRect.top

  _host.style.width = `${popoverWidth}px`
  _host.style.left = `${Math.max(4, Math.min(anchorRect.left, window.innerWidth - popoverWidth - 4))}px`

  if (placeBelow) {
    _host.style.top = `${anchorRect.bottom + 4}px`
    _host.style.bottom = ''
  } else {
    _host.style.top = ''
    _host.style.bottom = `${window.innerHeight - anchorRect.top + 4}px`
  }
}

// ============================================================================
// §11  Lifecycle
// ============================================================================

function resolveAndClose(result: PopoverResult): void {
  const resolve = _resolve
  _resolve = null
  cleanupPopover()
  resolve?.(result)
}

function cleanupPopover(): void {
  if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null }
  if (_clickOutsideHandler) {
    document.removeEventListener('mousedown', _clickOutsideHandler, true)
    _clickOutsideHandler = null
  }
  if (_keydownHandler) {
    document.removeEventListener('keydown', _keydownHandler, true)
    _keydownHandler = null
  }
  if (_host) {
    _host.remove()
    _host = null
    _shadow = null
  }
  _options = null
  _activeIndex = -1
}

// ============================================================================
// §12  SVG Icons
// ============================================================================

// Mini WR Desk logo for popover header
const SHIELD_SM_SVG = `<svg width="14" height="16" viewBox="0 0 64 72" fill="none">
  <path d="M32 2 L6 16 V38 C6 54 18 66 32 70 C46 66 58 54 58 38 V16 Z" fill="currentColor"/>
  <text x="32" y="36" text-anchor="middle" font-family="Arial,sans-serif" font-weight="900" font-size="22" fill="white">WR</text>
</svg>`

const SEARCH_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`

const LOCK_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>`

// Larger lock for CTA locked state
const LOCK_LG_SVG = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/><circle cx="12" cy="16" r="1" fill="currentColor"/></svg>`

// Setup / empty state icon — shield with plus
const SETUP_SVG = `<svg width="36" height="40" viewBox="0 0 64 72" fill="none">
  <path d="M32 4 L8 17 V38 C8 53 19 64 32 68 C45 64 56 53 56 38 V17 Z" fill="none" stroke="currentColor" stroke-width="3" opacity="0.35"/>
  <text x="32" y="38" text-anchor="middle" font-family="Arial,sans-serif" font-weight="900" font-size="20" fill="currentColor" opacity="0.5">WR</text>
  <circle cx="48" cy="56" r="12" fill="#6366f1"/>
  <path d="M48 50v12M42 56h12" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
</svg>`

const IDENTITY_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`

const STAR_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`

const VAULT_EMPTY_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M12 8v4m0 4h.01"/></svg>`

// ============================================================================
// §13  CSS
// ============================================================================

function buildPopoverCSS(): string {
  const t = CSS_TOKENS
  return `
    :host { all: initial; display: block; }

    .wrv-pop {
      background: ${t['--wrv-overlay-bg']};
      border: 1.5px solid ${t['--wrv-overlay-border']};
      border-radius: ${t['--wrv-overlay-radius']};
      box-shadow: ${t['--wrv-overlay-shadow']};
      font-family: ${t['--wrv-font-family']};
      color: ${t['--wrv-text-primary']};
      overflow: hidden;
      animation: wrv-pop-in 160ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes wrv-pop-in {
      from { opacity: 0; transform: translateY(-4px) scale(0.97); }
      to { opacity: 1; transform: translateY(0) scale(1); }
    }

    /* ── Header ── */
    .wrv-pop-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .wrv-pop-brand {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }
    .wrv-pop-logo {
      width: 20px;
      height: 22px;
      color: ${t['--wrv-accent']};
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .wrv-pop-title {
      font-size: 12px;
      font-weight: 800;
      color: ${t['--wrv-text-secondary']};
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    /* ── Mode Toggle ── */
    .wrv-pop-toggle {
      display: flex;
      background: rgba(255,255,255,0.06);
      border-radius: 6px;
      padding: 2px;
      margin-left: auto;
    }
    .wrv-pop-toggle-btn {
      padding: 3px 10px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: ${t['--wrv-text-muted']};
      font-family: ${t['--wrv-font-family']};
      font-size: ${t['--wrv-font-size-sm']};
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
    }
    .wrv-pop-toggle-btn:hover {
      color: ${t['--wrv-text-secondary']};
    }
    .wrv-pop-toggle-btn--active {
      background: ${t['--wrv-accent']};
      color: #fff;
    }
    .wrv-pop-toggle-btn--active:hover {
      color: #fff;
    }

    /* ── Close ── */
    .wrv-pop-close {
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: ${t['--wrv-text-muted']};
      cursor: pointer;
      font-size: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: all 0.15s;
    }
    .wrv-pop-close:hover {
      background: rgba(255,255,255,0.10);
      color: ${t['--wrv-text-primary']};
    }

    /* ── Search ── */
    .wrv-pop-search {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }
    .wrv-pop-search-icon {
      color: ${t['--wrv-text-muted']};
      flex-shrink: 0;
      display: flex;
    }
    .wrv-pop-search-input {
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
    .wrv-pop-search-input::placeholder {
      color: ${t['--wrv-text-muted']};
    }

    /* ── List ── */
    .wrv-pop-list {
      max-height: 220px;
      overflow-y: auto;
      padding: 4px 0;
      scrollbar-width: thin;
      scrollbar-color: rgba(255,255,255,0.15) transparent;
    }

    .wrv-pop-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      cursor: pointer;
      transition: background 0.1s;
    }
    .wrv-pop-item:hover,
    .wrv-pop-item--active {
      background: rgba(255,255,255,0.08);
    }
    .wrv-pop-item-icon {
      width: 18px;
      flex-shrink: 0;
      display: flex;
      justify-content: center;
      color: ${t['--wrv-text-muted']};
    }
    .wrv-pop-item:hover .wrv-pop-item-icon,
    .wrv-pop-item--active .wrv-pop-item-icon {
      color: ${t['--wrv-accent']};
    }
    .wrv-pop-item-text {
      flex: 1;
      min-width: 0;
    }
    .wrv-pop-item-title {
      font-size: ${t['--wrv-font-size-base']};
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wrv-pop-item-meta {
      font-size: ${t['--wrv-font-size-sm']};
      color: ${t['--wrv-text-muted']};
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .wrv-pop-item-badge {
      font-size: 10px;
      background: rgba(99, 102, 241, 0.18);
      color: ${t['--wrv-accent']};
      padding: 2px 6px;
      border-radius: 4px;
      flex-shrink: 0;
      font-weight: 500;
    }

    /* ── Loading ── */
    .wrv-pop-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 24px 10px;
      color: ${t['--wrv-text-muted']};
      font-size: ${t['--wrv-font-size-base']};
    }
    .wrv-pop-spinner {
      width: 16px;
      height: 16px;
      border: 2px solid rgba(255,255,255,0.15);
      border-top-color: ${t['--wrv-accent']};
      border-radius: 50%;
      animation: wrv-spin 0.6s linear infinite;
    }
    @keyframes wrv-spin {
      to { transform: rotate(360deg); }
    }

    /* ── Empty ── */
    .wrv-pop-empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      padding: 24px 10px;
      color: ${t['--wrv-text-muted']};
      font-size: ${t['--wrv-font-size-base']};
      text-align: center;
    }
    .wrv-pop-empty-icon {
      opacity: 0.4;
    }
    .wrv-pop-empty-hint {
      font-size: ${t['--wrv-font-size-sm']};
      opacity: 0.6;
    }

    /* ── CTA (setup / locked state) ── */
    .wrv-pop-cta {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding: 20px 16px;
      text-align: center;
    }
    .wrv-pop-cta-icon {
      color: ${t['--wrv-text-muted']};
      opacity: 0.5;
      margin-bottom: 2px;
    }
    .wrv-pop-cta-title {
      font-size: ${t['--wrv-font-size-base']};
      font-weight: 600;
      color: ${t['--wrv-text-primary']};
    }
    .wrv-pop-cta-desc {
      font-size: ${t['--wrv-font-size-sm']};
      color: ${t['--wrv-text-muted']};
      line-height: 1.4;
      max-width: 240px;
    }
    .wrv-pop-cta-btn {
      margin-top: 8px;
      padding: 7px 20px;
      border: none;
      border-radius: 6px;
      background: ${t['--wrv-accent']};
      color: #fff;
      font-family: ${t['--wrv-font-family']};
      font-size: ${t['--wrv-font-size-base']};
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s, transform 80ms;
    }
    .wrv-pop-cta-btn:hover {
      background: ${t['--wrv-accent-hover']};
    }
    .wrv-pop-cta-btn:active {
      transform: scale(0.96);
    }
    .wrv-pop-cta-btn:focus-visible {
      outline: 2px solid ${t['--wrv-accent']};
      outline-offset: 2px;
    }

    /* ── Footer ── */
    .wrv-pop-footer {
      border-top: 1px solid rgba(255,255,255,0.08);
      padding: 6px 10px;
    }
    .wrv-pop-open-mgr {
      width: 100%;
      padding: 6px 10px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: ${t['--wrv-accent']};
      font-family: ${t['--wrv-font-family']};
      font-size: ${t['--wrv-font-size-sm']};
      cursor: pointer;
      text-align: center;
      transition: background 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }
    .wrv-pop-open-mgr:hover {
      background: rgba(99, 102, 241, 0.10);
    }
    .wrv-pop-arrow {
      font-size: 14px;
    }

    @media (prefers-reduced-motion: reduce) {
      .wrv-pop { animation: none; }
      .wrv-pop-spinner { animation: none; }
    }
  `
}

// ============================================================================
// §14  Helpers
// ============================================================================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
