// ============================================================================
// WRVault Autofill — Overlay Manager
// ============================================================================
//
// Shadow-DOM overlay that previews vault values adjacent to form fields.
// Requires explicit user consent (click "Insert" or press Enter) before
// any value is committed into the page.
//
// Public API:
//   showOverlay(session)  → Promise<UserDecision>
//   hideOverlay()         → void
//
// Security invariants:
//   - Shadow DOM mode: closed (page scripts cannot reach internal nodes)
//   - No values are written to the page DOM — preview only
//   - Password values are never placed in any DOM attribute or text node
//   - Overlay auto-expires after session.timeoutMs
//   - Resilient to SPA re-renders via MutationObserver + position watchdog
// ============================================================================

import { createOverlayStyleSheet, CSS_TOKENS } from './overlayStyles'
import type {
  OverlaySession,
  OverlayTarget,
  MaskingConfig,
} from '../../../../../packages/shared/src/vault/insertionPipeline'
import {
  computeDisplayValue,
  DEFAULT_MASKING,
  DEFAULT_SESSION_TIMEOUT_MS,
} from '../../../../../packages/shared/src/vault/insertionPipeline'
import type { FieldKind } from '../../../../../packages/shared/src/vault/fieldTaxonomy'
import { guardElement, auditLog, emitTelemetryEvent, redactError } from './hardening'
import { attachGuard, type MutationGuardHandle, type GuardStatus } from './mutationGuard'
import { isHAEnforced } from './haGuard'
import { areWritesDisabled, onWritesDisabledChange } from './writesKillSwitch'

// ============================================================================
// §1  Types
// ============================================================================

/** The user's decision after interacting with the overlay. */
export type UserDecision =
  | { action: 'insert'; trustDomain: boolean }
  | { action: 'cancel' }
  | { action: 'expired' }

/** Internal mask state per field row. */
type MaskState = 'masked' | 'peeked' | 'revealed'

/** Position of the overlay relative to the target element. */
type Placement = 'below' | 'above'

// ============================================================================
// §2  Field icons (content-safe, no external loads)
// ============================================================================

const FIELD_ICONS: Partial<Record<string, string>> = {
  'login.username':        '\u{1F464}',  // 👤
  'login.email':           '\u{2709}',   // ✉
  'login.password':        '\u{1F512}',  // 🔒
  'login.new_password':    '\u{1F511}',  // 🔑
  'login.otp_code':        '\u{1F4F2}',  // 📲
  'login.recovery_code':   '\u{1F6E1}',  // 🛡
  'identity.first_name':   '\u{1F9D1}',  // 🧑
  'identity.last_name':    '\u{1F9D1}',  // 🧑
  'identity.full_name':    '\u{1F9D1}',  // 🧑
  'identity.email':        '\u{2709}',   // ✉
  'identity.phone':        '\u{1F4DE}',  // 📞
  'identity.street':       '\u{1F3E0}',  // 🏠
  'identity.postal_code':  '\u{1F4EE}',  // 📮
  'identity.city':         '\u{1F3D9}',  // 🏙
  'identity.country':      '\u{1F30D}',  // 🌍
  'company.name':          '\u{1F3E2}',  // 🏢
  'company.vat_number':    '\u{1F4C4}',  // 📄
  'company.iban':          '\u{1F3E6}',  // 🏦
}

function getFieldIcon(kind: FieldKind): string {
  return FIELD_ICONS[kind] ?? '\u{1F4DD}' // 📝
}

/** Human-friendly label for a field kind (strips section prefix). */
function getFieldLabel(kind: FieldKind): string {
  const LABELS: Partial<Record<string, string>> = {
    'login.username':        'Username',
    'login.email':           'Email',
    'login.password':        'Password',
    'login.new_password':    'New Password',
    'login.otp_code':        'OTP Code',
    'login.recovery_code':   'Recovery',
    'identity.first_name':   'First Name',
    'identity.last_name':    'Last Name',
    'identity.full_name':    'Full Name',
    'identity.email':        'Email',
    'identity.phone':        'Phone',
    'identity.birthday':     'Birthday',
    'identity.street':       'Street',
    'identity.street_number':'Number',
    'identity.address_line2':'Address 2',
    'identity.postal_code':  'ZIP / Postal',
    'identity.city':         'City',
    'identity.state':        'State',
    'identity.country':      'Country',
    'identity.tax_id':       'Tax ID',
    'company.name':          'Company',
    'company.email':         'Email',
    'company.phone':         'Phone',
    'company.vat_number':    'VAT Number',
    'company.tax_id':        'Tax ID',
    'company.hrb':           'HRB',
    'company.iban':          'IBAN',
    'company.billing_email': 'Billing Email',
  }
  return LABELS[kind] ?? kind.split('.').pop()!.replace(/_/g, ' ')
}

// ============================================================================
// §3  Singleton State
// ============================================================================

let _host: HTMLDivElement | null = null
let _shadow: ShadowRoot | null = null
let _resolve: ((decision: UserDecision) => void) | null = null
let _session: OverlaySession | null = null
let _maskStates: Map<number, MaskState> = new Map()
let _revealTimer: ReturnType<typeof setTimeout> | null = null
let _peekTimer: ReturnType<typeof setTimeout> | null = null
let _expireTimer: ReturnType<typeof setTimeout> | null = null
let _positionRaf: number | null = null
let _resizeObserver: ResizeObserver | null = null
let _clipboardTimers: ReturnType<typeof setTimeout>[] = []
let _styleSheet: CSSStyleSheet | null = null
let _placement: Placement = 'below'
let _mutationGuard: MutationGuardHandle | null = null
let _killSwitchUnsub: (() => void) | null = null

// ============================================================================
// §4  Public API
// ============================================================================

/**
 * Show the overlay for an OverlaySession.
 *
 * Returns a Promise that resolves when the user makes a decision:
 *   - { action: 'insert', trustDomain: boolean }  — user clicked Insert
 *   - { action: 'cancel' }                         — user clicked Cancel / Esc
 *   - { action: 'expired' }                        — session timed out
 *
 * Only one overlay can be active at a time.  Calling showOverlay while
 * one is visible will dismiss the previous one with 'cancel'.
 */
export function showOverlay(session: OverlaySession): Promise<UserDecision> {
  // Tear down any existing overlay — mark the displaced session as 'dismissed'
  // so it cannot be committed via a stale reference.
  if (_session && _session.state === 'preview') {
    _session.state = 'dismissed'
    auditLog('info', 'OVERLAY_SESSION_DISPLACED', `Previous session dismissed by new showOverlay (id redacted)`)
  }
  if (_resolve) {
    _resolve({ action: 'cancel' })
  }
  teardownInternal()

  // ── Hardening: pre-flight element guard on anchor ──
  if (session.targets.length > 0) {
    const anchor = session.targets[0].element as HTMLElement
    const guard = guardElement(anchor)
    if (!guard.safe) {
      auditLog('warn', guard.code ?? 'ELEMENT_HIDDEN', `Overlay blocked: ${guard.reason}`)
      return Promise.resolve({ action: 'cancel' })
    }
  }

  _session = session
  _maskStates = new Map()
  session.targets.forEach((_, i) => _maskStates.set(i, 'masked'))

  // ── Defense-in-depth: log session creation context (no raw domains/UUIDs) ──
  const ha = isHAEnforced()
  const level = ha ? 'security' : 'info'
  auditLog(
    level,
    'OVERLAY_SESSION_CREATED',
    `state=${session.state} origin=${session.origin} ha=${ha} fields=${session.targets.length}`,
  )

  emitTelemetryEvent('overlay_shown', {
    fieldCount: session.targets.length,
    haMode: ha,
  })

  return new Promise<UserDecision>((resolve) => {
    _resolve = resolve
    mount(session)

    // ── Mutation Guard: attach BEFORE user can click Insert ──
    const targetElements = session.targets.map(t => t.element as HTMLElement)
    _mutationGuard = attachGuard(targetElements)
    _mutationGuard.onTrip = (status) => {
      // Instant invalidation — dismiss overlay, abort any pending commit
      const reasons = status.violations.map(v => `${v.reason}[${v.targetIndex}]`).join(', ')
      auditLog('security', 'MUTATION_GUARD_ABORT', `Overlay aborted: ${reasons}`)
      emitTelemetryEvent('overlay_mutation_abort', { reasons })
      session.state = 'invalidated'
      session.invalidReasons = ['element_replaced']
      if (_resolve) {
        const r = _resolve
        teardownInternal()
        r({ action: 'cancel' })
      }
    }

    startExpireTimer(session.timeoutMs || DEFAULT_SESSION_TIMEOUT_MS)
    startPositionWatchdog()
  })
}

/**
 * Programmatically dismiss the overlay.
 * Resolves the pending promise with { action: 'cancel' }.
 * Marks the active session as 'dismissed' so it cannot be committed.
 */
export function hideOverlay(): void {
  if (_session && _session.state === 'preview') {
    _session.state = 'dismissed'
  }
  if (_resolve) {
    _resolve({ action: 'cancel' })
  }
  teardownInternal()
}

/**
 * Whether an overlay is currently visible.
 */
export function isOverlayVisible(): boolean {
  return _host !== null && _shadow !== null
}

/**
 * Return the active session's ID, or null if no session is active.
 * Used for concurrency enforcement (MAX_ACTIVE_SESSIONS=1).
 */
export function getActiveSessionId(): string | null {
  return _session?.id ?? null
}

/**
 * Check the mutation guard for the current overlay session.
 *
 * Returns { valid: true } if no DOM tampering was detected, or
 * { valid: false, violations: [...] } if the guard has tripped.
 *
 * Called by commitInsert() as gate 0, BEFORE any safety checks.
 * This is the primary defense against C-PIPE-01 (TOCTOU DOM swap).
 */
export function checkMutationGuard(): GuardStatus {
  if (!_mutationGuard) {
    return { valid: true, violations: [] }
  }
  return _mutationGuard.check()
}

// ============================================================================
// §5  Mount / Teardown
// ============================================================================

function mount(session: OverlaySession): void {
  // Create the shadow host
  _host = document.createElement('div')
  _host.id = 'wrv-autofill-overlay'
  _host.setAttribute('role', 'dialog')
  _host.setAttribute('aria-label', 'WRVault autofill preview')
  _host.setAttribute('aria-modal', 'false')

  Object.assign(_host.style, {
    position: 'absolute',
    zIndex: '2147483645',
    pointerEvents: 'auto',
    margin: '0',
    padding: '0',
    border: 'none',
    background: 'none',
  })

  // Attach closed shadow root
  _shadow = _host.attachShadow({ mode: 'closed' })

  // Inject styles
  if (!_styleSheet) {
    _styleSheet = createOverlayStyleSheet()
  }
  _shadow.adoptedStyleSheets = [_styleSheet]

  // Build the card
  const card = buildCard(session)
  _shadow.appendChild(card)

  // Append to document and position
  document.documentElement.appendChild(_host)
  positionOverlay(session)

  // Focus the insert button for keyboard users
  requestAnimationFrame(() => {
    const insertBtn = _shadow?.querySelector<HTMLButtonElement>('[data-wrv-action="insert"]')
    insertBtn?.focus()
  })

  // Listen for Escape at the document level
  document.addEventListener('keydown', onDocumentKeydown, true)

  // Listen for clicks outside the overlay
  document.addEventListener('mousedown', onOutsideClick, true)
}

function teardownInternal(): void {
  // Stop timers
  if (_expireTimer) { clearTimeout(_expireTimer); _expireTimer = null }
  if (_revealTimer) { clearTimeout(_revealTimer); _revealTimer = null }
  if (_peekTimer) { clearTimeout(_peekTimer); _peekTimer = null }
  if (_positionRaf) { cancelAnimationFrame(_positionRaf); _positionRaf = null }
  _clipboardTimers.forEach(t => clearTimeout(t))
  _clipboardTimers = []

  // Remove observers
  if (_mutationGuard) { _mutationGuard.detach(); _mutationGuard = null }
  if (_resizeObserver) { _resizeObserver.disconnect(); _resizeObserver = null }
  if (_killSwitchUnsub) { _killSwitchUnsub(); _killSwitchUnsub = null }

  // Remove listeners
  document.removeEventListener('keydown', onDocumentKeydown, true)
  document.removeEventListener('mousedown', onOutsideClick, true)

  // Animate out, then remove
  if (_host && _shadow) {
    const card = _shadow.querySelector('.wrv-card')
    if (card) {
      card.classList.add('wrv-card--dismissing')
      setTimeout(() => removeHost(), 140)
    } else {
      removeHost()
    }
  }

  _session = null
  _resolve = null
  _maskStates = new Map()
}

function removeHost(): void {
  if (_host && _host.parentNode) {
    _host.parentNode.removeChild(_host)
  }
  _host = null
  _shadow = null
}

// ============================================================================
// §6  Card Builder
// ============================================================================

function buildCard(session: OverlaySession): HTMLElement {
  const card = el('div', { class: 'wrv-card', tabindex: '-1' })

  // Arrow indicator
  const arrow = el('div', { class: 'wrv-arrow wrv-arrow--top' })
  card.appendChild(arrow)

  // ── Header ──
  card.appendChild(buildHeader(session))

  // ── Field rows ──
  card.appendChild(buildFields(session))

  // ── Trust toggle ──
  card.appendChild(buildTrustToggle(session))

  // ── Footer ──
  card.appendChild(buildFooter())

  // Trap focus within card
  card.addEventListener('keydown', onCardKeydown)

  return card
}

function buildHeader(session: OverlaySession): HTMLElement {
  const header = el('div', { class: 'wrv-header' })

  // Logo mark
  const logo = el('div', { class: 'wrv-logo', 'aria-hidden': 'true' })
  logo.textContent = 'V'
  header.appendChild(logo)

  // Text block
  const textBlock = el('div', { class: 'wrv-header-text' })

  const domain = el('div', { class: 'wrv-domain' })
  domain.textContent = session.profile.domain || window.location.hostname
  textBlock.appendChild(domain)

  const profileName = el('div', { class: 'wrv-profile-name' })
  profileName.textContent = session.profile.title
  textBlock.appendChild(profileName)

  header.appendChild(textBlock)

  // Close button
  const closeBtn = el('button', {
    class: 'wrv-close-btn',
    'aria-label': 'Close',
    title: 'Cancel (Esc)',
    'data-wrv-action': 'cancel',
    type: 'button',
  })
  closeBtn.textContent = '\u00D7' // ×
  closeBtn.addEventListener('click', onCancel)
  header.appendChild(closeBtn)

  return header
}

function buildFields(session: OverlaySession): HTMLElement {
  const container = el('div', { class: 'wrv-fields', role: 'list', 'aria-label': 'Fields to fill' })

  session.targets.forEach((target, index) => {
    const row = buildFieldRow(target, index)
    container.appendChild(row)
  })

  return container
}

function buildFieldRow(target: OverlayTarget, index: number): HTMLElement {
  const row = el('div', {
    class: 'wrv-field-row',
    role: 'listitem',
    'data-wrv-field-index': String(index),
  })

  // Icon
  const icon = el('span', { class: 'wrv-field-icon', 'aria-hidden': 'true' })
  icon.textContent = getFieldIcon(target.field.kind)
  row.appendChild(icon)

  // Label
  const label = el('span', { class: 'wrv-field-label' })
  label.textContent = getFieldLabel(target.field.kind)
  row.appendChild(label)

  // Value
  const valueSpan = el('span', {
    class: 'wrv-field-value',
    'data-wrv-value-index': String(index),
    'aria-live': 'polite',
  })
  updateValueDisplay(valueSpan, target, 'masked')
  row.appendChild(valueSpan)

  // Actions (only for sensitive fields)
  if (target.field.sensitive) {
    const actions = el('div', { class: 'wrv-field-actions' })

    // Reveal toggle
    const revealBtn = el('button', {
      class: 'wrv-icon-btn',
      'aria-label': 'Reveal password',
      title: 'Reveal',
      'data-wrv-reveal': String(index),
      type: 'button',
    })
    revealBtn.textContent = '\u{1F441}' // 👁
    revealBtn.addEventListener('click', () => onToggleReveal(index))
    actions.appendChild(revealBtn)

    // Copy
    const copyBtn = el('button', {
      class: 'wrv-icon-btn',
      'aria-label': 'Copy to clipboard',
      title: 'Copy',
      'data-wrv-copy': String(index),
      type: 'button',
    })
    copyBtn.textContent = '\u{1F4CB}' // 📋
    copyBtn.addEventListener('click', () => onCopy(index))
    actions.appendChild(copyBtn)

    row.appendChild(actions)

    // Peek on hover
    row.addEventListener('mouseenter', () => onPeekStart(index))
    row.addEventListener('mouseleave', () => onPeekEnd(index))
  }

  return row
}

function buildTrustToggle(session: OverlaySession): HTMLElement {
  const wrapper = el('div', { class: 'wrv-trust' })

  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  checkbox.className = 'wrv-trust-checkbox'
  checkbox.id = 'wrv-trust-checkbox'
  checkbox.checked = false
  checkbox.setAttribute('aria-describedby', 'wrv-trust-desc')
  wrapper.appendChild(checkbox)

  const labelEl = el('label', {
    class: 'wrv-trust-label',
    for: 'wrv-trust-checkbox',
    id: 'wrv-trust-desc',
  })
  const domainDisplay = session.profile.domain || window.location.hostname
  labelEl.textContent = `Always allow on ${domainDisplay}`
  wrapper.appendChild(labelEl)

  return wrapper
}

function buildFooter(): HTMLElement {
  const footer = el('div', { class: 'wrv-footer' })

  // Cancel
  const cancelBtn = el('button', {
    class: 'wrv-btn wrv-btn--secondary',
    'data-wrv-action': 'cancel',
    type: 'button',
  })
  cancelBtn.textContent = 'Cancel'
  cancelBtn.addEventListener('click', onCancel)
  footer.appendChild(cancelBtn)

  // Screen-reader hint
  const srHint = el('span', { class: 'wrv-sr-only' })
  srHint.textContent = 'Press Enter to insert, Escape to cancel'
  footer.appendChild(srHint)

  // Insert
  const insertBtn = el('button', {
    class: 'wrv-btn wrv-btn--primary wrv-btn--grow',
    'data-wrv-action': 'insert',
    type: 'button',
  }) as HTMLButtonElement
  insertBtn.innerHTML = '<span aria-hidden="true">\u2713</span> Insert'
  insertBtn.addEventListener('click', onInsertClick)
  footer.appendChild(insertBtn)

  // ── Kill-switch badge: disable Insert and show warning when writes are globally disabled ──
  const writesDisabledBadge = el('div', {
    class: 'wrv-writes-disabled-badge',
    'aria-live': 'polite',
  })
  writesDisabledBadge.textContent = '\u26D4 Writes disabled'
  writesDisabledBadge.style.display = 'none'
  footer.appendChild(writesDisabledBadge)

  function applyKillSwitchState(disabled: boolean): void {
    if (disabled) {
      insertBtn.disabled = true
      insertBtn.setAttribute('aria-disabled', 'true')
      insertBtn.title = 'Autofill writes are globally disabled by operator'
      writesDisabledBadge.style.display = ''
    } else {
      insertBtn.disabled = false
      insertBtn.removeAttribute('aria-disabled')
      insertBtn.title = ''
      writesDisabledBadge.style.display = 'none'
    }
  }

  applyKillSwitchState(areWritesDisabled())
  _killSwitchUnsub = onWritesDisabledChange(applyKillSwitchState)

  return footer
}

// ============================================================================
// §7  Positioning
// ============================================================================

function positionOverlay(session: OverlaySession): void {
  if (!_host || !session.targets.length) return

  // Anchor to the FIRST target element
  const anchor = session.targets[0].element as HTMLElement
  if (!anchor || !document.contains(anchor)) return

  const anchorRect = anchor.getBoundingClientRect()
  const scrollX = window.scrollX
  const scrollY = window.scrollY

  // Measure overlay (needs to be in DOM first)
  const overlayRect = _host.getBoundingClientRect()
  const overlayHeight = overlayRect.height || 200
  const overlayWidth = overlayRect.width || 300

  // Space below / above the anchor
  const spaceBelow = window.innerHeight - anchorRect.bottom
  const spaceAbove = anchorRect.top
  const GAP = 6

  // Prefer below; fall back to above if not enough room
  let top: number
  if (spaceBelow >= overlayHeight + GAP || spaceBelow >= spaceAbove) {
    top = anchorRect.bottom + GAP + scrollY
    _placement = 'below'
  } else {
    top = anchorRect.top - overlayHeight - GAP + scrollY
    _placement = 'above'
  }

  // Horizontal: align to anchor left, clamp to viewport
  let left = anchorRect.left + scrollX
  const maxLeft = window.innerWidth + scrollX - overlayWidth - 8
  if (left > maxLeft) left = maxLeft
  if (left < scrollX + 8) left = scrollX + 8

  _host.style.top = `${Math.round(top)}px`
  _host.style.left = `${Math.round(left)}px`

  // Update arrow
  updateArrow()
}

function updateArrow(): void {
  if (!_shadow) return
  const arrow = _shadow.querySelector('.wrv-arrow') as HTMLElement | null
  if (!arrow) return

  arrow.className = _placement === 'below' ? 'wrv-arrow wrv-arrow--top' : 'wrv-arrow wrv-arrow--bottom'
}

/**
 * Continuously reposition on scroll/resize/SPA re-renders.
 * Uses rAF for smoothness; stops when overlay is torn down.
 */
function startPositionWatchdog(): void {
  let lastAnchorTop = 0
  let lastAnchorLeft = 0

  function tick() {
    if (!_host || !_session || !_session.targets.length) return

    const anchor = _session.targets[0].element as HTMLElement

    // Anchor detached — auto-dismiss
    if (!anchor || !document.contains(anchor)) {
      auditLog('warn', 'ELEMENT_DETACHED', 'Overlay anchor detached during session')
      if (_resolve) _resolve({ action: 'cancel' })
      teardownInternal()
      return
    }

    // Hardening: check if our overlay host was repositioned off-screen (clickjack vector)
    if (_host) {
      const hostRect = _host.getBoundingClientRect()
      if (hostRect.right < -100 || hostRect.left > window.innerWidth + 100 ||
          hostRect.bottom < -100 || hostRect.top > window.innerHeight + 100) {
        auditLog('security', 'CJ_OVERLAY_REPOSITIONED', 'Overlay host moved off-screen by page script')
        if (_resolve) _resolve({ action: 'cancel' })
        teardownInternal()
        return
      }
    }

    const rect = anchor.getBoundingClientRect()

    // Only reposition if anchor moved (avoids layout thrashing)
    if (Math.abs(rect.top - lastAnchorTop) > 1 || Math.abs(rect.left - lastAnchorLeft) > 1) {
      lastAnchorTop = rect.top
      lastAnchorLeft = rect.left
      positionOverlay(_session)
    }

    _positionRaf = requestAnimationFrame(tick)
  }

  _positionRaf = requestAnimationFrame(tick)
}

// ============================================================================
// §8  Mask / Reveal / Peek
// ============================================================================

function updateValueDisplay(
  span: HTMLElement,
  target: OverlayTarget,
  state: MaskState,
): void {
  const displayVal = computeDisplayValue(
    target.commitValue,
    target.field.sensitive,
    state,
    DEFAULT_MASKING,
  )

  span.textContent = displayVal

  // Apply CSS class for styling
  span.className = 'wrv-field-value'
  if (target.field.sensitive) {
    if (state === 'revealed') {
      span.classList.add('wrv-field-value--revealed')
    } else {
      span.classList.add('wrv-field-value--masked')
    }
  } else {
    span.classList.add('wrv-field-value--clear')
  }
}

function refreshFieldDisplay(index: number): void {
  if (!_shadow || !_session) return
  const target = _session.targets[index]
  if (!target) return
  const state = _maskStates.get(index) ?? 'masked'
  const valueSpan = _shadow.querySelector(`[data-wrv-value-index="${index}"]`) as HTMLElement | null
  if (valueSpan) {
    updateValueDisplay(valueSpan, target, state)
  }

  // Update reveal button text
  const revealBtn = _shadow.querySelector(`[data-wrv-reveal="${index}"]`) as HTMLElement | null
  if (revealBtn) {
    revealBtn.textContent = state === 'revealed' ? '\u{1F441}\u200D\u{1F5E8}' : '\u{1F441}'
    revealBtn.setAttribute('aria-label', state === 'revealed' ? 'Hide password' : 'Reveal password')
  }
}

function onToggleReveal(index: number): void {
  const current = _maskStates.get(index) ?? 'masked'
  if (current === 'revealed') {
    // Re-mask
    _maskStates.set(index, 'masked')
    if (_revealTimer) { clearTimeout(_revealTimer); _revealTimer = null }
  } else {
    // Re-mask any previously revealed field (one at a time rule)
    _maskStates.forEach((state, i) => {
      if (state === 'revealed' && i !== index) {
        _maskStates.set(i, 'masked')
        refreshFieldDisplay(i)
      }
    })

    _maskStates.set(index, 'revealed')

    // Auto-remask after timeout
    if (_revealTimer) clearTimeout(_revealTimer)
    _revealTimer = setTimeout(() => {
      _maskStates.set(index, 'masked')
      refreshFieldDisplay(index)
      _revealTimer = null
    }, DEFAULT_MASKING.revealTimeoutMs)
  }
  refreshFieldDisplay(index)
}

function onPeekStart(index: number): void {
  const current = _maskStates.get(index) ?? 'masked'
  if (current !== 'masked') return // Don't override reveal state

  _maskStates.set(index, 'peeked')
  refreshFieldDisplay(index)

  // Auto-remask peek after timeout
  if (_peekTimer) clearTimeout(_peekTimer)
  _peekTimer = setTimeout(() => {
    if (_maskStates.get(index) === 'peeked') {
      _maskStates.set(index, 'masked')
      refreshFieldDisplay(index)
    }
    _peekTimer = null
  }, DEFAULT_MASKING.peekTimeoutMs)
}

function onPeekEnd(index: number): void {
  if (_maskStates.get(index) === 'peeked') {
    _maskStates.set(index, 'masked')
    refreshFieldDisplay(index)
  }
  if (_peekTimer) { clearTimeout(_peekTimer); _peekTimer = null }
}

async function onCopy(index: number): Promise<void> {
  if (!_session) return
  const target = _session.targets[index]
  if (!target) return

  try {
    await navigator.clipboard.writeText(target.commitValue)
  } catch {
    // Fallback: fail silently (clipboard may be blocked)
    return
  }

  // Visual feedback
  if (!_shadow) return
  const copyBtn = _shadow.querySelector(`[data-wrv-copy="${index}"]`) as HTMLElement | null
  if (copyBtn) {
    const original = copyBtn.textContent
    copyBtn.textContent = '\u2713' // ✓
    copyBtn.classList.add('wrv-icon-btn--success')
    setTimeout(() => {
      copyBtn.textContent = original
      copyBtn.classList.remove('wrv-icon-btn--success')
    }, 1500)
  }

  // Schedule clipboard clear
  const timer = setTimeout(async () => {
    try {
      const current = await navigator.clipboard.readText()
      if (current === target.commitValue) {
        await navigator.clipboard.writeText('')
      }
    } catch {
      // Cannot read clipboard to verify — acceptable
    }
  }, DEFAULT_MASKING.clipboardClearMs)
  _clipboardTimers.push(timer)
}

// ============================================================================
// §9  Event Handlers — Consent Security
// ============================================================================
//
// ATTACK CHAIN 3 — Programmatic Consent Bypass:
//
//   A page script detects the overlay and attempts to trigger "Insert"
//   without real user interaction.  Vectors:
//
//   3a. dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
//       → Blocked by isTrusted check (synthetic events have isTrusted=false)
//
//   3b. dispatchEvent(new MouseEvent('click'))
//       → Blocked by isTrusted check
//
//   3c. element.click()  (programmatic click — isTrusted=true in some
//       older specs, but coordinates are 0,0)
//       → Blocked by pointer-origin validation (coordinates must land
//         inside the Insert button's bounding rect)
//
//   3d. Repositioning a transparent overlay on top of the Insert button
//       so the user's real click on something else triggers our handler
//       → Blocked by pointer-origin validation (click coordinates vs.
//         button rect) + the overlay's own clickjacking detection in
//         the position watchdog
//
//   3e. dispatchEvent(new PointerEvent('click', { clientX, clientY }))
//       with correct coordinates but isTrusted=false
//       → Blocked by isTrusted check (PointerEvent inherits isTrusted)
//
// INVARIANT: onInsert() is NEVER called without passing through either
// onInsertClick() or onDocumentKeydown(), both of which enforce isTrusted
// and (for clicks) pointer-origin validation.
// ============================================================================

/**
 * Core insert action — called only after isTrusted + origin have been verified.
 *
 * IMPORTANT: This function MUST NOT be reachable from any code path that
 * does not first verify event.isTrusted === true.
 */
function onInsert(): void {
  if (!_resolve) return
  const trustChecked = getTrustCheckboxState()
  const resolve = _resolve
  emitTelemetryEvent('overlay_consent', { trustDomain: trustChecked })
  auditLog('info', 'OVERLAY_CONSENT', 'User consented to autofill insert')
  teardownInternal()
  resolve({ action: 'insert', trustDomain: trustChecked })
}

/**
 * Insert button click handler — enforces two independent checks:
 *
 *   1. isTrusted === true  (rejects dispatchEvent-based clicks)
 *   2. Pointer-origin validation  (rejects element.click() and
 *      CSS-repositioning clickjack attacks)
 *
 * Pointer-origin: the click's clientX/clientY must land within the
 * Insert button's bounding rect.  element.click() dispatches a click
 * with coordinates (0,0), which will fail this check unless the button
 * is at the top-left corner of the viewport — and even then, the
 * position watchdog would have already flagged the overlay.
 */
function onInsertClick(e: MouseEvent): void {
  // ── Gate 1: isTrusted ──
  if (!e.isTrusted) {
    auditLog('security', 'UNTRUSTED_INSERT_CLICK',
      'Rejected synthetic click on Insert button (isTrusted=false)')
    emitTelemetryEvent('consent_rejected', { reason: 'untrusted_click' })
    return
  }

  // ── Gate 2: Pointer-origin validation ──
  const btn = e.currentTarget as HTMLElement | null
  if (btn) {
    const rect = btn.getBoundingClientRect()
    const cx = e.clientX
    const cy = e.clientY

    // Allow a 1px tolerance for sub-pixel rounding
    const TOLERANCE = 1
    const inside =
      cx >= rect.left - TOLERANCE &&
      cx <= rect.right + TOLERANCE &&
      cy >= rect.top - TOLERANCE &&
      cy <= rect.bottom + TOLERANCE

    if (!inside) {
      auditLog('security', 'CLICK_ORIGIN_OUTSIDE_BUTTON',
        `Rejected click: (${cx},${cy}) outside button rect ` +
        `[${Math.round(rect.left)},${Math.round(rect.top)},` +
        `${Math.round(rect.right)},${Math.round(rect.bottom)}]`)
      emitTelemetryEvent('consent_rejected', {
        reason: 'pointer_origin_mismatch',
        cx, cy,
        rect_l: Math.round(rect.left), rect_t: Math.round(rect.top),
        rect_r: Math.round(rect.right), rect_b: Math.round(rect.bottom),
      })
      return
    }

    // ── Gate 3: Zero-coordinate heuristic ──
    //
    // element.click() in most browsers dispatches a MouseEvent with
    // clientX=0, clientY=0, which is a tell-tale sign of programmatic
    // invocation.  We reject it unless the button genuinely occupies
    // the viewport origin (rect includes 0,0) — an extremely unlikely
    // layout for our overlay.
    if (cx === 0 && cy === 0 && (rect.left > 1 || rect.top > 1)) {
      auditLog('security', 'ZERO_COORD_CLICK',
        'Rejected click with (0,0) coordinates — likely programmatic .click()')
      emitTelemetryEvent('consent_rejected', { reason: 'zero_coordinate_click' })
      return
    }
  }

  onInsert()
}

/**
 * Cancel action — safe to allow for both trusted and untrusted events.
 * Dismissing the overlay is never harmful.
 */
function onCancel(): void {
  if (!_resolve) return
  const resolve = _resolve
  emitTelemetryEvent('overlay_cancel', {})
  teardownInternal()
  resolve({ action: 'cancel' })
}

/**
 * Document-level keydown handler — enforces isTrusted for consent actions.
 *
 * Security gates for Enter (insert):
 *   1. isTrusted === true
 *   2. Event target is within our overlay shadow host
 *   3. Not targeting the Cancel button
 *
 * Escape (cancel) is allowed unconditionally — dismissing is safe.
 */
function onDocumentKeydown(e: KeyboardEvent): void {
  if (!_host) return

  // ── Escape: always allowed (cancel is safe) ──
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    onCancel()
    return
  }

  // ── Enter → Insert (requires full validation) ──
  if (e.key === 'Enter') {
    // Gate 1: isTrusted — reject synthetic keyboard events
    if (!e.isTrusted) {
      auditLog('security', 'UNTRUSTED_ENTER_KEY',
        'Rejected synthetic Enter keydown (isTrusted=false)')
      emitTelemetryEvent('consent_rejected', { reason: 'untrusted_enter' })
      return
    }

    // Gate 2: Event target origin — the focused element must be within
    // our overlay host (or the host itself).  This prevents a scenario
    // where the user presses Enter on a page element and our capture
    // listener intercepts it.
    const eventTarget = e.target as Node | null
    if (eventTarget && _host) {
      const inOverlay = _host === eventTarget ||
                        _host.contains(eventTarget) ||
                        e.composedPath().includes(_host)
      if (!inOverlay) {
        // Enter was pressed on a page element, not our overlay — ignore
        return
      }
    }

    // Gate 3: Not targeting Cancel button
    const targetEl = e.target as HTMLElement | null
    if (targetEl?.getAttribute('data-wrv-action') === 'cancel') return

    e.preventDefault()
    e.stopPropagation()
    onInsert()
  }
}

/**
 * Outside-click handler — dismisses the overlay (cancel, safe action).
 * No isTrusted check needed because cancel is non-destructive.
 */
function onOutsideClick(e: MouseEvent): void {
  if (!_host) return

  const path = e.composedPath()
  if (path.includes(_host)) return

  onCancel()
}

/**
 * Focus trap: Tab / Shift+Tab cycles within the card.
 */
function onCardKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || !_shadow) return

  const focusable = Array.from(
    _shadow.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((el) => el.offsetParent !== null)

  if (focusable.length === 0) return

  const active = _shadow.activeElement as HTMLElement | null
    ?? (_shadow.querySelector(':focus') as HTMLElement | null)
  const currentIndex = active ? focusable.indexOf(active) : -1

  if (e.shiftKey) {
    // Move backward
    const nextIndex = currentIndex <= 0 ? focusable.length - 1 : currentIndex - 1
    focusable[nextIndex].focus()
  } else {
    // Move forward
    const nextIndex = currentIndex >= focusable.length - 1 ? 0 : currentIndex + 1
    focusable[nextIndex].focus()
  }

  e.preventDefault()
}

// ============================================================================
// §10  Expire Timer
// ============================================================================

function startExpireTimer(ms: number): void {
  if (_expireTimer) clearTimeout(_expireTimer)
  _expireTimer = setTimeout(() => {
    if (_resolve) {
      const resolve = _resolve
      emitTelemetryEvent('overlay_expired', { timeoutMs: ms })
      auditLog('info', 'SESSION_EXPIRED', `Overlay session expired after ${ms}ms`)
      teardownInternal()
      resolve({ action: 'expired' })
    }
  }, ms)
}

// ============================================================================
// §11  Helpers
// ============================================================================

/** Typed createElement shorthand with attribute map. */
function el(tag: string, attrs: Record<string, string> = {}): HTMLElement {
  const node = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    node.setAttribute(k, v)
  }
  return node
}

function getTrustCheckboxState(): boolean {
  if (!_shadow) return false
  const cb = _shadow.querySelector<HTMLInputElement>('#wrv-trust-checkbox')
  return cb?.checked ?? false
}

// ============================================================================
// §12  Override Tokens (theme support)
// ============================================================================

/**
 * Apply a partial theme by overriding CSS custom properties at the :host level.
 *
 * Usage:
 *   applyTheme({ '--wrv-accent': '#10b981', '--wrv-overlay-bg': 'rgba(0,0,0,0.95)' })
 *
 * Call BEFORE showOverlay, or it will apply to the next overlay shown.
 * To reset, call applyTheme({}).
 */
const _themeOverrides: Partial<Record<string, string>> = {}

export function applyTheme(overrides: Partial<Record<string, string>>): void {
  // Clear previous
  for (const key of Object.keys(_themeOverrides)) {
    delete _themeOverrides[key]
  }
  // Apply new
  Object.assign(_themeOverrides, overrides)

  // Rebuild stylesheet with overrides
  _styleSheet = null // Force rebuild on next mount
}

/**
 * Retrieve all current CSS token values (defaults merged with overrides).
 * Useful for downstream code that needs to read token values programmatically.
 */
export function getTokens(): Record<string, string> {
  return { ...CSS_TOKENS, ..._themeOverrides }
}
