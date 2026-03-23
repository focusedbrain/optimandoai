/**
 * HS Context Field Validation
 *
 * Strict validation for profile fields when provided.
 * All fields are optional; if a value is entered, it must pass validation.
 * Used by the HS Context authoring UI before save.
 */

import { validateHsContextLink } from './linkValidation'

// ── URL validation (reuse existing safe link validation) ──
export function validateUrl(input: string | null | undefined): { ok: true; value: string } | { ok: false; error: string } {
  const result = validateHsContextLink(input)
  if (result.ok) return { ok: true, value: result.url }
  return { ok: false, error: result.reason }
}

// ── Email validation (RFC 5322 simplified) ──
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

export function validateEmail(input: string | null | undefined): { ok: true; value: string } | { ok: false; error: string } {
  if (input == null || typeof input !== 'string') return { ok: false, error: 'Email is required' }
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Email cannot be empty' }
  if (trimmed.length > 254) return { ok: false, error: 'Email too long' }
  if (!EMAIL_RE.test(trimmed)) return { ok: false, error: 'Invalid email format' }
  return { ok: true, value: trimmed }
}

// ── Phone validation (conservative: digits, spaces, +, -, (, ), .) ──
const PHONE_RE = /^[\d\s+\-().]{7,40}$/

export function validatePhone(input: string | null | undefined): { ok: true; value: string } | { ok: false; error: string } {
  if (input == null || typeof input !== 'string') return { ok: false, error: 'Phone is required' }
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Phone cannot be empty' }
  const digitsOnly = trimmed.replace(/\D/g, '')
  if (digitsOnly.length < 7) return { ok: false, error: 'Phone must have at least 7 digits' }
  if (!PHONE_RE.test(trimmed)) return { ok: false, error: 'Phone contains invalid characters' }
  return { ok: true, value: trimmed }
}

// ── Identifier validation (VAT, registration, etc.) ──
const IDENTIFIER_RE = /^[A-Za-z0-9\s\-_.]{1,80}$/

export function validateIdentifier(input: string | null | undefined): { ok: true; value: string } | { ok: false; error: string } {
  if (input == null || typeof input !== 'string') return { ok: false, error: 'Value is required' }
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, error: 'Value cannot be empty' }
  if (trimmed.length > 80) return { ok: false, error: 'Value too long' }
  if (!IDENTIFIER_RE.test(trimmed)) return { ok: false, error: 'Contains invalid characters (use letters, numbers, spaces, hyphens)' }
  return { ok: true, value: trimmed }
}

// ── Plain text (description/summary) — no markup, max length ──
const MAX_DESCRIPTION_LENGTH = 4000

export function validatePlainText(input: string | null | undefined, maxLen = MAX_DESCRIPTION_LENGTH): { ok: true; value: string } | { ok: false; error: string } {
  if (input == null || typeof input !== 'string') return { ok: false, error: 'Value is required' }
  const trimmed = input.trim()
  if (trimmed.length > maxLen) return { ok: false, error: `Maximum ${String(maxLen)} characters` }
  // Reject obvious HTML/markup
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return { ok: false, error: 'HTML or markup is not allowed' }
  return { ok: true, value: trimmed }
}

// ── Opening hours entry ──
export function validateOpeningHoursEntry(entry: { days?: string; from?: string; to?: string }): { ok: true; value: { days: string; from: string; to: string } } | { ok: false; error: string } {
  const days = (entry.days ?? '').trim()
  const from = (entry.from ?? '').trim()
  const to = (entry.to ?? '').trim()
  if (!days && !from && !to) return { ok: false, error: 'At least one of days, from, or to is required' }
  if (days.length > 60) return { ok: false, error: 'Days label too long' }
  if (from.length > 20) return { ok: false, error: 'From time too long' }
  if (to.length > 20) return { ok: false, error: 'To time too long' }
  return { ok: true, value: { days, from, to } }
}

// ── Document label (user-defined title) ──
const MAX_LABEL_LENGTH = 200

export function validateDocumentLabel(input: string | null | undefined): { ok: true; value: string } | { ok: false; error: string } {
  if (input == null || typeof input !== 'string') return { ok: true, value: '' } // Optional
  const trimmed = input.trim()
  if (trimmed.length > MAX_LABEL_LENGTH) return { ok: false, error: `Label must be ${MAX_LABEL_LENGTH} characters or less` }
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return { ok: false, error: 'HTML is not allowed' }
  return { ok: true, value: trimmed }
}

// ── Document type (aligns with UI: manual, contract, certificate, pricelist, custom) ──
const DOCUMENT_TYPE_MAX_LENGTH = 60
const ALLOWED_DOCUMENT_TYPES = new Set(['manual', 'contract', 'certificate', 'pricelist', 'custom'])

export function validateDocumentType(input: string | null | undefined): { ok: true; value: string } | { ok: false; error: string } {
  if (input == null || typeof input !== 'string') return { ok: true, value: '' } // Optional
  const trimmed = input.trim()
  if (!trimmed) return { ok: true, value: '' }
  if (trimmed.length > DOCUMENT_TYPE_MAX_LENGTH) return { ok: false, error: `Document type must be ${DOCUMENT_TYPE_MAX_LENGTH} characters or less` }
  if (/<[a-z][\s\S]*>/i.test(trimmed)) return { ok: false, error: 'HTML is not allowed' }
  const lower = trimmed.toLowerCase()
  if (!ALLOWED_DOCUMENT_TYPES.has(lower)) {
    return { ok: false, error: `Document type must be one of: ${[...ALLOWED_DOCUMENT_TYPES].join(', ')}` }
  }
  return { ok: true, value: lower }
}
