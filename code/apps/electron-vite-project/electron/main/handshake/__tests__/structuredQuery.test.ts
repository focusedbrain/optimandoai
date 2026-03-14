/**
 * Unit tests for structured query classifier and lookup.
 * Verifies that Context Graph field questions resolve correctly.
 */
import { describe, it, expect } from 'vitest'
import { queryClassifier, structuredLookup, structuredLookupMulti } from '../structuredQuery'

describe('queryClassifier', () => {
  it('matches "What are the payment methods?"', () => {
    const r = queryClassifier('What are the payment methods?')
    expect(r.matched).toBe(true)
    expect(r.fieldPath).toBe('billing.payment_methods')
  })

  it('matches "Whats that then Payment Methods" (loose phrasing)', () => {
    const r = queryClassifier('Whats that then Payment Methods')
    expect(r.matched).toBe(true)
    expect(r.fieldPath).toBe('billing.payment_methods')
  })

  it('matches "What is the VAT number?"', () => {
    const r = queryClassifier('What is the VAT number?')
    expect(r.matched).toBe(true)
    expect(r.fieldPath).toBe('tax.vat_number')
  })

  it('matches "What is the email?"', () => {
    const r = queryClassifier('What is the email?')
    expect(r.matched).toBe(true)
    expect(r.fieldPath).toBe('contact.general.email')
  })

  it('matches "What is the address?"', () => {
    const r = queryClassifier('What is the address?')
    expect(r.matched).toBe(true)
    expect(r.fieldPath).toBe('company.address')
  })

  it('matches "What about the registration?"', () => {
    const r = queryClassifier('What about the registration?')
    expect(r.matched).toBe(true)
    expect(r.fieldPath).toBe('tax.registration_number')
  })

  it('matches "What are the opening hours?" (existing)', () => {
    const r = queryClassifier('What are the opening hours?')
    expect(r.matched).toBe(true)
    expect(r.fieldPath).toBe('opening_hours.schedule')
  })

  it('does not match document RAG questions', () => {
    const r = queryClassifier('What does the document say about refunds?')
    expect(r.matched).toBe(false)
  })

  it('does not match attachment questions', () => {
    const r = queryClassifier('What is this attachment about?')
    expect(r.matched).toBe(false)
  })

  // Coverage: additional structured queries
  it('matches "What is the registration number?"', () => {
    const r = queryClassifier('What is the registration number?')
    expect(r.matched).toBe(true)
    expect(r.fieldPath).toBe('tax.registration_number')
  })
  it('matches "What is the legal company?"', () => {
    const r = queryClassifier('What is the legal company?')
    expect(r.matched).toBe(true)
    expect(r.fieldPath).toBe('company.legal_name')
  })
  it('matches "What country is it in?"', () => {
    const r = queryClassifier('What country is it in?')
    expect(r.matched).toBe(true)
    expect(r.fieldPath).toBe('company.country')
  })
  it('matches "What is the phone number?"', () => {
    const r = queryClassifier('What is the phone number?')
    expect(r.matched).toBe(true)
    expect(r.fieldPath).toBe('contact.general.phone')
  })
  it('matches "What are the links?"', () => {
    const r = queryClassifier('What are the links?')
    expect(r.matched).toBe(true)
    expect(r.fieldPath).toBe('company.links')
  })
  it('matches "Who are the contacts?"', () => {
    const r = queryClassifier('Who are the contacts?')
    expect(r.matched).toBe(true)
    expect(r.fieldPath).toBe('contact.persons')
  })

  // False-positive safety: must NOT match as structured lookup
  it('does not match "send me an email" (command, not question)', () => {
    const r = queryClassifier('send me an email')
    expect(r.matched).toBe(false)
  })
  it('does not match "call them" (command)', () => {
    const r = queryClassifier('call them')
    expect(r.matched).toBe(false)
  })
  it('does not match "register this" (command)', () => {
    const r = queryClassifier('register this')
    expect(r.matched).toBe(false)
  })
  it('does not match "payment failed" (status, not question)', () => {
    const r = queryClassifier('payment failed')
    expect(r.matched).toBe(false)
  })
  it('does not match "country manager" (role, not question)', () => {
    const r = queryClassifier('country manager')
    expect(r.matched).toBe(false)
  })
  it('does not match "link this" (command)', () => {
    const r = queryClassifier('link this')
    expect(r.matched).toBe(false)
  })
  it('does not match "address this issue" (command)', () => {
    const r = queryClassifier('address this issue')
    expect(r.matched).toBe(false)
  })
})

describe('structuredLookup', () => {
  const blocksWithProfile = [
    {
      handshake_id: 'hs-test-1',
      block_id: 'ctx-test-acceptor-001',
      payload_ref: JSON.stringify({
        profile: {
          id: 'p1',
          name: 'Acme Corp',
          fields: {
            legalCompanyName: 'Acme Corp Ltd',
            vatNumber: 'DE123456789',
            companyRegistrationNumber: 'HRB 12345',
            generalPhone: '+49 30 123456',
            generalEmail: 'info@acme.example',
            address: 'Berlin, Germany',
            country: 'Germany',
            paymentMethods: [
              { type: 'bank_account', iban: 'DE89370400440532013000', bic: 'COBADEFFXXX', bank_name: 'Commerzbank', account_holder: 'Acme' },
              { type: 'paypal', paypal_email: 'pay@acme.example' },
            ],
            contacts: [
              { name: 'John Doe', role: 'Sales', email: 'john@acme.example', phone: '+49 30 111111' },
            ],
            website: 'https://acme.example',
            linkedin: 'https://linkedin.com/company/acme',
          },
        },
      }),
      source: 'acceptor',
    },
  ]

  it('returns payment methods from profile.fields', () => {
    const r = structuredLookup(blocksWithProfile, 'billing.payment_methods')
    expect(r.found).toBe(true)
    expect(r.value).toContain('DE89370400440532013000')
    expect(r.value).toContain('PayPal: pay@acme.example')
  })

  it('returns VAT number from profile.fields', () => {
    const r = structuredLookup(blocksWithProfile, 'tax.vat_number')
    expect(r.found).toBe(true)
    expect(r.value).toBe('DE123456789')
  })

  it('returns registration from profile.fields', () => {
    const r = structuredLookup(blocksWithProfile, 'tax.registration_number')
    expect(r.found).toBe(true)
    expect(r.value).toBe('HRB 12345')
  })

  it('returns email from profile.fields', () => {
    const r = structuredLookup(blocksWithProfile, 'contact.general.email')
    expect(r.found).toBe(true)
    expect(r.value).toBe('info@acme.example')
  })

  it('returns address from profile.fields', () => {
    const r = structuredLookup(blocksWithProfile, 'company.address')
    expect(r.found).toBe(true)
    expect(r.value).toBe('Berlin, Germany')
  })

  it('returns country from profile.fields', () => {
    const r = structuredLookup(blocksWithProfile, 'company.country')
    expect(r.found).toBe(true)
    expect(r.value).toBe('Germany')
  })

  it('returns contacts from profile.fields', () => {
    const r = structuredLookup(blocksWithProfile, 'contact.persons')
    expect(r.found).toBe(true)
    expect(r.value).toContain('John Doe')
    expect(r.value).toContain('john@acme.example')
  })

  it('returns links from profile.fields', () => {
    const r = structuredLookup(blocksWithProfile, 'company.links')
    expect(r.found).toBe(true)
    expect(r.value).toContain('https://acme.example')
    expect(r.value).toContain('https://linkedin.com/company/acme')
  })

  it('formatAddress: uses legacy address when present', () => {
    const blocks = [{
      handshake_id: 'h1',
      block_id: 'ctx-1',
      payload_ref: JSON.stringify({
        profile: { fields: { address: '123 Main St, City' } },
      }),
      source: 'acceptor',
    }]
    const r = structuredLookup(blocks, 'company.address')
    expect(r.found).toBe(true)
    expect(r.value).toBe('123 Main St, City')
  })

  it('formatAddress: composes from structured fields when address empty', () => {
    const blocks = [{
      handshake_id: 'h1',
      block_id: 'ctx-1',
      payload_ref: JSON.stringify({
        profile: {
          fields: {
            street: 'Main St',
            streetNumber: '123',
            postalCode: '12345',
            city: 'Berlin',
            country: 'Germany',
          },
        },
      }),
      source: 'acceptor',
    }]
    const r = structuredLookup(blocks, 'company.address')
    expect(r.found).toBe(true)
    expect(r.value).toContain('Main St')
    expect(r.value).toContain('Berlin')
    expect(r.value).toContain('Germany')
  })

  it('formatPaymentMethods: handles empty array', () => {
    const blocks = [{
      handshake_id: 'h1',
      block_id: 'ctx-1',
      payload_ref: JSON.stringify({
        profile: { fields: { paymentMethods: [] } },
      }),
      source: 'acceptor',
    }]
    const r = structuredLookup(blocks, 'billing.payment_methods')
    expect(r.found).toBe(false)
  })

  it('formatLinks: returns undefined when no links', () => {
    const blocks = [{
      handshake_id: 'h1',
      block_id: 'ctx-1',
      payload_ref: JSON.stringify({
        profile: { fields: { generalEmail: 'a@b.com' } },
      }),
      source: 'acceptor',
    }]
    const r = structuredLookup(blocks, 'company.links')
    expect(r.found).toBe(false)
  })
})

describe('multi-field compound queries', () => {
  it('matches "contact and company details"', () => {
    const r = queryClassifier('Give me the contact and company details')
    expect(r.matched).toBe(true)
    expect(r.fieldPaths).toBeDefined()
    expect(r.fieldPaths).toContain('contact.general.phone')
    expect(r.fieldPaths).toContain('company.address')
  })

  it('structuredLookupMulti returns aggregated result', () => {
    const blocks = [{
      handshake_id: 'h1',
      block_id: 'ctx-1',
      payload_ref: JSON.stringify({
        profile: {
          fields: {
            generalPhone: '+49 123',
            generalEmail: 'a@b.com',
            legalCompanyName: 'Acme',
            address: 'Berlin',
          },
        },
      }),
      source: 'acceptor',
    }]
    const r = structuredLookupMulti(blocks, ['contact.general.phone', 'contact.general.email', 'company.name', 'company.address'])
    expect(r.found).toBe(true)
    expect(r.value).toContain('+49 123')
    expect(r.value).toContain('a@b.com')
    expect(r.value).toContain('Acme')
    expect(r.value).toContain('Berlin')
  })
})
