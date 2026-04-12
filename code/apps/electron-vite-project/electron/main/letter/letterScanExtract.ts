/**
 * Layer 1 — deterministic hints from OCR / PDF text for incoming letter extraction.
 */

export type LetterScanRawExtraction = {
  date: string | null
  sender_lines: string[]
  recipient_lines: string[]
  subject_line: string | null
  reference: string | null
  salutation_line: string | null
  customer_number: string | null
  invoice_number: string | null
  contract_number: string | null
  order_number: string | null
  file_reference: string | null
  contact_person: string | null
}

const EMPTY_RAW: LetterScanRawExtraction = {
  date: null,
  sender_lines: [],
  recipient_lines: [],
  subject_line: null,
  reference: null,
  salutation_line: null,
  customer_number: null,
  invoice_number: null,
  contract_number: null,
  order_number: null,
  file_reference: null,
  contact_person: null,
}

const DATE_PATTERNS: RegExp[] = [
  /(\d{1,2})\.\s?(Januar|Februar|März|April|Mai|Juni|Juli|August|September|Oktober|November|Dezember)\s?(\d{4})/i,
  /(\d{1,2})\.(\d{1,2})\.(\d{4})/,
  /(\d{4})-(\d{2})-(\d{2})/,
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i,
  /\b\d{1,2}\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i,
]

const SUBJECT_LINE_RE =
  /^(?:Betreff|Subject|Re|Aw|Regarding|Your ref|Ihr Schreiben)\s*[:\s]\s*(.+)$/i

const REF_LINE_RE =
  /^(?:Aktenzeichen|Geschäftszeichen|Ihr\s*Zeichen|Unser\s*Zeichen|Unsere\s*Ref|Ref\.?|Reference|Zeichen)\s*[:\s]\s*(.+)$/i

const SALUTATION_RE =
  /^(Sehr geehrte|Sehr geehrter|Sehr geehrte Damen und Herren|Dear|Guten Tag|Hallo|Good morning|Good afternoon)\b/i

function extractFirstDate(text: string): string | null {
  for (const re of DATE_PATTERNS) {
    const m = text.match(re)
    if (m && m[0]) return m[0].trim()
  }
  return null
}

function findSubjectLine(paragraphs: string[][]): string | null {
  for (const para of paragraphs) {
    for (const line of para) {
      const m = line.match(SUBJECT_LINE_RE)
      if (m?.[1]) return m[1].trim()
    }
  }
  return null
}

function findReference(paragraphs: string[][]): string | null {
  for (const para of paragraphs) {
    for (const line of para) {
      const m = line.match(REF_LINE_RE)
      if (m?.[1]) return m[1].trim()
    }
  }
  return null
}

function findSalutationLine(paragraphs: string[][]): string | null {
  for (const para of paragraphs) {
    for (const line of para) {
      if (SALUTATION_RE.test(line)) return line.trim()
    }
  }
  return null
}

/** Index of first paragraph that contains a salutation line. */
function salutationParagraphIndex(paragraphs: string[][]): number {
  for (let i = 0; i < paragraphs.length; i++) {
    for (const line of paragraphs[i]) {
      if (SALUTATION_RE.test(line)) return i
    }
  }
  return -1
}

function splitParagraphs(firstPage: string): string[][] {
  const normalized = firstPage.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const chunks = normalized.split(/\n\s*\n/)
  const out: string[][] = []
  for (const chunk of chunks) {
    const lines = chunk
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length) out.push(lines)
  }
  return out
}

/** Drop tiny paragraphs that are only a date or page number. */
function isNoiseParagraph(lines: string[]): boolean {
  if (lines.length !== 1) return false
  const L = lines[0]
  if (L.length < 4) return true
  if (/^seite\s+\d+/i.test(L)) return true
  if (DATE_PATTERNS.some((re) => re.test(L)) && L.length < 40) return false
  return false
}

/** Regex hints for IDs / contact (full letter text — invoices may use later pages). */
function extractIdentificationHints(text: string): Pick<
  LetterScanRawExtraction,
  | 'customer_number'
  | 'invoice_number'
  | 'contract_number'
  | 'order_number'
  | 'file_reference'
  | 'contact_person'
> {
  const t = text || ''
  const out = {
    customer_number: null as string | null,
    invoice_number: null as string | null,
    contract_number: null as string | null,
    order_number: null as string | null,
    file_reference: null as string | null,
    contact_person: null as string | null,
  }

  const mCust = t.match(
    /(?:Kundennummer|Kunden-?Nr\.?|Kd\.?\s*-?\s*Nr\.?|Kundenkonto|Customer\s*(?:No|Number|ID))[:\s]+([A-Za-z0-9\-/.]+)/i,
  )
  if (mCust?.[1]) out.customer_number = mCust[1].trim()

  const mInv = t.match(
    /(?:Rechnungsnummer|Rechnung\s*Nr\.?|Rg\.?\s*-?\s*Nr\.?|Invoice\s*(?:No|Number|ID))[:\s]+([A-Za-z0-9\-/.]+)/i,
  )
  if (mInv?.[1]) out.invoice_number = mInv[1].trim()

  const mContract = t.match(
    /(?:Vertragsnummer|Vertrag\s*Nr\.?|Policennummer|Contract\s*(?:No|Number|ID))[:\s]+([A-Za-z0-9\-/.]+)/i,
  )
  if (mContract?.[1]) out.contract_number = mContract[1].trim()

  const mOrder = t.match(
    /(?:Bestellnummer|Bestell-?Nr\.?|Auftrags-?Nr\.?|Auftragsnummer|Order\s*(?:No|Number|ID))[:\s]+([A-Za-z0-9\-/.]+)/i,
  )
  if (mOrder?.[1]) out.order_number = mOrder[1].trim()

  const mFile = t.match(
    /(?:Aktenzeichen|Az\.?|Geschäftszeichen|Gz\.?|Unser\s*Zeichen|Ihr\s*Zeichen|File\s*Ref)[:\s]+([A-Za-z0-9\-/.\s]+?)(?:\n|$)/i,
  )
  if (mFile?.[1]) out.file_reference = mFile[1].trim()

  const mContact = t.match(
    /(?:Ansprechpartner|Sachbearbeiter|Ihr\s*Ansprechpartner|Bearbeiter|Contact\s*Person)[:\s]+([A-Za-zÄÖÜäöüß.\-\s]+?)(?:\n|$)/i,
  )
  if (mContact?.[1]) out.contact_person = mContact[1].trim()

  return out
}

export function extractRawFromScanText(fullText: string): { raw: LetterScanRawExtraction } {
  if (!fullText || typeof fullText !== 'string') {
    return { raw: { ...EMPTY_RAW } }
  }

  const firstPage =
    fullText.split(/\n--- Page Break ---\n/i)[0]?.trim() ?? fullText.trim()
  if (!firstPage) {
    const idHints = extractIdentificationHints(fullText.trim())
    return { raw: { ...EMPTY_RAW, ...idHints } }
  }

  const extractedDate = extractFirstDate(firstPage)
  let paragraphs = splitParagraphs(firstPage).filter((p) => !isNoiseParagraph(p))

  const subject_line = findSubjectLine(paragraphs)
  const reference = findReference(paragraphs)
  const salutation_line = findSalutationLine(paragraphs)
  const si = salutationParagraphIndex(paragraphs)

  let sender_lines: string[] = []
  let recipient_lines: string[] = []

  if (si >= 2) {
    sender_lines = paragraphs[0] ?? []
    recipient_lines = paragraphs[1] ?? []
  } else if (si === 1) {
    sender_lines = paragraphs[0] ?? []
    const lines = sender_lines
    if (lines.length >= 5) {
      const mid = Math.min(3, Math.floor(lines.length / 2))
      sender_lines = lines.slice(0, mid)
      recipient_lines = lines.slice(mid)
    }
  } else if (si === 0) {
    sender_lines = []
    recipient_lines = []
  } else {
    if (paragraphs.length >= 2) {
      sender_lines = paragraphs[0] ?? []
      recipient_lines = paragraphs[1] ?? []
    } else if (paragraphs.length === 1) {
      const L = paragraphs[0]
      if (L.length >= 4) {
        const mid = Math.min(3, Math.floor(L.length / 2))
        sender_lines = L.slice(0, mid)
        recipient_lines = L.slice(mid)
      } else {
        sender_lines = L
      }
    }
  }

  const maxLines = 8
  sender_lines = sender_lines.slice(0, maxLines)
  recipient_lines = recipient_lines.slice(0, maxLines)

  const idHints = extractIdentificationHints(fullText.trim())

  return {
    raw: {
      date: extractedDate,
      sender_lines,
      recipient_lines,
      subject_line,
      reference,
      salutation_line,
      ...idHints,
    },
  }
}
