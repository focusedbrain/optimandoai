import { describe, expect, it } from 'vitest'
import {
  grantSessionConsent,
  hasSessionConsent,
  revokeSessionConsent,
  onSessionConsentChange,
  _clearAllSessionConsentForTests,
} from '../sessionConsent.js'

describe('sessionConsent', () => {
  it('grants pdf_parsing scope for the session', () => {
    _clearAllSessionConsentForTests()
    expect(hasSessionConsent('pdf_parsing')).toBe(false)
    grantSessionConsent('pdf_parsing')
    expect(hasSessionConsent('pdf_parsing')).toBe(true)
    revokeSessionConsent('pdf_parsing')
    expect(hasSessionConsent('pdf_parsing')).toBe(false)
  })

  it('notifies listeners on grant', () => {
    _clearAllSessionConsentForTests()
    let n = 0
    const off = onSessionConsentChange(() => {
      n++
    })
    grantSessionConsent('pdf_parsing')
    expect(n).toBe(1)
    off()
  })

  it('supports arbitrary scope strings for future consent surfaces', () => {
    _clearAllSessionConsentForTests()
    grantSessionConsent('office_document_parsing')
    expect(hasSessionConsent('office_document_parsing')).toBe(true)
    expect(hasSessionConsent('pdf_parsing')).toBe(false)
    revokeSessionConsent('office_document_parsing')
    expect(hasSessionConsent('office_document_parsing')).toBe(false)
  })
})
