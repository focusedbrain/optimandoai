import { describe, expect, it } from 'vitest'
import {
  connectOfferConsentErrorCopy,
  connectOfferPreviewRows,
  formatPreviewInstant,
  readConnectOfferPreview,
} from './connectOfferPreview'

const HASH = 'ab'.repeat(32)

function preview(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bound_definition: {
      sender_email: 'sender@test.com',
      receiver_email: 'receiver@test.com',
      profile_id: 'legacy_v0',
      publisher_domain_verified: false,
    },
    scopes: [],
    external_processing: 'none',
    reciprocal_allowed: false,
    expires_at: '2026-10-02T10:00:00.000Z',
    entry: { wr_code_canonical: '', value_statement: '' },
    session_bound_expires_at: '',
    ...overrides,
  }
}

function rowMap(p: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(connectOfferPreviewRows({ preview: p, preview_hash: HASH }).map((r) => [r.label, r.value]))
}

describe('readConnectOfferPreview', () => {
  it('accepts a preview object with a 64-char lowercase hex hash', () => {
    expect(readConnectOfferPreview({ preview: preview(), preview_hash: HASH })?.preview_hash).toBe(HASH)
  })

  it('rejects a missing, malformed or uppercase hash and an empty preview', () => {
    expect(readConnectOfferPreview(undefined)).toBeNull()
    expect(readConnectOfferPreview({ preview: preview(), preview_hash: 'AB'.repeat(32) })).toBeNull()
    expect(readConnectOfferPreview({ preview: preview(), preview_hash: 'abc' })).toBeNull()
    expect(readConnectOfferPreview({ preview: {}, preview_hash: HASH })).toBeNull()
    expect(readConnectOfferPreview({ preview: [], preview_hash: HASH })).toBeNull()
  })
})

describe('connectOfferPreviewRows', () => {
  it('shows parties, kind, sharing terms and expiry for a plain handshake', () => {
    expect(rowMap(preview())).toEqual({
      From: 'sender@test.com',
      To: 'receiver@test.com',
      Kind: 'Handshake',
      'Context scopes': 'None',
      'Outside processing': 'Not allowed',
      'Two-way sharing': 'Not allowed',
      'Request expires': '2026-10-02 10:00 UTC',
    })
  })

  it('names the own-device pairing profile', () => {
    const rows = rowMap(preview({ bound_definition: { sender_email: 'me@test.com', receiver_email: 'me@test.com', profile_id: 'internal_device' } }))
    expect(rows.Kind).toBe('Pairing with your own device')
  })

  it('adds the WR Code, publisher domain state and signed offer when the offer came from a code', () => {
    const rows = rowMap(
      preview({
        bound_definition: { sender_email: 'pub@a.test', receiver_email: 'r@test.com', profile_id: 'legacy_v0', publisher_domain_verified: true },
        entry: { wr_code_canonical: 'P-TEST01-10001N', value_statement: 'Signed value statement.' },
        scopes: ['billing', 'support'],
        reciprocal_allowed: true,
        session_bound_expires_at: '2026-09-26T08:30:00.000Z',
      }),
    )
    expect(rows['WR Code']).toBe('P-TEST01-10001N')
    expect(rows['Publisher domain']).toBe('Verified')
    expect(rows.Offer).toBe('Signed value statement.')
    expect(rows['Context scopes']).toBe('billing, support')
    expect(rows['Two-way sharing']).toBe('Allowed')
    expect(rows['Session offer ends']).toBe('2026-09-26 08:30 UTC')
  })

  it('does not show code rows for an offer without a WR Code', () => {
    const rows = rowMap(preview())
    expect(rows['WR Code']).toBeUndefined()
    expect(rows['Publisher domain']).toBeUndefined()
    expect(rows.Offer).toBeUndefined()
  })

  it('an unknown profile id is named, not dropped', () => {
    expect(rowMap(preview({ bound_definition: { profile_id: 'future_profile' } })).Kind).toBe('Handshake (future_profile)')
  })
})

describe('formatPreviewInstant', () => {
  it('formats ISO instants in UTC and leaves anything else unchanged', () => {
    expect(formatPreviewInstant('2026-10-02T10:00:00.000Z')).toBe('2026-10-02 10:00 UTC')
    expect(formatPreviewInstant('soon')).toBe('soon')
  })
})

describe('connectOfferConsentErrorCopy', () => {
  it('maps consent refusals to plain language and leaves others to the caller', () => {
    expect(connectOfferConsentErrorCopy('PREVIEW_HASH_MISMATCH')).toMatch(/changed after you opened it/)
    expect(connectOfferConsentErrorCopy('PREVIEW_HASH_REQUIRED')).toMatch(/review it before accepting/)
    expect(connectOfferConsentErrorCopy('OFFER_NOT_CONSENTABLE')).toMatch(/can no longer be accepted/)
    expect(connectOfferConsentErrorCopy('SOMETHING_ELSE')).toBeNull()
  })
})
