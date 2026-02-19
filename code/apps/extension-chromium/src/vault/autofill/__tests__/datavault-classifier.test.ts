/**
 * Tests: DataVault Field Classifier + Fill Engine
 *
 * Validates:
 *   1. Identity/company field detection via autocomplete, name/id, label
 *   2. Multi-language keyword matching (DE + EN)
 *   3. Confidence thresholds (high >= 65, medium 50-65, below 50 excluded)
 *   4. Fill engine: single-field fill, multi-field fill
 *   5. Address composition (street + house_number)
 *   6. <select> filling by value and text
 *   7. Readonly/disabled field skipping
 *   8. Non-empty field preservation (no overwrite by default)
 *   9. DataVault adapter field map building
 *
 * @vitest-environment jsdom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { scoreCandidate } from '../fieldScanner'
import { buildFieldMap } from '../dataVaultAdapter'
import { fillSingleField, fillAllMatchedFields } from '../dataVaultFillEngine'
import type { FieldCandidate } from '../../../../../../packages/shared/src/vault/insertionPipeline'
import type { FieldKind } from '../../../../../../packages/shared/src/vault/fieldTaxonomy'
import { CONFIDENCE_THRESHOLD } from '../../../../../../packages/shared/src/vault/fieldTaxonomy'

// ============================================================================
// Helpers
// ============================================================================

function createInput(
  attrs: Record<string, string> = {},
  labelText?: string,
): HTMLInputElement {
  const input = document.createElement('input')
  for (const [k, v] of Object.entries(attrs)) {
    input.setAttribute(k, v)
  }
  document.body.appendChild(input)

  if (labelText) {
    const label = document.createElement('label')
    label.textContent = labelText
    if (input.id) {
      label.setAttribute('for', input.id)
    } else {
      label.appendChild(input.cloneNode())
    }
    document.body.appendChild(label)
  }

  // Give non-zero dimensions for visibility check
  Object.defineProperty(input, 'getBoundingClientRect', {
    value: () => ({ top: 100, left: 100, width: 200, height: 30, bottom: 130, right: 300 }),
  })

  return input
}

function createSelect(
  options: Array<{ value: string; text: string }>,
  attrs: Record<string, string> = {},
): HTMLSelectElement {
  const select = document.createElement('select')
  for (const [k, v] of Object.entries(attrs)) {
    select.setAttribute(k, v)
  }
  for (const opt of options) {
    const option = document.createElement('option')
    option.value = opt.value
    option.textContent = opt.text
    select.appendChild(option)
  }
  document.body.appendChild(select)

  Object.defineProperty(select, 'getBoundingClientRect', {
    value: () => ({ top: 100, left: 100, width: 200, height: 30, bottom: 130, right: 300 }),
  })

  return select
}

afterEach(() => {
  document.body.innerHTML = ''
})

// ============================================================================
// §1  Identity Field Detection
// ============================================================================

describe('DataVault classifier — identity fields', () => {
  it('detects first name via autocomplete="given-name"', () => {
    const input = createInput({ autocomplete: 'given-name' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.first_name')
    expect(score.best.accepted).toBe(true)
  })

  it('detects last name via autocomplete="family-name"', () => {
    const input = createInput({ autocomplete: 'family-name' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.last_name')
    expect(score.best.accepted).toBe(true)
  })

  it('detects email via input type="email"', () => {
    const input = createInput({ type: 'email', name: 'email' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toMatch(/\.email$/)
    expect(score.best.accepted).toBe(true)
  })

  it('detects phone via autocomplete="tel"', () => {
    const input = createInput({ autocomplete: 'tel' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.phone')
    expect(score.best.accepted).toBe(true)
  })

  it('detects street via autocomplete="street-address"', () => {
    const input = createInput({ autocomplete: 'street-address' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.street')
    expect(score.best.accepted).toBe(true)
  })

  it('detects postal code via autocomplete="postal-code"', () => {
    const input = createInput({ autocomplete: 'postal-code' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.postal_code')
    expect(score.best.accepted).toBe(true)
  })

  it('detects city via autocomplete="address-level2"', () => {
    const input = createInput({ autocomplete: 'address-level2' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.city')
    expect(score.best.accepted).toBe(true)
  })

  it('detects country via autocomplete="country"', () => {
    const input = createInput({ autocomplete: 'country' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.country')
    expect(score.best.accepted).toBe(true)
  })

  it('detects birthday via autocomplete="bday"', () => {
    const input = createInput({ autocomplete: 'bday' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.birthday')
    expect(score.best.accepted).toBe(true)
  })
})

// ============================================================================
// §2  Name/ID Regex Matching
// ============================================================================

describe('DataVault classifier — name/id patterns', () => {
  it('detects first name via name="first_name"', () => {
    const input = createInput({ name: 'first_name' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.first_name')
    expect(score.best.accepted).toBe(true)
  })

  it('detects last name via name="surname"', () => {
    const input = createInput({ name: 'surname' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.last_name')
    expect(score.best.accepted).toBe(true)
  })

  it('detects phone via id="phone"', () => {
    const input = createInput({ id: 'phone' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.phone')
    expect(score.best.accepted).toBe(true)
  })

  it('detects postal code via name="plz"', () => {
    const input = createInput({ name: 'plz' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.postal_code')
    expect(score.best.accepted).toBe(true)
  })

  it('detects city via name="city"', () => {
    const input = createInput({ name: 'city' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.city')
    expect(score.best.accepted).toBe(true)
  })
})

// ============================================================================
// §3  German Language Keywords
// ============================================================================

describe('DataVault classifier — German keywords', () => {
  it('detects "Vorname" as first name via placeholder', () => {
    const input = createInput({ placeholder: 'Vorname' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.first_name')
  })

  it('detects "Nachname" as last name via placeholder', () => {
    const input = createInput({ placeholder: 'Nachname' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.last_name')
  })

  it('detects "Straße" as street via name', () => {
    const input = createInput({ name: 'strasse' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.street')
    expect(score.best.accepted).toBe(true)
  })

  it('detects "Hausnummer" as street number via name', () => {
    const input = createInput({ name: 'hausnummer' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.street_number')
  })

  it('detects "Stadt" as city via placeholder', () => {
    const input = createInput({ placeholder: 'Stadt' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.city')
  })

  it('detects "Postleitzahl" as postal code via placeholder', () => {
    const input = createInput({ placeholder: 'Postleitzahl' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.postal_code')
  })

  it('detects "Telefon" as phone via placeholder', () => {
    const input = createInput({ placeholder: 'Telefon' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.phone')
  })

  it('detects "Geburtsdatum" as birthday via name', () => {
    const input = createInput({ name: 'geburtsdatum' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('identity.birthday')
    expect(score.best.accepted).toBe(true)
  })
})

// ============================================================================
// §4  Company Field Detection
// ============================================================================

describe('DataVault classifier — company fields', () => {
  it('detects company via autocomplete="organization"', () => {
    const input = createInput({ autocomplete: 'organization' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('company.name')
    expect(score.best.accepted).toBe(true)
  })

  it('detects VAT via name="vat_number"', () => {
    const input = createInput({ name: 'vat_number' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('company.vat_number')
    expect(score.best.accepted).toBe(true)
  })

  it('detects IBAN via name="iban"', () => {
    const input = createInput({ name: 'iban' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('company.iban')
    expect(score.best.accepted).toBe(true)
  })

  it('detects company name via name="firma"', () => {
    const input = createInput({ name: 'firma' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('company.name')
    expect(score.best.accepted).toBe(true)
  })

  it('detects USt-ID (German VAT) via name="ust_id"', () => {
    const input = createInput({ name: 'ust_id' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('company.vat_number')
    expect(score.best.accepted).toBe(true)
  })

  it('detects HRB via name="handelsregister"', () => {
    const input = createInput({ name: 'handelsregister' })
    const score = scoreCandidate(input)
    expect(score.best.bestKind).toBe('company.hrb')
    expect(score.best.accepted).toBe(true)
  })
})

// ============================================================================
// §5  Anti-Signal Suppression
// ============================================================================

describe('DataVault classifier — anti-signals', () => {
  it('suppresses hidden inputs', () => {
    const input = createInput({ type: 'hidden', name: 'first_name' })
    const score = scoreCandidate(input)
    expect(score.best.accepted).toBe(false)
  })

  it('suppresses search-related fields', () => {
    const input = createInput({ name: 'search_query', type: 'text' })
    const score = scoreCandidate(input)
    expect(score.best.accepted).toBe(false)
  })

  it('suppresses checkbox inputs', () => {
    const input = createInput({ type: 'checkbox', name: 'first_name' })
    const score = scoreCandidate(input)
    expect(score.best.accepted).toBe(false)
  })
})

// ============================================================================
// §6  DataVault Adapter — Field Map Building
// ============================================================================

describe('DataVault adapter — buildFieldMap', () => {
  it('maps identity fields correctly', () => {
    const fields = [
      { key: 'first_name', value: 'Oscar', encrypted: false, type: 'text' as const },
      { key: 'surname', value: 'Schreyer', encrypted: false, type: 'text' as const },
      { key: 'email', value: 'oscar@example.com', encrypted: false, type: 'email' as const },
      { key: 'phone', value: '+49123456', encrypted: false, type: 'text' as const },
      { key: 'street', value: 'Hauptstr.', encrypted: false, type: 'text' as const },
      { key: 'street_number', value: '42', encrypted: false, type: 'text' as const },
      { key: 'postal_code', value: '10115', encrypted: false, type: 'text' as const },
      { key: 'city', value: 'Berlin', encrypted: false, type: 'text' as const },
      { key: 'country', value: 'Germany', encrypted: false, type: 'text' as const },
    ]

    const map = buildFieldMap(fields, 'identity')

    expect(map.get('identity.first_name')).toBe('Oscar')
    expect(map.get('identity.last_name')).toBe('Schreyer')
    expect(map.get('identity.email')).toBe('oscar@example.com')
    expect(map.get('identity.phone')).toBe('+49123456')
    expect(map.get('identity.street')).toBe('Hauptstr.')
    expect(map.get('identity.street_number')).toBe('42')
    expect(map.get('identity.postal_code')).toBe('10115')
    expect(map.get('identity.city')).toBe('Berlin')
    expect(map.get('identity.country')).toBe('Germany')
  })

  it('composes full_name from first + last', () => {
    const fields = [
      { key: 'first_name', value: 'Oscar', encrypted: false, type: 'text' as const },
      { key: 'surname', value: 'Schreyer', encrypted: false, type: 'text' as const },
    ]

    const map = buildFieldMap(fields, 'identity')
    expect(map.get('identity.full_name')).toBe('Oscar Schreyer')
  })

  it('maps company fields correctly', () => {
    const fields = [
      { key: 'email', value: 'info@acme.de', encrypted: false, type: 'email' as const },
      { key: 'vat_number', value: 'DE123456789', encrypted: false, type: 'text' as const },
      { key: 'street', value: 'Friedrichstr.', encrypted: false, type: 'text' as const },
      { key: 'city', value: 'Berlin', encrypted: false, type: 'text' as const },
    ]

    const map = buildFieldMap(fields, 'company')

    expect(map.get('company.email')).toBe('info@acme.de')
    expect(map.get('company.vat_number')).toBe('DE123456789')
    expect(map.get('company.street')).toBe('Friedrichstr.')
    expect(map.get('company.city')).toBe('Berlin')
  })

  it('skips empty values', () => {
    const fields = [
      { key: 'first_name', value: '', encrypted: false, type: 'text' as const },
      { key: 'surname', value: 'Schreyer', encrypted: false, type: 'text' as const },
    ]

    const map = buildFieldMap(fields, 'identity')
    expect(map.has('identity.first_name')).toBe(false)
    expect(map.get('identity.last_name')).toBe('Schreyer')
  })

  it('maps date_of_birth to identity.birthday', () => {
    const fields = [
      { key: 'date_of_birth', value: '1990-01-15', encrypted: false, type: 'text' as const },
    ]

    const map = buildFieldMap(fields, 'identity')
    expect(map.get('identity.birthday')).toBe('1990-01-15')
  })
})

// ============================================================================
// §7  Fill Engine — Single Field
// ============================================================================

describe('DataVault fill engine — single field', () => {
  it('fills a text input successfully', () => {
    const input = createInput({ type: 'text', name: 'first_name' })
    const result = fillSingleField(input, 'Oscar')
    expect(result.success).toBe(true)
    expect(input.value).toBe('Oscar')
  })

  it('skips readonly fields', () => {
    const input = createInput({ type: 'text', name: 'first_name', readonly: '' })
    const result = fillSingleField(input, 'Oscar')
    expect(result.success).toBe(false)
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('readonly_or_disabled')
  })

  it('skips disabled fields', () => {
    const input = createInput({ type: 'text', name: 'first_name', disabled: '' })
    const result = fillSingleField(input, 'Oscar')
    expect(result.success).toBe(false)
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('readonly_or_disabled')
  })

  it('does not overwrite non-empty fields by default', () => {
    const input = createInput({ type: 'text', name: 'first_name' })
    input.value = 'ExistingValue'
    const result = fillSingleField(input, 'Oscar')
    expect(result.success).toBe(false)
    expect(result.skipped).toBe(true)
    expect(result.reason).toBe('has_existing_value')
    expect(input.value).toBe('ExistingValue')
  })

  it('overwrites non-empty fields when overwriteExisting=true', () => {
    const input = createInput({ type: 'text', name: 'first_name' })
    input.value = 'ExistingValue'
    const result = fillSingleField(input, 'Oscar', true)
    expect(result.success).toBe(true)
    expect(input.value).toBe('Oscar')
  })

  it('returns error for detached elements', () => {
    const input = document.createElement('input')
    // Not appended to document — detached
    const result = fillSingleField(input, 'Oscar')
    expect(result.success).toBe(false)
    expect(result.reason).toBe('element_detached')
  })
})

// ============================================================================
// §8  Fill Engine — Select Element
// ============================================================================

describe('DataVault fill engine — select elements', () => {
  it('fills a select by matching option value', () => {
    const select = createSelect([
      { value: 'de', text: 'Germany' },
      { value: 'at', text: 'Austria' },
      { value: 'ch', text: 'Switzerland' },
    ], { name: 'country' })

    const result = fillSingleField(select, 'de')
    expect(result.success).toBe(true)
    expect(select.value).toBe('de')
  })

  it('fills a select by matching visible text', () => {
    const select = createSelect([
      { value: 'de', text: 'Germany' },
      { value: 'at', text: 'Austria' },
    ], { name: 'country' })

    const result = fillSingleField(select, 'Germany')
    expect(result.success).toBe(true)
    expect(select.value).toBe('de')
  })

  it('fills a select with partial text match', () => {
    const select = createSelect([
      { value: 'de', text: 'Germany (DE)' },
      { value: 'at', text: 'Austria (AT)' },
    ], { name: 'country' })

    const result = fillSingleField(select, 'Germany')
    expect(result.success).toBe(true)
    expect(select.value).toBe('de')
  })

  it('returns error when no option matches', () => {
    const select = createSelect([
      { value: 'de', text: 'Germany' },
      { value: 'at', text: 'Austria' },
    ], { name: 'country' })

    const result = fillSingleField(select, 'France')
    expect(result.success).toBe(false)
    expect(result.reason).toBe('no_matching_option')
  })
})

// ============================================================================
// §9  Fill Engine — Multi-Field (Auto Mode)
// ============================================================================

describe('DataVault fill engine — multi-field fill', () => {
  it('fills multiple matched fields from a field map', () => {
    const form = document.createElement('form')
    document.body.appendChild(form)

    const firstName = createInput({ name: 'first_name', type: 'text' })
    const lastName = createInput({ name: 'last_name', type: 'text' })
    const email = createInput({ name: 'email', type: 'email' })
    form.append(firstName, lastName, email)

    const fieldMap = new Map<FieldKind, string>([
      ['identity.first_name', 'Oscar'],
      ['identity.last_name', 'Schreyer'],
      ['identity.email', 'oscar@example.com'],
    ])

    const candidates: FieldCandidate[] = [
      {
        element: firstName,
        matchedKind: 'identity.first_name',
        match: { confidence: 95, accepted: true, bestKind: 'identity.first_name', runnerUp: null, runnerUpConfidence: 0, signals: [], antiSignals: [], contextBoost: 0 },
        fingerprint: null as any,
        crossOrigin: false,
        formIndex: 0,
        formContext: 'contact',
      },
      {
        element: lastName,
        matchedKind: 'identity.last_name',
        match: { confidence: 95, accepted: true, bestKind: 'identity.last_name', runnerUp: null, runnerUpConfidence: 0, signals: [], antiSignals: [], contextBoost: 0 },
        fingerprint: null as any,
        crossOrigin: false,
        formIndex: 1,
        formContext: 'contact',
      },
      {
        element: email,
        matchedKind: 'identity.email',
        match: { confidence: 95, accepted: true, bestKind: 'identity.email', runnerUp: null, runnerUpConfidence: 0, signals: [], antiSignals: [], contextBoost: 0 },
        fingerprint: null as any,
        crossOrigin: false,
        formIndex: 2,
        formContext: 'contact',
      },
    ]

    const result = fillAllMatchedFields(candidates, fieldMap)
    expect(result.filled).toBe(3)
    expect(result.skipped).toBe(0)
    expect(result.failed).toBe(0)
    expect(firstName.value).toBe('Oscar')
    expect(lastName.value).toBe('Schreyer')
    expect(email.value).toBe('oscar@example.com')
  })

  it('skips fields without a value in the profile', () => {
    const input = createInput({ name: 'tax_id', type: 'text' })

    const fieldMap = new Map<FieldKind, string>([
      ['identity.first_name', 'Oscar'],
    ])

    const candidates: FieldCandidate[] = [
      {
        element: input,
        matchedKind: 'identity.tax_id',
        match: { confidence: 70, accepted: true, bestKind: 'identity.tax_id', runnerUp: null, runnerUpConfidence: 0, signals: [], antiSignals: [], contextBoost: 0 },
        fingerprint: null as any,
        crossOrigin: false,
        formIndex: 0,
        formContext: 'contact',
      },
    ]

    const result = fillAllMatchedFields(candidates, fieldMap)
    expect(result.skipped).toBe(1)
    expect(result.filled).toBe(0)
  })

  it('skips fields below confidence threshold', () => {
    const input = createInput({ name: 'maybe_name', type: 'text' })

    const fieldMap = new Map<FieldKind, string>([
      ['identity.first_name', 'Oscar'],
    ])

    const candidates: FieldCandidate[] = [
      {
        element: input,
        matchedKind: 'identity.first_name',
        match: { confidence: 30, accepted: false, bestKind: 'identity.first_name', runnerUp: null, runnerUpConfidence: 0, signals: [], antiSignals: [], contextBoost: 0 },
        fingerprint: null as any,
        crossOrigin: false,
        formIndex: 0,
        formContext: 'unknown',
      },
    ]

    const result = fillAllMatchedFields(candidates, fieldMap)
    expect(result.filled).toBe(0)
  })

  it('skips cross-origin candidates', () => {
    const input = createInput({ name: 'first_name', type: 'text' })

    const fieldMap = new Map<FieldKind, string>([
      ['identity.first_name', 'Oscar'],
    ])

    const candidates: FieldCandidate[] = [
      {
        element: input,
        matchedKind: 'identity.first_name',
        match: { confidence: 95, accepted: true, bestKind: 'identity.first_name', runnerUp: null, runnerUpConfidence: 0, signals: [], antiSignals: [], contextBoost: 0 },
        fingerprint: null as any,
        crossOrigin: true,
        formIndex: 0,
        formContext: 'contact',
      },
    ]

    const result = fillAllMatchedFields(candidates, fieldMap)
    expect(result.filled).toBe(0)
  })
})

// ============================================================================
// §10  Address Composition
// ============================================================================

describe('DataVault fill engine — address composition', () => {
  it('composes street + house_number when page has only one address field', () => {
    const streetInput = createInput({ name: 'address', type: 'text', autocomplete: 'street-address' })

    const fieldMap = new Map<FieldKind, string>([
      ['identity.street', 'Hauptstraße'],
      ['identity.street_number', '42'],
    ])

    // Only one address field — no separate street_number field
    const candidates: FieldCandidate[] = [
      {
        element: streetInput,
        matchedKind: 'identity.street',
        match: { confidence: 95, accepted: true, bestKind: 'identity.street', runnerUp: null, runnerUpConfidence: 0, signals: [], antiSignals: [], contextBoost: 0 },
        fingerprint: null as any,
        crossOrigin: false,
        formIndex: 0,
        formContext: 'address',
      },
    ]

    const result = fillAllMatchedFields(candidates, fieldMap)
    expect(result.filled).toBe(1)
    expect(streetInput.value).toBe('Hauptstraße 42')
  })
})
