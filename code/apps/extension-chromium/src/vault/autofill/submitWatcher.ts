// ============================================================================
// WRVault Autofill — Submit Watcher (Credential Capture)
// ============================================================================
//
// Detects when a user submits login/signup credentials and extracts them for
// the "Save Password" flow.
//
// Detection vectors:
//   1. <form> submit event (native)
//   2. beforeunload after password field was interacted with
//   3. XHR/fetch interception (SPA auth flows — POST to auth-like URLs)
//   4. pushState/replaceState navigation after password interaction
//
// False-positive prevention:
//   - Ignores payment/checkout forms (card-number, CVV, expiry fields)
//   - Ignores forms where password field is empty
//   - Ignores forms with < 2 char password (likely placeholder/invalid)
//   - Ignores search forms and filter forms
//   - Debounces: same credentials within 3s are not re-triggered
//
// Security:
//   - Extracted values are held in-memory only (never persisted to storage)
//   - Values are cleared when the save-bar dismisses
//   - No credentials are sent anywhere without explicit user consent
//
// Implements: ISubmitWatcher from insertionPipeline.ts
// ============================================================================

import type {
  ExtractedCredentials,
  ISubmitWatcher,
} from '../../../../../packages/shared/src/vault/insertionPipeline'
import type { FormContext } from '../../../../../packages/shared/src/vault/fieldTaxonomy'
import { FORM_CONTEXT_SIGNALS } from '../../../../../packages/shared/src/vault/fieldTaxonomy'
import { classifyFormIntent } from './fieldScanner'

// ============================================================================
// §1  Constants
// ============================================================================

/** Minimum password length to consider valid. */
const MIN_PASSWORD_LENGTH = 2

/** Debounce window: ignore duplicate credentials within this period. */
const DEDUP_WINDOW_MS = 3000

/** Auto-dismiss timeout for save bar (ms). */
export const SAVE_BAR_TIMEOUT_MS = 30_000

/** URL patterns that indicate auth-related XHR/fetch calls (login + registration). */
const AUTH_URL_PATTERNS = [
  /\/log[_\-.]?in/i,
  /\/sign[_\-.]?in/i,
  /\/sign[_\-.]?up/i,
  /\/register/i,
  /\/registrieren/i,
  /\/create[_\-.]?account/i,
  /\/auth/i,
  /\/session/i,
  /\/token/i,
  /\/api\/v?\d*\/?(?:log[_\-.]?in|sign[_\-.]?in|auth|register|signup|sign[_\-.]?up|create[_\-.]?account)/i,
  /\/anmeld/i,
  /\/oauth/i,
  /\/sso/i,
]

/** Form/field patterns that indicate PAYMENT forms (suppress save-password). */
const PAYMENT_PATTERNS = {
  /** Input name/id patterns for credit card fields. */
  cardFields: /(?:card[_\-.]?(?:number|num|no)|cc[_\-.]?(?:number|num|no)|credit[_\-.]?card|kartennummer)/i,
  cvvFields: /(?:cvv|cvc|cvv2|cvc2|security[_\-.]?code|sicherheitscode|kartenprüfnummer)/i,
  expiryFields: /(?:expir|ablauf|gültig|exp[_\-.]?(?:date|month|year|mm|yy))/i,
  /** Autocomplete attributes for payment. */
  paymentAutocomplete: /^cc-/,
  /** Form action/class patterns for checkout/payment. */
  paymentFormPatterns: /(?:payment|checkout|bezahl|kasse|stripe|braintree|adyen|paypal)/i,
}

// ============================================================================
// §2  State
// ============================================================================

let _running = false
let _callbacks: Array<(creds: ExtractedCredentials) => void> = []
let _lastExtracted: { hash: string; at: number } | null = null
let _interactedPasswordFields = new WeakSet<HTMLElement>()
let _formSubmitHandler: ((e: Event) => void) | null = null
let _beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null
let _originalFetch: typeof fetch | null = null
let _originalXHROpen: typeof XMLHttpRequest.prototype.open | null = null
let _originalPushState: typeof history.pushState | null = null
let _originalReplaceState: typeof history.replaceState | null = null
let _passwordFocusHandler: ((e: FocusEvent) => void) | null = null
let _passwordInputHandler: ((e: Event) => void) | null = null

/** Pending registration credential waiting for success confirmation. */
let _pendingRegCreds: { creds: ExtractedCredentials; form: WeakRef<HTMLFormElement>; path: string } | null = null
let _regSuccessTimer: ReturnType<typeof setTimeout> | null = null
let _regSuccessObserver: MutationObserver | null = null

/** How long to wait for a registration success signal (ms). */
const REG_SUCCESS_TIMEOUT_MS = 8000

/** Text patterns that indicate a successful registration / account creation. */
const REG_SUCCESS_TEXT = /(?:welcome|account\s*created|registration\s*(?:successful|complete)|verify\s*(?:your\s*)?email|check\s*(?:your\s*)?(?:inbox|email)|willkommen|konto\s*erstellt|registrierung\s*(?:erfolgreich|abgeschlossen))/i

// ============================================================================
// §3  Public API (implements ISubmitWatcher)
// ============================================================================

/**
 * Start watching for credential submissions.
 *
 * Hooks:
 *   - form submit events (capture phase)
 *   - beforeunload (catch navigating-away submissions)
 *   - fetch/XHR interception (SPA auth calls)
 *   - history.pushState/replaceState (SPA navigation after auth)
 *   - password field interaction tracking
 */
export function startSubmitWatcher(): void {
  if (_running) return
  _running = true

  // Track password field interactions
  _passwordFocusHandler = (e: FocusEvent) => {
    const target = e.target as HTMLElement
    if (isPasswordField(target)) {
      _interactedPasswordFields.add(target)
    }
  }
  _passwordInputHandler = (e: Event) => {
    const target = e.target as HTMLElement
    if (isPasswordField(target)) {
      _interactedPasswordFields.add(target)
    }
  }
  document.addEventListener('focusin', _passwordFocusHandler, true)
  document.addEventListener('input', _passwordInputHandler, true)

  // Hook form submit (capture phase to run before form navigation)
  _formSubmitHandler = (e: Event) => {
    const form = e.target as HTMLFormElement
    if (form.tagName !== 'FORM') return
    handleFormSubmit(form)
  }
  document.addEventListener('submit', _formSubmitHandler, true)

  // Hook beforeunload — catch cases where submit causes navigation
  // without a submit event (e.g., link-based login buttons)
  _beforeUnloadHandler = () => {
    // If there are pending registration credentials waiting for success,
    // the page navigating away IS the success signal — commit them.
    if (_pendingRegCreds) {
      commitPendingRegistration()
      return
    }
    tryExtractFromActivePasswordField()
  }
  window.addEventListener('beforeunload', _beforeUnloadHandler)

  // Hook fetch for SPA auth detection
  hookFetch()

  // Hook XHR for SPA auth detection
  hookXHR()

  // Hook history API for SPA navigation detection
  hookHistory()
}

/**
 * Stop watching for credential submissions.
 * Cleans up all hooks and listeners.
 */
export function stopSubmitWatcher(): void {
  if (!_running) return
  _running = false

  if (_formSubmitHandler) {
    document.removeEventListener('submit', _formSubmitHandler, true)
    _formSubmitHandler = null
  }
  if (_beforeUnloadHandler) {
    window.removeEventListener('beforeunload', _beforeUnloadHandler)
    _beforeUnloadHandler = null
  }
  if (_passwordFocusHandler) {
    document.removeEventListener('focusin', _passwordFocusHandler, true)
    _passwordFocusHandler = null
  }
  if (_passwordInputHandler) {
    document.removeEventListener('input', _passwordInputHandler, true)
    _passwordInputHandler = null
  }

  // Restore fetch
  if (_originalFetch) {
    window.fetch = _originalFetch
    _originalFetch = null
  }

  // Restore XHR
  if (_originalXHROpen) {
    XMLHttpRequest.prototype.open = _originalXHROpen
    _originalXHROpen = null
  }

  // Restore history
  if (_originalPushState) {
    history.pushState = _originalPushState
    _originalPushState = null
  }
  if (_originalReplaceState) {
    history.replaceState = _originalReplaceState
    _originalReplaceState = null
  }

  // Clean up pending registration
  cancelPendingRegistration()

  _callbacks = []
  _lastExtracted = null
  _interactedPasswordFields = new WeakSet()
}

/**
 * Register a callback for credential submission detection.
 * Returns an unsubscribe function.
 */
export function onCredentialSubmit(
  callback: (creds: ExtractedCredentials) => void,
): () => void {
  _callbacks.push(callback)
  return () => {
    _callbacks = _callbacks.filter(cb => cb !== callback)
  }
}

// ============================================================================
// §4  Form Submit Handler
// ============================================================================

/** Handle a native <form> submit event. */
function handleFormSubmit(form: HTMLFormElement): void {
  // Skip payment forms
  if (isPaymentForm(form)) return

  // Find password field(s) in the form
  const passwordFields = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ).filter(f => f.value.length >= MIN_PASSWORD_LENGTH)

  if (passwordFields.length === 0) return

  // Find username/email field
  const usernameField = findUsernameField(form)

  // Determine form type (login vs signup vs password_change)
  const formType = classifyFormType(form, passwordFields)

  // ── Confirm-password mismatch guard ──
  // If this is a signup/password_change form with 2+ password fields that
  // have different values, the user likely has a typo — skip extraction.
  if ((formType === 'signup' || formType === 'password_change') && passwordFields.length >= 2) {
    const vals = passwordFields.map(f => f.value)
    const newPwField = passwordFields.find(f =>
      f.autocomplete === 'new-password' ||
      /(?:new|confirm|repeat|re[_\-.]?enter)/i.test(f.name + f.id),
    )
    const confirmFields = passwordFields.filter(f => f !== newPwField && f.autocomplete !== 'current-password')
    if (newPwField && confirmFields.length > 0) {
      const mismatch = confirmFields.some(f => f.value !== newPwField.value)
      if (mismatch) return
    } else if (passwordFields.length === 2 && vals[0] !== vals[1]) {
      // Two password fields with different values — likely a mismatch
      return
    }
  }

  // Use the first non-empty password (for login), or the "new-password" if signup
  const password = selectPassword(passwordFields, formType)
  if (!password) return

  const creds: ExtractedCredentials = {
    domain: window.location.origin,
    username: usernameField?.value?.trim() ?? '',
    password,
    formAction: form.action || undefined,
    formType,
    extractedAt: Date.now(),
  }

  // ── Registration: defer emission until success signal ──
  if (formType === 'signup') {
    waitForRegistrationSuccess(creds, form)
    return
  }

  emitCredentials(creds)
}

// ============================================================================
// §5  SPA Detection — Fetch/XHR Interception
// ============================================================================

/**
 * Hook window.fetch to detect auth-related POST requests.
 * After a successful auth call, extract credentials from the DOM.
 */
function hookFetch(): void {
  _originalFetch = window.fetch
  window.fetch = async function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const result = _originalFetch!.call(this, input, init)

    // Only intercept POST/PUT requests to auth-like URLs
    const method = init?.method?.toUpperCase() ?? 'GET'
    if (method !== 'POST' && method !== 'PUT') return result

    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    if (!isAuthURL(url)) return result

    // After the fetch completes, check if there are credentials to capture
    result.then((response) => {
      if (response.ok || response.status === 302 || response.status === 301) {
        // Delay slightly to let the SPA update the UI
        setTimeout(() => tryExtractFromActivePasswordField(), 300)
      }
    }).catch(() => { /* ignore network errors */ })

    return result
  }
}

/**
 * Hook XMLHttpRequest.open to detect auth-related requests.
 */
function hookXHR(): void {
  _originalXHROpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function patchedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: any[]
  ) {
    const urlStr = typeof url === 'string' ? url : url.href
    if ((method === 'POST' || method === 'PUT') && isAuthURL(urlStr)) {
      this.addEventListener('load', () => {
        if (this.status >= 200 && this.status < 400) {
          setTimeout(() => tryExtractFromActivePasswordField(), 300)
        }
      })
    }
    return (_originalXHROpen as any).call(this, method, url, ...rest)
  }
}

/**
 * Hook history.pushState/replaceState to detect SPA navigation after login.
 */
function hookHistory(): void {
  _originalPushState = history.pushState
  _originalReplaceState = history.replaceState

  history.pushState = function patchedPushState(...args: Parameters<typeof history.pushState>) {
    _originalPushState!.apply(this, args)
    setTimeout(() => tryExtractFromActivePasswordField(), 200)
  }

  history.replaceState = function patchedReplaceState(...args: Parameters<typeof history.replaceState>) {
    _originalReplaceState!.apply(this, args)
    setTimeout(() => tryExtractFromActivePasswordField(), 200)
  }
}

// ============================================================================
// §6  Credential Extraction
// ============================================================================

/**
 * Attempt to extract credentials from any password field that was
 * recently interacted with.  Used by SPA hooks and beforeunload.
 */
function tryExtractFromActivePasswordField(): void {
  // Find all password fields that were interacted with and still have values
  const allPasswords = document.querySelectorAll<HTMLInputElement>('input[type="password"]')
  for (const pwField of allPasswords) {
    if (!_interactedPasswordFields.has(pwField)) continue
    if (pwField.value.length < MIN_PASSWORD_LENGTH) continue

    // Find the enclosing form (if any)
    const form = pwField.closest('form')

    // Skip payment forms
    if (form && isPaymentForm(form as HTMLFormElement)) continue

    // Find username
    const usernameField = form
      ? findUsernameField(form as HTMLFormElement)
      : findUsernameNearPassword(pwField)

    const passwordFields = form
      ? Array.from(form.querySelectorAll<HTMLInputElement>('input[type="password"]')).filter(f => f.value.length >= MIN_PASSWORD_LENGTH)
      : [pwField]

    const formType = form
      ? classifyFormType(form as HTMLFormElement, passwordFields)
      : 'unknown'

    const creds: ExtractedCredentials = {
      domain: window.location.origin,
      username: usernameField?.value?.trim() ?? '',
      password: pwField.value,
      formAction: (form as HTMLFormElement)?.action || undefined,
      formType,
      extractedAt: Date.now(),
    }

    // ── Registration: defer emission until success signal ──
    if (formType === 'signup' && form) {
      waitForRegistrationSuccess(creds, form as HTMLFormElement)
      return
    }

    emitCredentials(creds)
    return // Only emit once per trigger
  }
}

/**
 * Find the username/email field in a form.
 *
 * Strategy (ordered by priority):
 *   1. input[autocomplete="username"] or [autocomplete="email"]
 *   2. input[type="email"]
 *   3. input[name/id matching username/email patterns]
 *   4. First visible text input before the first password field
 */
function findUsernameField(form: HTMLFormElement): HTMLInputElement | null {
  // 1. Autocomplete attributes
  const byAutocomplete = form.querySelector<HTMLInputElement>(
    'input[autocomplete="username"], input[autocomplete="email"]',
  )
  if (byAutocomplete && byAutocomplete.value) return byAutocomplete

  // 2. Email type
  const byType = form.querySelector<HTMLInputElement>('input[type="email"]')
  if (byType && byType.value) return byType

  // 3. Name/id patterns
  const allInputs = form.querySelectorAll<HTMLInputElement>('input:not([type="hidden"]):not([type="password"]):not([type="submit"])')
  const usernameRegex = /(?:user[_\-.]?name|login[_\-.]?id|email|e[_\-.]?mail|user|uid|identifier|benutzername|anmeldename)/i
  for (const input of allInputs) {
    if (usernameRegex.test(input.name) || usernameRegex.test(input.id)) {
      if (input.value) return input
    }
  }

  // 4. First visible text input before the password field
  const firstPassword = form.querySelector<HTMLInputElement>('input[type="password"]')
  if (firstPassword) {
    const allVisible = Array.from(allInputs).filter(el => {
      const type = el.type.toLowerCase()
      return type === 'text' || type === 'email' || type === 'tel' || type === ''
    })
    for (const input of allVisible) {
      if (input.value && form.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_PRECEDING) {
        return input
      }
    }
    // Fallback: first visible input with value
    const first = allVisible.find(i => i.value)
    if (first) return first
  }

  return null
}

/**
 * Find a username field near a password field when there's no enclosing form.
 * Searches among siblings and nearby inputs in the DOM.
 */
function findUsernameNearPassword(pwField: HTMLInputElement): HTMLInputElement | null {
  const parent = pwField.parentElement?.parentElement ?? pwField.parentElement ?? document.body
  const inputs = parent.querySelectorAll<HTMLInputElement>(
    'input[type="text"], input[type="email"], input[autocomplete="username"], input[autocomplete="email"]',
  )
  const usernameRegex = /(?:user[_\-.]?name|login|email|e[_\-.]?mail|user|uid|benutzername)/i
  for (const input of inputs) {
    if (input === pwField) continue
    if (usernameRegex.test(input.name) || usernameRegex.test(input.id) || input.type === 'email') {
      if (input.value) return input
    }
  }
  // Fallback: first non-password input with a value
  for (const input of inputs) {
    if (input !== pwField && input.value) return input
  }
  return null
}

/**
 * Select the appropriate password from multiple password fields.
 * For login: use the first (only) password field.
 * For signup: use the "new-password" field, or the first if ambiguous.
 */
function selectPassword(
  fields: HTMLInputElement[],
  formType: ExtractedCredentials['formType'],
): string | null {
  if (fields.length === 0) return null
  if (fields.length === 1) return fields[0].value

  // Multiple password fields → likely signup (password + confirm)
  // Use the first one (the "new password"), ignore the confirmation
  const newPw = fields.find(f =>
    f.autocomplete === 'new-password' ||
    /(?:new[_\-.]?pass|create[_\-.]?pass|passwort[_\-.]?erstellen)/i.test(f.name + f.id),
  )
  if (newPw) return newPw.value

  // If both have the same value, it's a confirm pattern — use either
  if (fields.length === 2 && fields[0].value === fields[1].value) {
    return fields[0].value
  }

  // Fallback: first non-empty password
  return fields[0].value
}

// ============================================================================
// §7  Form Classification
// ============================================================================

/**
 * Classify a form as login, signup, password_change, or unknown.
 *
 * Delegates to the shared scoring-based classifier in fieldScanner.ts
 * and maps the full FormContext to the credential-relevant subset.
 */
function classifyFormType(
  form: HTMLFormElement,
  _passwordFields: HTMLInputElement[],
): ExtractedCredentials['formType'] {
  const intent = classifyFormIntent(form)
  if (intent === 'login') return 'login'
  if (intent === 'signup') return 'signup'
  if (intent === 'password_change') return 'password_change'
  return 'unknown'
}

// ============================================================================
// §7.5  Registration Success Detection
// ============================================================================

/**
 * Defer credential emission for signup forms until a success signal is
 * detected.  This prevents the "Save password?" prompt from appearing
 * when registration fails (validation error, duplicate email, etc.).
 *
 * Success signals (any one triggers emission):
 *   - URL path changes (pushState, popstate, navigation)
 *   - The submitted form disappears from the DOM
 *   - Common success text appears in the page body
 *   - Page unloads entirely (beforeunload — likely success redirect)
 *
 * If no signal fires within REG_SUCCESS_TIMEOUT_MS (8s), the pending
 * credentials are discarded.
 */
function waitForRegistrationSuccess(
  creds: ExtractedCredentials,
  form: HTMLFormElement,
): void {
  // Cancel any previous pending registration
  cancelPendingRegistration()

  const startPath = window.location.pathname + window.location.search
  _pendingRegCreds = { creds, form: new WeakRef(form), path: startPath }

  // ── Success check: runs periodically and on DOM changes ──
  const checkSuccess = (): boolean => {
    if (!_pendingRegCreds) return false

    // 1. URL path changed
    const currentPath = window.location.pathname + window.location.search
    if (currentPath !== _pendingRegCreds.path) {
      commitPendingRegistration()
      return true
    }

    // 2. Form disappeared from DOM
    const formEl = _pendingRegCreds.form.deref()
    if (!formEl || !formEl.isConnected) {
      commitPendingRegistration()
      return true
    }

    // 3. Success text appeared in the page
    try {
      const bodyText = document.body?.innerText ?? ''
      if (REG_SUCCESS_TEXT.test(bodyText)) {
        commitPendingRegistration()
        return true
      }
    } catch { /* ignore */ }

    return false
  }

  // ── MutationObserver: watch for DOM changes that signal success ──
  _regSuccessObserver = new MutationObserver(() => {
    checkSuccess()
  })
  _regSuccessObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  })

  // ── popstate: detect browser-level navigation ──
  const onPopState = () => { checkSuccess() }
  window.addEventListener('popstate', onPopState, { once: true })

  // ── Periodic check (handles pushState we might miss) ──
  let elapsed = 0
  const interval = setInterval(() => {
    elapsed += 500
    if (checkSuccess() || elapsed >= REG_SUCCESS_TIMEOUT_MS) {
      clearInterval(interval)
      window.removeEventListener('popstate', onPopState)
      // If we timed out without success, discard
      if (elapsed >= REG_SUCCESS_TIMEOUT_MS && _pendingRegCreds) {
        cancelPendingRegistration()
      }
    }
  }, 500)

  // ── Timeout: hard stop ──
  _regSuccessTimer = setTimeout(() => {
    clearInterval(interval)
    window.removeEventListener('popstate', onPopState)
    cancelPendingRegistration()
  }, REG_SUCCESS_TIMEOUT_MS + 100)

  // ── beforeunload: if page navigates away, emit immediately ──
  const onBeforeUnload = () => {
    clearInterval(interval)
    window.removeEventListener('popstate', onPopState)
    commitPendingRegistration()
  }
  window.addEventListener('beforeunload', onBeforeUnload, { once: true })
}

/** Emit the pending registration credentials and clean up. */
function commitPendingRegistration(): void {
  if (!_pendingRegCreds) return
  const creds = _pendingRegCreds.creds
  cancelPendingRegistration()
  emitCredentials(creds)
}

/** Discard the pending registration and clean up watchers. */
function cancelPendingRegistration(): void {
  _pendingRegCreds = null
  if (_regSuccessTimer) {
    clearTimeout(_regSuccessTimer)
    _regSuccessTimer = null
  }
  if (_regSuccessObserver) {
    _regSuccessObserver.disconnect()
    _regSuccessObserver = null
  }
}

// ============================================================================
// §8  Payment Form Detection (False-Positive Prevention)
// ============================================================================

/**
 * Detect if a form is a payment/checkout form.
 * If so, the save-password prompt should NOT fire.
 */
function isPaymentForm(form: HTMLFormElement): boolean {
  // Check form action/class/id for payment patterns
  const formSignals = [form.action, form.id, form.className].join(' ')
  if (PAYMENT_PATTERNS.paymentFormPatterns.test(formSignals)) return true

  // Check for credit card input fields
  const allInputs = form.querySelectorAll<HTMLInputElement>('input')
  for (const input of allInputs) {
    const nameId = (input.name + ' ' + input.id).toLowerCase()
    const ac = input.autocomplete?.toLowerCase() ?? ''

    if (PAYMENT_PATTERNS.cardFields.test(nameId)) return true
    if (PAYMENT_PATTERNS.cvvFields.test(nameId)) return true
    if (PAYMENT_PATTERNS.expiryFields.test(nameId)) return true
    if (PAYMENT_PATTERNS.paymentAutocomplete.test(ac)) return true
  }

  return false
}

// ============================================================================
// §9  Helpers
// ============================================================================

function isPasswordField(el: HTMLElement): boolean {
  return el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'password'
}

function isAuthURL(url: string): boolean {
  return AUTH_URL_PATTERNS.some(pattern => pattern.test(url))
}

/**
 * Emit extracted credentials to all registered callbacks.
 * Deduplicates within DEDUP_WINDOW_MS.
 */
function emitCredentials(creds: ExtractedCredentials): void {
  // Validate: password must be non-trivial
  if (creds.password.length < MIN_PASSWORD_LENGTH) return

  // Deduplicate
  const hash = simpleHash(creds.domain + creds.username + creds.password)
  const now = Date.now()
  if (_lastExtracted && _lastExtracted.hash === hash && now - _lastExtracted.at < DEDUP_WINDOW_MS) {
    return
  }
  _lastExtracted = { hash, at: now }

  // Notify all callbacks
  for (const cb of _callbacks) {
    try {
      cb(creds)
    } catch (err) {
      console.error('[SUBMIT-WATCHER] Callback error:', err)
    }
  }
}

/** Simple string hash for deduplication (not cryptographic). */
function simpleHash(str: string): string {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return h.toString(36)
}
