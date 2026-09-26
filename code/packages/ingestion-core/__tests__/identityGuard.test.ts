import { describe, test, expect } from 'vitest'
import {
  fullClaimIdentityMatch,
  isPartialIdentityCollision,
  samePrincipalFullClaim,
} from '../src/identityGuard.js'

const fullIdentity = {
  iss: 'https://auth.optirando.com/realms/wr',
  sub: 'sub-alice-001',
  email: 'alice@example.com',
  wrdesk_user_id: 'wrdesk-alice',
}

describe('fullClaimIdentityMatch', () => {
  test('exact full-claim match is ok and identityComplete', () => {
    const r = fullClaimIdentityMatch({ ...fullIdentity }, { ...fullIdentity })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.identityComplete).toBe(true)
      expect(r.matchedClaims).toEqual(['iss', 'sub', 'email', 'wrdesk_user_id'])
    }
  })

  test('email comparison is case/whitespace-insensitive; others are exact', () => {
    const r = fullClaimIdentityMatch(
      { ...fullIdentity, email: '  ALICE@Example.com ' },
      fullIdentity,
    )
    expect(r.ok).toBe(true)

    const caseSub = fullClaimIdentityMatch({ ...fullIdentity, sub: 'SUB-ALICE-001' }, fullIdentity)
    expect(caseSub.ok).toBe(false)
  })

  test('cross-SSO: same sub under a different issuer is rejected [VII.3.8/3.10]', () => {
    const r = fullClaimIdentityMatch(
      { ...fullIdentity, iss: 'https://evil-idp.example.com' },
      fullIdentity,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('claim_mismatch')
      expect(r.mismatchedClaims).toEqual(['iss'])
    }
    expect(isPartialIdentityCollision(r)).toBe(true)
  })

  test('no OR-logic: matching wrdesk id does not compensate a differing email', () => {
    const r = fullClaimIdentityMatch({ ...fullIdentity, email: 'mallory@example.com' }, fullIdentity)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.mismatchedClaims).toEqual(['email'])
  })

  test('no sub-only shortcut: bound issuer missing from presented identity fails', () => {
    const r = fullClaimIdentityMatch(
      { sub: fullIdentity.sub, email: fullIdentity.email, wrdesk_user_id: fullIdentity.wrdesk_user_id },
      fullIdentity,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('presented_claim_missing')
      expect(r.missingClaims).toEqual(['iss'])
    }
  })

  test('legacy binding (subset of claims) matches on the bound set but is not identityComplete (Q12)', () => {
    const legacyBound = { email: 'alice@example.com', wrdesk_user_id: 'wrdesk-alice' }
    const r = fullClaimIdentityMatch(fullIdentity, legacyBound)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.identityComplete).toBe(false)
  })

  test('empty/blank bound identity never matches (fail-closed)', () => {
    expect(fullClaimIdentityMatch(fullIdentity, {}).ok).toBe(false)
    expect(fullClaimIdentityMatch(fullIdentity, { iss: ' ', sub: '', email: null }).ok).toBe(false)
    expect(fullClaimIdentityMatch(fullIdentity, null).ok).toBe(false)
    expect(fullClaimIdentityMatch(null, fullIdentity).ok).toBe(false)
  })

  test('iss-only binding identifies a realm, not a principal — never matches', () => {
    const r = fullClaimIdentityMatch(fullIdentity, { iss: fullIdentity.iss })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('no_bound_claims')
  })

  test('extra presented claims beyond the bound set are ignored', () => {
    const r = fullClaimIdentityMatch(fullIdentity, { sub: fullIdentity.sub, iss: fullIdentity.iss })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.identityComplete).toBe(false)
  })

  test('isPartialIdentityCollision is false for fully-distinct identities', () => {
    const r = fullClaimIdentityMatch(
      {
        iss: 'https://other-idp.example.com',
        sub: 'sub-bob',
        email: 'bob@example.com',
        wrdesk_user_id: 'wrdesk-bob',
      },
      fullIdentity,
    )
    expect(r.ok).toBe(false)
    expect(isPartialIdentityCollision(r)).toBe(false)
  })
})

describe('samePrincipalFullClaim', () => {
  test('identical full identities are the same principal (complete)', () => {
    const r = samePrincipalFullClaim(fullIdentity, { ...fullIdentity })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.identityComplete).toBe(true)
  })

  test('any shared-claim mismatch fails, even when other claims agree', () => {
    const r = samePrincipalFullClaim(fullIdentity, {
      ...fullIdentity,
      iss: 'https://other-realm.example.com',
    })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toBe('claim_mismatch')
      expect(r.mismatchedClaims).toEqual(['iss'])
    }
  })

  test('legacy partial overlap matches on shared claims but is not complete', () => {
    const r = samePrincipalFullClaim(fullIdentity, {
      email: 'alice@example.com',
      wrdesk_user_id: 'wrdesk-alice',
    })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.identityComplete).toBe(false)
  })

  test('no overlapping claims → never the same principal (fail-closed)', () => {
    const r = samePrincipalFullClaim({ iss: 'x', sub: 'y' }, { email: 'a@b.c', wrdesk_user_id: 'w' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('insufficient_overlap')
    expect(samePrincipalFullClaim({}, {}).ok).toBe(false)
    expect(samePrincipalFullClaim(null, fullIdentity).ok).toBe(false)
  })

  test('issuer-only overlap is a realm match, not an identity match', () => {
    const r = samePrincipalFullClaim(
      { iss: 'https://auth.optirando.com/realms/wr', sub: 'sub-a' },
      { iss: 'https://auth.optirando.com/realms/wr', email: 'b@example.com' },
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('insufficient_overlap')
  })

  test('wrdesk-id-only agreement with differing emails is NOT the same principal', () => {
    const r = samePrincipalFullClaim(
      { wrdesk_user_id: 'wrdesk-alice', email: 'alice@example.com' },
      { wrdesk_user_id: 'wrdesk-alice', email: 'other@example.com' },
    )
    expect(r.ok).toBe(false)
  })
})
