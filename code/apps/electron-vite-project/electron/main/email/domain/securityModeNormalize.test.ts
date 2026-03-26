import { describe, it, expect } from 'vitest'
import { imapUsesImplicitTls, normalizeSecurityMode } from './securityModeNormalize'

describe('imapUsesImplicitTls', () => {
  it('treats ssl/tls/imaps aliases as implicit TLS (993-style)', () => {
    expect(imapUsesImplicitTls('ssl')).toBe(true)
    expect(imapUsesImplicitTls('SSL')).toBe(true)
    expect(imapUsesImplicitTls('tls')).toBe(true)
    expect(imapUsesImplicitTls('SSL/TLS')).toBe(true)
    expect(imapUsesImplicitTls('imaps')).toBe(true)
  })

  it('does not treat starttls as implicit TLS', () => {
    expect(imapUsesImplicitTls('starttls')).toBe(false)
  })
})

describe('normalizeSecurityMode', () => {
  it('maps legacy strings to canonical ssl/starttls/none', () => {
    expect(normalizeSecurityMode('SSL/TLS', 'none')).toBe('ssl')
    expect(normalizeSecurityMode('starttls', 'ssl')).toBe('starttls')
    expect(normalizeSecurityMode('plain', 'ssl')).toBe('none')
  })
})
