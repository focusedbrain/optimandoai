// ============================================================================
// WRVault DataVault — Popup UI (Profile Selection + Field Preview)
// ============================================================================
//
// Small popup shown when the user clicks a DataVault inline icon.
//
// Layout:
//   ┌──────────────────────────────────────────┐
//   │  DataVault            [Auto] [Manual]    │  ← header + mode toggle
//   ├──────────────────────────────────────────┤
//   │  🔒Private │ 💼Business │ 🏢Company │ ★Custom │  ← type tabs w/ badges
//   ├──────────────────────────────────────────┤
//   │  🔒 "My Identity"                       │  ← profile badge + name
//   ├──────────────────────────────────────────┤
//   │  Matched fields in this form:            │
//   │  ┌────────────────────────────────────┐  │
//   │  │ ✓ First Name    →  Oscar           │  │
//   │  │ ✓ Last Name     →  Schreyer        │  │
//   │  │ ✓ Email         →  oscar@...       │  │
//   │  │ ● Street        →  (already set)   │  │
//   │  │ ✓ City          →  Berlin          │  │
//   │  └────────────────────────────────────┘  │
//   ├──────────────────────────────────────────┤
//   │  [Fill this field]  [Fill all matched]   │  ← actions
//   │  Never fill on this site                 │  ← denylist
//   └──────────────────────────────────────────┘
//
// Auto mode: clicking a green icon fills ALL matched fields immediately
// (no popup). The popup only shows in manual mode.
//
// Profile type badges: Private (purple), Business (gold), Company (blue),
// Custom (pink) — matching the WRVault sidebar categories.
//
// Shadow DOM (mode: 'closed') for CSS isolation.
// ============================================================================

import type { FieldCandidate } from '../../../../../packages/shared/src/vault/insertionPipeline'
import type { FieldKind } from '../../../../../packages/shared/src/vault/fieldTaxonomy'
import { FIELD_BY_KIND } from '../../../../../packages/shared/src/vault/fieldTaxonomy'
import {
  listDataVaultProfiles,
  getDataVaultProfile,
  getLastUsedProfileId,
  setLastUsedProfileId,
  addToDvDenylist,
} from './dataVaultAdapter'
import type {
  DataVaultProfileSummary,
  DataVaultProfile,
  DataVaultProfileType,
} from './dataVaultAdapter'
import { fillSingleField, fillAllMatchedFields } from './dataVaultFillEngine'
import type { FillAllResult } from './dataVaultFillEngine'
import { buildFieldFingerprint, saveLearned } from './dvSiteLearning'
import { FILLABLE_FIELDS } from '../../../../../packages/shared/src/vault/fieldTaxonomy'

// ============================================================================
// §1  Types
// ============================================================================

export interface DvPopupOptions {
  anchorElement: HTMLElement
  candidate: FieldCandidate
  allCandidates: FieldCandidate[]
  iconRect: DOMRect
}

export type DvPopupResult =
  | { action: 'filled_single'; vaultKey: FieldKind }
  | { action: 'filled_all'; fillResult: FillAllResult }
  | { action: 'remapped'; oldVaultKey: FieldKind | null; newVaultKey: FieldKind }
  | { action: 'denied'; origin: string }
  | { action: 'dismissed' }

// ============================================================================
// §2  State
// ============================================================================

let _host: HTMLElement | null = null
let _shadow: ShadowRoot | null = null
let _resolve: ((result: DvPopupResult) => void) | null = null
let _options: DvPopupOptions | null = null
let _profiles: DataVaultProfileSummary[] = []
let _activeProfile: DataVaultProfile | null = null
let _loading = true
let _clickOutsideHandler: ((e: MouseEvent) => void) | null = null
let _keydownHandler: ((e: KeyboardEvent) => void) | null = null

// ============================================================================
// §3  Public API
// ============================================================================

/**
 * Show the DataVault popup and return a promise that resolves on user action.
 */
export function showDvPopup(options: DvPopupOptions): Promise<DvPopupResult> {
  hideDvPopup()
  _options = options

  return new Promise((resolve) => {
    _resolve = resolve
    _loading = true
    createPopupDOM(options)
    loadProfiles(options)
  })
}

/** Hide the DataVault popup. */
export function hideDvPopup(): void {
  if (_clickOutsideHandler) {
    document.removeEventListener('click', _clickOutsideHandler, true)
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
  _profiles = []
  _activeProfile = null
  _loading = true
}

/** Check if the DataVault popup is visible. */
export function isDvPopupVisible(): boolean {
  return _host !== null
}

// ============================================================================
// §4  DOM Creation
// ============================================================================

function createPopupDOM(options: DvPopupOptions): void {
  _host = document.createElement('div')
  _host.setAttribute('data-wrv-dv-popup', '')
  _host.setAttribute('data-wrv-no-autofill', '')
  _host.style.cssText = `
    position: fixed;
    z-index: 2147483646;
    margin: 0;
    padding: 0;
  `

  _shadow = _host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = buildCSS()
  _shadow.appendChild(style)

  const container = document.createElement('div')
  container.className = 'dv-popup'
  container.innerHTML = renderLoading()
  _shadow.appendChild(container)

  document.body.appendChild(_host)
  positionPopup(options.iconRect)

  // Click outside → dismiss
  _clickOutsideHandler = (e: MouseEvent) => {
    if (_host && !_host.contains(e.target as Node)) {
      dismissPopup()
    }
  }
  setTimeout(() => {
    document.addEventListener('click', _clickOutsideHandler!, true)
  }, 50)

  // Escape → dismiss
  _keydownHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      dismissPopup()
    }
  }
  document.addEventListener('keydown', _keydownHandler, true)
}

function positionPopup(iconRect: DOMRect): void {
  if (!_host) return

  const popupWidth = 320
  const popupHeight = 280
  const gap = 4

  let top = iconRect.bottom + gap
  let left = iconRect.left - popupWidth + iconRect.width

  // Clamp to viewport
  if (top + popupHeight > window.innerHeight) {
    top = iconRect.top - popupHeight - gap
  }
  if (left < 8) left = 8
  if (left + popupWidth > window.innerWidth - 8) {
    left = window.innerWidth - popupWidth - 8
  }

  _host.style.top = `${top}px`
  _host.style.left = `${left}px`
}

// ============================================================================
// §5  Profile Loading
// ============================================================================

async function loadProfiles(options: DvPopupOptions): Promise<void> {
  // Retry with increasing delays — background service worker or Electron
  // backend may need time to wake up even though the vault is unlocked.
  const retryDelays = [0, 400, 800, 1500]
  let lastError: unknown = null

  for (let attempt = 0; attempt < retryDelays.length; attempt++) {
    if (attempt > 0) {
      await new Promise(r => setTimeout(r, retryDelays[attempt]))
      if (!_host) return // popup was closed while waiting
    }
    try {
      _profiles = await listDataVaultProfiles()
      if (_profiles.length > 0) break
      // Empty result may mean the vault API is still warming up — retry
      lastError = null
    } catch (err) {
      lastError = err
    }
  }

  if (lastError && _profiles.length === 0) {
    renderError()
    return
  }

  if (_profiles.length === 0) {
    renderEmpty()
    return
  }

  const origin = window.location.origin
  const lastUsedId = await getLastUsedProfileId(origin)
  let targetId = lastUsedId

  if (!targetId || !_profiles.find(p => p.itemId === targetId)) {
    targetId = _profiles[0].itemId
  }

  try {
    await loadProfile(targetId!, options)
  } catch {
    // Profile fetch failed — retry once after a delay
    await new Promise(r => setTimeout(r, 600))
    if (!_host) return
    try {
      await loadProfile(targetId!, options)
    } catch {
      renderError()
    }
  }
}

async function loadProfile(profileId: string, options: DvPopupOptions): Promise<void> {
  _loading = true
  if (_shadow?.querySelector('.dv-popup')) {
    const container = _shadow.querySelector('.dv-popup')!
    container.innerHTML = renderLoading()
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      _activeProfile = await getDataVaultProfile(profileId)
      _loading = false
      renderContent(options)
      return
    } catch {
      if (attempt < 2) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
        if (!_host) return
      }
    }
  }

  renderError()
}

// ============================================================================
// §6  Rendering
// ============================================================================

function renderLoading(): string {
  return `<div class="dv-loading">Loading profiles...</div>`
}

function renderEmpty(): void {
  if (!_shadow) return
  const container = _shadow.querySelector('.dv-popup')
  if (!container) return
  container.innerHTML = `
    <div class="dv-header">
      <span class="dv-title">📇 DataVault</span>
    </div>
    <div class="dv-empty">
      No identity or company profiles found.<br>
      Create one in the Vault Manager.
    </div>
  `
}

function renderError(): void {
  if (!_shadow) return
  const container = _shadow.querySelector('.dv-popup')
  if (!container) return
  container.innerHTML = `
    <div class="dv-header">
      <span class="dv-title">📇 DataVault</span>
    </div>
    <div class="dv-error">
      Unable to load profiles.<br>
      The vault may be locked.
    </div>
  `
}

function renderContent(options: DvPopupOptions): void {
  if (!_shadow || !_activeProfile || !_options) return
  const container = _shadow.querySelector('.dv-popup')
  if (!container) return

  const profile = _activeProfile
  const candidates = options.allCandidates
  const clickedCandidate = options.candidate

  // Build matched field preview
  const matchedFields = buildMatchedFieldPreview(candidates, profile)

  // Collect distinct profile types that exist
  const existingTypes = new Set(_profiles.map(p => p.type))

  container.innerHTML = `
    <div class="dv-header">
      <span class="dv-title">DataVault</span>
    </div>
    <div class="dv-type-tabs">
      ${(['private', 'company', 'custom'] as const)
        .filter(t => existingTypes.has(t))
        .map(t => `
          <button class="dv-type-tab ${profile.type === t ? 'active' : ''}" data-type="${t}" type="button">
            <span class="dv-type-badge dv-badge-${t}">${profileTypeBadgeIcon(t)}</span>
            ${profileTypeLabel(t)}
          </button>
        `).join('')}
    </div>
    <div class="dv-profile-row">
      <span class="dv-type-badge dv-badge-${profile.type} dv-badge-lg">${profileTypeBadgeIcon(profile.type)}</span>
      ${_profiles.filter(p => p.type === profile.type).length > 1 ? `
      <select class="dv-select">
        ${_profiles.filter(p => p.type === profile.type).map(p => `
          <option value="${p.itemId}" ${p.itemId === profile.itemId ? 'selected' : ''}>${escapeHtml(p.title)}</option>
        `).join('')}
      </select>
      ` : `
      <span class="dv-profile-title">${escapeHtml(profile.title)}</span>
      `}
    </div>
    <div class="dv-fields-header">Matched fields in this form:</div>
    <div class="dv-fields-list">
      ${matchedFields.length > 0 ? matchedFields.map(f => `
        <div class="dv-field-row ${f.willFill ? 'will-fill' : 'skipped'}">
          <span class="dv-field-status">${f.willFill ? '✓' : '●'}</span>
          <span class="dv-field-label">${escapeHtml(f.label)}</span>
          <span class="dv-field-value">${f.willFill ? escapeHtml(f.preview) : '(already set)'}</span>
        </div>
      `).join('') : `
        <div class="dv-no-match">No matching fields found for this profile.</div>
      `}
    </div>
    <div class="dv-actions">
      <button class="dv-btn dv-btn-fill-single" ${!clickedCandidate.matchedKind || !profile.fields.has(clickedCandidate.matchedKind) ? 'disabled' : ''}>
        Fill this field
      </button>
      <button class="dv-btn dv-btn-primary dv-btn-fill-all" ${matchedFields.filter(f => f.willFill).length === 0 ? 'disabled' : ''}>
        Fill all matched (${matchedFields.filter(f => f.willFill).length})
      </button>
    </div>
    <div class="dv-remap-row">
      <span class="dv-remap-label">Map this field to:</span>
      <select class="dv-remap-select">
        <option value="">— Change mapping —</option>
        ${buildRemapOptions(clickedCandidate.matchedKind)}
      </select>
    </div>
    <button class="dv-deny-btn">Never fill on this site</button>
  `

  // Wire up events
  wireEvents(options)
}

// ============================================================================
// §7  Event Wiring
// ============================================================================

function wireEvents(options: DvPopupOptions): void {
  if (!_shadow) return

  // Profile type tabs (Private / Business / Company / Custom)
  const typeTabs = _shadow.querySelectorAll<HTMLButtonElement>('.dv-type-tab')
  typeTabs.forEach(tab => {
    tab.addEventListener('click', (e) => {
      e.stopPropagation()
      const type = tab.dataset.type as DataVaultProfileType
      const profilesOfType = _profiles.filter(p => p.type === type)
      if (profilesOfType.length > 0) {
        loadProfile(profilesOfType[0].itemId, options)
      }
    })
  })

  // Profile select dropdown
  const select = _shadow.querySelector<HTMLSelectElement>('.dv-select')
  if (select) {
    select.addEventListener('change', () => {
      loadProfile(select.value, options)
    })
  }

  // Fill this field button
  const fillSingleBtn = _shadow.querySelector<HTMLButtonElement>('.dv-btn-fill-single')
  if (fillSingleBtn) {
    fillSingleBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (!e.isTrusted || !_activeProfile) return
      handleFillSingle(options)
    })
  }

  // Fill all matched button
  const fillAllBtn = _shadow.querySelector<HTMLButtonElement>('.dv-btn-fill-all')
  if (fillAllBtn) {
    fillAllBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (!e.isTrusted || !_activeProfile) return
      handleFillAll(options)
    })
  }

  // Remap select
  const remapSelect = _shadow.querySelector<HTMLSelectElement>('.dv-remap-select')
  if (remapSelect) {
    remapSelect.addEventListener('change', (e) => {
      e.stopPropagation()
      const newKind = remapSelect.value as FieldKind
      if (newKind) {
        handleRemap(options, newKind)
      }
    })
  }

  // Never fill on this site
  const denyBtn = _shadow.querySelector<HTMLButtonElement>('.dv-deny-btn')
  if (denyBtn) {
    denyBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (!e.isTrusted) return
      handleDeny()
    })
  }
}

// ============================================================================
// §8  Action Handlers
// ============================================================================

function handleFillSingle(options: DvPopupOptions): void {
  if (!_activeProfile) return

  const kind = options.candidate.matchedKind
  if (!kind) return

  const value = _activeProfile.fields.get(kind)
  if (!value) return

  const el = options.candidate.element as HTMLElement
  fillSingleField(el, value)

  // Persist last used profile
  setLastUsedProfileId(window.location.origin, _activeProfile.itemId)

  const result: DvPopupResult = { action: 'filled_single', vaultKey: kind }
  _resolve?.(result)
  hideDvPopup()
}

function handleFillAll(options: DvPopupOptions): void {
  if (!_activeProfile) return

  // Filter to candidates in the same form group as the clicked field
  const clickedEl = options.candidate.element as HTMLElement
  const formGroup = getFormGroup(clickedEl)
  const groupCandidates = filterCandidatesByGroup(options.allCandidates, formGroup)

  // Only fill identity/company fields (not login fields)
  const dvCandidates = groupCandidates.filter(c => {
    if (!c.matchedKind) return false
    const section = c.matchedKind.split('.')[0]
    return section === 'identity' || section === 'company'
  })

  const fillResult = fillAllMatchedFields(dvCandidates, _activeProfile.fields, {
    minConfidence: 50,
  })

  // Persist last used profile
  setLastUsedProfileId(window.location.origin, _activeProfile.itemId)

  const result: DvPopupResult = { action: 'filled_all', fillResult }
  _resolve?.(result)
  hideDvPopup()
}

async function handleDeny(): Promise<void> {
  const origin = window.location.origin
  await addToDvDenylist(origin)
  const result: DvPopupResult = { action: 'denied', origin }
  _resolve?.(result)
  hideDvPopup()
}

function dismissPopup(): void {
  _resolve?.({ action: 'dismissed' })
  hideDvPopup()
}

// ============================================================================
// §9  Field Preview Builder
// ============================================================================

interface FieldPreview {
  kind: FieldKind
  label: string
  preview: string
  willFill: boolean
}

function buildMatchedFieldPreview(
  candidates: FieldCandidate[],
  profile: DataVaultProfile,
): FieldPreview[] {
  const previews: FieldPreview[] = []
  const seenElements = new Set<HTMLElement>()
  const seenKinds = new Set<FieldKind>()

  for (const candidate of candidates) {
    const kind = candidate.matchedKind
    if (!kind) continue

    // Skip duplicate entries for the same DOM element
    const el = candidate.element as HTMLElement
    if (seenElements.has(el)) continue
    seenElements.add(el)

    // Skip duplicate FieldKind entries (e.g., two email inputs on the page
    // would both fill with the same profile value — showing it twice is noise)
    if (seenKinds.has(kind)) continue
    seenKinds.add(kind)

    // Only identity and company fields
    const section = kind.split('.')[0]
    if (section !== 'identity' && section !== 'company') continue

    if (candidate.crossOrigin) continue

    const value = profile.fields.get(kind)
    const spec = FIELD_BY_KIND.get(kind)
    const label = spec ? formatFieldLabel(kind) : kind

    const inputEl = candidate.element as HTMLInputElement
    const currentValue = (inputEl.value ?? '').trim()
    const willFill = !!value && !currentValue && !inputEl.disabled && !inputEl.readOnly

    previews.push({
      kind,
      label,
      preview: value ? maskPreview(value, spec?.sensitive ?? false) : '—',
      willFill,
    })
  }

  return previews
}

function formatFieldLabel(kind: FieldKind): string {
  const parts = kind.split('.')
  const name = parts[parts.length - 1]
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function maskPreview(value: string, sensitive: boolean): string {
  if (sensitive) return '••••••'
  if (value.length > 20) return value.slice(0, 18) + '…'
  return value
}

// ============================================================================
// §10  Form Grouping
// ============================================================================

function getFormGroup(element: HTMLElement): HTMLElement | null {
  // Closest <form>
  const form = element.closest('form')
  if (form) return form

  // Closest container with role=form
  const roleForm = element.closest('[role="form"]')
  if (roleForm) return roleForm as HTMLElement

  // No <form> wrapper: walk up to find the broadest container that groups
  // form fields together.  Keep going until the jump in input count becomes
  // small (we want the tightest container that holds ALL related inputs).
  let bestParent: HTMLElement | null = null
  let bestCount = 0
  let parent = element.parentElement
  while (parent && parent !== document.body) {
    const inputs = parent.querySelectorAll('input, select, textarea')
    if (inputs.length >= 2) {
      bestParent = parent
      bestCount = inputs.length
    }
    // Stop expanding once we've found a wide enough container (>= 3 fields)
    // and the parent's input count hasn't grown (we've left the form area)
    if (bestCount >= 3 && parent.parentElement) {
      const parentInputs = parent.parentElement.querySelectorAll('input, select, textarea')
      if (parentInputs.length === bestCount) break
    }
    parent = parent.parentElement
  }

  return bestParent ?? document.body
}

function filterCandidatesByGroup(
  candidates: FieldCandidate[],
  group: HTMLElement | null,
): FieldCandidate[] {
  if (!group) return candidates

  return candidates.filter(c => {
    const el = c.element as HTMLElement
    return group.contains(el)
  })
}

// ============================================================================
// §10.1  Remap Helpers
// ============================================================================

/** Build remap <option> elements for all DataVault-relevant FieldKinds. */
function buildRemapOptions(currentKind: FieldKind | null): string {
  const dvKinds = FILLABLE_FIELDS.filter(spec => {
    const section = spec.section
    return section === 'identity' || section === 'company'
  })

  return dvKinds
    .map(spec => {
      const label = formatFieldLabel(spec.kind)
      const selected = spec.kind === currentKind ? 'selected' : ''
      return `<option value="${spec.kind}" ${selected}>${escapeHtml(label)}</option>`
    })
    .join('')
}

/**
 * Handle user remapping a field: persist the new mapping via Site Learning
 * and resolve the popup with a 'remapped' result.
 */
async function handleRemap(options: DvPopupOptions, newKind: FieldKind): Promise<void> {
  const el = options.candidate.element as HTMLElement
  const fingerprint = buildFieldFingerprint(el)
  const oldKind = options.candidate.matchedKind

  // Persist the learned mapping
  try {
    await saveLearned(window.location.origin, fingerprint, newKind)
  } catch {
    // Non-fatal: learning store error doesn't block the user
  }

  const result: DvPopupResult = {
    action: 'remapped',
    oldVaultKey: oldKind,
    newVaultKey: newKind,
  }
  _resolve?.(result)
  hideDvPopup()
}

// ============================================================================
// §10.2  Profile Type Badge Helpers
// ============================================================================

const BADGE_ICONS: Record<DataVaultProfileType, string> = {
  private: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="12" height="12"><path d="M6 1a2.5 2.5 0 0 0-2.5 2.5v0A2.5 2.5 0 0 0 6 6a2.5 2.5 0 0 0 2.5-2.5A2.5 2.5 0 0 0 6 1zm-3 7a1 1 0 0 0-1 1v.5C2 10.88 3.79 11.5 6 11.5s4-.62 4-2V9a1 1 0 0 0-1-1H3z" fill="currentColor"/></svg>`,
  company: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="12" height="12"><path d="M3 1a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H3zm1 2h1v1H4V3zm3 0h1v1H7V3zM4 5.5h1v1H4v-1zm3 0h1v1H7v-1zM4 8h4v2H4V8z" fill="currentColor"/></svg>`,
  custom: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="12" height="12"><path d="M6 .5l1.76 3.57 3.94.57-2.85 2.78.67 3.93L6 9.57 2.48 11.35l.67-3.93L.3 4.64l3.94-.57L6 .5z" fill="currentColor"/></svg>`,
}

function profileTypeBadgeIcon(type: DataVaultProfileType): string {
  return BADGE_ICONS[type] ?? BADGE_ICONS.custom
}

const PROFILE_TYPE_LABELS: Record<DataVaultProfileType, string> = {
  private: 'Private Data',
  company: 'Company Data',
  custom: 'Custom Data',
}

function profileTypeLabel(type: DataVaultProfileType): string {
  return PROFILE_TYPE_LABELS[type] ?? 'Custom Data'
}

// ============================================================================
// §11  Helpers
// ============================================================================

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ============================================================================
// §12  CSS
// ============================================================================

function buildCSS(): string {
  return `
    :host {
      all: initial;
      display: block;
    }

    .dv-popup {
      width: 340px;
      max-height: 460px;
      overflow-y: auto;
      background: #1e1e2e;
      border: 1px solid rgba(99, 102, 241, 0.4);
      border-radius: 10px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 13px;
      color: #e2e8f0;
      animation: dvFadeIn 0.15s ease;
    }

    @keyframes dvFadeIn {
      from { opacity: 0; transform: translateY(-4px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ── Header with title + Auto/Manual toggle ── */

    .dv-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .dv-title {
      font-weight: 700;
      font-size: 13px;
      color: #c4b5fd;
      letter-spacing: 0.3px;
    }

    /* ── Profile type tabs (Private/Business/Company/Custom) ── */

    .dv-type-tabs {
      display: flex;
      gap: 2px;
      padding: 6px 10px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      overflow-x: auto;
    }

    .dv-type-tab {
      all: unset;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      color: #94a3b8;
      white-space: nowrap;
      transition: all 0.15s ease;
    }

    .dv-type-tab:hover {
      background: rgba(255, 255, 255, 0.06);
      color: #e2e8f0;
    }

    .dv-type-tab.active {
      background: rgba(99, 102, 241, 0.15);
      color: #c4b5fd;
    }

    /* ── Badge icons for profile types ── */

    .dv-type-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border-radius: 4px;
      flex-shrink: 0;
    }

    .dv-type-badge svg {
      width: 12px;
      height: 12px;
    }

    .dv-badge-lg {
      width: 22px;
      height: 22px;
      border-radius: 5px;
    }

    .dv-badge-lg svg {
      width: 14px;
      height: 14px;
    }

    .dv-badge-private {
      background: rgba(99, 102, 241, 0.2);
      color: #a78bfa;
    }
    .dv-badge-company {
      background: rgba(59, 130, 246, 0.2);
      color: #60a5fa;
    }
    .dv-badge-custom {
      background: rgba(236, 72, 153, 0.2);
      color: #f472b6;
    }

    /* ── Profile row ── */

    .dv-profile-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }

    .dv-profile-title {
      font-size: 13px;
      font-weight: 500;
      color: #e2e8f0;
    }

    .dv-select {
      flex: 1;
      background: #2a2a3e;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 12px;
      color: #e2e8f0;
      outline: none;
    }

    .dv-select:focus {
      border-color: rgba(99, 102, 241, 0.5);
    }

    /* ── Fields ── */

    .dv-fields-header {
      padding: 8px 14px 4px;
      font-size: 11px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .dv-fields-list {
      padding: 2px 10px;
      max-height: 180px;
      overflow-y: auto;
    }

    .dv-field-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 4px;
      border-radius: 4px;
      font-size: 12px;
    }

    .dv-field-row.will-fill {
      color: #e2e8f0;
    }

    .dv-field-row.skipped {
      color: #64748b;
    }

    .dv-field-status {
      font-size: 11px;
      width: 14px;
      flex-shrink: 0;
    }

    .dv-field-row.will-fill .dv-field-status {
      color: #22c55e;
    }

    .dv-field-row.skipped .dv-field-status {
      color: #64748b;
    }

    .dv-field-label {
      flex: 0 0 auto;
      min-width: 80px;
      font-weight: 500;
    }

    .dv-field-value {
      flex: 1;
      text-align: right;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: #94a3b8;
      font-family: monospace;
      font-size: 11px;
    }

    .dv-no-match {
      padding: 12px 4px;
      color: #64748b;
      font-size: 12px;
      text-align: center;
    }

    /* ── Actions ── */

    .dv-actions {
      display: flex;
      gap: 8px;
      padding: 10px 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }

    .dv-btn {
      all: unset;
      flex: 1;
      text-align: center;
      padding: 7px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
      background: rgba(255, 255, 255, 0.06);
      color: #e2e8f0;
    }

    .dv-btn:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.1);
    }

    .dv-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    .dv-btn-primary {
      background: rgba(99, 102, 241, 0.3);
      color: #c4b5fd;
    }

    .dv-btn-primary:hover:not(:disabled) {
      background: rgba(99, 102, 241, 0.45);
    }

    .dv-remap-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.04);
    }

    .dv-remap-label {
      font-size: 11px;
      color: #64748b;
      white-space: nowrap;
    }

    .dv-remap-select {
      flex: 1;
      background: #2a2a3e;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      padding: 3px 6px;
      font-size: 11px;
      color: #e2e8f0;
      outline: none;
    }

    .dv-remap-select:focus {
      border-color: rgba(99, 102, 241, 0.5);
    }

    .dv-deny-btn {
      all: unset;
      display: block;
      width: 100%;
      text-align: center;
      padding: 7px 14px;
      font-size: 11px;
      color: #64748b;
      cursor: pointer;
      border-top: 1px solid rgba(255, 255, 255, 0.04);
      box-sizing: border-box;
      transition: color 0.15s ease;
    }

    .dv-deny-btn:hover {
      color: #ef4444;
    }

    .dv-loading, .dv-empty, .dv-error {
      padding: 24px 14px;
      text-align: center;
      color: #64748b;
      font-size: 12px;
    }

    .dv-error {
      color: #ef4444;
    }
  `
}
