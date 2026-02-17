// ============================================================================
// WRVault QSO Remap — Mapping Wizard (Shadow DOM UI)
// ============================================================================
//
// A lightweight 3(+1)-step wizard for binding a vault credential to a
// login form's DOM elements.  Steps:
//   1. Select username/email field (skippable for password-only)
//   2. Select password field
//   3. Select sign-in button
//   4. Confirm summary
//
// The wizard uses a small inline panel anchored near the anchor element.
// Keyboard-friendly: ESC cancels, Tab navigates, Enter confirms.
// Runs inside a closed Shadow DOM.
//
// Security contract:
//   - No DOM writes to page inputs (read-only element picking).
//   - isTrusted validated on element selection clicks.
//   - Cross-origin iframe elements are rejected.
//   - Element picks validated with guardElement before acceptance.
// ============================================================================

import { guardElement, auditLogSafe } from '../hardening'
import { isHAEnforced } from '../haGuard'
import { buildElementMapping } from './selectorStrategy'
import type { ElementMapping } from './selectorStrategy'

// ============================================================================
// §1  Types
// ============================================================================

export interface WizardResult {
  username: ElementMapping | null
  password: ElementMapping
  submit: ElementMapping
}

export interface WizardHandle {
  remove: () => void
  host: HTMLElement
}

export type WizardCompleteCallback = (result: WizardResult) => void
export type WizardCancelCallback = () => void

export interface WizardOptions {
  /** Anchor element for positioning the wizard panel. */
  anchor: HTMLElement
  /** Whether to include a username selection step. */
  includeUsername: boolean
  /** Callback on successful completion. */
  onComplete: WizardCompleteCallback
  /** Callback on cancellation. */
  onCancel: WizardCancelCallback
  /** Pre-detected elements to pre-fill (skip step if set). */
  preDetected?: {
    username?: HTMLElement
    password?: HTMLElement
    submit?: HTMLElement
  }
}

type WizardStep = 'username' | 'password' | 'submit' | 'confirm'

// ============================================================================
// §2  State
// ============================================================================

let _activeWizard: WizardHandle | null = null

// ============================================================================
// §3  Public API
// ============================================================================

/**
 * Show the mapping wizard panel.
 *
 * The wizard guides the user through selecting login form elements.
 * Each selection requires a real isTrusted click on the target element.
 * Singleton: replaces any existing wizard.
 */
export function showMappingWizard(options: WizardOptions): WizardHandle {
  hideMappingWizard()

  const host = document.createElement('div')
  host.id = 'wrv-mapping-wizard'
  host.setAttribute('data-wrv-wizard', 'true')
  host.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:auto;'

  const shadow = host.attachShadow({ mode: 'closed' })

  const sheet = new CSSStyleSheet()
  sheet.replaceSync(buildWizardCSS())
  shadow.adoptedStyleSheets = [sheet]

  // --- Wizard state ---
  const steps: WizardStep[] = options.includeUsername
    ? ['username', 'password', 'submit', 'confirm']
    : ['password', 'submit', 'confirm']

  let stepIndex = 0
  let usernameMapping: ElementMapping | null = null
  let passwordMapping: ElementMapping | null = null
  let submitMapping: ElementMapping | null = null

  // Pre-fill from pre-detected elements
  if (options.preDetected?.username && options.includeUsername) {
    usernameMapping = buildElementMapping(options.preDetected.username, 'username')
    // Skip username step if pre-detected
    if (steps[0] === 'username') stepIndex = 1
  }
  if (options.preDetected?.password) {
    passwordMapping = buildElementMapping(options.preDetected.password, 'password')
    // Skip password step
    while (stepIndex < steps.length && steps[stepIndex] === 'password') stepIndex++
  }
  if (options.preDetected?.submit) {
    submitMapping = buildElementMapping(options.preDetected.submit, 'submit')
    while (stepIndex < steps.length && steps[stepIndex] === 'submit') stepIndex++
  }

  // --- UI elements ---
  const container = document.createElement('div')
  container.className = 'wrv-wizard'

  const header = document.createElement('div')
  header.className = 'wrv-wizard-header'
  const headerTitle = document.createElement('span')
  headerTitle.className = 'wrv-wizard-title'
  const cancelBtn = document.createElement('button')
  cancelBtn.className = 'wrv-wizard-cancel'
  cancelBtn.textContent = 'Cancel'
  cancelBtn.setAttribute('aria-label', 'Cancel mapping')
  header.appendChild(headerTitle)
  header.appendChild(cancelBtn)

  const body = document.createElement('div')
  body.className = 'wrv-wizard-body'

  const footer = document.createElement('div')
  footer.className = 'wrv-wizard-footer'

  const skipBtn = document.createElement('button')
  skipBtn.className = 'wrv-wizard-skip'
  skipBtn.textContent = 'Skip'

  const backBtn = document.createElement('button')
  backBtn.className = 'wrv-wizard-back'
  backBtn.textContent = 'Back'

  const confirmBtn = document.createElement('button')
  confirmBtn.className = 'wrv-wizard-confirm'
  confirmBtn.textContent = 'Save mapping'

  container.appendChild(header)
  container.appendChild(body)
  container.appendChild(footer)
  shadow.appendChild(container)

  // --- Page highlight for element picking ---
  let highlightEl: HTMLElement | null = null
  let pageClickHandler: ((e: MouseEvent) => void) | null = null
  let pageMoveHandler: ((e: MouseEvent) => void) | null = null

  function startElementPick(
    role: 'username' | 'password' | 'submit',
    callback: (el: HTMLElement) => void,
  ) {
    stopElementPick()

    body.innerHTML = ''
    const instruction = document.createElement('div')
    instruction.className = 'wrv-wizard-instruction'
    instruction.textContent = getStepInstruction(role)
    body.appendChild(instruction)

    const hint = document.createElement('div')
    hint.className = 'wrv-wizard-hint'
    hint.textContent = 'Click the element on the page, or press Escape to cancel.'
    body.appendChild(hint)

    // Highlight on hover
    pageMoveHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target || host.contains(target)) return
      clearHighlight()
      target.style.outline = '2px solid #4f8cff'
      target.style.outlineOffset = '-1px'
      highlightEl = target
    }

    // Pick on click
    pageClickHandler = (e: MouseEvent) => {
      if (!e.isTrusted) return
      e.preventDefault()
      e.stopImmediatePropagation()

      const target = e.target as HTMLElement
      if (!target || host.contains(target)) return

      clearHighlight()

      // Validate picked element
      const guard = guardElement(target)
      if (!guard.safe) {
        showStepError(body, 'This element cannot be selected (hidden or blocked).')
        return
      }

      // Cross-origin check
      if (isInCrossOriginFrame(target)) {
        showStepError(body, 'Cannot select elements in cross-origin iframes.')
        return
      }

      // Role-specific validation
      if (role === 'password') {
        const input = target as HTMLInputElement
        if (input.tagName !== 'INPUT' || input.type !== 'password') {
          showStepError(body, 'Please select a password input field.')
          return
        }
      }
      if (role === 'username') {
        const input = target as HTMLInputElement
        const validTypes = ['text', 'email', 'tel', '']
        if (input.tagName !== 'INPUT' || !validTypes.includes(input.type?.toLowerCase())) {
          showStepError(body, 'Please select a username or email input field.')
          return
        }
      }
      if (role === 'submit') {
        const tag = target.tagName
        if (tag !== 'BUTTON' && tag !== 'INPUT' && target.getAttribute('role') !== 'button') {
          showStepError(body, 'Please select a button or submit element.')
          return
        }
      }

      stopElementPick()
      callback(target)
    }

    document.addEventListener('mousemove', pageMoveHandler, { capture: true })
    document.addEventListener('click', pageClickHandler, { capture: true })
  }

  function stopElementPick() {
    clearHighlight()
    if (pageClickHandler) {
      document.removeEventListener('click', pageClickHandler, { capture: true })
      pageClickHandler = null
    }
    if (pageMoveHandler) {
      document.removeEventListener('mousemove', pageMoveHandler, { capture: true })
      pageMoveHandler = null
    }
  }

  function clearHighlight() {
    if (highlightEl) {
      highlightEl.style.outline = ''
      highlightEl.style.outlineOffset = ''
      highlightEl = null
    }
  }

  function showStepError(parent: HTMLElement, msg: string) {
    const existing = parent.querySelector('.wrv-wizard-error')
    if (existing) existing.remove()
    const err = document.createElement('div')
    err.className = 'wrv-wizard-error'
    err.textContent = msg
    parent.appendChild(err)
    setTimeout(() => err.remove(), 3000)
  }

  // --- Step rendering ---
  function renderStep() {
    stopElementPick()
    body.innerHTML = ''
    footer.innerHTML = ''

    const step = steps[stepIndex]
    headerTitle.textContent = `Map login form (${stepIndex + 1}/${steps.length})`

    if (step === 'username') {
      startElementPick('username', (el) => {
        usernameMapping = buildElementMapping(el, 'username')
        stepIndex++
        renderStep()
      })
      // Allow skipping username (password-only sites)
      footer.appendChild(skipBtn)
      skipBtn.onclick = () => {
        usernameMapping = null
        stepIndex++
        renderStep()
      }
    } else if (step === 'password') {
      startElementPick('password', (el) => {
        passwordMapping = buildElementMapping(el, 'password')
        stepIndex++
        renderStep()
      })
    } else if (step === 'submit') {
      startElementPick('submit', (el) => {
        submitMapping = buildElementMapping(el, 'submit')
        stepIndex++
        renderStep()
      })
    } else if (step === 'confirm') {
      renderConfirmation()
    }

    // Back button (if not first step)
    if (stepIndex > 0 && step !== 'confirm') {
      footer.insertBefore(backBtn, footer.firstChild)
      backBtn.onclick = () => {
        stepIndex--
        renderStep()
      }
    }
  }

  function renderConfirmation() {
    if (!passwordMapping || !submitMapping) {
      showStepError(body, 'Missing required elements. Please go back.')
      return
    }

    const summary = document.createElement('div')
    summary.className = 'wrv-wizard-summary'

    const hostname = window.location.hostname

    summary.innerHTML = ''
    const items: string[] = [
      `<div class="wrv-summary-row"><span class="wrv-summary-label">Site:</span> <span>${escapeHtml(hostname)}</span></div>`,
    ]
    if (usernameMapping) {
      items.push(`<div class="wrv-summary-row"><span class="wrv-summary-label">Username field:</span> <span class="wrv-summary-mono">${escapeHtml(usernameMapping.selector)}</span></div>`)
    }
    items.push(`<div class="wrv-summary-row"><span class="wrv-summary-label">Password field:</span> <span class="wrv-summary-mono">${escapeHtml(passwordMapping.selector)}</span></div>`)
    items.push(`<div class="wrv-summary-row"><span class="wrv-summary-label">Submit button:</span> <span class="wrv-summary-mono">${escapeHtml(submitMapping.selector)}</span></div>`)

    summary.innerHTML = items.join('')
    body.appendChild(summary)

    footer.innerHTML = ''
    footer.appendChild(backBtn)
    footer.appendChild(confirmBtn)

    backBtn.onclick = () => {
      stepIndex--
      renderStep()
    }

    confirmBtn.onclick = () => {
      hideMappingWizard()
      options.onComplete({
        username: usernameMapping,
        password: passwordMapping!,
        submit: submitMapping!,
      })
    }
  }

  // --- Cancel ---
  cancelBtn.addEventListener('click', () => {
    hideMappingWizard()
    options.onCancel()
  })

  // ESC to cancel
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      hideMappingWizard()
      options.onCancel()
    }
  }
  document.addEventListener('keydown', escHandler, { capture: true })

  // --- Position & mount ---
  document.documentElement.appendChild(host)
  const anchorRect = options.anchor.getBoundingClientRect()
  host.style.top = `${anchorRect.bottom + 8}px`
  host.style.left = `${Math.max(8, anchorRect.left - 100)}px`

  // Initial render
  renderStep()

  const handle: WizardHandle = {
    host,
    remove: () => {
      stopElementPick()
      document.removeEventListener('keydown', escHandler, { capture: true })
      host.remove()
      if (_activeWizard === handle) _activeWizard = null
    },
  }

  _activeWizard = handle
  return handle
}

/** Hide the active mapping wizard. */
export function hideMappingWizard(): void {
  if (_activeWizard) {
    _activeWizard.remove()
    _activeWizard = null
  }
}

/** Whether the mapping wizard is currently visible. */
export function isMappingWizardVisible(): boolean {
  return _activeWizard !== null && _activeWizard.host.isConnected
}

// ============================================================================
// §4  Helpers
// ============================================================================

function getStepInstruction(role: 'username' | 'password' | 'submit'): string {
  switch (role) {
    case 'username': return 'Click the username or email input field on the page.'
    case 'password': return 'Click the password input field on the page.'
    case 'submit': return 'Click the sign-in / submit button on the page.'
  }
}

function isInCrossOriginFrame(el: HTMLElement): boolean {
  try {
    const win = el.ownerDocument?.defaultView
    if (!win) return true
    const _origin = win.location.origin
    return false
  } catch {
    return true
  }
}

function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, c => {
    switch (c) {
      case '&': return '&amp;'
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '"': return '&quot;'
      case "'": return '&#39;'
      default: return c
    }
  })
}

// ============================================================================
// §5  Styles
// ============================================================================

function buildWizardCSS(): string {
  return `
:host { all: initial; display: block; }
.wrv-wizard {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.14);
  width: 300px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 13px;
  color: #111827;
  overflow: hidden;
}
.wrv-wizard-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #f3f4f6;
  background: #fafbfc;
}
.wrv-wizard-title {
  font-weight: 600;
  font-size: 12px;
  color: #6b7280;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.wrv-wizard-cancel {
  all: unset;
  font-size: 12px;
  color: #9ca3af;
  cursor: pointer;
}
.wrv-wizard-cancel:hover { color: #ef4444; }
.wrv-wizard-body {
  padding: 14px;
  min-height: 60px;
}
.wrv-wizard-instruction {
  font-weight: 500;
  margin-bottom: 6px;
  color: #374151;
}
.wrv-wizard-hint {
  font-size: 11px;
  color: #9ca3af;
  margin-bottom: 4px;
}
.wrv-wizard-error {
  margin-top: 8px;
  padding: 6px 10px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 6px;
  color: #dc2626;
  font-size: 12px;
}
.wrv-wizard-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 14px;
  border-top: 1px solid #f3f4f6;
  background: #fafbfc;
}
.wrv-wizard-skip, .wrv-wizard-back {
  all: unset;
  font-size: 12px;
  color: #6b7280;
  cursor: pointer;
  padding: 4px 10px;
  border-radius: 5px;
}
.wrv-wizard-skip:hover, .wrv-wizard-back:hover { background: #f3f4f6; }
.wrv-wizard-confirm {
  all: unset;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: #2563eb;
  cursor: pointer;
  padding: 5px 14px;
  border-radius: 5px;
}
.wrv-wizard-confirm:hover { background: #1d4ed8; }
.wrv-wizard-summary { line-height: 1.7; }
.wrv-summary-row {
  display: flex;
  gap: 6px;
  align-items: baseline;
  font-size: 12px;
}
.wrv-summary-label {
  font-weight: 500;
  color: #6b7280;
  flex-shrink: 0;
}
.wrv-summary-mono {
  font-family: 'SF Mono', Consolas, monospace;
  font-size: 11px;
  color: #374151;
  word-break: break-all;
}
`
}
