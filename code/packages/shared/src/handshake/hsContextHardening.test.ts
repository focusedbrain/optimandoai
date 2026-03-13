/**
 * HS Context Hardening Tests
 *
 * Covers: publisher gating, link validation, sensitive policy, document metadata,
 * backward compatibility, and field validation.
 */

import { describe, it, expect } from 'vitest'
import { validateHsContextLink, linkEntityId } from './linkValidation'
import {
  validateUrl,
  validateEmail,
  validatePhone,
  validateIdentifier,
  validatePlainText,
  validateDocumentLabel,
  validateDocumentType,
} from './hsContextFieldValidation'
import { canAccessRecordType } from '../vault/vaultCapabilities'

// ── Publisher gating ──
describe('HS Context publisher gating', () => {
  it('publisher can use handshake_context (share)', () => {
    expect(canAccessRecordType('publisher', 'handshake_context', 'share')).toBe(true)
  })

  it('publisher_lifetime can use handshake_context', () => {
    expect(canAccessRecordType('publisher_lifetime', 'handshake_context', 'share')).toBe(true)
  })

  it('enterprise can use handshake_context', () => {
    expect(canAccessRecordType('enterprise', 'handshake_context', 'share')).toBe(true)
  })

  it('pro cannot use handshake_context', () => {
    expect(canAccessRecordType('pro', 'handshake_context', 'share')).toBe(false)
  })

  it('free cannot use handshake_context', () => {
    expect(canAccessRecordType('free', 'handshake_context', 'share')).toBe(false)
  })

  it('unknown cannot use handshake_context', () => {
    expect(canAccessRecordType('unknown', 'handshake_context', 'share')).toBe(false)
  })
})

// ── Link validation (protected link flow) ──
describe('validateHsContextLink', () => {
  it('rejects invalid protocol (javascript)', () => {
    const r = validateHsContextLink('javascript:alert(1)')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('Unsafe')
  })

  it('rejects data: protocol', () => {
    const r = validateHsContextLink('data:text/html,<script>')
    expect(r.ok).toBe(false)
  })

  it('rejects file: protocol', () => {
    const r = validateHsContextLink('file:///etc/passwd')
    expect(r.ok).toBe(false)
  })

  it('accepts valid https URL', () => {
    const r = validateHsContextLink('https://example.com/path')
    expect(r.ok).toBe(true)
    expect(r.url).toBe('https://example.com/path')
  })

  it('accepts valid http URL', () => {
    const r = validateHsContextLink('http://example.com')
    expect(r.ok).toBe(true)
  })

  it('rejects empty string', () => {
    const r = validateHsContextLink('')
    expect(r.ok).toBe(false)
  })

  it('linkEntityId truncates to 500 chars', () => {
    const long = 'https://example.com/' + 'a'.repeat(600)
    expect(linkEntityId(long).length).toBe(500)
  })
})

// ── Field validation ──
describe('hsContextFieldValidation', () => {
  it('validateUrl rejects javascript', () => {
    const r = validateUrl('javascript:void(0)')
    expect(r.ok).toBe(false)
  })

  it('validateUrl accepts https', () => {
    const r = validateUrl('https://acme.com')
    expect(r.ok).toBe(true)
  })

  it('validateEmail rejects invalid', () => {
    expect(validateEmail('not-an-email').ok).toBe(false)
    expect(validateEmail('@nodomain.com').ok).toBe(false)
  })

  it('validateEmail accepts valid', () => {
    const r = validateEmail('user@example.com')
    expect(r.ok).toBe(true)
  })

  it('validatePhone requires 7+ digits', () => {
    expect(validatePhone('123').ok).toBe(false)
    expect(validatePhone('+1 234 567 8901').ok).toBe(true)
  })

  it('validatePlainText rejects HTML', () => {
    const r = validatePlainText('<script>alert(1)</script>')
    expect(r.ok).toBe(false)
  })

  it('validateDocumentLabel allows empty (optional)', () => {
    const r = validateDocumentLabel('')
    expect(r.ok).toBe(true)
    expect(r.value).toBe('')
  })

  it('validateDocumentLabel rejects HTML', () => {
    const r = validateDocumentLabel('<b>Label</b>')
    expect(r.ok).toBe(false)
  })

  it('validateDocumentType accepts allowed values', () => {
    expect(validateDocumentType('manual').ok).toBe(true)
    expect(validateDocumentType('contract').ok).toBe(true)
    expect(validateDocumentType('certificate').ok).toBe(true)
    expect(validateDocumentType('pricelist').ok).toBe(true)
    expect(validateDocumentType('custom').ok).toBe(true)
  })

  it('validateDocumentType rejects invalid values', () => {
    const r = validateDocumentType('invalid_type')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('one of')
  })

  it('validateDocumentType allows empty (optional)', () => {
    expect(validateDocumentType('').ok).toBe(true)
    expect(validateDocumentType(null).ok).toBe(true)
    expect(validateDocumentType(undefined).ok).toBe(true)
  })
})

// ── Auto-expand rule (must stay in sync with HandshakeWorkspace) ──
describe('Auto-expand rule', () => {
  const shouldAutoExpand = (b: { type?: string; source?: string }) =>
    b.type === 'vault_profile' && b.source === 'received'

  it('received vault_profile expands', () => {
    expect(shouldAutoExpand({ type: 'vault_profile', source: 'received' })).toBe(true)
  })

  it('generic context does not expand', () => {
    expect(shouldAutoExpand({ type: 'generic', source: 'received' })).toBe(false)
    expect(shouldAutoExpand({ type: 'vault_profile', source: 'sent' })).toBe(false)
    expect(shouldAutoExpand({ type: 'message' })).toBe(false)
  })
})

// ── Backward compatibility ──
describe('Backward compatibility', () => {
  it('validateDocumentLabel allows null/undefined (optional field)', () => {
    expect(validateDocumentLabel(null).ok).toBe(true)
    expect(validateDocumentLabel(undefined).ok).toBe(true)
  })

  it('old items without label/document_type: validateDocumentLabel accepts empty', () => {
    const r = validateDocumentLabel('')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe('')
  })
})
