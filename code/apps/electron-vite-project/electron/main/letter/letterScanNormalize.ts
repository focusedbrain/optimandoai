/**
 * Layer 2 — AI normalization of deterministic letter scan hints (Ollama).
 */

import type { ChatMessage } from '../llm/types'
import type { LetterScanRawExtraction } from './letterScanExtract'

const OUTPUT_KEYS = [
  'sender_name',
  'sender_address',
  'recipient_name',
  'recipient_address',
  'date',
  'subject',
  'reference_number',
  'salutation',
  'body_summary',
] as const

export type NormalizedLetterFields = Record<(typeof OUTPUT_KEYS)[number], string>

const NORMALIZE_SYSTEM = `You are extracting structured data from a business letter. You receive JSON "hints" from a rules-based extractor and the full letter text. Return a single JSON object with:
- sender_name: string
- sender_address: string (full multi-line address, use \\n between lines if needed)
- recipient_name: string
- recipient_address: string
- date: string in ISO format YYYY-MM-DD when possible; otherwise empty string
- subject: string
- reference_number: string (file/reference numbers), empty if none
- salutation: string (opening line)
- body_summary: string (2-3 sentences summarizing the letter)

Also include a "confidence" object with the SAME keys as above; each value is a number from 0.0 to 1.0 for that field.

Rules:
- Prefer the full letter text; use hints only as weak guidance when text is ambiguous.
- If a field is missing, use an empty string.
- Return ONLY valid JSON, no markdown fences or commentary.`

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

export function fallbackNormalizedFromRaw(
  raw: LetterScanRawExtraction,
  fullText: string,
): { fields: NormalizedLetterFields; confidence: Record<string, number> } {
  const senderLines = raw.sender_lines
  const recipientLines = raw.recipient_lines
  const sender_name = senderLines[0] ?? ''
  const sender_address = senderLines.join('\n')
  const recipient_name = recipientLines[0] ?? ''
  const recipient_address = recipientLines.join('\n')

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

  const fields: NormalizedLetterFields = {
    sender_name,
    sender_address,
    recipient_name,
    recipient_address,
    date: dateIso,
    subject: raw.subject_line ?? '',
    reference_number: raw.reference ?? '',
    salutation: raw.salutation_line ?? '',
    body_summary: bodyStub.slice(0, 500).replace(/\s+/g, ' ').trim(),
  }

  const baseConf = 0.45
  const confidence: Record<string, number> = {}
  for (const k of OUTPUT_KEYS) {
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
  const textSlice = fullText.slice(0, 4000)

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

  const messages: ChatMessage[] = [
    { role: 'system', content: NORMALIZE_SYSTEM },
    {
      role: 'user',
      content: `Raw hints:\n${JSON.stringify(raw, null, 2)}\n\nFull letter text:\n${textSlice}`,
    },
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

  const confRaw = isRecord(parsed.confidence) ? parsed.confidence : {}

  const fields: NormalizedLetterFields = { ...fallback.fields }
  const confidence: Record<string, number> = { ...fallback.confidence }

  for (const k of OUTPUT_KEYS) {
    const v = parsed[k]
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

  for (const k of OUTPUT_KEYS) {
    if (!(k in confidence)) {
      confidence[k] = fields[k] ? 0.65 : 0
    } else {
      confidence[k] = clamp01(confidence[k]!)
    }
  }

  return { ok: true, fields, confidence }
}
