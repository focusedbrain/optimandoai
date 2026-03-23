/**
 * Unit tests for hsContextNormalize.ts
 *
 * Coverage:
 *  1. normalizeAdHocContext — plain text passthrough
 *  2. normalizeAdHocContext — JSON to Key: Value
 *  3. normalizeAdHocContext — nested JSON indented
 *  4. normalizeAdHocContext — JSON array repeated lines
 *  5. normalizeAdHocContext — invalid JSON falls back to plain text
 *  6. normalizeProfileToText — renders all sections
 *  7. normalizeProfileToText — custom fields multi-line
 *  8. normalizeProfileToText — document pending note
 *  9. normalizeProfileToText — document failed note
 * 10. normalizeProfileToText — document success with text
 * 11. buildCombinedContextText — multiple profiles + ad-hoc
 */

import { describe, it, expect } from 'vitest'
import {
  normalizeAdHocContext,
  normalizeProfileToText,
  buildCombinedContextText,
} from './hsContextNormalize'
import type { HsContextProfile, ProfileDocumentSummary } from './hsContextNormalize'

// ── Helpers ──

function makeProfile(overrides: Partial<HsContextProfile> = {}): HsContextProfile {
  return {
    id: 'hsp_test',
    name: 'Test Corp',
    scope: 'non_confidential',
    fields: {},
    custom_fields: [],
    ...overrides,
  }
}

// ── 1. Plain text passthrough ──
describe('normalizeAdHocContext — plain text', () => {
  it('returns trimmed plain text unchanged', () => {
    const result = normalizeAdHocContext('  Hello world  ')
    expect(result).toBe('Hello world')
  })

  it('preserves line breaks', () => {
    const result = normalizeAdHocContext('Line 1\nLine 2\nLine 3')
    expect(result).toContain('Line 1')
    expect(result).toContain('Line 2')
    expect(result).toContain('Line 3')
  })

  it('collapses more than 2 blank lines', () => {
    const result = normalizeAdHocContext('A\n\n\n\n\nB')
    expect(result).not.toMatch(/\n{3,}/)
  })

  it('returns empty string for blank input', () => {
    expect(normalizeAdHocContext('   ')).toBe('')
    expect(normalizeAdHocContext('')).toBe('')
  })
})

// ── 2. Simple JSON object ──
describe('normalizeAdHocContext — simple JSON', () => {
  it('renders flat JSON as Key: Value lines', () => {
    const result = normalizeAdHocContext(JSON.stringify({ name: 'Acme', country: 'DE' }))
    expect(result).toContain('name: Acme')
    expect(result).toContain('country: DE')
  })
})

// ── 3. Nested JSON ──
describe('normalizeAdHocContext — nested JSON', () => {
  it('indents nested objects', () => {
    const obj = { company: { name: 'Acme', vat: 'DE123' } }
    const result = normalizeAdHocContext(JSON.stringify(obj))
    expect(result).toContain('company:')
    expect(result).toContain('name: Acme')
    expect(result).toContain('vat: DE123')
  })
})

// ── 4. JSON array ──
describe('normalizeAdHocContext — JSON array', () => {
  it('renders array items as repeated lines', () => {
    const result = normalizeAdHocContext(JSON.stringify(['alpha', 'beta', 'gamma']))
    expect(result).toContain('alpha')
    expect(result).toContain('beta')
    expect(result).toContain('gamma')
  })
})

// ── 5. Invalid JSON fallback ──
describe('normalizeAdHocContext — invalid JSON', () => {
  it('treats invalid JSON as plain text', () => {
    const input = 'This is not { JSON at all'
    const result = normalizeAdHocContext(input)
    expect(result).toBe(input)
  })

  it('handles partial JSON as plain text', () => {
    const input = '{"key": "value"'  // unclosed
    const result = normalizeAdHocContext(input)
    expect(result).toContain('key')
  })
})

// ── 6. Profile to text — all sections ──
describe('normalizeProfileToText — full profile', () => {
  it('renders PROFILE header and scope', () => {
    const profile = makeProfile({
      name: 'Acme Corp',
      scope: 'confidential',
      description: 'Main supplier profile',
    })
    const result = normalizeProfileToText(profile)
    expect(result).toMatch(/^PROFILE: Acme Corp/m)
    expect(result).toContain('Scope: Confidential')
    expect(result).toContain('Main supplier profile')
  })

  it('renders Business Identity fields', () => {
    const profile = makeProfile({
      fields: {
        legalCompanyName: 'Acme GmbH',
        country: 'Germany',
        website: 'https://acme.de',
      },
    })
    const result = normalizeProfileToText(profile)
    expect(result).toContain('Business Identity')
    expect(result).toContain('Legal Company Name: Acme GmbH')
    expect(result).toContain('Country: Germany')
    expect(result).toContain('Website: https://acme.de')
  })

  it('renders structured address from street/city/country', () => {
    const profile = makeProfile({
      fields: {
        legalCompanyName: 'Acme GmbH',
        street: 'Hauptstr',
        streetNumber: '42',
        postalCode: '10115',
        city: 'Berlin',
        country: 'Germany',
      },
    })
    const result = normalizeProfileToText(profile)
    expect(result).toContain('Address: Hauptstr 42, 10115 Berlin, Germany')
    expect(result).toContain('Country: Germany')
  })

  it('renders payment methods from paymentMethods array', () => {
    const profile = makeProfile({
      fields: {
        paymentMethods: [
          { type: 'bank_account', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', bank_name: 'Commerzbank', account_holder: 'Acme GmbH' },
        ],
      },
    })
    const result = normalizeProfileToText(profile)
    expect(result).toContain('Payment Methods: Bank: DE89370400440532013000 — COBADEFFXXX — Commerzbank — Acme GmbH')
  })

  it('masks credit card in payment methods (last 4 digits only, no CVV)', () => {
    const profile = makeProfile({
      fields: {
        paymentMethods: [
          { type: 'credit_card', cc_number: '4111111111111111', cc_holder: 'John Doe', cc_expiry: '12/25', cc_cvv: '123' },
        ],
      },
    })
    const result = normalizeProfileToText(profile)
    expect(result).toContain('Card: ••••1111 — John Doe — 12/25')
    expect(result).not.toContain('4111')
    expect(result).not.toContain('123')
    expect(result).not.toContain('cc_cvv')
  })

  it('renders Contacts section', () => {
    const profile = makeProfile({
      fields: {
        contacts: [
          { name: 'Jane Doe', role: 'Sales', email: 'jane@acme.de', phone: '+49 30 1234' },
        ],
      },
    })
    const result = normalizeProfileToText(profile)
    expect(result).toContain('Contact Persons')
    expect(result).toContain('Jane Doe')
    expect(result).toContain('Sales')
    expect(result).toContain('jane@acme.de')
  })

  it('renders Opening Hours section', () => {
    const profile = makeProfile({
      fields: {
        openingHours: [{ days: 'Mon-Fri', from: '09:00', to: '17:00' }],
        timezone: 'Europe/Berlin',
      },
    })
    const result = normalizeProfileToText(profile)
    expect(result).toContain('Opening Hours')
    expect(result).toContain('Mon-Fri: 09:00–17:00')
    expect(result).toContain('Timezone: Europe/Berlin')
  })

  it('skips empty sections', () => {
    const profile = makeProfile({ name: 'Minimal' })
    const result = normalizeProfileToText(profile)
    expect(result).not.toContain('Business Identity')
    expect(result).not.toContain('Contacts')
    expect(result).not.toContain('Billing')
  })
})

// ── 7. Custom fields multi-line ──
describe('normalizeProfileToText — custom fields', () => {
  it('renders single-line custom fields as Label: Value', () => {
    const profile = makeProfile({
      custom_fields: [{ label: 'Carrier', value: 'DHL Express' }],
    })
    const result = normalizeProfileToText(profile)
    expect(result).toContain('Carrier: DHL Express')
  })

  it('renders multi-line custom field values indented', () => {
    const profile = makeProfile({
      custom_fields: [{ label: 'Notes', value: 'Line A\nLine B\nLine C' }],
    })
    const result = normalizeProfileToText(profile)
    expect(result).toContain('Notes:')
    expect(result).toContain('Line A')
    expect(result).toContain('Line B')
  })

  it('skips fields with empty labels', () => {
    const profile = makeProfile({
      custom_fields: [{ label: '', value: 'ghost' }],
    })
    const result = normalizeProfileToText(profile)
    expect(result).not.toContain('ghost')
  })
})

// ── 8. Document pending note ──
describe('normalizeProfileToText — document pending', () => {
  it('includes pending note for pending documents', () => {
    const docs: ProfileDocumentSummary[] = [
      { filename: 'pricelist.pdf', extraction_status: 'pending' },
    ]
    const result = normalizeProfileToText(makeProfile(), docs)
    expect(result).toContain('[Document extraction pending: pricelist.pdf]')
  })
})

// ── 9. Document failed note ──
describe('normalizeProfileToText — document failed', () => {
  it('includes failed note for failed documents', () => {
    const docs: ProfileDocumentSummary[] = [
      { filename: 'cert.pdf', extraction_status: 'failed', error_message: 'corrupted' },
    ]
    const result = normalizeProfileToText(makeProfile(), docs)
    expect(result).toContain('[Document extraction failed: cert.pdf — not included]')
  })
})

// ── 10. Document success with extracted text ──
describe('normalizeProfileToText — document success', () => {
  it('includes extracted text for successful documents', () => {
    const docs: ProfileDocumentSummary[] = [
      { filename: 'manual.pdf', extraction_status: 'success', extracted_text: 'Chapter 1: Installation' },
    ]
    const result = normalizeProfileToText(makeProfile(), docs)
    expect(result).toContain('[Document: manual.pdf]')
    expect(result).toContain('Chapter 1: Installation')
  })

  it('does not include URL or PDF binary in output', () => {
    const docs: ProfileDocumentSummary[] = [
      { filename: 'doc.pdf', extraction_status: 'success', extracted_text: 'plain text content' },
    ]
    const result = normalizeProfileToText(makeProfile(), docs)
    expect(result).not.toMatch(/https?:\/\//i)
    expect(result).not.toContain('application/pdf')
  })
})

// ── 11. buildCombinedContextText ──
describe('buildCombinedContextText', () => {
  it('combines multiple profiles', () => {
    const profiles = [
      { profile: makeProfile({ name: 'Alpha Corp' }), documents: [] },
      { profile: makeProfile({ id: 'hsp_2', name: 'Beta GmbH', scope: 'confidential' as const }), documents: [] },
    ]
    const result = buildCombinedContextText(profiles)
    expect(result).toContain('PROFILE: Alpha Corp')
    expect(result).toContain('PROFILE: Beta GmbH')
  })

  it('appends ad-hoc context after profiles', () => {
    const profiles = [{ profile: makeProfile({ name: 'Corp A' }), documents: [] }]
    const result = buildCombinedContextText(profiles, 'Extra info here')
    expect(result).toContain('PROFILE: Corp A')
    expect(result).toContain('Extra info here')
    expect(result).toContain('--- Ad-hoc Context ---')
  })

  it('normalizes JSON ad-hoc context', () => {
    const result = buildCombinedContextText([], JSON.stringify({ note: 'hello' }))
    expect(result).toContain('note: hello')
  })

  it('returns empty string for empty inputs', () => {
    expect(buildCombinedContextText([])).toBe('')
    expect(buildCombinedContextText([], '   ')).toBe('')
  })
})
