import { describe, it, expect } from 'vitest'
import {
  normalizeGoogleOAuthClientId,
  isPlaceholderGoogleOAuthClientId,
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

describe('isPlaceholderGoogleOAuthClientId', () => {
  it('is true for invalid-but-nonempty placeholder-like strings', () => {
    expect(isPlaceholderGoogleOAuthClientId('REPLACE_WITH_x.apps.googleusercontent.com')).toBe(true)
  })

  it('is false for empty', () => {
    expect(isPlaceholderGoogleOAuthClientId('')).toBe(false)
    expect(isPlaceholderGoogleOAuthClientId(null)).toBe(false)
  })
})
