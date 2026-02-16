// ============================================================================
// WRVault Autofill — Save Bar (Credential Save UI)
// ============================================================================
//
// Two-stage UI for the "Save Password" experience:
//
//   Stage 1: Disk Icon
//     Small, unobtrusive floppy-disk icon anchored near the password field
//     (or top-right of form).  Pulses gently to attract attention.
//     Clicking opens Stage 2.
//
//   Stage 2: Store Credential Dialog
//     Shadow DOM dialog with:
//       - Domain (auto-filled, read-only)
//       - Username/email (pre-filled, editable)
//       - Password (masked + reveal toggle)
//       - Title/label (auto-generated, editable)
//       - Save / Cancel buttons
//       - "Update existing" vs "Save new" when duplicates found
//
// Design:
//   - All UI lives inside a single Shadow DOM host (mode: 'closed')
//   - Uses the same CSS token system as the autofill overlay
//   - Keyboard accessible: Tab cycles, Esc closes, Enter saves
//   - Auto-dismisses after SAVE_BAR_TIMEOUT_MS (30s) if ignored
//   - Repositions on scroll/resize via requestAnimationFrame watchdog
//
// ============================================================================

import type { ExtractedCredentials } from '../../../../../packages/shared/src/vault/insertionPipeline'
import { SAVE_BAR_TIMEOUT_MS } from './submitWatcher'
import { CSS_TOKENS } from './overlayStyles'

// ============================================================================
// §1  Types
// ============================================================================

/** User's decision from the save dialog. */
export type SaveDecision =
  | { action: 'save'; title: string; username: string; password: string }
  | { action: 'update'; itemId: string; title: string; username: string; password: string }
  | { action: 'cancel' }
  | { action: 'never' }  // "Never for this site"
  | { action: 'timeout' }

/** Existing credential match for duplicate detection. */
export interface ExistingMatch {
  itemId: string
  title: string
  username: string
  domain?: string
}

/** Options for showing the save bar. */
export interface SaveBarOptions {
  credentials: ExtractedCredentials
  /** Anchor element (password field or form) for icon positioning. */
  anchor?: HTMLElement
  /** Existing matches found in the vault (for duplicate UI). */
  existingMatches: ExistingMatch[]
}

// ============================================================================
// §2  State
// ============================================================================

let _host: HTMLElement | null = null
let _shadow: ShadowRoot | null = null
let _rafId: number | null = null
let _timeoutId: ReturnType<typeof setTimeout> | null = null
let _resolve: ((decision: SaveDecision) => void) | null = null
let _iconHost: HTMLElement | null = null
let _iconShadow: ShadowRoot | null = null

// ============================================================================
// §3  Public API
// ============================================================================

/**
 * Show the save-password icon near the anchor element.
 * Clicking the icon opens the full dialog.
 *
 * Returns a promise that resolves with the user's decision.
 */
export function showSaveBar(options: SaveBarOptions): Promise<SaveDecision> {
  hideSaveBar()

  return new Promise<SaveDecision>((resolve) => {
    _resolve = resolve

    // Stage 1: show the disk icon
    showDiskIcon(options, () => {
      // On icon click → Stage 2: show the dialog
      hideDiskIcon()
      showSaveDialog(options)
    })

    // Auto-dismiss after timeout
    _timeoutId = setTimeout(() => {
      hideSaveBar()
      resolve({ action: 'timeout' })
    }, SAVE_BAR_TIMEOUT_MS)
  })
}

/**
 * Dismiss and clean up all save bar UI.
 */
export function hideSaveBar(): void {
  hideDiskIcon()
  hideSaveDialog()
  if (_timeoutId) {
    clearTimeout(_timeoutId)
    _timeoutId = null
  }
  _resolve = null
}

/**
 * Check if the save bar (icon or dialog) is currently visible.
 */
export function isSaveBarVisible(): boolean {
  return _iconHost !== null || _host !== null
}

// ============================================================================
// §4  Stage 1 — Disk Icon
// ============================================================================

function showDiskIcon(options: SaveBarOptions, onClick: () => void): void {
  hideDiskIcon()

  _iconHost = document.createElement('div')
  _iconHost.setAttribute('data-wrv-save-icon', '')
  _iconHost.style.cssText = 'position:absolute;z-index:2147483644;pointer-events:auto;'
  document.body.appendChild(_iconHost)
  _iconShadow = _iconHost.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = buildIconCSS()
  _iconShadow.appendChild(style)

  const btn = document.createElement('button')
  btn.className = 'wrv-save-icon'
  btn.setAttribute('aria-label', 'Save password to WRVault')
  btn.setAttribute('title', 'Save password to WRVault')
  btn.innerHTML = DISK_SVG
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    onClick()
  })
  _iconShadow.appendChild(btn)

  // Position near anchor
  positionIcon(options.anchor)

  // Reposition watchdog
  _rafId = requestAnimationFrame(function iconWatchdog() {
    if (!_iconHost) return
    positionIcon(options.anchor)
    _rafId = requestAnimationFrame(iconWatchdog)
  })
}

function hideDiskIcon(): void {
  if (_rafId && !_host) {
    cancelAnimationFrame(_rafId)
    _rafId = null
  }
  if (_iconHost) {
    _iconHost.remove()
    _iconHost = null
    _iconShadow = null
  }
}

function positionIcon(anchor?: HTMLElement): void {
  if (!_iconHost || !anchor) {
    // Fallback: top-right of viewport
    if (_iconHost) {
      _iconHost.style.position = 'fixed'
      _iconHost.style.top = '16px'
      _iconHost.style.right = '16px'
      _iconHost.style.left = ''
    }
    return
  }

  const rect = anchor.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) return

  // Position to the right of the field, vertically centered
  _iconHost.style.position = 'fixed'
  _iconHost.style.top = `${rect.top + (rect.height / 2) - 16}px`
  _iconHost.style.left = `${rect.right + 6}px`

  // If off-screen right, place inside the field (right edge)
  if (rect.right + 44 > window.innerWidth) {
    _iconHost.style.left = `${rect.right - 40}px`
  }
}

// ============================================================================
// §5  Stage 2 — Save Dialog
// ============================================================================

function showSaveDialog(options: SaveBarOptions): void {
  hideSaveDialog()

  _host = document.createElement('div')
  _host.setAttribute('data-wrv-save-dialog', '')
  _host.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483646;pointer-events:auto;'
  document.body.appendChild(_host)
  _shadow = _host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = buildDialogCSS()
  _shadow.appendChild(style)

  const hasExisting = options.existingMatches.length > 0
  const creds = options.credentials
  const autoTitle = `${creds.domain} — ${creds.username || 'Login'}`

  const overlay = document.createElement('div')
  overlay.className = 'wrv-save-overlay'
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      resolveAndClose({ action: 'cancel' })
    }
  })

  const dialog = document.createElement('div')
  dialog.className = 'wrv-save-dialog'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-label', 'Save credential to WRVault')

  dialog.innerHTML = `
    <div class="wrv-save-header">
      <div class="wrv-save-header-icon">${SHIELD_SVG}</div>
      <div>
        <h2 class="wrv-save-title">${hasExisting ? 'Update Credential?' : 'Save Credential?'}</h2>
        <p class="wrv-save-subtitle">${escapeHtml(creds.domain)}</p>
      </div>
      <button class="wrv-save-close" aria-label="Close">&times;</button>
    </div>

    <div class="wrv-save-body">
      ${hasExisting ? buildExistingMatchSection(options.existingMatches) : ''}

      <div class="wrv-save-field-group">
        <label class="wrv-save-label" for="wrv-save-title">Title</label>
        <input class="wrv-save-input" id="wrv-save-title" type="text" value="${escapeAttr(autoTitle)}" autocomplete="off" spellcheck="false">
      </div>

      <div class="wrv-save-field-group">
        <label class="wrv-save-label" for="wrv-save-username">Username / Email</label>
        <input class="wrv-save-input" id="wrv-save-username" type="text" value="${escapeAttr(creds.username)}" autocomplete="off" spellcheck="false">
      </div>

      <div class="wrv-save-field-group">
        <label class="wrv-save-label" for="wrv-save-password">Password</label>
        <div class="wrv-save-pw-row">
          <input class="wrv-save-input wrv-save-pw-input" id="wrv-save-password" type="password" value="${escapeAttr(creds.password)}" autocomplete="off" spellcheck="false">
          <button class="wrv-save-reveal-btn" type="button" aria-label="Toggle password visibility">${EYE_SVG}</button>
        </div>
      </div>

      <p class="wrv-save-notice">
        ${creds.formType === 'signup' ? 'New account detected.' : ''}
        Credential will be encrypted and stored in your WRVault.
      </p>
    </div>

    <div class="wrv-save-footer">
      <button class="wrv-save-btn wrv-save-btn--cancel" type="button">Cancel</button>
      <button class="wrv-save-btn wrv-save-btn--never" type="button">Never for this site</button>
      <button class="wrv-save-btn wrv-save-btn--primary" type="button">${hasExisting ? 'Update' : 'Save'}</button>
    </div>
  `

  overlay.appendChild(dialog)
  _shadow.appendChild(overlay)

  // ── Event wiring ──
  const closeBtn = dialog.querySelector('.wrv-save-close') as HTMLElement
  const cancelBtn = dialog.querySelector('.wrv-save-btn--cancel') as HTMLElement
  const neverBtn = dialog.querySelector('.wrv-save-btn--never') as HTMLElement
  const saveBtn = dialog.querySelector('.wrv-save-btn--primary') as HTMLElement
  const titleInput = dialog.querySelector('#wrv-save-title') as HTMLInputElement
  const usernameInput = dialog.querySelector('#wrv-save-username') as HTMLInputElement
  const passwordInput = dialog.querySelector('#wrv-save-password') as HTMLInputElement
  const revealBtn = dialog.querySelector('.wrv-save-reveal-btn') as HTMLElement

  closeBtn?.addEventListener('click', () => resolveAndClose({ action: 'cancel' }))
  cancelBtn?.addEventListener('click', () => resolveAndClose({ action: 'cancel' }))
  neverBtn?.addEventListener('click', () => resolveAndClose({ action: 'never' }))

  saveBtn?.addEventListener('click', () => {
    const selectedMatch = getSelectedMatch(dialog)
    if (selectedMatch) {
      resolveAndClose({
        action: 'update',
        itemId: selectedMatch,
        title: titleInput.value.trim() || autoTitle,
        username: usernameInput.value.trim(),
        password: passwordInput.value,
      })
    } else {
      resolveAndClose({
        action: 'save',
        title: titleInput.value.trim() || autoTitle,
        username: usernameInput.value.trim(),
        password: passwordInput.value,
      })
    }
  })

  // Password reveal toggle
  let revealed = false
  revealBtn?.addEventListener('click', () => {
    revealed = !revealed
    passwordInput.type = revealed ? 'text' : 'password'
    revealBtn.innerHTML = revealed ? EYE_OFF_SVG : EYE_SVG
    revealBtn.setAttribute('aria-label', revealed ? 'Hide password' : 'Show password')
  })

  // Existing match selection
  const matchRadios = dialog.querySelectorAll<HTMLInputElement>('input[name="wrv-existing-match"]')
  matchRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === '__new__') {
        saveBtn.textContent = 'Save New'
      } else {
        saveBtn.textContent = 'Update'
      }
    })
  })

  // Keyboard handling
  dialog.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      resolveAndClose({ action: 'cancel' })
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      saveBtn?.click()
    } else if (e.key === 'Tab') {
      trapFocus(e, dialog)
    }
  })

  // Focus the title input
  setTimeout(() => titleInput?.focus(), 50)
}

function hideSaveDialog(): void {
  if (_rafId) {
    cancelAnimationFrame(_rafId)
    _rafId = null
  }
  if (_host) {
    _host.remove()
    _host = null
    _shadow = null
  }
}

function resolveAndClose(decision: SaveDecision): void {
  const resolve = _resolve
  hideSaveBar()
  resolve?.(decision)
}

// ============================================================================
// §6  Duplicate Match UI
// ============================================================================

function buildExistingMatchSection(matches: ExistingMatch[]): string {
  let html = `
    <div class="wrv-save-existing">
      <p class="wrv-save-existing-label">Existing credentials found for this domain:</p>
  `
  for (const match of matches) {
    html += `
      <label class="wrv-save-existing-item">
        <input type="radio" name="wrv-existing-match" value="${escapeAttr(match.itemId)}" checked>
        <div class="wrv-save-existing-info">
          <span class="wrv-save-existing-title">${escapeHtml(match.title)}</span>
          <span class="wrv-save-existing-user">${escapeHtml(match.username)}</span>
        </div>
      </label>
    `
  }
  html += `
      <label class="wrv-save-existing-item">
        <input type="radio" name="wrv-existing-match" value="__new__">
        <div class="wrv-save-existing-info">
          <span class="wrv-save-existing-title">Save as new entry</span>
          <span class="wrv-save-existing-user">Create a separate credential</span>
        </div>
      </label>
    </div>
  `
  return html
}

function getSelectedMatch(dialog: HTMLElement): string | null {
  const checked = dialog.querySelector<HTMLInputElement>('input[name="wrv-existing-match"]:checked')
  if (!checked || checked.value === '__new__') return null
  return checked.value
}

// ============================================================================
// §7  Focus Trap
// ============================================================================

function trapFocus(e: KeyboardEvent, container: HTMLElement): void {
  const focusable = container.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
  )
  if (focusable.length === 0) return

  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const shadow = container.getRootNode() as ShadowRoot

  if (e.shiftKey) {
    if (shadow.activeElement === first) {
      e.preventDefault()
      last.focus()
    }
  } else {
    if (shadow.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }
}

// ============================================================================
// §8  SVG Icons
// ============================================================================

const DISK_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`

const SHIELD_SVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/></svg>`

const EYE_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`

const EYE_OFF_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`

// ============================================================================
// §9  CSS
// ============================================================================

function buildIconCSS(): string {
  return `
    :host { all: initial; }
    .wrv-save-icon {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      border: 1px solid ${CSS_TOKENS['--wrv-overlay-border']};
      background: ${CSS_TOKENS['--wrv-overlay-bg']};
      color: ${CSS_TOKENS['--wrv-accent']};
      cursor: pointer;
      box-shadow: ${CSS_TOKENS['--wrv-overlay-shadow']};
      transition: all 0.2s ease;
      animation: wrv-pulse 2s ease-in-out infinite;
    }
    .wrv-save-icon:hover {
      background: ${CSS_TOKENS['--wrv-overlay-bg-hover']};
      border-color: ${CSS_TOKENS['--wrv-overlay-border-focus']};
      transform: scale(1.08);
    }
    .wrv-save-icon:focus-visible {
      outline: 2px solid ${CSS_TOKENS['--wrv-accent']};
      outline-offset: 2px;
    }
    @keyframes wrv-pulse {
      0%, 100% { box-shadow: ${CSS_TOKENS['--wrv-overlay-shadow']}; }
      50% { box-shadow: ${CSS_TOKENS['--wrv-overlay-shadow']}, 0 0 8px ${CSS_TOKENS['--wrv-accent']}40; }
    }
    @media (prefers-reduced-motion: reduce) {
      .wrv-save-icon { animation: none; }
    }
  `
}

function buildDialogCSS(): string {
  const t = CSS_TOKENS
  return `
    :host { all: initial; }

    .wrv-save-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.55);
      backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      animation: wrv-fade-in 0.15s ease-out;
    }

    .wrv-save-dialog {
      background: ${t['--wrv-overlay-bg']};
      border: 1px solid ${t['--wrv-overlay-border']};
      border-radius: 12px;
      box-shadow: ${t['--wrv-overlay-shadow']};
      width: 400px;
      max-width: 92vw;
      max-height: 85vh;
      overflow-y: auto;
      font-family: ${t['--wrv-font-family']};
      color: ${t['--wrv-text-primary']};
      animation: wrv-slide-up 0.2s ease-out;
    }

    .wrv-save-header {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px 20px;
      border-bottom: 1px solid ${t['--wrv-field-border']};
    }
    .wrv-save-header-icon {
      color: ${t['--wrv-success']};
      flex-shrink: 0;
    }
    .wrv-save-title {
      font-size: ${t['--wrv-font-size-lg']};
      font-weight: 600;
      margin: 0;
    }
    .wrv-save-subtitle {
      font-size: ${t['--wrv-font-size-sm']};
      color: ${t['--wrv-text-secondary']};
      margin: 2px 0 0 0;
    }
    .wrv-save-close {
      margin-left: auto;
      background: none;
      border: none;
      color: ${t['--wrv-text-muted']};
      font-size: 22px;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      line-height: 1;
    }
    .wrv-save-close:hover { color: ${t['--wrv-text-primary']}; background: ${t['--wrv-field-bg-hover']}; }

    .wrv-save-body {
      padding: 16px 20px;
    }

    .wrv-save-field-group {
      margin-bottom: 14px;
    }
    .wrv-save-label {
      display: block;
      font-size: ${t['--wrv-font-size-sm']};
      color: ${t['--wrv-text-secondary']};
      margin-bottom: 5px;
      font-weight: 500;
    }
    .wrv-save-input {
      width: 100%;
      padding: 9px 12px;
      background: ${t['--wrv-field-bg']};
      border: 1px solid ${t['--wrv-field-border']};
      border-radius: ${t['--wrv-field-radius']};
      color: ${t['--wrv-text-primary']};
      font-size: ${t['--wrv-font-size-base']};
      font-family: ${t['--wrv-font-family']};
      box-sizing: border-box;
      outline: none;
      transition: border-color 0.15s;
    }
    .wrv-save-input:focus {
      border-color: ${t['--wrv-accent']};
    }
    .wrv-save-pw-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .wrv-save-pw-input {
      flex: 1;
      font-family: ${t['--wrv-font-mono']};
    }
    .wrv-save-reveal-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      background: ${t['--wrv-field-bg']};
      border: 1px solid ${t['--wrv-field-border']};
      border-radius: ${t['--wrv-field-radius']};
      color: ${t['--wrv-text-secondary']};
      cursor: pointer;
      flex-shrink: 0;
    }
    .wrv-save-reveal-btn:hover {
      background: ${t['--wrv-field-bg-hover']};
      color: ${t['--wrv-text-primary']};
    }

    .wrv-save-notice {
      font-size: ${t['--wrv-font-size-sm']};
      color: ${t['--wrv-text-muted']};
      margin: 8px 0 0 0;
      line-height: 1.4;
    }

    .wrv-save-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 20px 16px;
      border-top: 1px solid ${t['--wrv-field-border']};
    }
    .wrv-save-btn {
      padding: 8px 16px;
      border-radius: 6px;
      font-size: ${t['--wrv-font-size-base']};
      font-weight: 500;
      font-family: ${t['--wrv-font-family']};
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s;
    }
    .wrv-save-btn--cancel {
      background: transparent;
      border-color: ${t['--wrv-field-border']};
      color: ${t['--wrv-text-secondary']};
    }
    .wrv-save-btn--cancel:hover {
      background: ${t['--wrv-field-bg-hover']};
      color: ${t['--wrv-text-primary']};
    }
    .wrv-save-btn--never {
      background: transparent;
      color: ${t['--wrv-text-muted']};
      font-size: ${t['--wrv-font-size-sm']};
      margin-right: auto;
      padding: 8px 10px;
    }
    .wrv-save-btn--never:hover {
      color: ${t['--wrv-danger']};
    }
    .wrv-save-btn--primary {
      background: ${t['--wrv-accent']};
      color: ${t['--wrv-accent-text']};
      margin-left: auto;
      font-weight: 600;
    }
    .wrv-save-btn--primary:hover {
      background: ${t['--wrv-accent-hover']};
    }
    .wrv-save-btn:focus-visible {
      outline: 2px solid ${t['--wrv-accent']};
      outline-offset: 2px;
    }

    /* ── Existing match section ── */
    .wrv-save-existing {
      background: ${t['--wrv-field-bg']};
      border: 1px solid ${t['--wrv-field-border']};
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 16px;
    }
    .wrv-save-existing-label {
      font-size: ${t['--wrv-font-size-sm']};
      color: ${t['--wrv-text-secondary']};
      margin: 0 0 10px 0;
      font-weight: 500;
    }
    .wrv-save-existing-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.1s;
      margin-bottom: 4px;
    }
    .wrv-save-existing-item:hover {
      background: ${t['--wrv-field-bg-hover']};
    }
    .wrv-save-existing-item input[type="radio"] {
      accent-color: ${t['--wrv-accent']};
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }
    .wrv-save-existing-info {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .wrv-save-existing-title {
      font-size: ${t['--wrv-font-size-base']};
      color: ${t['--wrv-text-primary']};
      font-weight: 500;
    }
    .wrv-save-existing-user {
      font-size: ${t['--wrv-font-size-sm']};
      color: ${t['--wrv-text-muted']};
    }

    /* ── Animations ── */
    @keyframes wrv-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes wrv-slide-up {
      from { transform: translateY(16px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .wrv-save-overlay, .wrv-save-dialog { animation: none; }
    }
  `
}

// ============================================================================
// §10  Helpers
// ============================================================================

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}
