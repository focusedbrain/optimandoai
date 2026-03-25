import { describe, it, expect } from 'vitest'
import {
  normalizeGoogleOAuthClientId,
  normalizeGoogleOAuthClientSecret,
  isPlaceholderGoogleOAuthClientId,
  oauthClientIdFingerprint,
} from './googleOAuthBuiltin'

describe('normalizeGoogleOAuthClientId', () => {
  it('accepts a typical Google OAuth client id', () => {
    expect(normalizeGoogleOAuthClientId('123456789-abc123xyz.apps.googleusercontent.com')).toBe(
      '123456789-abc123xyz.apps.googleusercontent.com',
    )
  })

  it('rejects placeholder templates', () => {
    expect(normalizeGoogleOAuthClientId('REPLACE_WITH_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com')).toBeNull()
    expect(normalizeGoogleOAuthClientId('YOUR_CLIENT.apps.googleusercontent.com')).toBeNull()
  })

  it('rejects wrong suffix', () => {
    expect(normalizeGoogleOAuthClientId('not-a-google-client-id')).toBeNull()
  })

  it('trims whitespace', () => {
    expect(normalizeGoogleOAuthClientId('  1-2.apps.googleusercontent.com  ')).toBe('1-2.apps.googleusercontent.com')
  })
})

describe('oauthClientIdFingerprint', () => {
  it('uses first 12 and last 8 for typical ids', () => {
    const id = '900632390085-abcdefghijklmnopqrstuv.apps.googleusercontent.com'
    expect(oauthClientIdFingerprint(id)).toBe('900632390085…tent.com')
  })

  it('abbreviates ids length <= 20 without printing full value', () => {
    expect(oauthClientIdFingerprint('short.apps.googleus')).toMatch(/^short\.…\(19ch\)$/)
  })
})

describe('normalizeGoogleOAuthClientSecret', () => {
  it('accepts a typical Desktop client secret shape', () => {
    expect(normalizeGoogleOAuthClientSecret('GOCSPX-abc123xyz789012')).toBe('GOCSPX-abc123xyz789012')
  })

  it('rejects placeholders and short strings', () => {
    expect(normalizeGoogleOAuthClientSecret('REPLACE_WITH_CLIENT_SECRET')).toBeNull()
    expect(normalizeGoogleOAuthClientSecret('short')).toBeNull()
    expect(normalizeGoogleOAuthClientSecret('')).toBeNull()
  })
})

describe('isPlaceholderGoogleOAuthClientId', () => {
  it('is true for invalid-but-nonempty placeholder-like strings', () => {
    expect(isPlaceholderGoogleOAuthClientId('REPLACE_WITH_x.apps.googleusercontent.com')).toBe(true)
  })

  it('is false for empty', () => {
    expect(isPlaceholderGoogleOAuthClientId('')).toBe(false)
    expect(isPlaceholderGoogleOAuthClientId(null)).toBe(false)
  })
})
