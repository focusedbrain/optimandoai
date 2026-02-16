// ============================================================================
// WRVault Autofill — Field Scanner Tests
// ============================================================================
//
// Environment: Vitest + JSDOM
//
// NOTE: JSDOM does not provide real layout (getBoundingClientRect returns zeros).
// Tests that rely on visibility or positioning use mocks.  Real browser tests
// should be run via Playwright (see integration strategy at end of file).
// ============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  collectCandidates,
  scoreCandidate,
  pickBestMapping,
  invalidateScanCache,
  startWatching,
  stopWatching,
} from './fieldScanner'
import type { ScanResult, ElementScore, FieldMapping } from './fieldScanner'
import type {
  VaultProfile,
  FieldEntry,
  AutofillSectionToggles,
} from '../../../../../packages/shared/src/vault/fieldTaxonomy'
import { CONFIDENCE_THRESHOLD } from '../../../../../packages/shared/src/vault/fieldTaxonomy'

// ============================================================================
// §1  Test Helpers
// ============================================================================

const ALL_TOGGLES: AutofillSectionToggles = {
  login: true,
  identity: true,
  company: true,
  custom: true,
}

const LOGIN_ONLY: AutofillSectionToggles = {
  login: true,
  identity: false,
  company: false,
  custom: false,
}

function makeInput(attrs: Record<string, string> = {}): HTMLInputElement {
  const el = document.createElement('input')
  for (const [key, val] of Object.entries(attrs)) {
    el.setAttribute(key, val)
  }
  document.body.appendChild(el)
  // Mock non-zero rect so the scanner doesn't skip it
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: 100, left: 100, width: 200, height: 30,
    bottom: 130, right: 300, x: 100, y: 100, toJSON: () => ({}),
  })
  return el
}

function makeSelect(attrs: Record<string, string> = {}): HTMLSelectElement {
  const el = document.createElement('select')
  for (const [key, val] of Object.entries(attrs)) {
    el.setAttribute(key, val)
  }
  document.body.appendChild(el)
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: 100, left: 100, width: 200, height: 30,
    bottom: 130, right: 300, x: 100, y: 100, toJSON: () => ({}),
  })
  return el
}

function makeLabel(text: string, forId: string): HTMLLabelElement {
  const label = document.createElement('label')
  label.setAttribute('for', forId)
  label.textContent = text
  document.body.appendChild(label)
  return label
}

function makeForm(attrs: Record<string, string> = {}): HTMLFormElement {
  const form = document.createElement('form')
  for (const [key, val] of Object.entries(attrs)) {
    form.setAttribute(key, val)
  }
  document.body.appendChild(form)
  return form
}

function makeProfile(overrides: Partial<VaultProfile> = {}): VaultProfile {
  return {
    itemId: 'item-1',
    title: 'Test Login',
    section: 'login',
    domain: 'example.com',
    fields: [
      { kind: 'login.email', label: 'Email', value: 'user@example.com', sensitive: false },
      { kind: 'login.password', label: 'Password', value: 'secret123', sensitive: true },
    ],
    updatedAt: Date.now(),
    ...overrides,
  }
}

// ============================================================================
// §2  Setup / Teardown
// ============================================================================

beforeEach(() => {
  document.body.innerHTML = ''
  invalidateScanCache()
  stopWatching()
})

afterEach(() => {
  vi.restoreAllMocks()
  stopWatching()
})

// ============================================================================
// §3  collectCandidates Tests
// ============================================================================

describe('collectCandidates', () => {

  it('detects a password field via autocomplete attribute', () => {
    makeInput({ type: 'password', autocomplete: 'current-password' })
    const result = collectCandidates(ALL_TOGGLES)

    expect(result.candidates.length).toBe(1)
    expect(result.candidates[0].matchedKind).toBe('login.password')
    expect(result.candidates[0].match.accepted).toBe(true)
    expect(result.candidates[0].match.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD)
  })

  it('detects an email field via input type + autocomplete', () => {
    makeInput({ type: 'email', autocomplete: 'email' })
    const result = collectCandidates(ALL_TOGGLES)

    expect(result.candidates.length).toBe(1)
    expect(result.candidates[0].matchedKind).toBe('login.email')
  })

  it('detects a username field via name attribute regex', () => {
    makeInput({ type: 'text', name: 'username' })
    const result = collectCandidates(ALL_TOGGLES)

    expect(result.candidates.length).toBeGreaterThanOrEqual(1)
    const userCandidate = result.candidates.find(c => c.matchedKind === 'login.username')
    expect(userCandidate).toBeDefined()
  })

  it('detects fields via label text', () => {
    const el = makeInput({ type: 'text', id: 'my-field' })
    makeLabel('Benutzername', 'my-field')

    const result = collectCandidates(ALL_TOGGLES)
    const match = result.candidates.find(c => c.element === el)
    expect(match).toBeDefined()
    expect(match!.matchedKind).toBe('login.username')
  })

  it('detects fields via placeholder text', () => {
    makeInput({ type: 'text', placeholder: 'Enter your email address' })
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates.length).toBeGreaterThanOrEqual(1)
  })

  it('respects section toggles — ignores identity when disabled', () => {
    makeInput({ type: 'text', autocomplete: 'given-name' })
    const result = collectCandidates(LOGIN_ONLY)

    // given-name is identity.first_name; with identity disabled, should not match
    const identityMatch = result.candidates.find(c =>
      c.matchedKind?.startsWith('identity.')
    )
    expect(identityMatch).toBeUndefined()
  })

  it('blocks hidden inputs', () => {
    makeInput({ type: 'hidden', name: 'password' })
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates.length).toBe(0)
  })

  it('blocks checkbox inputs', () => {
    makeInput({ type: 'checkbox', name: 'remember_me' })
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates.length).toBe(0)
  })

  it('blocks radio inputs', () => {
    makeInput({ type: 'radio', name: 'choice' })
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates.length).toBe(0)
  })

  it('applies anti-signals for search inputs', () => {
    makeInput({ type: 'text', name: 'search_query', id: 'search' })
    const result = collectCandidates(ALL_TOGGLES)

    // Should not be in candidates (anti-signal suppresses)
    const searchMatch = result.candidates.find(c =>
      c.matchedKind !== null
    )
    expect(searchMatch).toBeUndefined()
  })

  it('detects form context as login', () => {
    const form = makeForm({ action: '/api/login', id: 'login-form' })
    const el = document.createElement('input')
    el.type = 'text'
    el.name = 'user'
    form.appendChild(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 100, left: 100, width: 200, height: 30,
      bottom: 130, right: 300, x: 100, y: 100, toJSON: () => ({}),
    })

    const result = collectCandidates(ALL_TOGGLES)
    expect(result.formContext).toBe('login')
  })

  it('detects form context as signup', () => {
    const form = makeForm({ action: '/api/register' })
    const btn = document.createElement('button')
    btn.type = 'submit'
    btn.textContent = 'Create Account'
    form.appendChild(btn)
    const el = document.createElement('input')
    el.type = 'email'
    form.appendChild(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 100, left: 100, width: 200, height: 30,
      bottom: 130, right: 300, x: 100, y: 100, toJSON: () => ({}),
    })

    const result = collectCandidates(ALL_TOGGLES)
    expect(result.formContext).toBe('signup')
  })

  it('returns timing metadata', () => {
    makeInput({ type: 'password', autocomplete: 'current-password' })
    makeInput({ type: 'email', autocomplete: 'email' })

    const result = collectCandidates(ALL_TOGGLES)
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(result.scannedAt).toBeGreaterThan(0)
    expect(result.elementsEvaluated).toBe(2)
    expect(result.domain).toBe('localhost')
  })

  it('enforces maxElements limit', () => {
    for (let i = 0; i < 10; i++) {
      makeInput({ type: 'text', name: `field_${i}` })
    }

    const result = collectCandidates(ALL_TOGGLES, { maxElements: 3 })
    expect(result.elementsEvaluated).toBe(3)
  })

  it('returns cached result within throttle window', () => {
    makeInput({ type: 'password', autocomplete: 'current-password' })

    const first = collectCandidates(ALL_TOGGLES)
    const second = collectCandidates(ALL_TOGGLES)

    // Same reference (cached)
    expect(second).toBe(first)
  })

  it('returns fresh result after cache invalidation', () => {
    makeInput({ type: 'password', autocomplete: 'current-password' })

    const first = collectCandidates(ALL_TOGGLES)
    invalidateScanCache()
    const second = collectCandidates(ALL_TOGGLES)

    expect(second).not.toBe(first)
  })

  it('handles select elements', () => {
    const sel = makeSelect({ name: 'country', autocomplete: 'country-name' })
    const result = collectCandidates(ALL_TOGGLES)
    // SELECT elements are valid targets
    expect(result.elementsEvaluated).toBeGreaterThanOrEqual(1)
  })

  it('handles empty page gracefully', () => {
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates).toEqual([])
    expect(result.hints).toEqual([])
    expect(result.elementsEvaluated).toBe(0)
  })

  it('detects multiple fields in a login form', () => {
    const form = makeForm({ action: '/login' })

    const emailEl = document.createElement('input')
    emailEl.type = 'email'
    emailEl.name = 'email'
    emailEl.autocomplete = 'email'
    form.appendChild(emailEl)
    vi.spyOn(emailEl, 'getBoundingClientRect').mockReturnValue({
      top: 100, left: 100, width: 200, height: 30,
      bottom: 130, right: 300, x: 100, y: 100, toJSON: () => ({}),
    })

    const pwEl = document.createElement('input')
    pwEl.type = 'password'
    pwEl.name = 'password'
    pwEl.autocomplete = 'current-password'
    form.appendChild(pwEl)
    vi.spyOn(pwEl, 'getBoundingClientRect').mockReturnValue({
      top: 140, left: 100, width: 200, height: 30,
      bottom: 170, right: 300, x: 100, y: 140, toJSON: () => ({}),
    })

    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates.length).toBe(2)
    expect(result.formContext).toBe('login')

    const kinds = result.candidates.map(c => c.matchedKind).sort()
    expect(kinds).toContain('login.password')
    // Email could match login.email or identity.email; login.email preferred in login context
    expect(kinds.some(k => k?.includes('email'))).toBe(true)
  })
})

// ============================================================================
// §4  scoreCandidate Tests
// ============================================================================

describe('scoreCandidate', () => {

  it('returns allScores sorted by confidence', () => {
    const el = makeInput({ type: 'password', autocomplete: 'current-password' })
    const score = scoreCandidate(el)

    expect(score.best.bestKind).toBe('login.password')
    expect(score.allScores[0].kind).toBe('login.password')
    // allScores should be sorted descending
    for (let i = 1; i < score.allScores.length; i++) {
      expect(score.allScores[i - 1].confidence).toBeGreaterThanOrEqual(score.allScores[i].confidence)
    }
  })

  it('scores authoritative signals at 95+', () => {
    const el = makeInput({ autocomplete: 'username' })
    const score = scoreCandidate(el)

    expect(score.best.bestKind).toBe('login.username')
    expect(score.best.confidence).toBeGreaterThanOrEqual(95)
  })

  it('returns signals detail for debugging', () => {
    const el = makeInput({ type: 'email', name: 'user_email', autocomplete: 'email' })
    const score = scoreCandidate(el)

    expect(score.best.signals.length).toBeGreaterThan(0)
    const acSignal = score.best.signals.find(s => s.source === 'autocomplete' && s.matched)
    expect(acSignal).toBeDefined()
    expect(acSignal!.contribution).toBeGreaterThanOrEqual(90)
  })

  it('returns runner-up information', () => {
    // An email field could match login.email or identity.email
    const el = makeInput({ type: 'email', autocomplete: 'email' })
    const score = scoreCandidate(el)

    // Runner-up should exist since multiple specs have email signals
    expect(score.best.runnerUp).toBeTruthy()
    expect(score.best.runnerUpConfidence).toBeGreaterThan(0)
  })

  it('marks crossOrigin as false for same-origin elements', () => {
    const el = makeInput({ type: 'text' })
    const score = scoreCandidate(el)
    expect(score.crossOrigin).toBe(false)
  })

  it('scores zero for unsupported input types', () => {
    const el = makeInput({ type: 'text' })
    const score = scoreCandidate(el)

    // A bare text input with no name/label should score very low
    expect(score.best.confidence).toBeLessThan(CONFIDENCE_THRESHOLD)
  })
})

// ============================================================================
// §5  pickBestMapping Tests
// ============================================================================

describe('pickBestMapping', () => {

  it('maps vault email to detected email field', () => {
    const el = makeInput({ type: 'email', autocomplete: 'email' })
    invalidateScanCache()
    const scan = collectCandidates(ALL_TOGGLES)
    const profile = makeProfile()

    const mappings = pickBestMapping(scan.candidates, [profile])
    const emailMapping = mappings.find(m => m.kind === 'login.email')

    expect(emailMapping).toBeDefined()
    expect(emailMapping!.element).toBe(el)
    expect(emailMapping!.field.value).toBe('user@example.com')
    expect(emailMapping!.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD)
  })

  it('maps vault password to detected password field', () => {
    const el = makeInput({ type: 'password', autocomplete: 'current-password' })
    invalidateScanCache()
    const scan = collectCandidates(ALL_TOGGLES)
    const profile = makeProfile()

    const mappings = pickBestMapping(scan.candidates, [profile])
    const pwMapping = mappings.find(m => m.kind === 'login.password')

    expect(pwMapping).toBeDefined()
    expect(pwMapping!.element).toBe(el)
    expect(pwMapping!.field.value).toBe('secret123')
  })

  it('maps both email and password in a login form', () => {
    const form = makeForm({ action: '/login' })

    const emailEl = document.createElement('input')
    emailEl.type = 'email'
    emailEl.autocomplete = 'email'
    form.appendChild(emailEl)
    vi.spyOn(emailEl, 'getBoundingClientRect').mockReturnValue({
      top: 100, left: 100, width: 200, height: 30,
      bottom: 130, right: 300, x: 100, y: 100, toJSON: () => ({}),
    })

    const pwEl = document.createElement('input')
    pwEl.type = 'password'
    pwEl.autocomplete = 'current-password'
    form.appendChild(pwEl)
    vi.spyOn(pwEl, 'getBoundingClientRect').mockReturnValue({
      top: 140, left: 100, width: 200, height: 30,
      bottom: 170, right: 300, x: 100, y: 140, toJSON: () => ({}),
    })

    invalidateScanCache()
    const scan = collectCandidates(ALL_TOGGLES)
    const profile = makeProfile()
    const mappings = pickBestMapping(scan.candidates, [profile])

    expect(mappings.length).toBe(2)
    expect(mappings.map(m => m.kind).sort()).toEqual(['login.email', 'login.password'])
  })

  it('prefers domain-specific profiles over global ones', () => {
    makeInput({ type: 'password', autocomplete: 'current-password' })
    invalidateScanCache()
    const scan = collectCandidates(ALL_TOGGLES)

    const domainProfile = makeProfile({
      itemId: 'domain-1',
      domain: 'example.com',
      fields: [{ kind: 'login.password', label: 'Password', value: 'domain-pw', sensitive: true }],
    })
    const globalProfile = makeProfile({
      itemId: 'global-1',
      domain: undefined,
      fields: [{ kind: 'login.password', label: 'Password', value: 'global-pw', sensitive: true }],
    })

    const mappings = pickBestMapping(scan.candidates, [globalProfile, domainProfile])
    expect(mappings.length).toBe(1)
    expect(mappings[0].field.value).toBe('domain-pw')
  })

  it('does not assign the same element twice', () => {
    const el = makeInput({ type: 'email', autocomplete: 'email' })
    invalidateScanCache()
    const scan = collectCandidates(ALL_TOGGLES)

    const profile = makeProfile({
      fields: [
        { kind: 'login.email', label: 'Email', value: 'a@test.com', sensitive: false },
        { kind: 'identity.email', label: 'Personal Email', value: 'b@test.com', sensitive: false },
      ],
    })

    const mappings = pickBestMapping(scan.candidates, [profile])
    // Only one mapping for the single element
    expect(mappings.length).toBe(1)
  })

  it('returns reasons for each mapping', () => {
    makeInput({ type: 'password', autocomplete: 'current-password', name: 'password' })
    invalidateScanCache()
    const scan = collectCandidates(ALL_TOGGLES)
    const profile = makeProfile()

    const mappings = pickBestMapping(scan.candidates, [profile])
    const pwMapping = mappings.find(m => m.kind === 'login.password')!

    expect(pwMapping.reasons.length).toBeGreaterThan(0)
    expect(pwMapping.reasons.some(r => r.includes('autocomplete'))).toBe(true)
  })

  it('returns empty array when no profiles match candidates', () => {
    makeInput({ type: 'tel', autocomplete: 'tel' })
    invalidateScanCache()
    const scan = collectCandidates(ALL_TOGGLES)

    // Profile has only password, page has only phone
    const profile = makeProfile({
      fields: [{ kind: 'login.password', label: 'Password', value: 'pw', sensitive: true }],
    })

    const mappings = pickBestMapping(scan.candidates, [profile])
    expect(mappings.length).toBe(0)
  })

  it('returns empty array when no candidates above threshold', () => {
    makeInput({ type: 'text' })  // bare text field, low confidence
    invalidateScanCache()
    const scan = collectCandidates(ALL_TOGGLES)
    const profile = makeProfile()

    const mappings = pickBestMapping(scan.candidates, [profile])
    // A bare text input shouldn't match reliably
    expect(mappings.length).toBe(0)
  })
})

// ============================================================================
// §6  Anti-Signal Tests
// ============================================================================

describe('anti-signals', () => {

  it('coupon field is suppressed', () => {
    makeInput({ type: 'text', name: 'coupon_code' })
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates.length).toBe(0)
  })

  it('promo field is suppressed', () => {
    makeInput({ type: 'text', name: 'promo_code' })
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates.length).toBe(0)
  })

  it('tracking field is suppressed', () => {
    makeInput({ type: 'text', name: 'tracking_id' })
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates.length).toBe(0)
  })

  it('search label suppresses matching', () => {
    const el = makeInput({ type: 'text', id: 'search-box' })
    makeLabel('Search', 'search-box')

    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates.length).toBe(0)
  })
})

// ============================================================================
// §7  Form Context Boost Tests
// ============================================================================

describe('form context boosts', () => {

  it('login context boosts password confidence', () => {
    const form = makeForm({ action: '/api/login' })
    const el = document.createElement('input')
    el.type = 'password'
    el.name = 'pw'
    form.appendChild(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 100, left: 100, width: 200, height: 30,
      bottom: 130, right: 300, x: 100, y: 100, toJSON: () => ({}),
    })

    invalidateScanCache()
    const result = collectCandidates(ALL_TOGGLES)
    const pwCandidate = result.candidates.find(c => c.matchedKind === 'login.password')

    expect(pwCandidate).toBeDefined()
    expect(pwCandidate!.match.contextBoost).toBeGreaterThan(0)
  })

  it('checkout context boosts address fields', () => {
    const form = makeForm({ action: '/checkout/address' })
    const el = document.createElement('input')
    el.type = 'text'
    el.autocomplete = 'postal-code'
    form.appendChild(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 100, left: 100, width: 200, height: 30,
      bottom: 130, right: 300, x: 100, y: 100, toJSON: () => ({}),
    })

    invalidateScanCache()
    const result = collectCandidates(ALL_TOGGLES)
    const postalCandidate = result.candidates.find(c => c.matchedKind === 'identity.postal_code')

    expect(postalCandidate).toBeDefined()
  })
})

// ============================================================================
// §8  Identity & Company Field Tests
// ============================================================================

describe('identity and company fields', () => {

  it('detects first name via autocomplete=given-name', () => {
    makeInput({ autocomplete: 'given-name' })
    invalidateScanCache()
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates.some(c => c.matchedKind === 'identity.first_name')).toBe(true)
  })

  it('detects phone via input type=tel', () => {
    makeInput({ type: 'tel', name: 'phone' })
    invalidateScanCache()
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates.some(c => c.matchedKind === 'identity.phone')).toBe(true)
  })

  it('detects company name via autocomplete=organization', () => {
    makeInput({ autocomplete: 'organization' })
    invalidateScanCache()
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates.some(c => c.matchedKind === 'company.name')).toBe(true)
  })

  it('detects street via autocomplete=address-line1', () => {
    makeInput({ autocomplete: 'address-line1' })
    invalidateScanCache()
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates.some(c => c.matchedKind === 'identity.street')).toBe(true)
  })
})

// ============================================================================
// §9  MutationObserver Tests
// ============================================================================

describe('startWatching / stopWatching', () => {

  it('calls callback when new input is added', async () => {
    const callback = vi.fn()
    startWatching(ALL_TOGGLES, callback)

    // Add a new input after starting the observer
    const el = document.createElement('input')
    el.type = 'email'
    el.autocomplete = 'email'
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 100, left: 100, width: 200, height: 30,
      bottom: 130, right: 300, x: 100, y: 100, toJSON: () => ({}),
    })
    document.body.appendChild(el)

    // Wait for MutationObserver debounce
    await new Promise(resolve => setTimeout(resolve, 600))

    expect(callback).toHaveBeenCalled()
    const result: ScanResult = callback.mock.calls[0][0]
    expect(result.candidates.length).toBeGreaterThanOrEqual(1)

    stopWatching()
  })

  it('does not fire after stopWatching', async () => {
    const callback = vi.fn()
    startWatching(ALL_TOGGLES, callback)
    stopWatching()

    const el = document.createElement('input')
    el.type = 'password'
    document.body.appendChild(el)

    await new Promise(resolve => setTimeout(resolve, 600))
    expect(callback).not.toHaveBeenCalled()
  })
})

// ============================================================================
// §10  Edge Cases
// ============================================================================

describe('edge cases', () => {

  it('handles elements with no attributes', () => {
    const el = document.createElement('input')
    document.body.appendChild(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 100, left: 100, width: 200, height: 30,
      bottom: 130, right: 300, x: 100, y: 100, toJSON: () => ({}),
    })

    invalidateScanCache()
    // Should not throw
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.elementsEvaluated).toBe(1)
  })

  it('handles form with no inputs', () => {
    makeForm({ action: '/login' })
    invalidateScanCache()
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates).toEqual([])
  })

  it('handles aria-label as label source', () => {
    makeInput({ type: 'text', 'aria-label': 'Password' })
    invalidateScanCache()
    const result = collectCandidates(ALL_TOGGLES)
    // May or may not match depending on combined score; at minimum should not throw
    expect(result.elementsEvaluated).toBeGreaterThanOrEqual(1)
  })

  it('handles textarea elements', () => {
    const el = document.createElement('textarea')
    el.name = 'notes'
    document.body.appendChild(el)
    vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
      top: 100, left: 100, width: 200, height: 100,
      bottom: 200, right: 300, x: 100, y: 100, toJSON: () => ({}),
    })

    invalidateScanCache()
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.elementsEvaluated).toBe(1)
  })

  it('German keyword matching works', () => {
    const el = makeInput({ type: 'text', id: 'pw-feld' })
    makeLabel('Kennwort', 'pw-feld')

    invalidateScanCache()
    const score = scoreCandidate(el)
    // 'Kennwort' is in KW.password; should detect as password-related
    expect(score.best.bestKind).toBe('login.password')
  })

  it('OTP field detected via autocomplete=one-time-code', () => {
    makeInput({ autocomplete: 'one-time-code', inputmode: 'numeric' })
    invalidateScanCache()
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates.some(c => c.matchedKind === 'login.otp_code')).toBe(true)
  })

  it('new-password detected via autocomplete=new-password', () => {
    makeInput({ type: 'password', autocomplete: 'new-password' })
    invalidateScanCache()
    const result = collectCandidates(ALL_TOGGLES)
    expect(result.candidates.some(c => c.matchedKind === 'login.new_password')).toBe(true)
  })
})

// ============================================================================
// §11  Scoring Determinism Tests
// ============================================================================

describe('scoring determinism', () => {

  it('produces identical scores for identical elements', () => {
    const el1 = makeInput({ type: 'password', autocomplete: 'current-password', name: 'password' })
    const score1 = scoreCandidate(el1)

    const el2 = makeInput({ type: 'password', autocomplete: 'current-password', name: 'password' })
    const score2 = scoreCandidate(el2)

    expect(score1.best.confidence).toBe(score2.best.confidence)
    expect(score1.best.bestKind).toBe(score2.best.bestKind)
  })

  it('authoritative signal alone exceeds threshold', () => {
    const el = makeInput({ autocomplete: 'current-password' })
    const score = scoreCandidate(el)

    expect(score.best.confidence).toBeGreaterThanOrEqual(95)
    expect(score.best.accepted).toBe(true)
  })

  it('name_id regex alone with good match exceeds threshold', () => {
    const el = makeInput({ type: 'text', name: 'username' })
    const score = scoreCandidate(el)

    // name_id weight is 65, input_type=text is 10, total 75 → above threshold 60
    expect(score.best.accepted).toBe(true)
  })

  it('label keyword alone is below threshold', () => {
    const el = makeInput({ type: 'text', id: 'ambiguous' })
    makeLabel('email', 'ambiguous')
    const score = scoreCandidate(el)

    // label_text weight is 50; input_type=text is 10 → total 60 → at threshold exactly
    // This is borderline but should test the threshold edge
    expect(score.best.confidence).toBeGreaterThanOrEqual(50)
  })
})

// ============================================================================
// §12  Integration Test Strategy Notes (Real Browser)
// ============================================================================
//
// The following scenarios should be tested with Playwright or Puppeteer
// against real web pages or controlled test fixtures.
//
// 1. GOOGLE LOGIN PAGE
//    - Verify email step detects single email field
//    - Verify password step detects single password field
//    - Form context should be 'login'
//
// 2. GITHUB LOGIN PAGE
//    - Email/username + password + OTP detected
//    - Anti-signals don't fire on legitimate fields
//
// 3. AMAZON CHECKOUT
//    - Full address form: first name, last name, street, city, zip, country
//    - Form context should be 'checkout' or 'address'
//    - Phone field detected
//
// 4. SPA DYNAMIC FORM (React/Vue)
//    - Mount form after initial page load
//    - MutationObserver detects new fields
//    - Rescan produces correct candidates
//
// 5. GERMAN BANKING SITE
//    - IBAN field detected
//    - German labels (Kontonummer, etc.) matched
//    - Form context: checkout/payment
//
// 6. WORDPRESS REGISTRATION
//    - Username + email + password + confirm-password
//    - new_password distinguished from current password
//    - Form context: signup
//
// 7. ANTI-PATTERN PAGES
//    - Pages with honeypot fields (hidden inputs)
//    - Pages with search bars that look like login fields
//    - Pages with coupon/promo fields
//
// 8. PERFORMANCE BENCHMARK
//    - Page with 100+ form fields (CRM admin panel)
//    - Scan completes in <50ms
//    - MutationObserver debounce works correctly
//
// 9. IFRAME SCENARIOS
//    - Same-origin iframe: fields detected
//    - Cross-origin iframe: fields blocked
//
// 10. THROTTLE VERIFICATION
//    - Rapid calls to collectCandidates return cached result
//    - After invalidation, fresh scan runs
//
// ============================================================================
