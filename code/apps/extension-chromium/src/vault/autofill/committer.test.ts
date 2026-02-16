/**
 * Tests: WRVault Autofill Committer
 *
 * Tests the value-injection pipeline and safety checks.
 * Uses JSDOM-compatible mocks since these run in a Node/Vitest environment.
 *
 * Acceptance criteria:
 *   1. setValueSafely injects value via native setter and dispatches events
 *   2. setValueSafely falls back to direct assignment if native setter absent
 *   3. setValueSafely rejects disabled / readonly elements
 *   4. commitInsert rejects expired sessions
 *   5. commitInsert rejects sessions in terminal state
 *   6. commitInsert is atomic — zero writes if ANY target fails checks
 *   7. Safety checks correctly detect hidden, detached, disabled elements
 *   8. Fingerprint mismatch blocks commit
 *   9. Cross-origin iframe detection works
 *  10. Telemetry hook fires with correct data (no values)
 *  11. Event dispatch fires input + change, never keyboard events
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  setValueSafely,
  commitInsert,
  runSafetyChecks,
  setTelemetryHook,
} from './committer'
import type {
  OverlaySession,
  OverlayTarget,
  CommitResult,
  DOMFingerprint,
  DOMFingerprintProperties,
} from '../../../../../packages/shared/src/vault/insertionPipeline'
import type { VaultProfile, FieldEntry } from '../../../../../packages/shared/src/vault/fieldTaxonomy'

// ============================================================================
// Helpers — mock DOM elements + sessions
// ============================================================================

/** Minimal fingerprint that always matches (for tests focused on other things). */
function makePassingFingerprint(element: HTMLElement): DOMFingerprint {
  const rect = element.getBoundingClientRect()
  const computed = getComputedStyle(element)
  const props: DOMFingerprintProperties = {
    tagName: element.tagName,
    inputType: (element as HTMLInputElement).type ?? '',
    name: (element as HTMLInputElement).name ?? '',
    id: element.id ?? '',
    autocomplete: element.getAttribute('autocomplete') ?? '',
    rect: {
      top: Math.round(rect.top / 4) * 4,
      left: Math.round(rect.left / 4) * 4,
      width: Math.round(rect.width / 4) * 4,
      height: Math.round(rect.height / 4) * 4,
    },
    visibility: {
      display: computed.display,
      visibility: computed.visibility,
      opacity: computed.opacity,
    },
    parentChain: '',
    frameOrigin: window.location.origin,
    tabIndex: element.tabIndex,
    formAction: '',
  }
  return {
    hash: 'test_hash_pass__', // validateFingerprint is mocked below
    capturedAt: Date.now(),
    maxAge: 30000,
    properties: props,
  }
}

function makeField(kind: string = 'login.password', value: string = 'secret123'): FieldEntry {
  return {
    kind: kind as FieldEntry['kind'],
    label: kind.split('.').pop()!,
    value,
    sensitive: kind.includes('password'),
  }
}

function makeProfile(): VaultProfile {
  return {
    itemId: 'item-1',
    title: 'Test Login',
    section: 'login',
    domain: 'example.com',
    fields: [],
    updatedAt: Date.now(),
  }
}

function makeTarget(element: HTMLElement, field?: FieldEntry): OverlayTarget {
  const f = field ?? makeField()
  return {
    field: f,
    element,
    fingerprint: makePassingFingerprint(element),
    displayValue: '••••••••',
    commitValue: f.value,
  }
}

function makeSession(
  targets: OverlayTarget[],
  overrides?: Partial<OverlaySession>,
): OverlaySession {
  return {
    id: crypto.randomUUID(),
    profile: makeProfile(),
    targets,
    createdAt: Date.now(),
    timeoutMs: 60000,
    origin: 'auto',
    state: 'preview',
    ...overrides,
  }
}

/**
 * Create a visible, focusable input element attached to the DOM.
 * JSDOM has limited layout support, so we mock getBoundingClientRect.
 */
function createInput(type: string = 'text'): HTMLInputElement {
  const input = document.createElement('input')
  input.type = type
  input.name = 'test-field'
  input.id = 'test-input'
  document.body.appendChild(input)

  // JSDOM doesn't compute layout, so mock the rect
  vi.spyOn(input, 'getBoundingClientRect').mockReturnValue({
    top: 100, left: 200, width: 300, height: 40,
    bottom: 140, right: 500, x: 200, y: 100,
    toJSON: () => ({}),
  })

  return input
}

// Mock validateFingerprint to return passing by default
vi.mock('./domFingerprint', () => ({
  validateFingerprint: vi.fn().mockResolvedValue({ valid: true, reasons: [] }),
  takeFingerprint: vi.fn().mockResolvedValue({
    hash: 'test_hash_pass__',
    capturedAt: Date.now(),
    maxAge: 30000,
    properties: {},
  }),
  captureProperties: vi.fn().mockReturnValue({}),
}))

// ============================================================================
// §1  setValueSafely — Value Injection
// ============================================================================

describe('setValueSafely', () => {
  let input: HTMLInputElement

  beforeEach(() => {
    input = createInput()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  // ── 1. Basic value setting ──
  it('sets value via native setter and reports success', () => {
    const result = setValueSafely(input, 'hello')
    expect(result.success).toBe(true)
    expect(input.value).toBe('hello')
    expect(result.strategy).toBe('native_setter')
  })

  // ── 2. Fallback to direct assignment ──
  it('falls back to direct_assign when native setter is absent', () => {
    // Remove the prototype setter to force fallback
    const original = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
    Object.defineProperty(HTMLInputElement.prototype, 'value', {
      get: original.get,
      set: undefined,
      configurable: true,
    })

    const result = setValueSafely(input, 'fallback')

    // Restore
    Object.defineProperty(HTMLInputElement.prototype, 'value', original)

    expect(result.success).toBe(true)
    expect(result.strategy).toBe('direct_assign')
  })

  // ── 3. Rejects disabled elements ──
  it('rejects disabled input with READONLY_ELEMENT error', () => {
    input.disabled = true
    const result = setValueSafely(input, 'nope')
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('READONLY_ELEMENT')
  })

  // ── 4. Rejects readonly elements ──
  it('rejects readonly input with READONLY_ELEMENT error', () => {
    input.readOnly = true
    const result = setValueSafely(input, 'nope')
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('READONLY_ELEMENT')
  })

  // ── 5. Works with textarea ──
  it('sets value on textarea elements', () => {
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    vi.spyOn(textarea, 'getBoundingClientRect').mockReturnValue({
      top: 100, left: 200, width: 300, height: 80,
      bottom: 180, right: 500, x: 200, y: 100,
      toJSON: () => ({}),
    })

    const result = setValueSafely(textarea, 'multi\nline\ntext')
    expect(result.success).toBe(true)
    expect(textarea.value).toBe('multi\nline\ntext')
  })

  // ── 6. Dispatches input + change events (not keyboard) ──
  it('dispatches input and change events, not keyboard events', () => {
    const events: string[] = []

    input.addEventListener('input', () => events.push('input'))
    input.addEventListener('change', () => events.push('change'))
    input.addEventListener('keydown', () => events.push('keydown'))
    input.addEventListener('keypress', () => events.push('keypress'))
    input.addEventListener('keyup', () => events.push('keyup'))

    setValueSafely(input, 'test')

    expect(events).toContain('input')
    expect(events).toContain('change')
    expect(events).not.toContain('keydown')
    expect(events).not.toContain('keypress')
    expect(events).not.toContain('keyup')
  })

  // ── 7. Events bubble ──
  it('dispatched events bubble up the DOM', () => {
    const bubbled: string[] = []
    document.body.addEventListener('input', () => bubbled.push('input'))
    document.body.addEventListener('change', () => bubbled.push('change'))

    setValueSafely(input, 'bubble-test')

    expect(bubbled).toContain('input')
    expect(bubbled).toContain('change')
  })

  // ── 8. Handles empty string ──
  it('sets empty string value (clearing a field)', () => {
    input.value = 'pre-existing'
    const result = setValueSafely(input, '')
    expect(result.success).toBe(true)
    expect(input.value).toBe('')
  })

  // ── 9. Handles special characters ──
  it('handles special characters in value', () => {
    const special = 'p@$$w0rd!#%^&*<>"\'`'
    const result = setValueSafely(input, special)
    expect(result.success).toBe(true)
    expect(input.value).toBe(special)
  })

  // ── 10. Handles Unicode ──
  it('handles Unicode characters', () => {
    const unicode = 'Passwort123\u{1F512}\u{00E4}\u{00F6}\u{00FC}'
    const result = setValueSafely(input, unicode)
    expect(result.success).toBe(true)
    expect(input.value).toBe(unicode)
  })
})

// ============================================================================
// §2  commitInsert — Full Pipeline
// ============================================================================

describe('commitInsert', () => {
  let input: HTMLInputElement

  beforeEach(() => {
    input = createInput()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    setTelemetryHook(null)
  })

  // ── 1. Successful commit ──
  it('commits value when all checks pass', async () => {
    const target = makeTarget(input, makeField('login.password', 'mypassword'))
    const session = makeSession([target])

    const result = await commitInsert(session)

    expect(result.success).toBe(true)
    expect(result.sessionId).toBe(session.id)
    expect(result.fields).toHaveLength(1)
    expect(result.fields[0].success).toBe(true)
    expect(input.value).toBe('mypassword')
  })

  // ── 2. Multi-field commit ──
  it('commits multiple fields atomically', async () => {
    const input2 = createInput('password')
    input2.id = 'password-input'

    const t1 = makeTarget(input, makeField('login.email', 'user@example.com'))
    const t2 = makeTarget(input2, makeField('login.password', 'secret'))
    const session = makeSession([t1, t2])

    const result = await commitInsert(session)

    expect(result.success).toBe(true)
    expect(result.fields).toHaveLength(2)
    expect(input.value).toBe('user@example.com')
    expect(input2.value).toBe('secret')
  })

  // ── 3. Rejects expired session ──
  it('rejects expired session with SESSION_EXPIRED', async () => {
    const target = makeTarget(input)
    const session = makeSession([target], {
      createdAt: Date.now() - 120_000, // 2 minutes ago
      timeoutMs: 60_000,               // 1 minute timeout
    })

    const result = await commitInsert(session)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('SESSION_EXPIRED')
    expect(session.state).toBe('expired')
    expect(input.value).toBe('') // No injection
  })

  // ── 4. Rejects terminal session state ──
  it('rejects already-committed session', async () => {
    const target = makeTarget(input)
    const session = makeSession([target], { state: 'committed' as any })

    const result = await commitInsert(session)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('SESSION_INVALID')
  })

  it('rejects dismissed session', async () => {
    const target = makeTarget(input)
    const session = makeSession([target], { state: 'dismissed' as any })

    const result = await commitInsert(session)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('SESSION_INVALID')
  })

  // ── 5. Atomic: no writes if any target fails ──
  it('writes ZERO fields if any target fails safety checks', async () => {
    const input2 = createInput('password')
    input2.disabled = true // This one will fail

    const t1 = makeTarget(input, makeField('login.email', 'user@example.com'))
    const t2 = makeTarget(input2, makeField('login.password', 'secret'))
    const session = makeSession([t1, t2])

    const result = await commitInsert(session)

    expect(result.success).toBe(false)
    expect(input.value).toBe('')  // NOT filled — atomic rejection
    expect(input2.value).toBe('') // NOT filled
    expect(session.state).toBe('invalidated')
  })

  // ── 6. Detached element ──
  it('rejects commit when element is removed from DOM', async () => {
    const target = makeTarget(input)
    const session = makeSession([target])

    // Remove from DOM after session creation
    document.body.removeChild(input)

    const result = await commitInsert(session)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('ELEMENT_DETACHED')
  })

  // ── 7. Hidden input type ──
  it('rejects commit to hidden input type', async () => {
    input.type = 'hidden'
    const target = makeTarget(input)
    const session = makeSession([target])

    const result = await commitInsert(session)

    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('ELEMENT_HIDDEN')
  })

  // ── 8. Telemetry hook fires ──
  it('fires telemetry hook on successful commit', async () => {
    const hookFn = vi.fn()
    setTelemetryHook(hookFn)

    const target = makeTarget(input, makeField('login.password', 'pw'))
    const session = makeSession([target])

    await commitInsert(session)

    expect(hookFn).toHaveBeenCalledTimes(1)
    const event = hookFn.mock.calls[0][0]
    expect(event.outcome).toBe('success')
    expect(event.sessionId).toBe(session.id)
    expect(event.fieldCount).toBe(1)
    expect(event.fields[0].kind).toBe('login.password')
    expect(event.fields[0].success).toBe(true)
    expect(event.durationMs).toBeGreaterThanOrEqual(0)
    // Ensure no actual values in telemetry
    expect(JSON.stringify(event)).not.toContain('pw')
    expect(JSON.stringify(event)).not.toContain('secret')
  })

  it('fires telemetry hook on blocked commit', async () => {
    const hookFn = vi.fn()
    setTelemetryHook(hookFn)

    const target = makeTarget(input)
    const session = makeSession([target], {
      createdAt: Date.now() - 120_000,
      timeoutMs: 60_000,
    })

    await commitInsert(session)

    expect(hookFn).toHaveBeenCalledTimes(1)
    expect(hookFn.mock.calls[0][0].outcome).toBe('blocked')
  })

  // ── 9. Telemetry hook failure doesn't break commit ──
  it('swallows telemetry hook errors', async () => {
    setTelemetryHook(() => { throw new Error('hook crashed') })

    const target = makeTarget(input, makeField('login.password', 'pw'))
    const session = makeSession([target])

    // Should not throw
    const result = await commitInsert(session)
    expect(result.success).toBe(true)
  })
})

// ============================================================================
// §3  runSafetyChecks — Individual Checks
// ============================================================================

describe('runSafetyChecks', () => {
  let input: HTMLInputElement

  beforeEach(() => {
    input = createInput()
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('all checks pass for a normal visible input', async () => {
    const target = makeTarget(input)
    const session = makeSession([target])
    const result = await runSafetyChecks(target, session)

    expect(result.safe).toBe(true)
    expect(result.checks.every(c => c.passed)).toBe(true)
  })

  it('detects disabled element', async () => {
    input.disabled = true
    const target = makeTarget(input)
    const session = makeSession([target])

    const result = await runSafetyChecks(target, session)

    expect(result.safe).toBe(false)
    const focusCheck = result.checks.find(c => c.name === 'is_focusable')
    expect(focusCheck?.passed).toBe(false)
    expect(focusCheck?.reason).toContain('disabled')
  })

  it('detects removed element', async () => {
    const target = makeTarget(input)
    const session = makeSession([target])
    document.body.removeChild(input)

    const result = await runSafetyChecks(target, session)

    expect(result.safe).toBe(false)
    const detachCheck = result.checks.find(c => c.name === 'is_not_detached')
    expect(detachCheck?.passed).toBe(false)
  })

  it('detects expired session', async () => {
    const target = makeTarget(input)
    const session = makeSession([target], {
      createdAt: Date.now() - 120_000,
      timeoutMs: 60_000,
    })

    const result = await runSafetyChecks(target, session)

    expect(result.safe).toBe(false)
    const expireCheck = result.checks.find(c => c.name === 'session_not_expired')
    expect(expireCheck?.passed).toBe(false)
  })

  it('detects hidden input type', async () => {
    input.type = 'hidden'
    const target = makeTarget(input)
    const session = makeSession([target])

    const result = await runSafetyChecks(target, session)

    expect(result.safe).toBe(false)
    const hiddenCheck = result.checks.find(c => c.name === 'is_not_hidden_input')
    expect(hiddenCheck?.passed).toBe(false)
  })

  it('detects blocked input types (checkbox, radio, file, etc.)', async () => {
    for (const blockedType of ['checkbox', 'radio', 'file', 'submit', 'button', 'reset', 'image', 'range', 'color']) {
      input.type = blockedType
      const target = makeTarget(input)
      const session = makeSession([target])

      const result = await runSafetyChecks(target, session)
      const hiddenCheck = result.checks.find(c => c.name === 'is_not_hidden_input')
      expect(hiddenCheck?.passed).toBe(false)
    }
  })

  it('runs ALL checks even when first fails (no short circuit)', async () => {
    input.disabled = true
    input.type = 'hidden'
    const target = makeTarget(input)
    const session = makeSession([target], {
      createdAt: Date.now() - 120_000,
      timeoutMs: 60_000,
    })

    const result = await runSafetyChecks(target, session)

    // Multiple checks should have failed
    const failedChecks = result.checks.filter(c => !c.passed)
    expect(failedChecks.length).toBeGreaterThan(1)
  })
})

// ============================================================================
// §4  Integration Test Strategy Notes
// ============================================================================
//
// The unit tests above cover the core logic using JSDOM.  For full integration
// testing, the following scenarios need a real browser environment (Playwright
// or Puppeteer with a Chrome extension harness):
//
// ┌──────────────────────────────────────────────────────────────────────────┐
// │ INTEGRATION TEST MATRIX                                                  │
// ├──────────────────────────────────────────────────────────────────────────┤
// │                                                                          │
// │ 1. React form (create-react-app)                                         │
// │    — Verify native setter fires React's onChange handler                  │
// │    — Verify controlled component state updates                           │
// │    — Verify form submission contains injected values                      │
// │                                                                          │
// │ 2. Vue 3 form (v-model binding)                                          │
// │    — Verify input event triggers v-model reactivity                      │
// │    — Verify computed properties update                                    │
// │    — Verify Vuex/Pinia store reflects injected value                     │
// │                                                                          │
// │ 3. Angular form (ReactiveFormsModule)                                    │
// │    — Verify FormControl.valueChanges emits                               │
// │    — Verify template-driven form detects change                          │
// │                                                                          │
// │ 4. Svelte form (bind:value)                                              │
// │    — Verify reactive assignment triggers component update                │
// │                                                                          │
// │ 5. jQuery / vanilla form                                                 │
// │    — Verify .val() reflects injected value                               │
// │    — Verify submit handler sees correct values                           │
// │                                                                          │
// │ 6. SPA navigation (React Router / Vue Router)                            │
// │    — Verify overlay dismisses on route change                            │
// │    — Verify no stale session survives page transition                    │
// │                                                                          │
// │ 7. Shadow DOM forms (Salesforce Lightning, Shopify)                      │
// │    — Verify events bubble through composed: true                         │
// │    — Verify nested shadow roots don't block event propagation            │
// │                                                                          │
// │ 8. Anti-bot protection (Cloudflare Turnstile page)                       │
// │    — Verify isTrusted=false on our events doesn't trigger CAPTCHA        │
// │    — Verify we do NOT dispatch keyboard events                           │
// │                                                                          │
// │ 9. Password manager coexistence (1Password, Bitwarden)                   │
// │    — Verify no conflicts with other password manager overlays            │
// │    — Verify both can fill the same form sequentially                     │
// │                                                                          │
// │ 10. Iframe scenarios                                                     │
// │    — Verify same-origin iframe fields CAN be filled                      │
// │    — Verify cross-origin iframe fields are BLOCKED                       │
// │    — Verify sandbox iframe fields are BLOCKED                            │
// │                                                                          │
// │ 11. Concurrent sessions                                                  │
// │    — Verify MAX_ACTIVE_SESSIONS=1 is enforced                           │
// │    — Verify opening a new overlay cancels the previous                   │
// │                                                                          │
// │ 12. Fingerprint tamper scenarios                                         │
// │    — Inject, then script moves input to different parent → BLOCKED      │
// │    — Inject, then script adds hidden sibling input → BLOCKED            │
// │    — Inject, then script changes input name/id → BLOCKED                │
// │    — Inject, then input scrolls off-screen → allowed (within 4px)       │
// │    — Inject after 31 seconds → BLOCKED (fingerprint expired)            │
// │                                                                          │
// │ Test harness: Playwright with Chrome extension loaded via --load-ext     │
// │ Each test case: navigate to test fixture page → trigger autofill →      │
// │ assert DOM state + console errors + network absence                      │
// │                                                                          │
// └──────────────────────────────────────────────────────────────────────────┘
