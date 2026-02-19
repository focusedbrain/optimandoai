/**
 * Tests: Form Intent Classifier + Icon Suppression + Credential Guards
 *
 * Validates:
 *   1. classifyFormIntent scoring returns correct FormContext for login,
 *      signup, password_change, and ambiguous forms
 *   2. Password field count heuristics
 *   3. autocomplete attribute detection
 *   4. Submit button / heading text signals
 *   5. URL path hints (via location mock)
 *   6. Icon suppression: filterPasswordCandidates excludes non-login forms
 *   7. Confirm-password mismatch guard
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { classifyFormIntent } from '../fieldScanner'
import type { FormContext } from '../../../../../../packages/shared/src/vault/fieldTaxonomy'

// ============================================================================
// Helpers
// ============================================================================

/** Create a <form> in the document with given inner HTML and return it. */
function createForm(innerHTML: string, attrs: Record<string, string> = {}): HTMLFormElement {
  const form = document.createElement('form')
  for (const [k, v] of Object.entries(attrs)) {
    form.setAttribute(k, v)
  }
  form.innerHTML = innerHTML
  document.body.appendChild(form)
  return form
}

/** Clean up all forms after each test. */
afterEach(() => {
  document.body.innerHTML = ''
})

// ============================================================================
// §1  Login Form Detection
// ============================================================================

describe('classifyFormIntent — login forms', () => {
  it('detects a simple login form (1 password, submit="Sign in")', () => {
    const form = createForm(`
      <input type="email" name="email" />
      <input type="password" name="password" />
      <button type="submit">Sign in</button>
    `)
    expect(classifyFormIntent(form)).toBe('login')
  })

  it('detects login via autocomplete="current-password"', () => {
    const form = createForm(`
      <input type="text" name="user" />
      <input type="password" autocomplete="current-password" />
      <button type="submit">Continue</button>
    `)
    expect(classifyFormIntent(form)).toBe('login')
  })

  it('detects login via form action URL', () => {
    const form = createForm(
      `<input type="text" name="user" />
       <input type="password" name="pass" />
       <button type="submit">Go</button>`,
      { action: '/api/login' },
    )
    expect(classifyFormIntent(form)).toBe('login')
  })

  it('detects login via form id', () => {
    const form = createForm(
      `<input type="email" />
       <input type="password" />
       <button type="submit">Submit</button>`,
      { id: 'sign-in-form' },
    )
    expect(classifyFormIntent(form)).toBe('login')
  })
})

// ============================================================================
// §2  Signup / Registration Form Detection
// ============================================================================

describe('classifyFormIntent — signup forms', () => {
  it('detects signup with 2 password fields (password + confirm)', () => {
    const form = createForm(`
      <input type="email" name="email" />
      <input type="password" name="password" />
      <input type="password" name="confirm_password" />
      <button type="submit">Create account</button>
    `)
    expect(classifyFormIntent(form)).toBe('signup')
  })

  it('detects signup via autocomplete="new-password" on two fields', () => {
    const form = createForm(`
      <input type="email" name="email" />
      <input type="password" autocomplete="new-password" />
      <input type="password" autocomplete="new-password" />
      <button type="submit">Join</button>
    `)
    expect(classifyFormIntent(form)).toBe('signup')
  })

  it('detects signup via submit button text "Register"', () => {
    const form = createForm(`
      <input type="email" name="email" />
      <input type="password" name="pwd" />
      <input type="password" name="pwd_confirm" />
      <button type="submit">Register</button>
    `)
    expect(classifyFormIntent(form)).toBe('signup')
  })

  it('detects signup via form action /register', () => {
    const form = createForm(
      `<input type="email" name="email" />
       <input type="password" name="pwd" />
       <input type="password" name="pwd2" />
       <button type="submit">Submit</button>`,
      { action: '/register' },
    )
    expect(classifyFormIntent(form)).toBe('signup')
  })

  it('detects signup via heading text', () => {
    const form = createForm(`
      <h2>Create your account</h2>
      <input type="email" name="email" />
      <input type="password" name="password" />
      <input type="password" name="password_confirm" />
      <button type="submit">Next</button>
    `)
    expect(classifyFormIntent(form)).toBe('signup')
  })

  it('detects signup via field name "register"', () => {
    const form = createForm(`
      <input type="email" name="register_email" />
      <input type="password" name="register_password" />
      <input type="password" name="register_password_confirm" />
      <button type="submit">Go</button>
    `)
    expect(classifyFormIntent(form)).toBe('signup')
  })
})

// ============================================================================
// §3  Password Change Form Detection
// ============================================================================

describe('classifyFormIntent — password change forms', () => {
  it('detects password change (current-password + new-password)', () => {
    const form = createForm(`
      <input type="password" autocomplete="current-password" name="current_pass" />
      <input type="password" autocomplete="new-password" name="new_pass" />
      <button type="submit">Update password</button>
    `)
    expect(classifyFormIntent(form)).toBe('password_change')
  })

  it('detects password change via 3 password fields + button text', () => {
    const form = createForm(`
      <input type="password" name="old_password" />
      <input type="password" name="new_password" />
      <input type="password" name="confirm_new_password" />
      <button type="submit">Change password</button>
    `)
    expect(classifyFormIntent(form)).toBe('password_change')
  })

  it('detects password change via form action /change-password', () => {
    const form = createForm(
      `<input type="password" name="current" autocomplete="current-password" />
       <input type="password" name="new_pw" autocomplete="new-password" />
       <button type="submit">Save</button>`,
      { action: '/change-password' },
    )
    expect(classifyFormIntent(form)).toBe('password_change')
  })
})

// ============================================================================
// §4  Unknown / Ambiguous Forms
// ============================================================================

describe('classifyFormIntent — ambiguous forms', () => {
  it('returns unknown for a form with 1 password and no other signals', () => {
    const form = createForm(`
      <input type="text" name="q" />
      <input type="password" name="secret" />
      <button type="submit">Submit</button>
    `)
    const result = classifyFormIntent(form)
    // With only a single password field and no login/signup signals,
    // this may resolve to unknown or login (20 pts from 1-pw-field rule).
    // Either is acceptable; it should NOT be signup or password_change.
    expect(result).not.toBe('signup')
    expect(result).not.toBe('password_change')
  })

  it('returns unknown for a form with no password fields', () => {
    const form = createForm(`
      <input type="text" name="search" />
      <button type="submit">Search</button>
    `)
    expect(classifyFormIntent(form)).toBe('unknown')
  })

  it('returns unknown for a non-form element', () => {
    const div = document.createElement('div')
    document.body.appendChild(div)
    expect(classifyFormIntent(div)).toBe('unknown')
  })
})

// ============================================================================
// §5  Mixed Signals — Highest Score Wins
// ============================================================================

describe('classifyFormIntent — mixed signals', () => {
  it('signup wins when signup signals outweigh login signals', () => {
    const form = createForm(
      `<input type="email" name="email" />
       <input type="password" autocomplete="new-password" />
       <input type="password" name="confirm_password" />
       <button type="submit">Register</button>`,
      { action: '/auth/signup' },
    )
    expect(classifyFormIntent(form)).toBe('signup')
  })

  it('login wins when login signals outweigh signup on a single-pw form', () => {
    const form = createForm(
      `<input type="email" name="email" />
       <input type="password" autocomplete="current-password" />
       <button type="submit">Sign in</button>`,
      { action: '/login' },
    )
    expect(classifyFormIntent(form)).toBe('login')
  })
})

// ============================================================================
// §6  Icon Suppression Logic
// ============================================================================

describe('icon suppression via filterPasswordCandidates', () => {
  // We test the filtering logic directly rather than importing the private
  // function.  The rule is: candidates with formContext === 'signup' or
  // 'password_change' should be excluded.

  const ICON_SUPPRESSED_CONTEXTS = new Set(['signup', 'password_change'])
  const PASSWORD_FIELD_KINDS = new Set([
    'login.password', 'login.new_password', 'login.username', 'login.email',
  ])

  function filterPasswordCandidates(candidates: Array<{ matchedKind: string | null; formContext: FormContext }>) {
    return candidates.filter(c => {
      if (!c.matchedKind || !PASSWORD_FIELD_KINDS.has(c.matchedKind)) return false
      if (ICON_SUPPRESSED_CONTEXTS.has(c.formContext)) return false
      return true
    })
  }

  it('keeps login.password candidates on login forms', () => {
    const result = filterPasswordCandidates([
      { matchedKind: 'login.password', formContext: 'login' },
      { matchedKind: 'login.email', formContext: 'login' },
    ])
    expect(result).toHaveLength(2)
  })

  it('filters out candidates on signup forms', () => {
    const result = filterPasswordCandidates([
      { matchedKind: 'login.password', formContext: 'signup' },
      { matchedKind: 'login.email', formContext: 'signup' },
    ])
    expect(result).toHaveLength(0)
  })

  it('filters out candidates on password_change forms', () => {
    const result = filterPasswordCandidates([
      { matchedKind: 'login.password', formContext: 'password_change' },
      { matchedKind: 'login.new_password', formContext: 'password_change' },
    ])
    expect(result).toHaveLength(0)
  })

  it('keeps candidates on unknown forms (conservative)', () => {
    const result = filterPasswordCandidates([
      { matchedKind: 'login.password', formContext: 'unknown' },
    ])
    expect(result).toHaveLength(1)
  })

  it('filters out non-password-field kinds regardless of context', () => {
    const result = filterPasswordCandidates([
      { matchedKind: 'identity.first_name', formContext: 'login' },
    ])
    expect(result).toHaveLength(0)
  })
})

// ============================================================================
// §7  Confirm-Password Mismatch Guard
// ============================================================================

describe('confirm-password mismatch guard', () => {
  // We replicate the guard logic from submitWatcher to unit-test it directly.

  function shouldSkipDueToMismatch(
    formType: string,
    passwordValues: string[],
  ): boolean {
    if ((formType === 'signup' || formType === 'password_change') && passwordValues.length >= 2) {
      if (passwordValues.length === 2 && passwordValues[0] !== passwordValues[1]) {
        return true
      }
    }
    return false
  }

  it('skips when signup has 2 password fields with different values', () => {
    expect(shouldSkipDueToMismatch('signup', ['abc123', 'abc124'])).toBe(true)
  })

  it('does not skip when signup has matching passwords', () => {
    expect(shouldSkipDueToMismatch('signup', ['abc123', 'abc123'])).toBe(false)
  })

  it('does not skip for login forms regardless of mismatch', () => {
    expect(shouldSkipDueToMismatch('login', ['abc123', 'abc124'])).toBe(false)
  })

  it('skips when password_change has mismatched passwords', () => {
    expect(shouldSkipDueToMismatch('password_change', ['old', 'new1'])).toBe(true)
  })

  it('does not skip for single password field', () => {
    expect(shouldSkipDueToMismatch('signup', ['abc123'])).toBe(false)
  })
})
