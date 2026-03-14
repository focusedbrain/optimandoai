/**
 * Unit tests for vaultCapabilities — tier gating for vault record types.
 *
 * Key invariant: Free-tier users can ONLY access automation_secret records.
 * Pro+ users gain human_credential, pii_record, document, custom.
 * Publisher+ users additionally gain handshake_context.
 */

import { describe, it, expect } from 'vitest'
import {
  canAccessRecordType,
  getAccessibleRecordTypes,
  canAccessCategory,
  getCategoryOptionsForTier,
  canAttachContext,
  matchDomainGlob,
  DEFAULT_BINDING_POLICY,
  LEGACY_CATEGORY_TO_RECORD_TYPE,
  RECORD_TYPE_TO_DEFAULT_CATEGORY,
  ALL_ITEM_CATEGORIES,
  type VaultTier,
  type VaultRecordType,
  type LegacyItemCategory,
  type HandshakeBindingPolicy,
  type HandshakeTarget,
} from './vaultCapabilities'

// ---------------------------------------------------------------------------
// 1. Free tier — automation_secret ONLY
// ---------------------------------------------------------------------------
describe('Free tier', () => {
  const tier: VaultTier = 'free'

  it('can access automation_secret', () => {
    expect(canAccessRecordType(tier, 'automation_secret')).toBe(true)
    expect(canAccessRecordType(tier, 'automation_secret', 'write')).toBe(true)
    expect(canAccessRecordType(tier, 'automation_secret', 'delete')).toBe(true)
  })

  it('CANNOT access human_credential (password manager)', () => {
    expect(canAccessRecordType(tier, 'human_credential')).toBe(false)
    expect(canAccessRecordType(tier, 'human_credential', 'write')).toBe(false)
  })

  it('CANNOT access pii_record (data manager)', () => {
    expect(canAccessRecordType(tier, 'pii_record')).toBe(false)
  })

  it('CANNOT access document (document vault)', () => {
    expect(canAccessRecordType(tier, 'document')).toBe(false)
  })

  it('CANNOT access custom data', () => {
    expect(canAccessRecordType(tier, 'custom')).toBe(false)
  })

  it('CANNOT access handshake_context', () => {
    expect(canAccessRecordType(tier, 'handshake_context')).toBe(false)
  })

  it('getAccessibleRecordTypes returns only automation_secret', () => {
    expect(getAccessibleRecordTypes(tier)).toEqual(['automation_secret'])
  })

  it('canAccessCategory gates legacy categories correctly', () => {
    expect(canAccessCategory(tier, 'automation_secret')).toBe(true)
    expect(canAccessCategory(tier, 'password')).toBe(false)
    expect(canAccessCategory(tier, 'identity')).toBe(false)
    expect(canAccessCategory(tier, 'company')).toBe(false) // company_data requires Publisher
    expect(canAccessCategory(tier, 'custom')).toBe(false)
  })

  it('getCategoryOptionsForTier returns only automation_secret', () => {
    const opts = getCategoryOptionsForTier(tier)
    expect(opts).toHaveLength(1)
    expect(opts[0].value).toBe('automation_secret')
  })
})

// ---------------------------------------------------------------------------
// 1b. Unknown tier — no access (session missing or tier cannot be derived)
// ---------------------------------------------------------------------------
describe('Unknown tier', () => {
  const tier: VaultTier = 'unknown'

  it('CANNOT access any record type', () => {
    expect(canAccessRecordType(tier, 'automation_secret')).toBe(false)
    expect(canAccessRecordType(tier, 'human_credential')).toBe(false)
    expect(canAccessRecordType(tier, 'handshake_context')).toBe(false)
  })

  it('getAccessibleRecordTypes returns empty array', () => {
    expect(getAccessibleRecordTypes(tier)).toEqual([])
  })

  it('getCategoryOptionsForTier returns empty array', () => {
    expect(getCategoryOptionsForTier(tier)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 2. Pro tier — automation_secret + human_credential + pii_record + document + custom (company_data requires Publisher)
// ---------------------------------------------------------------------------
describe('Pro tier', () => {
  const tier: VaultTier = 'pro'

  it('can access automation_secret', () => {
    expect(canAccessRecordType(tier, 'automation_secret')).toBe(true)
  })

  it('can access human_credential (password manager)', () => {
    expect(canAccessRecordType(tier, 'human_credential')).toBe(true)
    expect(canAccessRecordType(tier, 'human_credential', 'write')).toBe(true)
    expect(canAccessRecordType(tier, 'human_credential', 'export')).toBe(true)
  })

  it('can access pii_record (data manager)', () => {
    expect(canAccessRecordType(tier, 'pii_record')).toBe(true)
  })

  it('can access document', () => {
    expect(canAccessRecordType(tier, 'document')).toBe(true)
  })

  it('can access custom data', () => {
    expect(canAccessRecordType(tier, 'custom')).toBe(true)
  })

  it('CANNOT access handshake_context (Publisher+ only)', () => {
    expect(canAccessRecordType(tier, 'handshake_context')).toBe(false)
  })

  it('getCategoryOptionsForTier returns categories Pro can write (company excluded — Publisher+ only)', () => {
    const opts = getCategoryOptionsForTier(tier, 'write')
    const values = opts.map(o => o.value)
    expect(values).toContain('automation_secret')
    expect(values).toContain('password')
    expect(values).toContain('identity')
    expect(values).not.toContain('company') // company_data requires Publisher
    expect(values).toContain('custom')
    expect(values).toContain('document')
    expect(values).not.toContain('handshake_context')
    expect(values).toHaveLength(5)
  })

  it('Pro CANNOT read or write company (Publisher+ required, same as HS Context)', () => {
    expect(canAccessCategory(tier, 'company', 'read')).toBe(false)
    expect(canAccessCategory(tier, 'company', 'write')).toBe(false)
    expect(canAccessCategory(tier, 'company', 'delete')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. Publisher tier — everything
// ---------------------------------------------------------------------------
describe('Publisher tier', () => {
  const tier: VaultTier = 'publisher'

  it('can access handshake_context', () => {
    expect(canAccessRecordType(tier, 'handshake_context')).toBe(true)
  })

  it('can share handshake_context', () => {
    expect(canAccessRecordType(tier, 'handshake_context', 'share')).toBe(true)
  })

  it('still has all Pro features', () => {
    expect(canAccessRecordType(tier, 'automation_secret')).toBe(true)
    expect(canAccessRecordType(tier, 'human_credential')).toBe(true)
    expect(canAccessRecordType(tier, 'pii_record')).toBe(true)
    expect(canAccessRecordType(tier, 'document')).toBe(true)
    expect(canAccessRecordType(tier, 'custom')).toBe(true)
  })

  it('getCategoryOptionsForTier includes handshake_context and company (Publisher can write both)', () => {
    const opts = getCategoryOptionsForTier(tier, 'write')
    const values = opts.map(o => o.value)
    expect(values).toContain('handshake_context')
    expect(values).toContain('company')
    expect(values).toHaveLength(7)
  })

  it('canAccessCategory gates handshake_context correctly', () => {
    expect(canAccessCategory(tier, 'handshake_context')).toBe(true)
    expect(canAccessCategory('pro', 'handshake_context')).toBe(false)
    expect(canAccessCategory('free', 'handshake_context')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 4. Mapping integrity
// ---------------------------------------------------------------------------
describe('Category ↔ RecordType mapping', () => {
  it('automation_secret maps to automation_secret record type', () => {
    expect(LEGACY_CATEGORY_TO_RECORD_TYPE['automation_secret']).toBe('automation_secret')
  })

  it('password maps to human_credential', () => {
    expect(LEGACY_CATEGORY_TO_RECORD_TYPE['password']).toBe('human_credential')
  })

  it('identity maps to pii_record, company maps to company_data', () => {
    expect(LEGACY_CATEGORY_TO_RECORD_TYPE['identity']).toBe('pii_record')
    expect(LEGACY_CATEGORY_TO_RECORD_TYPE['company']).toBe('company_data')
  })

  it('RECORD_TYPE_TO_DEFAULT_CATEGORY round-trips for automation_secret', () => {
    expect(RECORD_TYPE_TO_DEFAULT_CATEGORY['automation_secret']).toBe('automation_secret')
  })

  it('ALL_ITEM_CATEGORIES includes automation_secret first', () => {
    expect(ALL_ITEM_CATEGORIES[0]).toBe('automation_secret')
    expect(ALL_ITEM_CATEGORIES).toContain('password')
    expect(ALL_ITEM_CATEGORIES).toContain('custom')
  })
})

// ---------------------------------------------------------------------------
// 5. Private tier — same access as Free (vault features start at Pro)
// ---------------------------------------------------------------------------
describe('Private tier', () => {
  const tier: VaultTier = 'private'

  it('can access automation_secret', () => {
    expect(canAccessRecordType(tier, 'automation_secret')).toBe(true)
  })

  it('CANNOT access human_credential (Pro+ only)', () => {
    expect(canAccessRecordType(tier, 'human_credential')).toBe(false)
  })

  it('getCategoryOptionsForTier returns only automation_secret', () => {
    const opts = getCategoryOptionsForTier(tier)
    expect(opts).toHaveLength(1)
    expect(opts[0].value).toBe('automation_secret')
  })
})

// ---------------------------------------------------------------------------
// 6. Fail-closed — unknown/missing category returns false
// ---------------------------------------------------------------------------
describe('Fail-closed behavior', () => {
  it('canAccessCategory returns false for unknown category', () => {
    expect(canAccessCategory('pro', 'nonexistent' as any)).toBe(false)
  })

  it('Free tier share action is denied even for automation_secret', () => {
    expect(canAccessRecordType('free', 'automation_secret', 'share')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 7. matchDomainGlob
// ---------------------------------------------------------------------------
describe('matchDomainGlob', () => {
  it('exact match', () => {
    expect(matchDomainGlob('example.com', 'example.com')).toBe(true)
  })

  it('exact match is case-insensitive', () => {
    expect(matchDomainGlob('Example.COM', 'example.com')).toBe(true)
  })

  it('no match for different domains', () => {
    expect(matchDomainGlob('example.com', 'other.com')).toBe(false)
  })

  it('wildcard *.example.com matches sub.example.com', () => {
    expect(matchDomainGlob('*.example.com', 'sub.example.com')).toBe(true)
  })

  it('wildcard *.example.com matches deeply nested subdomain', () => {
    expect(matchDomainGlob('*.example.com', 'a.b.example.com')).toBe(true)
  })

  it('wildcard *.example.com matches bare example.com', () => {
    expect(matchDomainGlob('*.example.com', 'example.com')).toBe(true)
  })

  it('wildcard *.example.com does NOT match notexample.com', () => {
    expect(matchDomainGlob('*.example.com', 'notexample.com')).toBe(false)
  })

  it('handles leading/trailing whitespace', () => {
    expect(matchDomainGlob(' example.com ', ' example.com ')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 8. canAttachContext — Handshake context attachment evaluator
// ---------------------------------------------------------------------------
describe('canAttachContext', () => {
  const publisherTier: VaultTier = 'publisher'
  const proTier: VaultTier = 'pro'
  const freeTier: VaultTier = 'free'

  const basePolicy: HandshakeBindingPolicy = {
    allowed_domains: [],
    handshake_types: [],
    valid_until: null,
    safe_to_share: true,
    step_up_required: false,
  }

  const baseTarget: HandshakeTarget = {
    domain: 'partner.example.com',
  }

  it('allows attachment for Publisher with safe_to_share=true and no restrictions', () => {
    const result = canAttachContext(publisherTier, basePolicy, baseTarget)
    expect(result.allowed).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it('blocks Pro tier (insufficient tier)', () => {
    const result = canAttachContext(proTier, basePolicy, baseTarget)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('tier_insufficient')
  })

  it('blocks Free tier (insufficient tier)', () => {
    const result = canAttachContext(freeTier, basePolicy, baseTarget)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('tier_insufficient')
  })

  it('blocks when safe_to_share=false', () => {
    const policy = { ...basePolicy, safe_to_share: false }
    const result = canAttachContext(publisherTier, policy, baseTarget)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('not_safe_to_share')
  })

  it('blocks when domain does not match allowed_domains', () => {
    const policy = { ...basePolicy, allowed_domains: ['*.corp.net'] }
    const result = canAttachContext(publisherTier, policy, baseTarget)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('domain_mismatch')
    expect(result.message).toContain('partner.example.com')
  })

  it('allows when domain matches allowed_domains glob', () => {
    const policy = { ...basePolicy, allowed_domains: ['*.example.com'] }
    const result = canAttachContext(publisherTier, policy, baseTarget)
    expect(result.allowed).toBe(true)
  })

  it('allows when domain matches one of multiple allowed_domains', () => {
    const policy = { ...basePolicy, allowed_domains: ['*.corp.net', 'partner.example.com'] }
    const result = canAttachContext(publisherTier, policy, baseTarget)
    expect(result.allowed).toBe(true)
  })

  it('blocks when handshake type does not match', () => {
    const policy = { ...basePolicy, handshake_types: ['support', 'onboarding'] }
    const target = { ...baseTarget, type: 'sales' }
    const result = canAttachContext(publisherTier, policy, target)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('type_mismatch')
  })

  it('allows when handshake type matches', () => {
    const policy = { ...basePolicy, handshake_types: ['support', 'sales'] }
    const target = { ...baseTarget, type: 'sales' }
    const result = canAttachContext(publisherTier, policy, target)
    expect(result.allowed).toBe(true)
  })

  it('skips type check when target has no type', () => {
    const policy = { ...basePolicy, handshake_types: ['support'] }
    const result = canAttachContext(publisherTier, policy, baseTarget)
    expect(result.allowed).toBe(true)
  })

  it('blocks when expired (valid_until in the past)', () => {
    const policy = { ...basePolicy, valid_until: Date.now() - 60_000 }
    const result = canAttachContext(publisherTier, policy, baseTarget)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('expired')
  })

  it('allows when valid_until is in the future', () => {
    const policy = { ...basePolicy, valid_until: Date.now() + 3_600_000 }
    const result = canAttachContext(publisherTier, policy, baseTarget)
    expect(result.allowed).toBe(true)
  })

  it('blocks when step_up_required but not done', () => {
    const policy = { ...basePolicy, step_up_required: true }
    const target = { ...baseTarget, step_up_done: false }
    const result = canAttachContext(publisherTier, policy, target)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('step_up_required')
  })

  it('allows when step_up_required and step_up_done', () => {
    const policy = { ...basePolicy, step_up_required: true }
    const target = { ...baseTarget, step_up_done: true }
    const result = canAttachContext(publisherTier, policy, target)
    expect(result.allowed).toBe(true)
  })

  it('DEFAULT_BINDING_POLICY has safe_to_share=false (fail-safe)', () => {
    expect(DEFAULT_BINDING_POLICY.safe_to_share).toBe(false)
    // Should block even for publisher because safe_to_share is false
    const result = canAttachContext(publisherTier, DEFAULT_BINDING_POLICY, baseTarget)
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe('not_safe_to_share')
  })

  it('provides human-readable messages for each block reason', () => {
    // Tier
    const r1 = canAttachContext(proTier, basePolicy, baseTarget)
    expect(r1.message).toBeTruthy()

    // safe_to_share
    const r2 = canAttachContext(publisherTier, { ...basePolicy, safe_to_share: false }, baseTarget)
    expect(r2.message).toBeTruthy()

    // Domain
    const r3 = canAttachContext(publisherTier, { ...basePolicy, allowed_domains: ['other.com'] }, baseTarget)
    expect(r3.message).toBeTruthy()

    // Expired
    const r4 = canAttachContext(publisherTier, { ...basePolicy, valid_until: 1 }, baseTarget)
    expect(r4.message).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// 9. WRVault HS Context editor eligibility (structured vs legacy)
// ---------------------------------------------------------------------------
describe('WRVault HS Context editor eligibility', () => {
  it('Publisher+ tiers get structured HS Context editor (canAccessRecordType share)', () => {
    expect(canAccessRecordType('publisher', 'handshake_context', 'share')).toBe(true)
    expect(canAccessRecordType('publisher_lifetime', 'handshake_context', 'share')).toBe(true)
    expect(canAccessRecordType('enterprise', 'handshake_context', 'share')).toBe(true)
  })

  it('Pro and lower tiers do NOT get structured HS Context editor', () => {
    expect(canAccessRecordType('pro', 'handshake_context', 'share')).toBe(false)
    expect(canAccessRecordType('free', 'handshake_context', 'share')).toBe(false)
    expect(canAccessRecordType('private', 'handshake_context', 'share')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 10. Handshake context mapping integrity
// ---------------------------------------------------------------------------
describe('Handshake context mapping', () => {
  it('handshake_context is in LEGACY_CATEGORY_TO_RECORD_TYPE', () => {
    expect(LEGACY_CATEGORY_TO_RECORD_TYPE['handshake_context']).toBe('handshake_context')
  })

  it('handshake_context maps back to handshake_context in RECORD_TYPE_TO_DEFAULT_CATEGORY', () => {
    expect(RECORD_TYPE_TO_DEFAULT_CATEGORY['handshake_context']).toBe('handshake_context')
  })

  it('ALL_ITEM_CATEGORIES includes handshake_context', () => {
    expect(ALL_ITEM_CATEGORIES).toContain('handshake_context')
  })
})
