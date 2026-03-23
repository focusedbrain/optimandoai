/**
 * HS Context Normalization
 *
 * Single source-of-truth for converting all context inputs into normalized
 * plain text before embedding into a handshake capsule.
 *
 * Rules (non-negotiable):
 *  - No PDF binaries, no PDF URLs, no minified JSON.
 *  - Section headings: PROFILE: <name>, subheadings without markup.
 *  - Field format: Label: Value
 *  - Multi-line values indented 2 spaces.
 *  - Paragraphs and line breaks preserved.
 *  - Ad-hoc JSON: rendered as Key: Value lines (nested indented, arrays repeated).
 *  - If JSON parse fails: treat as plain text.
 */

// ── Types ──

/** Payment method types — matches Company Data form (vault-ui-typescript.ts). */
export type PaymentMethodType = 'bank_account' | 'credit_card' | 'paypal'

export interface PaymentMethodBankAccount {
  type: 'bank_account'
  iban?: string
  bic?: string
  bank_name?: string
  account_holder?: string
}

export interface PaymentMethodCreditCard {
  type: 'credit_card'
  cc_number?: string
  cc_holder?: string
  cc_expiry?: string
  cc_cvv?: string
}

export interface PaymentMethodPayPal {
  type: 'paypal'
  paypal_email?: string
}

export type PaymentMethod = PaymentMethodBankAccount | PaymentMethodCreditCard | PaymentMethodPayPal

export interface ProfileFields {
  // Business Identity
  legalCompanyName?: string
  tradeName?: string
  /** Legacy single-line address. Kept for backward compat. Composed from structured fields on save. */
  address?: string
  /** Structured address (Company Data alignment) */
  street?: string
  streetNumber?: string
  postalCode?: string
  city?: string
  state?: string
  country?: string
  website?: string
  // Links / Online Presence (normalized field names for authoring + display)
  linkedin?: string
  twitter?: string
  facebook?: string
  instagram?: string
  youtube?: string
  officialLink?: string
  supportUrl?: string
  // General contact (when no contact persons)
  generalPhone?: string
  generalEmail?: string
  supportEmail?: string
  // Tax & Identifiers
  vatNumber?: string
  companyRegistrationNumber?: string
  supplierNumber?: string
  customerNumber?: string
  // Contacts
  contacts?: ContactEntry[]
  // Opening Hours
  openingHours?: OpeningHoursEntry[]
  timezone?: string
  holidayNotes?: string
  // Billing
  billingEmail?: string
  paymentTerms?: string
  /** Legacy single-line bank details. Kept for backward compat. Composed from paymentMethods on save. */
  bankDetails?: string
  /** Payment methods — same structure as Company Data (repeatable Bank Account, Credit Card, PayPal). */
  paymentMethods?: PaymentMethod[]
  // Logistics / Operations
  receivingHours?: string
  deliveryInstructions?: string
  supportHours?: string
  escalationContact?: string
}

export interface ContactEntry {
  name?: string
  role?: string
  email?: string
  phone?: string
  notes?: string
}

export interface OpeningHoursEntry {
  days: string
  from: string
  to: string
}

export interface CustomField {
  label: string
  value: string
}

export interface HsContextProfile {
  id: string
  name: string
  description?: string
  scope: 'non_confidential' | 'confidential'
  fields: ProfileFields
  custom_fields: CustomField[]
}

export interface ProfileDocumentSummary {
  id?: string
  filename: string
  /** User-defined label/title (optional). Falls back to filename when empty. */
  label?: string | null
  /** Optional document type: manual, contract, custom, etc. */
  document_type?: string | null
  extraction_status: 'pending' | 'success' | 'failed'
  extracted_text?: string | null
  error_message?: string | null
  /** Structured error code — used by the UI to pick the right failure card.
   *  e.g. 'NO_TEXT_EXTRACTED' → BYOK Vision card
   *       'PASSWORD_PROTECTED' → password message
   *       'EXTRACTION_TIMEOUT' → timeout message
   */
  error_code?: string | null
  sensitive?: boolean
}

// ── Internal helpers ──

function trimLines(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}


function renderJsonValue(value: unknown, depth = 0): string {
  const pad = '  '.repeat(depth)
  if (value === null || value === undefined) return `${pad}(empty)`
  if (typeof value === 'string') return `${pad}${value}`
  if (typeof value === 'number' || typeof value === 'boolean') return `${pad}${String(value)}`
  if (Array.isArray(value)) {
    return value.map((item) => renderJsonValue(item, depth)).join('\n')
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    return Object.entries(obj)
      .map(([k, v]) => {
        const label = `${pad}${k}`
        if (v !== null && typeof v === 'object') {
          return `${label}:\n${renderJsonValue(v, depth + 1)}`
        }
        return `${label}: ${renderJsonValue(v, 0)}`
      })
      .join('\n')
  }
  return `${pad}${String(value)}`
}

// ── Ad-hoc context normalization ──

/**
 * Normalize ad-hoc context input (plain text or JSON string) to plain text.
 * JSON is rendered as Key: Value lines. Invalid JSON is treated as plain text.
 */
export function normalizeAdHocContext(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''

  // Try JSON parse
  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed === 'object' && parsed !== null) {
      return trimLines(renderJsonValue(parsed))
    }
    // Scalar JSON value — just stringify
    return trimLines(String(parsed))
  } catch {
    // Not JSON — treat as plain text
    return trimLines(trimmed)
  }
}

// ── Profile field rendering ──

function renderContacts(contacts: ContactEntry[]): string {
  if (!contacts.length) return ''
  const lines = contacts.map((c) => {
    const parts = [c.name, c.role, c.email, c.phone].filter(Boolean)
    let line = parts.join(' — ')
    if (c.notes) line += `\n  ${c.notes}`
    return line
  })
  return lines.join('\n')
}

function renderOpeningHours(hours: OpeningHoursEntry[]): string {
  return hours.map((h) => `${h.days}: ${h.from}–${h.to}`).join('\n')
}

/**
 * Render a single HS Context Profile to plain text.
 */
export function normalizeProfileToText(
  profile: HsContextProfile,
  documents: ProfileDocumentSummary[] = [],
): string {
  const lines: string[] = []

  lines.push(`PROFILE: ${profile.name}`)
  lines.push(`Scope: ${profile.scope === 'confidential' ? 'Confidential' : 'Non-Confidential'}`)

  if (profile.description) {
    lines.push('')
    lines.push(profile.description)
  }

  const f = profile.fields

  // Business Identity — address: prefer structured if available, else legacy
  const hasStructuredAddress = !!(f.street || f.streetNumber || f.postalCode || f.city || f.state || f.country)
  let addressValue: string | undefined
  if (hasStructuredAddress) {
    const addrParts: string[] = []
    const line1 = [f.street, f.streetNumber].filter(Boolean).join(' ')
    if (line1) addrParts.push(line1)
    const line2 = [f.postalCode, f.city].filter(Boolean).join(' ')
    if (line2) addrParts.push(line2)
    const line3 = [f.state, f.country].filter(Boolean).join(', ')
    if (line3) addrParts.push(line3)
    addressValue = addrParts.join(', ')
  } else {
    addressValue = f.address
  }

  const bizFields: Array<[string, string | undefined]> = [
    ['Legal Company Name', f.legalCompanyName],
    ['Trade Name', f.tradeName],
    ['Address', addressValue?.trim() || undefined],
    ['Country', f.country],
  ]
  const bizLines = bizFields.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)
  if (bizLines.length) {
    lines.push('')
    lines.push('Business Identity')
    bizLines.forEach((l) => lines.push(`  ${l}`))
  }

  // Links / Online Presence (normalized field names)
  const linkFields: Array<[string, string | undefined]> = [
    ['Website', f.website],
    ['LinkedIn', f.linkedin],
    ['Twitter', f.twitter],
    ['Facebook', f.facebook],
    ['Instagram', f.instagram],
    ['YouTube', f.youtube],
    ['Official Link', f.officialLink],
    ['Support URL', f.supportUrl],
  ]
  const linkLines = linkFields.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)
  if (linkLines.length) {
    lines.push('')
    lines.push('Links & Online Presence')
    linkLines.forEach((l) => lines.push(`  ${l}`))
  }

  // Tax & Identifiers
  const taxFields: Array<[string, string | undefined]> = [
    ['VAT Number', f.vatNumber],
    ['Company Registration Number', f.companyRegistrationNumber],
    ['Supplier Number', f.supplierNumber],
    ['Customer Number', f.customerNumber],
  ]
  const taxLines = taxFields.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)
  if (taxLines.length) {
    lines.push('')
    lines.push('Tax & Identifiers')
    taxLines.forEach((l) => lines.push(`  ${l}`))
  }

  // Contacts (general + contact persons)
  const hasGeneralContact = f.generalPhone || f.generalEmail || f.supportEmail
  if (hasGeneralContact) {
    lines.push('')
    lines.push('General Contact')
    if (f.generalPhone) lines.push(`  Phone: ${f.generalPhone}`)
    if (f.generalEmail) lines.push(`  Email: ${f.generalEmail}`)
    if (f.supportEmail) lines.push(`  Support Email: ${f.supportEmail}`)
  }
  if (f.contacts && f.contacts.length > 0) {
    lines.push('')
    lines.push('Contact Persons')
    const rendered = renderContacts(f.contacts)
    rendered.split('\n').forEach((l) => lines.push(`  ${l}`))
  }

  // Opening Hours
  if (f.openingHours && f.openingHours.length > 0) {
    lines.push('')
    lines.push('Opening Hours')
    renderOpeningHours(f.openingHours).split('\n').forEach((l) => lines.push(`  ${l}`))
    if (f.timezone) lines.push(`  Timezone: ${f.timezone}`)
    if (f.holidayNotes) lines.push(`  Holiday Notes: ${f.holidayNotes}`)
  }

  // Billing — prefer paymentMethods if available (with credit card masking), else legacy bankDetails
  let bankDetailsValue: string | undefined
  if (f.paymentMethods && f.paymentMethods.length > 0) {
    const parts: string[] = []
    for (const m of f.paymentMethods) {
      if (m.type === 'bank_account') {
        const bankParts = [m.iban, m.bic, m.bank_name, m.account_holder].filter(Boolean)
        if (bankParts.length > 0) parts.push(`Bank: ${bankParts.join(' — ')}`)
      } else if (m.type === 'credit_card') {
        // SECURITY: Never include cc_cvv. Mask cc_number to last 4 digits only.
        const last4 = m.cc_number && m.cc_number.length >= 4 ? m.cc_number.slice(-4) : ''
        const cardParts = last4 ? [`••••${last4}`] : []
        if (m.cc_holder) cardParts.push(m.cc_holder)
        if (m.cc_expiry) cardParts.push(m.cc_expiry)
        if (cardParts.length > 0) parts.push(`Card: ${cardParts.join(' — ')}`)
      } else if (m.type === 'paypal' && m.paypal_email) {
        parts.push(`PayPal: ${m.paypal_email}`)
      }
    }
    bankDetailsValue = parts.length > 0 ? parts.join(' | ') : undefined
  } else {
    bankDetailsValue = f.bankDetails
  }

  const billingFields: Array<[string, string | undefined]> = [
    ['Billing Email', f.billingEmail],
    ['Payment Terms', f.paymentTerms],
    ['Payment Methods', bankDetailsValue?.trim() || undefined],
  ]
  const billingLines = billingFields.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)
  if (billingLines.length) {
    lines.push('')
    lines.push('Billing')
    billingLines.forEach((l) => lines.push(`  ${l}`))
  }

  // Logistics / Operations
  const logisticsFields: Array<[string, string | undefined]> = [
    ['Receiving Hours', f.receivingHours],
    ['Delivery Instructions', f.deliveryInstructions],
    ['Support Hours', f.supportHours],
    ['Escalation Contact', f.escalationContact],
  ]
  const logisticsLines = logisticsFields.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)
  if (logisticsLines.length) {
    lines.push('')
    lines.push('Logistics & Operations')
    logisticsLines.forEach((l) => lines.push(`  ${l}`))
  }

  // Custom Fields
  if (profile.custom_fields && profile.custom_fields.length > 0) {
    lines.push('')
    lines.push('Custom Fields')
    for (const cf of profile.custom_fields) {
      if (!cf.label) continue
      const valueLines = cf.value.split('\n')
      if (valueLines.length === 1) {
        lines.push(`  ${cf.label}: ${cf.value}`)
      } else {
        lines.push(`  ${cf.label}:`)
        valueLines.forEach((vl) => lines.push(`    ${vl}`))
      }
    }
  }

  // Documents
  if (documents.length > 0) {
    lines.push('')
    lines.push('--- Documents ---')
    for (const doc of documents) {
      if (doc.extraction_status === 'success' && doc.extracted_text) {
        lines.push('')
        const docLabel = doc.label?.trim() || doc.filename
        lines.push(`[Document: ${docLabel}${doc.document_type ? ` (${doc.document_type})` : ''}]`)
        lines.push(trimLines(doc.extracted_text))
      } else if (doc.extraction_status === 'pending') {
        lines.push(`[Document extraction pending: ${doc.filename}]`)
      } else if (doc.extraction_status === 'failed') {
        lines.push(`[Document extraction failed: ${doc.filename} — not included]`)
      }
    }
  }

  return trimLines(lines.join('\n'))
}

/**
 * Build a single normalized plain-text context block payload from multiple
 * profiles + optional ad-hoc context text.
 */
export function buildCombinedContextText(
  profiles: Array<{ profile: HsContextProfile; documents: ProfileDocumentSummary[] }>,
  adHocContext?: string,
): string {
  const parts: string[] = []

  for (const { profile, documents } of profiles) {
    const text = normalizeProfileToText(profile, documents)
    if (text) parts.push(text)
  }

  if (adHocContext?.trim()) {
    const normalized = normalizeAdHocContext(adHocContext)
    if (normalized) {
      if (parts.length > 0) {
        parts.push('--- Ad-hoc Context ---')
      }
      parts.push(normalized)
    }
  }

  return parts.join('\n\n')
}
