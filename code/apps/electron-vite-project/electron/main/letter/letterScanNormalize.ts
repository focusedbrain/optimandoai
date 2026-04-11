/**
 * Layer 2 — AI normalization of deterministic letter scan hints (Ollama).
 */

import type { ChatMessage } from '../llm/types'
import type { LetterScanRawExtraction } from './letterScanExtract'

export const LETTER_EXTRACT_OUTPUT_KEYS = [
  'sender_name',
  'sender_address',
  'recipient_name',
  'recipient_address',
  'date',
  'subject',
  'reference_number',
  'salutation',
  'body_summary',
  'sender_phone',
  'sender_fax',
  'sender_email',
  'sender_website',
  'sender_iban',
  'sender_bic',
  'sender_bank',
  'sender_tax_id',
  'sender_registration',
] as const

export type NormalizedLetterFields = Record<(typeof LETTER_EXTRACT_OUTPUT_KEYS)[number], string>

/** Regex hints before the AI call — keeps IBAN/phone out of address fields. */
export function preFilterFields(rawText: string): {
  ibanMatches: string[]
  bicMatches: string[]
  phoneMatches: string[]
  emailMatches: string[]
  dateMatches: string[]
  taxIdMatches: string[]
} {
  const t = rawText || ''
  return {
    ibanMatches: (t.match(/[A-Z]{2}\d{2}[\s]?(?:\d{4}[\s]?){2,7}\d{1,4}/gi) || []).map((m) =>
      m.replace(/\s/g, ''),
    ),
    bicMatches: (t.match(/\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g) || []).filter(
      (x) => x.length >= 8 && x.length <= 11,
    ),
    phoneMatches:
      t.match(/(?:Tel(?:efon)?|Fon|Phone|Mobil|Mobile)[\s.:]*[\d+][\d\s\-/().]{5,30}/gi) || [],
    emailMatches: t.match(/[\w.+-]+@[\w.-]+\.\w{2,}/g) || [],
    dateMatches:
      t.match(/\d{1,2}\.\s?(?:Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s?\d{4}/gi) ||
      [],
    taxIdMatches:
      t.match(/(?:USt-?Id(?:Nr)?\.?|Steuernummer|St\.?\s*-?\s*Nr\.?)[\s.:]*[\w\d/\-]{5,25}/gi) || [],
  }
}

/** Remove bank/contact/legal lines from postal address blobs (Layer 1 safety net). */
export function sanitizePostalAddressField(text: string): string {
  if (!text || typeof text !== 'string') return ''
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean)
  const kept: string[] = []
  for (const line of lines) {
    const compact = line.replace(/\s/g, '')
    if (/^[A-Z]{2}\d{2}\d{10,30}$/i.test(compact)) continue
    if (/@/.test(line)) continue
    if (/^(https?:\/\/|www\.)/i.test(line)) continue
    if (/^(tel|fax|fon|telefon|phone|e-?mail|mobil)\b/i.test(line)) continue
    if (/\b(BIC|IBAN|SWIFT)\b/i.test(line)) continue
    if (/\b(USt-?Id|Steuernummer|St\.?\s*-?\s*Nr|UID)\b/i.test(line)) continue
    if (/\b(HRB|HRA|Amtsgericht|Handelsregister|Geschäftszeichen)\b/i.test(line)) continue
    if (/^[+(\d][\d\s()./+-]{6,}$/.test(line) && /\d{5,}/.test(compact)) continue
    kept.push(line)
    if (kept.length >= 4) break
  }
  return kept.join('\n')
}

const NORMALIZE_SYSTEM = `You are extracting structured data from a German/European business letter. Follow these rules STRICTLY:

FIELD DEFINITIONS — only extract what matches each definition:

- sender_name: The company name or person name of the letter's author. Usually at the top of the letter or in the letterhead. ONE line only.

- sender_address: The POSTAL address of the sender. Contains ONLY: street name + number, postal code + city, optionally country. Does NOT contain: phone numbers, fax numbers, email addresses, websites, IBAN, BIC, bank names, tax IDs, registration numbers, or any other identifiers. Maximum 3-4 lines.

- recipient_name: The name of the person or company the letter is addressed to. Usually in the address window area (left side, below the sender line).

- recipient_address: The POSTAL address of the recipient. Same rules as sender_address — street, postal code, city only.

- date: The letter date. Format as YYYY-MM-DD. Look for patterns like "11. April 2026" or "11.04.2026".

- subject: The subject line of the letter. Usually bold or preceded by "Betreff:" or "Betrifft:". ONE line.

- reference_number: Any reference, file number, or "Aktenzeichen". Look for patterns like "Unser Zeichen:", "Ihr Zeichen:", "Ref:", "Az:". If none found, return empty string.

- salutation: The greeting line. Usually "Sehr geehrte Damen und Herren," or "Sehr geehrter Herr [Name]," or similar.

- body_summary: A 2-3 sentence summary of what the letter is about. Do not quote the letter — summarize the main point and any action requested.

- sender_phone: Phone number of the sender. Look for "Tel:", "Telefon:", "Tel.:", "Fon:". If not found, return empty string.

- sender_fax: Fax number. Look for "Fax:". If not found, return empty string.

- sender_email: Email address of the sender. If not found, return empty string.

- sender_website: Website URL. If not found, return empty string.

- sender_iban: IBAN number. Format: DE followed by digits, often grouped. If not found, return empty string.

- sender_bic: BIC/SWIFT code. Usually near the IBAN. If not found, return empty string.

- sender_bank: Name of the bank. Usually near IBAN/BIC. If not found, return empty string.

- sender_tax_id: Tax ID ("Steuernummer", "USt-IdNr.", "UID"). If not found, return empty string.

- sender_registration: Commercial register entry ("HRB", "Amtsgericht", "Handelsregister"). If not found, return empty string.

RULES:
1. NEVER mix bank details (IBAN, BIC, bank name) into address fields.
2. NEVER include phone/fax/email/website in address fields.
3. NEVER include tax IDs or registration numbers in address fields.
4. Address fields contain ONLY: street, postal code, city, optionally country.
5. If you are unsure about a field, return empty string — do NOT guess.
6. Return ONLY valid JSON. No markdown, no explanation, no backticks.

Return format (exactly this shape):
{
  "fields": {
    "sender_name": "",
    "sender_address": "",
    "recipient_name": "",
    "recipient_address": "",
    "date": "",
    "subject": "",
    "reference_number": "",
    "salutation": "",
    "body_summary": "",
    "sender_phone": "",
    "sender_fax": "",
    "sender_email": "",
    "sender_website": "",
    "sender_iban": "",
    "sender_bic": "",
    "sender_bank": "",
    "sender_tax_id": "",
    "sender_registration": ""
  },
  "confidence": {
    "sender_name": 0.0,
    "sender_address": 0.0,
    "recipient_name": 0.0,
    "recipient_address": 0.0,
    "date": 0.0,
    "subject": 0.0,
    "reference_number": 0.0,
    "salutation": 0.0,
    "body_summary": 0.0,
    "sender_phone": 0.0,
    "sender_fax": 0.0,
    "sender_email": 0.0,
    "sender_website": 0.0,
    "sender_iban": 0.0,
    "sender_bic": 0.0,
    "sender_bank": 0.0,
    "sender_tax_id": 0.0,
    "sender_registration": 0.0
  }
}`

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

function coerceRaw(input: unknown): LetterScanRawExtraction {
  if (!isRecord(input)) {
    return {
      date: null,
      sender_lines: [],
      recipient_lines: [],
      subject_line: null,
      reference: null,
      salutation_line: null,
    }
  }
  const lines = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  const dateVal = input['date']
  const subjVal = input['subject_line']
  const refVal = input['reference']
  const salVal = input['salutation_line']
  return {
    date: typeof dateVal === 'string' ? dateVal : null,
    sender_lines: lines(input['sender_lines']),
    recipient_lines: lines(input['recipient_lines']),
    subject_line: typeof subjVal === 'string' ? subjVal : null,
    reference: typeof refVal === 'string' ? refVal : null,
    salutation_line: typeof salVal === 'string' ? salVal : null,
  }
}

/** Parse DD.MM.YYYY or D.M.YYYY to ISO; return null if not matched. */
function tryGermanShortDateToIso(s: string): string | null {
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (!m) return null
  const d = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  const y = parseInt(m[3], 10)
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${y.toString().padStart(4, '0')}-${mo.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`
}

function emptyFields(): NormalizedLetterFields {
  const o = {} as NormalizedLetterFields
  for (const k of LETTER_EXTRACT_OUTPUT_KEYS) {
    o[k] = ''
  }
  return o
}

export function fallbackNormalizedFromRaw(
  raw: LetterScanRawExtraction,
  fullText: string,
): { fields: NormalizedLetterFields; confidence: Record<string, number> } {
  const senderLines = raw.sender_lines
  const recipientLines = raw.recipient_lines
  const sender_name = senderLines[0] ?? ''
  let sender_address = senderLines.slice(1).join('\n')
  const recipient_name = recipientLines[0] ?? ''
  let recipient_address = recipientLines.slice(1).join('\n')

  sender_address = sanitizePostalAddressField(sender_address)
  recipient_address = sanitizePostalAddressField(recipient_address)

  let dateIso = ''
  if (raw.date) {
    dateIso = tryGermanShortDateToIso(raw.date.trim()) ?? ''
    if (!dateIso && /^\d{4}-\d{2}-\d{2}$/.test(raw.date.trim())) {
      dateIso = raw.date.trim()
    }
  }

  const firstPage = fullText.split(/\n--- Page Break ---\n/i)[0] ?? fullText
  const afterSal =
    raw.salutation_line && firstPage.includes(raw.salutation_line)
      ? firstPage.split(raw.salutation_line).slice(1).join(raw.salutation_line)
      : firstPage
  const bodyStub = afterSalutationTrim(afterSal)

  const fields = emptyFields()
  fields.sender_name = sender_name
  fields.sender_address = sender_address
  fields.recipient_name = recipient_name
  fields.recipient_address = recipient_address
  fields.date = dateIso
  fields.subject = raw.subject_line ?? ''
  fields.reference_number = raw.reference ?? ''
  fields.salutation = raw.salutation_line ?? ''
  fields.body_summary = bodyStub.slice(0, 500).replace(/\s+/g, ' ').trim()

  const baseConf = 0.45
  const confidence: Record<string, number> = {}
  for (const k of LETTER_EXTRACT_OUTPUT_KEYS) {
    confidence[k] = fields[k] ? baseConf : 0
  }
  if (fields.body_summary) confidence.body_summary = 0.35

  return { fields, confidence }
}

function afterSalutationTrim(s: string): string {
  return s.replace(/^[\s\n:]+/, '').trim()
}

function parseModelJson(text: string): unknown {
  const cleaned = text
    .replace(/```json?\s*/gi, '')
    .replace(/```/g, '')
    .trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  const slice = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned
  return JSON.parse(slice)
}

export async function normalizeLetterScanExtraction(
  rawFields: unknown,
  fullText: string,
): Promise<{
  ok: boolean
  fields: NormalizedLetterFields
  confidence: Record<string, number>
  error?: string
}> {
  const raw = coerceRaw(rawFields)
  const fallback = fallbackNormalizedFromRaw(raw, fullText)
  const textSlice = fullText.slice(0, 6000)
  const preFiltered = preFilterFields(fullText.slice(0, 500_000))

  const { ollamaManager } = await import('../llm/ollama-manager')
  const modelId = await ollamaManager.getEffectiveChatModelName()
  if (!modelId) {
    return {
      ok: false,
      fields: fallback.fields,
      confidence: fallback.confidence,
      error: 'No Ollama model configured. Showing rule-based extraction only.',
    }
  }

  const userMessage = `Extract fields from this business letter.

Pre-extracted hints (use these to separate data correctly — do NOT put these values inside sender_address or recipient_address):
- Detected IBAN(s): ${preFiltered.ibanMatches.join(', ') || 'none'}
- Detected BIC(s): ${preFiltered.bicMatches.join(', ') || 'none'}
- Detected phone(s): ${preFiltered.phoneMatches.join(' | ') || 'none'}
- Detected email(s): ${preFiltered.emailMatches.join(', ') || 'none'}
- Detected tax ID line(s): ${preFiltered.taxIdMatches.join(' | ') || 'none'}
- Detected date phrase(s): ${preFiltered.dateMatches.join(', ') || 'none'}

Rules-based paragraph hints (weak guidance only):
${JSON.stringify(raw, null, 2)}

IMPORTANT: Put IBAN, BIC, bank, phone, fax, email, website, tax ID, and registration ONLY in their dedicated fields. Postal address fields must contain only street, postal code, city, and optional country.

Full letter text:
${textSlice}`

  const messages: ChatMessage[] = [
    { role: 'system', content: NORMALIZE_SYSTEM },
    { role: 'user', content: userMessage },
  ]

  let content = ''
  try {
    const response = await ollamaManager.chat(modelId, messages)
    content = response?.content?.trim() ?? ''
  } catch (e) {
    return {
      ok: false,
      fields: fallback.fields,
      confidence: fallback.confidence,
      error: e instanceof Error ? e.message : 'Ollama request failed',
    }
  }

  let parsed: unknown
  try {
    parsed = parseModelJson(content)
  } catch {
    return {
      ok: false,
      fields: fallback.fields,
      confidence: fallback.confidence,
      error: 'Could not parse model output as JSON.',
    }
  }

  if (!isRecord(parsed)) {
    return {
      ok: false,
      fields: fallback.fields,
      confidence: fallback.confidence,
      error: 'Model returned non-object JSON.',
    }
  }

  const dataObj: Record<string, unknown> = isRecord(parsed.fields) ? parsed.fields : parsed
  const confRaw: Record<string, unknown> = isRecord(parsed.confidence) ? parsed.confidence : {}

  const fields: NormalizedLetterFields = { ...fallback.fields }
  const confidence: Record<string, number> = { ...fallback.confidence }

  for (const k of LETTER_EXTRACT_OUTPUT_KEYS) {
    const v = dataObj[k]
    if (typeof v === 'string') {
      fields[k] = v.trim()
    }
    const c = confRaw[k]
    if (typeof c === 'number') {
      confidence[k] = clamp01(c)
    } else if (typeof fields[k] === 'string' && fields[k].length > 0) {
      confidence[k] = Math.max(confidence[k] ?? 0, 0.72)
    }
  }

  fields.sender_address = sanitizePostalAddressField(fields.sender_address)
  fields.recipient_address = sanitizePostalAddressField(fields.recipient_address)

  for (const k of LETTER_EXTRACT_OUTPUT_KEYS) {
    if (!(k in confidence)) {
      confidence[k] = fields[k] ? 0.65 : 0
    } else {
      confidence[k] = clamp01(confidence[k]!)
    }
  }

  return { ok: true, fields, confidence }
}
