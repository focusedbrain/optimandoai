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
  'customer_number',
  'invoice_number',
  'contract_number',
  'order_number',
  'file_reference',
  'contact_person',
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
  'detected_language',
] as const

export type NormalizedLetterFields = Record<(typeof LETTER_EXTRACT_OUTPUT_KEYS)[number], string>

/** Regex hints before the AI call — keeps IBAN/phone out of address fields (international). */
export function preFilterFields(rawText: string): {
  ibanMatches: string[]
  bicMatches: string[]
  phoneMatches: string[]
  emailMatches: string[]
  dateMatches: string[]
  taxIdMatches: string[]
} {
  const t = rawText || ''
  const ibanMatches = (
    t.match(
      /[A-Z]{2}\d{2}[\s]?[\dA-Z]{4}[\s]?[\dA-Z]{4}[\s]?[\dA-Z]{4}[\s]?[\dA-Z]{0,4}[\s]?[\dA-Z]{0,4}[\s]?[\dA-Z]{0,4}/gi,
    ) || []
  ).map((m) => m.replace(/\s/g, '').toUpperCase())
  const bicRaw = t.match(/\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/gi) || []
  const bicMatches = bicRaw.map((x) => x.toUpperCase())
  const phoneMatches =
    t.match(
      /(?:Tel(?:efon|éphone|ephone)?|Phone|Fon|Ph|Tél)[\s.:]*[\+\d\s\-\/\(\)]{6,20}/gi,
    ) || []
  const emailMatches = t.match(/[\w.+-]+@[\w.-]+\.\w{2,}/g) || []
  const dateMatches = [
    ...(t.match(/\d{1,2}[\.\/\-]\d{1,2}[\.\/\-]\d{2,4}/g) || []),
    ...(t.match(/\d{4}-\d{2}-\d{2}/g) || []),
    ...(t.match(
      /\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember|janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+\d{4}/gi,
    ) || []),
  ]
  const taxIdMatches = [
    ...(t.match(/(?:USt-?Id(?:Nr)?|Steuernummer|St\.?-?Nr)[\s.:]*[\w\d\/\s]{5,20}/gi) || []),
    ...(t.match(/(?:VAT\s*(?:No|Number|Reg))[\s.:]*[\w\d\s]{5,20}/gi) || []),
    ...(t.match(/(?:TVA|N°\s*TVA)[\s.:]*[\w\d\s]{5,20}/gi) || []),
    ...(t.match(/(?:EIN|TIN|ABN|GST)[\s.:]*[\d\-\s]{5,20}/gi) || []),
  ]
  return { ibanMatches, bicMatches, phoneMatches, emailMatches, dateMatches, taxIdMatches }
}

/** Remove bank/contact/legal lines from postal address blobs (Layer 1 safety net). */
export function sanitizePostalAddressField(text: string): string {
  if (!text || typeof text !== 'string') return ''

  // Step 1: split long single lines at IBAN / BIC / common bank-name boundaries (OCR often glues blocks)
  let normalized = text
    .replace(
      /\s+([A-Z]{2}\d{2}(?:\s*\d{4}){2,7}(?:\s*[\dA-Z]{0,4}){0,3})/gi,
      '\n$1',
    )
    .replace(/\s+([A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\s/g, '\n$1\n')
    .replace(
      /\s+((?:Sparkasse|Postbank|Commerzbank|Deutsche Bank|Volksbank|Raiffeisen)[^\n]*)/gi,
      '\n$1',
    )

  const lines = normalized.split('\n').map((l) => l.trim()).filter(Boolean)
  const kept: string[] = []

  for (const line of lines) {
    const compact = line.replace(/\s/g, '')

    if (/\b[A-Z]{2}\d{2}[\s\dA-Z]{14,}\b/i.test(line) && /\d/.test(line)) continue
    if (/\b[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/.test(line)) continue
    if (/\b(?:IBAN|BIC|SWIFT|Konto|Bankverbindung)\b/i.test(line)) continue
    if (
      /\b(?:Sparkasse|Postbank|Commerzbank|Deutsche Bank|Volksbank|Raiffeisen)\b/i.test(line)
    )
      continue
    if (
      /\b(?:Geschäftsführ|Handelsregister|HRB|HRA|Amtsgericht|Registergericht|USt-?Id)\b/i.test(line)
    )
      continue
    if (/\b(?:Wirtschaftsprüf|Steuerberater|Rechtsanwält)\b/i.test(line)) continue
    if (/\bGeschäftsführende\s+Partner\b/i.test(line)) continue
    if (/^(?:Partner|Gesellschafter|Geschäftsführende\s+Partner)\s*:/i.test(line)) continue

    if (/^[A-Z]{2}\d{2}\d{10,30}$/i.test(compact)) continue
    if (/@/.test(line)) continue
    if (/^(https?:\/\/|www\.)/i.test(line)) continue
    if (/^(tel|fax|fon|telefon|phone|e-?mail|mobil)\b/i.test(line)) continue
    if (/\b(BIC|IBAN|SWIFT)\b/i.test(line)) continue
    if (/\b(USt-?Id|Steuernummer|St\.?\s*-?\s*Nr|UID|VAT|TVA|RCS|SIRET|EIN|TIN|ABN|GST)\b/i.test(line))
      continue
    if (/\b(HRB|HRA|Amtsgericht|Handelsregister|Geschäftszeichen|Company\s*No\.?)\b/i.test(line))
      continue
    if (/^[+(\d][\d\s()./+-]{6,}$/.test(line) && /\d{5,}/.test(compact)) continue

    kept.push(line)
    if (kept.length >= 4) break
  }

  return kept.join('\n')
}

const NORMALIZE_SYSTEM = `You are extracting structured data from a business letter. The letter can be in ANY language from ANY country. Detect the language automatically and extract accordingly.

FIELD DEFINITIONS — extract ONLY what matches each definition:

- sender_name: Company name or person name of the letter's author. Usually at the top or in the letterhead. ONE line.

- sender_address: POSTAL address of the sender. Contains ONLY: street + number, postal/ZIP code + city, optionally state/province + country. Does NOT contain: phone, fax, email, website, bank details, IBAN, BIC, tax IDs, registration numbers, or any other identifiers. Maximum 4 lines.

- recipient_name: Name of the person or company the letter is addressed to. Usually in the address window area.

- recipient_address: POSTAL address of the recipient. Same rules as sender_address — postal address only, nothing else.

ADDRESS PURITY (sender_address and recipient_address):
These two fields must contain ONLY the postal mailing address (street, house number, postal code, city, country).
They must NEVER contain: bank details (IBAN such as DE16 2305 1030..., BIC/SWIFT such as NOLADE21SHO or DEUTDEFF, bank names such as Sparkasse, Postbank, Commerzbank); legal or registry text (Handelsregister, HRB, HRA, Amtsgericht); partner or auditor lines (Geschäftsführende Partner, Wirtschaftsprüfungsgesellschaft, Steuerberater); tax identifiers (USt-IdNr, Steuernummer); phone, fax, email, or website. Put those values only in sender_iban, sender_bic, sender_bank, sender_tax_id, sender_registration, sender_phone, sender_fax, sender_email, sender_website as applicable.
Example: CORRECT = "Musterstraße 1" + "24118 Kiel". WRONG in address = "Sparkasse Südholstein DE16 2305 1030 0002 0304 01" (bank + IBAN belong in sender_bank / sender_iban).

- date: The letter date. Return in ISO format YYYY-MM-DD. Recognize all common formats:
  "April 11, 2026" / "11 April 2026" / "11.04.2026" / "04/11/2026" / "2026-04-11" / "11 avril 2026" / "11. April 2026" etc.

- subject: The subject line. May be preceded by: "Subject:", "Re:", "Betreff:", "Objet:", "Asunto:", "Oggetto:", "Onderwerp:", or simply be a bold/standalone line after the salutation area. ONE line.

- reference_number: Any reference, file number, case number, or tracking ID. May be preceded by: "Ref:", "Reference:", "Our ref:", "Your ref:", "Unser Zeichen:", "Ihr Zeichen:", "Az:", "Dossier:", "N/Réf:", "Réf:". If none found, return empty string.

- customer_number: The sender's customer or client number as used by the recipient toward the sender (e.g. Kundennummer, Kd.-Nr., Kundenkonto, Customer No.). Return only the number or code, not the label text.

- invoice_number: Invoice or bill number (e.g. Rechnungsnummer, Rg.-Nr., Rechnung Nr., Invoice No.). Return only the number or code.

- contract_number: Contract or policy number (e.g. Vertragsnummer, Policennummer, Vertrag Nr., Contract No.). Return only the number or code.

- order_number: Order or purchase number (e.g. Bestellnummer, Bestell-Nr., Auftragsnummer, Order No.). Return only the number or code.

- file_reference: Official file or case reference (e.g. Aktenzeichen, Az., Geschäftszeichen, Gz., Unser Zeichen, Ihr Zeichen when it denotes a file/case code). Return the full reference string. If the same line is only a generic "Ref:" with no separate Aktenzeichen, still capture it here or in reference_number — do not duplicate the same value in both if identical.

- contact_person: Named contact person or case handler (e.g. Ansprechpartner, Sachbearbeiter, Ihr Ansprechpartner, Bearbeiter). Return the person's name only when possible, not their full title block or department name.

- salutation: The greeting line. Examples across languages:
  "Dear Mr. Smith," / "Dear Sir or Madam," / "Sehr geehrte Damen und Herren," / "Madame, Monsieur," / "Estimado/a Sr/Sra," / "Egregio Signore," etc.

- body_summary: 2-3 sentence summary of the letter's content in the SAME language as the letter. Summarize the main point and any action requested.

- sender_phone: Phone number. Look for: "Tel:", "Phone:", "Telefon:", "Tél:", "Tel.:", "Ph:". Return with country code if visible. If not found, return empty string.

- sender_fax: Fax number. If not found, return empty string.

- sender_email: Email address of the sender. If not found, return empty string.

- sender_website: Website URL. If not found, return empty string.

- sender_iban: IBAN number (international format: 2 letter country code + 2 check digits + up to 30 alphanumeric). If not found, return empty string.

- sender_bic: BIC/SWIFT code. If not found, return empty string.

- sender_bank: Name of the bank. If not found, return empty string.

- sender_tax_id: Tax identification number. Varies by country:
  Germany: "USt-IdNr", "Steuernummer" / UK: "VAT Number" / France: "N° TVA" / US: "EIN", "TIN" / etc.
  If not found, return empty string.

- sender_registration: Company registration number. Varies by country:
  Germany: "HRB", "Amtsgericht" / UK: "Company No." / France: "RCS", "SIRET" / US: "Inc." state filing / etc.
  If not found, return empty string.

- detected_language: The language of the letter as ISO 639-1 code (e.g. "de", "en", "fr", "es", "it", "nl", "ja", "ar").

STRICT RULES:
1. NEVER mix bank details (IBAN, BIC, bank name, account numbers) into sender_address or recipient_address — use sender_iban, sender_bic, sender_bank.
2. NEVER include phone/fax/email/website in address fields.
3. NEVER include tax IDs, registration numbers, Handelsregister/HRB/HRA, partner lists, or auditor firm names in address fields.
4. Address fields contain ONLY postal address components (street, ZIP/postal code, city, optional region/country), at most 4 lines.
5. If unsure about a field, return empty string — do NOT guess.
6. Detect the language automatically — do not assume any specific language.
7. Return ONLY valid JSON. No markdown, no explanation.

Return format:
{
  "fields": {
    "sender_name": "...",
    "sender_address": "...",
    "recipient_name": "...",
    "recipient_address": "...",
    "date": "YYYY-MM-DD",
    "subject": "...",
    "reference_number": "...",
    "customer_number": "...",
    "invoice_number": "...",
    "contract_number": "...",
    "order_number": "...",
    "file_reference": "...",
    "contact_person": "...",
    "salutation": "...",
    "body_summary": "...",
    "sender_phone": "...",
    "sender_fax": "...",
    "sender_email": "...",
    "sender_website": "...",
    "sender_iban": "...",
    "sender_bic": "...",
    "sender_bank": "...",
    "sender_tax_id": "...",
    "sender_registration": "...",
    "detected_language": "..."
  },
  "confidence": {
    "sender_name": 0.95,
    "sender_address": 0.95,
    "recipient_name": 0.95,
    "recipient_address": 0.95,
    "date": 0.95,
    "subject": 0.95,
    "reference_number": 0.95,
    "customer_number": 0.95,
    "invoice_number": 0.95,
    "contract_number": 0.95,
    "order_number": 0.95,
    "file_reference": 0.95,
    "contact_person": 0.95,
    "salutation": 0.95,
    "body_summary": 0.95,
    "sender_phone": 0.95,
    "sender_fax": 0.95,
    "sender_email": 0.95,
    "sender_website": 0.95,
    "sender_iban": 0.95,
    "sender_bic": 0.95,
    "sender_bank": 0.95,
    "sender_tax_id": 0.95,
    "sender_registration": 0.95,
    "detected_language": 0.95
  }
}`

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
}

function optStrField(input: Record<string, unknown>, key: string): string | null {
  const v = input[key]
  return typeof v === 'string' ? v : null
}

function coerceRaw(input: unknown): LetterScanRawExtraction {
  const emptyHints = {
    customer_number: null as string | null,
    invoice_number: null as string | null,
    contract_number: null as string | null,
    order_number: null as string | null,
    file_reference: null as string | null,
    contact_person: null as string | null,
  }
  if (!isRecord(input)) {
    return {
      date: null,
      sender_lines: [],
      recipient_lines: [],
      subject_line: null,
      reference: null,
      salutation_line: null,
      ...emptyHints,
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
    customer_number: optStrField(input, 'customer_number'),
    invoice_number: optStrField(input, 'invoice_number'),
    contract_number: optStrField(input, 'contract_number'),
    order_number: optStrField(input, 'order_number'),
    file_reference: optStrField(input, 'file_reference'),
    contact_person: optStrField(input, 'contact_person'),
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

  const idKeys = [
    'customer_number',
    'invoice_number',
    'contract_number',
    'order_number',
    'file_reference',
    'contact_person',
  ] as const
  for (const k of idKeys) {
    const v = raw[k]
    if (typeof v === 'string' && v.trim()) {
      fields[k] = v.trim()
    }
  }

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
