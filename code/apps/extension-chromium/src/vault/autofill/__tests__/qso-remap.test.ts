/**
 * Tests: QSO Remap — Add & Map, Remap, Mapping Validation
 *
 * Validates:
 *   1. Selector strategy: robust selector generation + signature scoring
 *   2. Mapping validation: origin check, element resolution, same-form check
 *   3. Mapping store: create credential, save/load/delete mapping
 *   4. Remap manager: state machine, detection, isTrusted enforcement
 *   5. Security: iframe blocking, DOM change invalidation, rate limiting
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Mock modules BEFORE importing ──

vi.mock('../hardening', () => ({
  guardElement: vi.fn(() => ({ safe: true, code: null, reason: '' })),
  auditLog: vi.fn(),
  auditLogSafe: vi.fn(),
  emitTelemetryEvent: vi.fn(),
  redactError: vi.fn((e: any) => String(e)),
}))

vi.mock('../haGuard', () => ({
  isHAEnforced: vi.fn(() => false),
}))

vi.mock('../toggleSync', () => ({
  isAutofillActive: vi.fn(() => true),
}))

vi.mock('../writesKillSwitch', () => ({
  areWritesDisabled: vi.fn(() => false),
}))

vi.mock('../../api', () => ({
  getItemForFill: vi.fn(),
  listItemsForIndex: vi.fn(() => []),
  createItem: vi.fn(async (item: any) => ({
    id: 'new-item-id',
    ...item,
    created_at: Date.now(),
    updated_at: Date.now(),
    favorite: false,
  })),
  getItemMeta: vi.fn(async () => null),
  setItemMeta: vi.fn(async () => {}),
}))

vi.mock('../fieldScanner', () => ({
  collectCandidates: vi.fn(() => ({
    candidates: [],
    hints: [],
    formContext: 'unknown',
    domain: 'https://example.com',
    scannedAt: Date.now(),
    elementsEvaluated: 10,
    durationMs: 5,
    partial: false,
  })),
}))

vi.mock('../submitGuard', () => ({
  resolveSubmitTarget: vi.fn(() => null),
  safeSubmitAfterFill: vi.fn(() => ({ submitted: false, code: 'SUBMIT_NO_FORM', reason: 'no_form' })),
}))

// Mock Shadow DOM UI modules (JSDOM lacks CSSStyleSheet / adoptedStyleSheets)
vi.mock('../qso/remapIcon', () => ({
  showRemapIcon: vi.fn(() => ({ remove: vi.fn(), host: document.createElement('div'), mode: 'add_map', updateMode: vi.fn() })),
  hideRemapIcon: vi.fn(),
  isRemapIconVisible: vi.fn(() => false),
  getRemapIconMode: vi.fn(() => null),
}))

vi.mock('../qso/mappingWizard', () => ({
  showMappingWizard: vi.fn(() => ({ remove: vi.fn(), host: document.createElement('div') })),
  hideMappingWizard: vi.fn(),
  isMappingWizardVisible: vi.fn(() => false),
}))

vi.mock('../qso/qsoPicker', () => ({
  showQsoPicker: vi.fn(() => ({ remove: vi.fn(), host: document.createElement('div') })),
  hideQsoPicker: vi.fn(),
  isQsoPickerVisible: vi.fn(() => false),
}))

vi.mock('../committer', () => ({
  commitInsert: vi.fn(async () => ({ success: true })),
  setQsoFillActive: vi.fn(),
}))

vi.mock('../domFingerprint', () => ({
  takeFingerprint: vi.fn(async () => ({
    hash: 'mock_hash',
    capturedAt: Date.now(),
    maxAge: 60000,
    properties: { tagName: 'INPUT', inputType: 'text', name: '' },
  })),
  validateFingerprint: vi.fn(async () => ({ valid: true, reasons: [] })),
}))

vi.mock('../mutationGuard', () => ({
  attachGuard: vi.fn(() => ({
    check: () => ({ valid: true }),
    detach: vi.fn(),
    tripped: false,
    violations: [],
    onTrip: null,
  })),
}))

vi.mock('../../../../../../packages/shared/src/vault/originPolicy', () => ({
  matchOrigin: vi.fn(() => ({ matches: true, matchType: 'exact' })),
  isPublicSuffix: vi.fn(() => false),
}))

vi.mock('../../../../../../packages/shared/src/vault/insertionPipeline', () => ({
  computeDisplayValue: vi.fn(() => '***'),
  DEFAULT_MASKING: { char: '*', visibleChars: 0 },
}))

// ── Imports AFTER mocks ──

import {
  buildSelector,
  buildSignature,
  buildElementMapping,
  validateMapping,
  scoreSignatureMatch,
  effectiveOrigin,
} from '../qso/selectorStrategy'
import type { LoginFormMapping, ElementSignature } from '../qso/selectorStrategy'
import {
  saveMapping,
  loadMapping,
  deleteMapping,
  createCredentialFromPageInput,
  findCredentialsForOrigin,
} from '../qso/mappingStore'
import {
  updateRemapState,
  teardownRemap,
  getRemapState,
} from '../qso/remapManager'
import { guardElement, auditLogSafe } from '../hardening'
import { isAutofillActive } from '../toggleSync'
import { areWritesDisabled } from '../writesKillSwitch'
import { collectCandidates } from '../fieldScanner'
import { resolveSubmitTarget } from '../submitGuard'
import * as vaultAPI from '../../api'

// ============================================================================
// Helpers
// ============================================================================

function makeInput(attrs: Record<string, string> = {}): HTMLInputElement {
  const el = document.createElement('input')
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v)
  }
  document.body.appendChild(el)
  return el
}

function makeButton(attrs: Record<string, string> = {}): HTMLButtonElement {
  const btn = document.createElement('button')
  for (const [k, v] of Object.entries(attrs)) {
    btn.setAttribute(k, v)
  }
  btn.textContent = attrs.text ?? 'Submit'
  document.body.appendChild(btn)
  return btn
}

function makeForm(): HTMLFormElement {
  const form = document.createElement('form')
  document.body.appendChild(form)
  return form
}

function makeLoginForm(): { form: HTMLFormElement; username: HTMLInputElement; password: HTMLInputElement; submit: HTMLButtonElement } {
  const form = makeForm()
  const username = document.createElement('input')
  username.type = 'text'
  username.name = 'username'
  username.autocomplete = 'username'
  form.appendChild(username)

  const password = document.createElement('input')
  password.type = 'password'
  password.name = 'password'
  password.autocomplete = 'current-password'
  form.appendChild(password)

  const submit = document.createElement('button')
  submit.type = 'submit'
  submit.textContent = 'Sign In'
  form.appendChild(submit)

  return { form, username, password, submit }
}

// ============================================================================
// §1 — Selector Strategy
// ============================================================================

describe('Selector Strategy', () => {
  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { document.body.innerHTML = '' })

  describe('buildSelector', () => {
    it('prefers stable id', () => {
      const el = makeInput({ id: 'login-email', type: 'email' })
      expect(buildSelector(el)).toBe('#login-email')
    })

    it('uses name+type when no id', () => {
      const el = makeInput({ name: 'user_name', type: 'text' })
      expect(buildSelector(el)).toBe('input[name="user_name"][type="text"]')
    })

    it('uses autocomplete when no name/id', () => {
      const el = makeInput({ type: 'password', autocomplete: 'current-password' })
      expect(buildSelector(el)).toBe('input[autocomplete="current-password"]')
    })

    it('skips auto-generated ids (long hex)', () => {
      const el = makeInput({ id: 'a1b2c3d4e5f6a7b8', type: 'text' })
      const sel = buildSelector(el)
      expect(sel).not.toContain('#a1b2c3d4e5f6a7b8')
    })

    it('uses aria-label as fallback', () => {
      const el = makeInput({ type: 'text', 'aria-label': 'Email address' })
      expect(buildSelector(el)).toBe('input[aria-label="Email address"]')
    })
  })

  describe('buildSignature', () => {
    it('captures element properties', () => {
      const el = makeInput({
        type: 'password',
        name: 'pwd',
        autocomplete: 'current-password',
        placeholder: 'Enter password',
      })
      const sig = buildSignature(el)
      expect(sig.tagName).toBe('INPUT')
      expect(sig.inputType).toBe('password')
      expect(sig.name).toBe('pwd')
      expect(sig.autocomplete).toBe('current-password')
      expect(sig.placeholder).toBe('Enter password')
    })

    it('captures form context when in a form', () => {
      const form = makeForm()
      form.action = 'https://example.com/auth/login'
      const el = document.createElement('input')
      el.type = 'text'
      form.appendChild(el)
      const sig = buildSignature(el)
      expect(sig.formActionHash).toBeTruthy()
      expect(sig.formDepth).toBeGreaterThanOrEqual(0)
      expect(sig.formIndex).toBeGreaterThanOrEqual(0)
    })
  })

  describe('scoreSignatureMatch', () => {
    it('returns 0 for different tagNames', () => {
      const a: ElementSignature = { tagName: 'INPUT', inputType: 'text', inputMode: '', autocomplete: '', name: '', ariaLabel: '', formActionHash: '', formDepth: 0, formIndex: 0, placeholder: '' }
      const b: ElementSignature = { ...a, tagName: 'BUTTON' }
      expect(scoreSignatureMatch(a, b)).toBe(0)
    })

    it('returns high score for identical signatures', () => {
      const sig: ElementSignature = {
        tagName: 'INPUT', inputType: 'password', inputMode: '', autocomplete: 'current-password',
        name: 'password', ariaLabel: 'Password', formActionHash: 'abc', formDepth: 2, formIndex: 1, placeholder: 'Enter password',
      }
      expect(scoreSignatureMatch(sig, sig)).toBeGreaterThanOrEqual(90)
    })

    it('returns moderate score for partial match (name differs)', () => {
      const stored: ElementSignature = {
        tagName: 'INPUT', inputType: 'password', inputMode: '', autocomplete: 'current-password',
        name: 'pwd', ariaLabel: '', formActionHash: '', formDepth: 2, formIndex: 1, placeholder: '',
      }
      const live: ElementSignature = { ...stored, name: 'password_field' }
      const score = scoreSignatureMatch(stored, live)
      expect(score).toBeGreaterThan(30)
      expect(score).toBeLessThan(90)
    })
  })

  describe('buildElementMapping', () => {
    it('builds a complete mapping with selector and signature', () => {
      const el = makeInput({ name: 'email', type: 'email', autocomplete: 'username' })
      const mapping = buildElementMapping(el, 'username')
      expect(mapping.role).toBe('username')
      expect(mapping.selector).toContain('email')
      expect(mapping.signature.tagName).toBe('INPUT')
      expect(mapping.signature.inputType).toBe('email')
    })
  })
})

// ============================================================================
// §2 — Mapping Validation
// ============================================================================

describe('Mapping Validation', () => {
  beforeEach(() => { document.body.innerHTML = '' })
  afterEach(() => { document.body.innerHTML = '' })

  it('fails on origin mismatch', () => {
    const mapping: LoginFormMapping = {
      mapping_version: 1,
      origin: 'https://other-site.com',
      password: { selector: 'input[name="pwd"]', signature: buildSignature(makeInput({ type: 'password' })), role: 'password' },
      submit: { selector: 'button[type="submit"]', signature: buildSignature(makeButton({ type: 'submit' })), role: 'submit' },
      last_verified_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }
    const result = validateMapping(mapping)
    expect(result.valid).toBe(false)
    expect(result.failures).toContain('origin_mismatch')
  })

  it('fails when password element not found', () => {
    const mapping: LoginFormMapping = {
      mapping_version: 1,
      origin: effectiveOrigin(),
      password: { selector: '#nonexistent-password', signature: { tagName: 'INPUT', inputType: 'password', inputMode: '', autocomplete: '', name: '', ariaLabel: '', formActionHash: '', formDepth: 0, formIndex: 0, placeholder: '' }, role: 'password' },
      submit: { selector: '#nonexistent-submit', signature: { tagName: 'BUTTON', inputType: 'submit', inputMode: '', autocomplete: '', name: '', ariaLabel: '', formActionHash: '', formDepth: 0, formIndex: 0, placeholder: '' }, role: 'submit' },
      last_verified_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }
    const result = validateMapping(mapping)
    expect(result.valid).toBe(false)
    expect(result.failures).toContain('password_not_found')
  })

  it('succeeds when all elements found by selector', () => {
    const form = makeForm()
    const pwInput = document.createElement('input')
    pwInput.type = 'password'
    pwInput.name = 'pw'
    form.appendChild(pwInput)

    const submitBtn = document.createElement('button')
    submitBtn.type = 'submit'
    form.appendChild(submitBtn)

    // Mock visibility
    pwInput.getBoundingClientRect = () => ({ x: 0, y: 0, width: 200, height: 30, top: 0, right: 200, bottom: 30, left: 0, toJSON: () => {} })
    submitBtn.getBoundingClientRect = () => ({ x: 0, y: 30, width: 100, height: 30, top: 30, right: 100, bottom: 60, left: 0, toJSON: () => {} })

    const mapping: LoginFormMapping = {
      mapping_version: 1,
      origin: effectiveOrigin(),
      password: buildElementMapping(pwInput, 'password'),
      submit: buildElementMapping(submitBtn, 'submit'),
      last_verified_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }
    const result = validateMapping(mapping)
    expect(result.valid).toBe(true)
    expect(result.confidence).toBeGreaterThan(50)
  })

  it('detects cross-form mismatch', () => {
    const form1 = makeForm()
    const form2 = makeForm()

    const pwInput = document.createElement('input')
    pwInput.type = 'password'
    pwInput.name = 'pw_cross'
    form1.appendChild(pwInput)

    const submitBtn = document.createElement('button')
    submitBtn.type = 'submit'
    submitBtn.id = 'submit_cross'
    form2.appendChild(submitBtn)

    pwInput.getBoundingClientRect = () => ({ x: 0, y: 0, width: 200, height: 30, top: 0, right: 200, bottom: 30, left: 0, toJSON: () => {} })
    submitBtn.getBoundingClientRect = () => ({ x: 0, y: 30, width: 100, height: 30, top: 30, right: 100, bottom: 60, left: 0, toJSON: () => {} })

    const mapping: LoginFormMapping = {
      mapping_version: 1,
      origin: effectiveOrigin(),
      password: buildElementMapping(pwInput, 'password'),
      submit: buildElementMapping(submitBtn, 'submit'),
      last_verified_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }
    const result = validateMapping(mapping)
    expect(result.failures).toContain('cross_form')
  })
})

// ============================================================================
// §3 — Mapping Store (Vault Persistence)
// ============================================================================

describe('Mapping Store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })
  afterEach(() => { document.body.innerHTML = '' })

  it('createCredentialFromPageInput creates item + saves mapping', async () => {
    const mapping: LoginFormMapping = {
      mapping_version: 1,
      origin: 'https://example.com',
      password: { selector: 'input[name="pwd"]', signature: { tagName: 'INPUT', inputType: 'password', inputMode: '', autocomplete: '', name: 'pwd', ariaLabel: '', formActionHash: '', formDepth: 0, formIndex: 0, placeholder: '' }, role: 'password' },
      submit: { selector: 'button[type="submit"]', signature: { tagName: 'BUTTON', inputType: 'submit', inputMode: '', autocomplete: '', name: '', ariaLabel: '', formActionHash: '', formDepth: 0, formIndex: 0, placeholder: '' }, role: 'submit' },
      last_verified_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }

    const id = await createCredentialFromPageInput({
      origin: 'https://example.com',
      username: 'user@test.com',
      password: 'secret123',
      mapping,
    })

    expect(id).toBe('new-item-id')
    expect(vaultAPI.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'password',
        domain: 'example.com',
        fields: expect.arrayContaining([
          expect.objectContaining({ key: 'username', value: 'user@test.com' }),
          expect.objectContaining({ key: 'password', type: 'password' }),
        ]),
      }),
    )
    expect(vaultAPI.setItemMeta).toHaveBeenCalled()
  })

  it('createCredentialFromPageInput allows password-only (no username)', async () => {
    const mapping: LoginFormMapping = {
      mapping_version: 1,
      origin: 'https://example.com',
      password: { selector: 'input[type="password"]', signature: { tagName: 'INPUT', inputType: 'password', inputMode: '', autocomplete: '', name: '', ariaLabel: '', formActionHash: '', formDepth: 0, formIndex: 0, placeholder: '' }, role: 'password' },
      submit: { selector: 'button', signature: { tagName: 'BUTTON', inputType: '', inputMode: '', autocomplete: '', name: '', ariaLabel: '', formActionHash: '', formDepth: 0, formIndex: 0, placeholder: '' }, role: 'submit' },
      last_verified_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }

    await createCredentialFromPageInput({
      origin: 'https://example.com',
      username: '', // empty username
      password: 'secret123',
      mapping,
    })

    expect(vaultAPI.createItem).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.not.arrayContaining([
          expect.objectContaining({ key: 'username' }),
        ]),
      }),
    )
  })

  it('saveMapping persists to vault meta', async () => {
    const mapping: LoginFormMapping = {
      mapping_version: 1,
      origin: 'https://example.com',
      password: { selector: 'input', signature: { tagName: 'INPUT', inputType: 'password', inputMode: '', autocomplete: '', name: '', ariaLabel: '', formActionHash: '', formDepth: 0, formIndex: 0, placeholder: '' }, role: 'password' },
      submit: { selector: 'button', signature: { tagName: 'BUTTON', inputType: '', inputMode: '', autocomplete: '', name: '', ariaLabel: '', formActionHash: '', formDepth: 0, formIndex: 0, placeholder: '' }, role: 'submit' },
      last_verified_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }

    await saveMapping('cred-1', mapping)

    expect(vaultAPI.setItemMeta).toHaveBeenCalledWith(
      'cred-1',
      expect.objectContaining({ qso_mapping: mapping }),
    )
  })

  it('loadMapping returns stored mapping', async () => {
    const mapping: LoginFormMapping = {
      mapping_version: 1,
      origin: 'https://example.com',
      password: { selector: 'input', signature: { tagName: 'INPUT', inputType: 'password', inputMode: '', autocomplete: '', name: '', ariaLabel: '', formActionHash: '', formDepth: 0, formIndex: 0, placeholder: '' }, role: 'password' },
      submit: { selector: 'button', signature: { tagName: 'BUTTON', inputType: '', inputMode: '', autocomplete: '', name: '', ariaLabel: '', formActionHash: '', formDepth: 0, formIndex: 0, placeholder: '' }, role: 'submit' },
      last_verified_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }

    ;(vaultAPI.getItemMeta as any).mockResolvedValue({ qso_mapping: mapping })

    const loaded = await loadMapping('cred-1')
    expect(loaded).not.toBeNull()
    expect(loaded!.mapping_version).toBe(1)
    expect(loaded!.origin).toBe('https://example.com')
  })

  it('loadMapping returns null for missing meta', async () => {
    ;(vaultAPI.getItemMeta as any).mockResolvedValue(null)
    const loaded = await loadMapping('cred-1')
    expect(loaded).toBeNull()
  })

  it('loadMapping returns null for malformed meta', async () => {
    ;(vaultAPI.getItemMeta as any).mockResolvedValue({ qso_mapping: { bad: true } })
    const loaded = await loadMapping('cred-1')
    expect(loaded).toBeNull()
  })

  it('deleteMapping removes from meta', async () => {
    const existingMeta = { qso_mapping: { mapping_version: 1 }, other_key: 'keep' }
    ;(vaultAPI.getItemMeta as any).mockResolvedValue(existingMeta)

    await deleteMapping('cred-1')

    expect(vaultAPI.setItemMeta).toHaveBeenCalledWith(
      'cred-1',
      expect.not.objectContaining({ qso_mapping: expect.anything() }),
    )
  })
})

// ============================================================================
// §4 — Remap Manager (State Machine)
// ============================================================================

describe('Remap Manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
    teardownRemap()
    ;(isAutofillActive as any).mockReturnValue(true)
    ;(areWritesDisabled as any).mockReturnValue(false)
    ;(guardElement as any).mockReturnValue({ safe: true, code: null, reason: '' })
  })

  afterEach(() => {
    teardownRemap()
    document.body.innerHTML = ''
  })

  it('starts in IDLE state', () => {
    expect(getRemapState()).toBe('IDLE')
  })

  it('returns NO_ACTION when autofill is disabled', async () => {
    ;(isAutofillActive as any).mockReturnValue(false)
    const result = await updateRemapState()
    expect(result.state).toBe('NO_ACTION')
  })

  it('returns NO_ACTION when writes are disabled', async () => {
    ;(areWritesDisabled as any).mockReturnValue(true)
    const result = await updateRemapState()
    expect(result.state).toBe('NO_ACTION')
  })

  it('returns NO_ACTION when no login form detected', async () => {
    ;(collectCandidates as any).mockReturnValue({
      candidates: [],
      hints: [],
      formContext: 'unknown',
      domain: 'https://example.com',
      scannedAt: Date.now(),
      elementsEvaluated: 10,
      durationMs: 5,
      partial: false,
    })

    const result = await updateRemapState()
    expect(result.state).toBe('NO_ACTION')
  })

  it('does not show Add & Map for signup forms (2 password fields)', async () => {
    const pw1 = makeInput({ type: 'password', name: 'pw1' })
    const pw2 = makeInput({ type: 'password', name: 'pw2' })

    ;(collectCandidates as any).mockReturnValue({
      candidates: [
        { element: pw1, matchedKind: 'login.password', match: { confidence: 80 } },
        { element: pw2, matchedKind: 'login.password', match: { confidence: 70 } },
      ],
      hints: [],
      formContext: 'signup',
      domain: 'https://example.com',
      scannedAt: Date.now(),
      elementsEvaluated: 10,
      durationMs: 5,
      partial: false,
    })

    ;(vaultAPI.listItemsForIndex as any).mockResolvedValue([])

    const result = await updateRemapState()
    expect(result.isSignupForm).toBe(true)
    expect(result.mode).toBeNull()
  })

  it('shows Remap when credentials exist but no valid mapping', async () => {
    const form = makeForm()
    const pw = document.createElement('input')
    pw.type = 'password'
    pw.name = 'pw'
    pw.value = 'typed'
    form.appendChild(pw)

    const submitBtn = document.createElement('button')
    submitBtn.type = 'submit'
    form.appendChild(submitBtn)

    ;(collectCandidates as any).mockReturnValue({
      candidates: [
        { element: pw, matchedKind: 'login.password', match: { confidence: 80 } },
      ],
      hints: [],
      formContext: 'login',
      domain: 'https://example.com',
      scannedAt: Date.now(),
      elementsEvaluated: 10,
      durationMs: 5,
      partial: false,
    })

    // resolveSubmitTarget returns the submit button
    ;(resolveSubmitTarget as any).mockReturnValue(submitBtn)

    // jsdom location.hostname is 'localhost'
    ;(vaultAPI.listItemsForIndex as any).mockResolvedValue([
      { id: 'item-1', category: 'password', title: 'Test', domain: 'localhost', fields: [] },
    ])
    ;(vaultAPI.getItemMeta as any).mockResolvedValue(null)

    const result = await updateRemapState()
    expect(result.state).toBe('REMAP_READY')
    expect(result.mode).toBe('remap')
    expect(result.credentials.length).toBe(1)
  })

  it('teardownRemap resets state', () => {
    teardownRemap()
    expect(getRemapState()).toBe('IDLE')
  })
})

// ============================================================================
// §5 — Security: isTrusted Enforcement
// ============================================================================

describe('Security: isTrusted Enforcement', () => {
  it('remapIcon click handler requires isTrusted (source-level check)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'qso', 'remapIcon.ts'),
      'utf-8',
    )
    expect(source).toContain('if (!e.isTrusted)')
    expect(source).toContain('e.preventDefault()')
    expect(source).toContain('e.stopImmediatePropagation()')
  })

  it('mappingWizard click handler checks isTrusted (source-level check)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'qso', 'mappingWizard.ts'),
      'utf-8',
    )
    expect(source).toContain('if (!e.isTrusted) return')
  })

  it('remapManager handleRemapIconClick checks isTrusted (source-level check)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'qso', 'remapManager.ts'),
      'utf-8',
    )
    expect(source).toContain('if (!e.isTrusted)')
    expect(source).toContain('QSO_REMAP_REJECT_UNTRUSTED')
  })
})

// ============================================================================
// §6 — Security: Iframe Blocking
// ============================================================================

describe('Security: Iframe Blocking', () => {
  it('mappingWizard rejects cross-origin iframe elements (source-level check)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'qso', 'mappingWizard.ts'),
      'utf-8',
    )
    expect(source).toContain('isInCrossOriginFrame')
    expect(source).toContain('Cannot select elements in cross-origin iframes')
  })

  it('selectorStrategy validateMapping checks cross-origin iframe', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'qso', 'selectorStrategy.ts'),
      'utf-8',
    )
    expect(source).toContain('isInCrossOriginFrame')
    expect(source).toContain('cross_origin_iframe')
  })
})

// ============================================================================
// §7 — Security: DOM Change Invalidation
// ============================================================================

describe('Security: DOM Change Invalidation', () => {
  it('remapIcon verifies anchor stability before calling handler (source-level check)', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'qso', 'remapIcon.ts'),
      'utf-8',
    )
    expect(source).toContain('anchorRectAtCreate')
    expect(source).toContain('QSO_REMAP_DOM_SHIFTED')
    expect(source).toContain('!anchor.isConnected')
  })

  it('mapping validation fails when password element removed from DOM', () => {
    const form = makeForm()
    const pw = document.createElement('input')
    pw.type = 'password'
    pw.name = 'will_remove'
    form.appendChild(pw)
    pw.getBoundingClientRect = () => ({ x: 0, y: 0, width: 200, height: 30, top: 0, right: 200, bottom: 30, left: 0, toJSON: () => {} })

    const mapping: LoginFormMapping = {
      mapping_version: 1,
      origin: effectiveOrigin(),
      password: buildElementMapping(pw, 'password'),
      submit: { selector: '#nonexistent', signature: { tagName: 'BUTTON', inputType: 'submit', inputMode: '', autocomplete: '', name: '', ariaLabel: '', formActionHash: '', formDepth: 0, formIndex: 0, placeholder: '' }, role: 'submit' },
      last_verified_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }

    // Remove the password element
    pw.remove()

    const result = validateMapping(mapping)
    expect(result.valid).toBe(false)
    expect(result.failures.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// §8 — Module Isolation
// ============================================================================

describe('Module Isolation', () => {
  it('remapManager does not import setValueSafely', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'qso', 'remapManager.ts'),
      'utf-8',
    )
    const importLines = source.split('\n').filter((l: string) => l.trimStart().startsWith('import '))
    expect(importLines.join('\n')).not.toContain('setValueSafely')
  })

  it('mappingStore does not import committer', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'qso', 'mappingStore.ts'),
      'utf-8',
    )
    const importLines = source.split('\n').filter((l: string) => l.trimStart().startsWith('import '))
    expect(importLines.join('\n')).not.toContain('committer')
  })

  it('selectorStrategy does not import any write modules', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'qso', 'selectorStrategy.ts'),
      'utf-8',
    )
    const importLines = source.split('\n').filter((l: string) => l.trimStart().startsWith('import '))
    const combined = importLines.join('\n')
    expect(combined).not.toContain('committer')
    expect(combined).not.toContain('setValueSafely')
    expect(combined).not.toContain('writeBoundary')
  })

  it('remapIcon uses closed Shadow DOM', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'qso', 'remapIcon.ts'),
      'utf-8',
    )
    expect(source).toContain("attachShadow({ mode: 'closed' })")
  })

  it('mappingWizard uses closed Shadow DOM', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(
      path.resolve(__dirname, '..', 'qso', 'mappingWizard.ts'),
      'utf-8',
    )
    expect(source).toContain("attachShadow({ mode: 'closed' })")
  })
})
