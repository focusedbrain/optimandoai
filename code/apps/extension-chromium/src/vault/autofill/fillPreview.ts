// ============================================================================
// WRVault Autofill — Fill Preview (Secure Overlay Previews)
// ============================================================================
//
// In Manual mode, credentials are NOT injected into the real DOM fields.
// Instead, secure Shadow DOM overlays are positioned over each field,
// visually showing the values. The page cannot read Shadow DOM content,
// preventing data exfiltration until the user explicitly clicks the
// site's login button.
//
// On submit interception:
//   1. Inject real values into the fields via setValueSafely
//   2. Remove all preview overlays
//   3. Re-trigger the form submission
//
// ============================================================================

import type { VaultItem, Field } from '../types'
import type { FieldCandidate } from '../../../../../packages/shared/src/vault/insertionPipeline'
import { setValueSafely, setPopoverFillActive } from './committer'
import { resolveSubmitTarget } from './submitGuard'
import { auditLog, emitTelemetryEvent } from './hardening'

// ============================================================================
// §1  Types
// ============================================================================

interface PreviewOverlay {
  host: HTMLElement
  element: HTMLInputElement
  value: string
  kind: string
}

// ============================================================================
// §2  State
// ============================================================================

let _overlays: PreviewOverlay[] = []
let _rafId: number | null = null
let _pendingItem: VaultItem | null = null
let _pendingCandidates: FieldCandidate[] = []
let _submitListener: ((e: Event) => void) | null = null
let _submitTarget: HTMLElement | null = null

// ============================================================================
// §3  Public API
// ============================================================================

/**
 * Show secure preview overlays over form fields without injecting values
 * into the real DOM. The page cannot access the credential data until
 * the user clicks the login button.
 */
export function showFillPreview(
  item: VaultItem,
  candidates: FieldCandidate[],
  _anchorElement?: HTMLElement | null,
): void {
  clearFillPreview()

  _pendingItem = item
  _pendingCandidates = candidates

  // Build value map: determine what value goes into each field
  const entries = resolveFieldValues(item, candidates)
  if (entries.length === 0) return

  // Create overlay for each field
  for (const entry of entries) {
    const overlay = createPreviewOverlay(entry.element, entry.value, entry.kind)
    if (overlay) {
      _overlays.push(overlay)
    }
  }

  if (_overlays.length === 0) return

  // Start position watchdog
  startPositionWatchdog()

  // Set up submit interception
  setupSubmitInterception(candidates)

  auditLog('info', 'FILL_PREVIEW_SHOWN', `Showing ${_overlays.length} secure preview overlay(s)`)
}

/**
 * Remove all preview overlays and clean up listeners.
 */
export function clearFillPreview(): void {
  for (const overlay of _overlays) {
    try { overlay.host.remove() } catch { /* noop */ }
  }
  _overlays = []
  _pendingItem = null
  _pendingCandidates = []

  if (_submitListener && _submitTarget) {
    _submitTarget.removeEventListener('click', _submitListener, true)
  }
  _submitListener = null
  _submitTarget = null

  stopPositionWatchdog()
}

/**
 * Whether preview overlays are currently active.
 */
export function isFillPreviewActive(): boolean {
  return _overlays.length > 0
}

// ============================================================================
// §4  Value Resolution
// ============================================================================

interface FieldValueEntry {
  element: HTMLInputElement
  value: string
  kind: string
}

function resolveFieldValues(
  item: VaultItem,
  candidates: FieldCandidate[],
): FieldValueEntry[] {
  const entries: FieldValueEntry[] = []

  for (const candidate of candidates) {
    const el = candidate.element as HTMLInputElement
    if (!el || !document.contains(el)) continue

    const matchedKind = candidate.matchedKind
    if (!matchedKind) continue

    const vaultField = findMatchingField(item, matchedKind)
    if (!vaultField || !vaultField.value) continue

    entries.push({ element: el, value: vaultField.value, kind: matchedKind })
  }

  return entries
}

function findMatchingField(item: VaultItem, kind: string): Field | null {
  const kindParts = kind.split('.')
  const fieldName = kindParts[kindParts.length - 1]

  for (const field of item.fields) {
    if (field.key === fieldName) return field
  }

  const keyMap: Record<string, string[]> = {
    'password': ['password', 'pass', 'pwd'],
    'new_password': ['password', 'new_password'],
    'username': ['username', 'user', 'login', 'email'],
    'email': ['email', 'e-mail', 'mail', 'username'],
  }

  const candidates = keyMap[fieldName] || [fieldName]
  for (const key of candidates) {
    for (const field of item.fields) {
      if (field.key.toLowerCase() === key.toLowerCase()) return field
    }
  }

  return null
}

// ============================================================================
// §5  Overlay Creation
// ============================================================================

function createPreviewOverlay(
  element: HTMLInputElement,
  value: string,
  kind: string,
): PreviewOverlay | null {
  const rect = element.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return null

  const host = document.createElement('div')
  host.setAttribute('data-wrv-fill-preview', '')
  host.style.cssText = 'position:fixed;z-index:2147483645;pointer-events:auto;'

  const shadow = host.attachShadow({ mode: 'closed' })

  const style = document.createElement('style')
  style.textContent = buildPreviewCSS()
  shadow.appendChild(style)

  const isPassword = kind.includes('password')
  const displayValue = isPassword ? '\u2022'.repeat(Math.min(value.length, 16)) : value

  const container = document.createElement('div')
  container.className = 'wrv-fp'

  const valueSpan = document.createElement('span')
  valueSpan.className = 'wrv-fp-value'
  valueSpan.textContent = displayValue
  container.appendChild(valueSpan)

  const dismiss = document.createElement('button')
  dismiss.className = 'wrv-fp-dismiss'
  dismiss.setAttribute('type', 'button')
  dismiss.setAttribute('aria-label', 'Dismiss preview')
  dismiss.textContent = '\u00d7'
  dismiss.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()
    clearFillPreview()
  })
  container.appendChild(dismiss)

  shadow.appendChild(container)
  document.documentElement.appendChild(host)
  positionOverlay(host, element)

  return { host, element, value, kind }
}

function positionOverlay(host: HTMLElement, anchor: HTMLElement): void {
  if (!host.isConnected) return
  const rect = anchor.getBoundingClientRect()
  if (rect.width === 0 && rect.height === 0) {
    host.style.display = 'none'
    return
  }
  host.style.display = ''
  host.style.top = `${rect.top}px`
  host.style.left = `${rect.left}px`
  host.style.width = `${rect.width}px`
  host.style.height = `${rect.height}px`
}

// ============================================================================
// §6  Position Watchdog
// ============================================================================

function startPositionWatchdog(): void {
  if (_rafId) return

  function tick() {
    const stillValid: PreviewOverlay[] = []
    for (const ov of _overlays) {
      if (!document.contains(ov.element)) {
        try { ov.host.remove() } catch { /* noop */ }
      } else {
        positionOverlay(ov.host, ov.element)
        stillValid.push(ov)
      }
    }
    _overlays = stillValid

    if (_overlays.length === 0) {
      clearFillPreview()
      return
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
// §7  Submit Interception
// ============================================================================

function setupSubmitInterception(candidates: FieldCandidate[]): void {
  let form: HTMLFormElement | null = null
  for (const candidate of candidates) {
    const el = candidate.element as HTMLElement
    if (el && document.contains(el)) {
      form = el.closest('form')
      if (form) break
    }
  }

  const submitEl = form ? resolveSubmitTarget(form) : findSubmitButtonOnPage()
  if (!submitEl) {
    auditLog('info', 'FILL_PREVIEW_NO_SUBMIT', 'No submit button found for preview interception')
    return
  }

  _submitTarget = submitEl

  _submitListener = (e: Event) => {
    e.preventDefault()
    e.stopImmediatePropagation()
    executePreviewFill(form, submitEl)
  }

  submitEl.addEventListener('click', _submitListener, true)
}

function executePreviewFill(
  form: HTMLFormElement | null,
  submitEl: HTMLElement,
): void {
  if (_overlays.length === 0) return

  setPopoverFillActive(true)
  let filledCount = 0

  try {
    for (const ov of _overlays) {
      if (!document.contains(ov.element)) continue
      const result = setValueSafely(ov.element, ov.value)
      if (result.success) filledCount++
    }
  } finally {
    setPopoverFillActive(false)
  }

  auditLog('info', 'FILL_PREVIEW_INJECTED', `Injected ${filledCount} fields on user submit`)
  emitTelemetryEvent('preview_fill_inject', { fieldCount: filledCount })

  // Clean up overlays and listener before re-submitting
  clearFillPreview()

  // Re-trigger the form submission after a short delay
  if (filledCount > 0) {
    setTimeout(() => {
      try {
        if (form && typeof form.requestSubmit === 'function') {
          if (submitEl instanceof HTMLButtonElement || submitEl instanceof HTMLInputElement) {
            form.requestSubmit(submitEl)
          } else {
            form.requestSubmit()
          }
        } else {
          submitEl.click()
        }
        auditLog('info', 'FILL_PREVIEW_SUBMIT', 'Form submitted after preview fill')
      } catch {
        try {
          submitEl.click()
        } catch {
          auditLog('warn', 'FILL_PREVIEW_SUBMIT_FAILED', 'Preview fill submit failed')
        }
      }
    }, 50)
  }
}

function findSubmitButtonOnPage(): HTMLElement | null {
  const buttonPatterns = [
    /log\s*in/i, /sign\s*in/i, /anmeld/i, /einloggen/i,
    /submit/i, /continue/i, /weiter/i, /next/i,
    /sign\s*up/i, /register/i, /registrier/i, /erstellen/i,
  ]

  const allButtons = document.querySelectorAll<HTMLElement>(
    'button, input[type="submit"], a[role="button"]',
  )

  for (const btn of allButtons) {
    const text = (btn.textContent || (btn as HTMLInputElement).value || '').trim()
    const rect = btn.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue

    for (const pattern of buttonPatterns) {
      if (pattern.test(text)) return btn
    }
  }

  return null
}

// ============================================================================
// §8  CSS
// ============================================================================

function buildPreviewCSS(): string {
  return `
    :host { all: initial; display: block; }
    .wrv-fp {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      padding: 0 10px;
      background: rgba(255, 255, 255, 0.97);
      border: 2px solid #22c55e;
      border-radius: 4px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      cursor: default;
      overflow: hidden;
    }
    .wrv-fp-value {
      flex: 1;
      font-size: 14px;
      color: #1e293b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      letter-spacing: 0.2px;
      user-select: none;
    }
    .wrv-fp-dismiss {
      flex-shrink: 0;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      border: none;
      background: rgba(0, 0, 0, 0.08);
      color: #64748b;
      font-size: 14px;
      line-height: 1;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      margin-left: 6px;
      transition: background 0.15s ease, color 0.15s ease;
    }
    .wrv-fp-dismiss:hover {
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }
  `
}
