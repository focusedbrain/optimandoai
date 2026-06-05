/**
 * B2.2 (spec 0013 §1) — display-envelope derivation INSIDE the key-less guest.
 *
 * Header parsing is untrusted-structure parsing (RFC 2047 encoded-words, malformed
 * address lists, header folding). Per INV-7 it may NOT happen in the orchestrator
 * flag-on. This module decodes + normalizes the display envelope (subject, from,
 * to, cc, reply-to, date) entirely in-guest, with C4-style caps. BOTH producers
 * use it: the RFC822 parser (`emailDepackage.hardenedParse`) feeds raw header
 * strings; the provider-structured-json walker feeds Graph fields (still treated
 * as untrusted strings, capped + normalized identically).
 *
 * Degradation, not risk routing (spec 0013 §1.2): a failed/ambiguous decode does
 * NOT quarantine — the field degrades to a length-capped literal placeholder
 * (raw string shown as-is) and is listed in `degradedFields`. Nothing structural
 * crosses the boundary unparsed, so this is display degradation only. Content
 * processing always proceeds.
 *
 * Pure: node `Buffer` + global `TextDecoder` only. No electron, no network.
 */

export interface EnvelopeAddress {
  readonly email: string
  readonly name?: string
}

export interface DisplayEnvelope {
  readonly subject: string
  readonly from?: EnvelopeAddress
  readonly to: readonly EnvelopeAddress[]
  readonly cc: readonly EnvelopeAddress[]
  readonly replyTo?: EnvelopeAddress
  /** ISO 8601 when parseable; otherwise the capped raw string (and degraded). */
  readonly date?: string
  /** Field names that degraded (decode failed/ambiguous or oversized). */
  readonly degradedFields: readonly string[]
}

export const ENVELOPE_CAPS = {
  MAX_SUBJECT_LEN: 2048,
  MAX_NAME_LEN: 998,
  MAX_EMAIL_LEN: 320,
  MAX_DATE_LEN: 128,
  MAX_RECIPIENTS: 256,
  MAX_MSGID_LEN: 998,
  MAX_REFERENCES: 64,
} as const

/**
 * B2.2 threading keys, derived IN-GUEST (header handling never in the orchestrator
 * flag-on). IMAP has no native thread id, so flag-on it threads / relocates (MOVE)
 * on the guest-derived `messageId` rather than a locally-parsed header. These are
 * opaque ASCII msg-id tokens — trimmed + capped, never RFC 2047 decoded.
 */
export interface ThreadingHints {
  readonly messageId?: string
  readonly inReplyTo?: string
  readonly references?: readonly string[]
}

function capMsgId(v: string | undefined): string | undefined {
  if (!v) return undefined
  const t = v.trim()
  if (!t) return undefined
  return t.length > ENVELOPE_CAPS.MAX_MSGID_LEN ? t.slice(0, ENVELOPE_CAPS.MAX_MSGID_LEN) : t
}

/** Threading hints from raw RFC822 headers (RFC822 path). */
export function threadingFromHeaders(headers: Map<string, string>): ThreadingHints {
  const refsRaw = headers.get('references')
  const references = refsRaw
    ? refsRaw.split(/\s+/).map((s) => s.trim()).filter(Boolean).slice(0, ENVELOPE_CAPS.MAX_REFERENCES)
    : undefined
  return {
    messageId: capMsgId(headers.get('message-id')),
    inReplyTo: capMsgId(headers.get('in-reply-to')),
    references: references && references.length ? references : undefined,
  }
}

/** Threading hints from provider-native fields (Graph `internetMessageId`). */
export function threadingFromProvider(fields: { messageId?: string; inReplyTo?: string; references?: readonly string[] }): ThreadingHints {
  const references = fields.references
    ? fields.references.map((s) => s.trim()).filter(Boolean).slice(0, ENVELOPE_CAPS.MAX_REFERENCES)
    : undefined
  return {
    messageId: capMsgId(fields.messageId),
    inReplyTo: capMsgId(fields.inReplyTo),
    references: references && references.length ? references : undefined,
  }
}

// ── RFC 2047 encoded-word decode ─────────────────────────────────────────────

const ENCODED_WORD = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/

function decodeQ(text: string): Buffer {
  const s = text.replace(/_/g, ' ')
  const out: number[] = []
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && i + 2 < s.length) {
      const h = s.slice(i + 1, i + 3)
      if (/^[0-9A-Fa-f]{2}$/.test(h)) {
        out.push(parseInt(h, 16))
        i += 2
        continue
      }
    }
    out.push(s.charCodeAt(i) & 0xff)
  }
  return Buffer.from(out)
}

/** Decode ONE encoded word; returns null on any malformed/unknown-charset case. */
function decodeOne(charset: string, enc: string, text: string): string | null {
  try {
    const bytes = enc.toLowerCase() === 'b' ? Buffer.from(text.replace(/\s+/g, ''), 'base64') : decodeQ(text)
    // Unknown charset labels make the TextDecoder ctor throw → degrade.
    const dec = new TextDecoder(charset.trim().toLowerCase(), { fatal: false })
    return dec.decode(bytes)
  } catch {
    return null
  }
}

/**
 * Decode a header value that may contain RFC 2047 encoded words. Adjacent encoded
 * words separated only by whitespace are joined without that whitespace (RFC 2047
 * §6.2). Returns `degraded:true` (and the ORIGINAL raw string) if any encoded word
 * present cannot be decoded — never a partial mix.
 */
export function decodeHeaderText(raw: string): { value: string; degraded: boolean } {
  if (!raw || !raw.includes('=?')) return { value: raw ?? '', degraded: false }

  // Tokenize into [literal | encoded-word] runs, collapsing whitespace that sits
  // strictly between two encoded words.
  const tokens: Array<{ kind: 'lit' | 'ew'; text: string; decoded?: string }> = []
  let rest = raw
  const global = new RegExp(ENCODED_WORD.source, 'g')
  let lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = global.exec(raw)) !== null) {
    if (m.index > lastIndex) tokens.push({ kind: 'lit', text: raw.slice(lastIndex, m.index) })
    const decoded = decodeOne(m[1]!, m[2]!, m[3]!)
    if (decoded === null) return { value: raw, degraded: true }
    tokens.push({ kind: 'ew', text: m[0]!, decoded })
    lastIndex = m.index + m[0]!.length
  }
  if (lastIndex < raw.length) tokens.push({ kind: 'lit', text: raw.slice(lastIndex) })
  void rest

  let value = ''
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!
    if (t.kind === 'ew') {
      value += t.decoded
    } else {
      // Drop whitespace-only literals between two encoded words (RFC 2047 §6.2).
      const prev = tokens[i - 1]
      const next = tokens[i + 1]
      if (prev?.kind === 'ew' && next?.kind === 'ew' && /^\s*$/.test(t.text)) continue
      value += t.text
    }
  }
  return { value, degraded: false }
}

// ── Field normalization with caps ────────────────────────────────────────────

function capText(value: string, max: number): { value: string; degraded: boolean } {
  if (value.length > max) return { value: value.slice(0, max), degraded: true }
  return { value, degraded: false }
}

function stripQuotes(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).trim()
  return t
}

/** Split a raw address list on commas not inside quotes or angle brackets. */
function splitAddressList(raw: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote = false
  let inAngle = false
  for (const ch of raw) {
    if (ch === '"' && !inAngle) inQuote = !inQuote
    else if (ch === '<' && !inQuote) inAngle = true
    else if (ch === '>' && !inQuote) inAngle = false
    if (ch === ',' && !inQuote && !inAngle) {
      if (cur.trim()) out.push(cur.trim())
      cur = ''
      continue
    }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function parseOneAddress(token: string, markDegraded: () => void): EnvelopeAddress | null {
  const t = token.trim()
  if (!t) return null
  const angle = /^(.*)<([^>]*)>\s*$/.exec(t)
  let rawName = ''
  let rawEmail = ''
  if (angle) {
    rawName = angle[1]!.trim()
    rawEmail = angle[2]!.trim()
  } else {
    rawEmail = t
  }
  let name: string | undefined
  if (rawName) {
    const dec = decodeHeaderText(stripQuotes(rawName))
    if (dec.degraded) markDegraded()
    const capped = capText(dec.value, ENVELOPE_CAPS.MAX_NAME_LEN)
    if (capped.degraded) markDegraded()
    name = capped.value || undefined
  }
  const emailCap = capText(rawEmail, ENVELOPE_CAPS.MAX_EMAIL_LEN)
  if (emailCap.degraded) markDegraded()
  return name ? { email: emailCap.value, name } : { email: emailCap.value }
}

function parseAddressList(raw: string | undefined, fieldName: string, degraded: Set<string>): EnvelopeAddress[] {
  if (!raw) return []
  const mark = () => degraded.add(fieldName)
  let tokens = splitAddressList(raw)
  if (tokens.length > ENVELOPE_CAPS.MAX_RECIPIENTS) {
    tokens = tokens.slice(0, ENVELOPE_CAPS.MAX_RECIPIENTS)
    mark()
  }
  const out: EnvelopeAddress[] = []
  for (const tok of tokens) {
    const a = parseOneAddress(tok, mark)
    if (a) out.push(a)
  }
  return out
}

function normalizeSubject(raw: string | undefined, degraded: Set<string>): string {
  const dec = decodeHeaderText(raw ?? '')
  if (dec.degraded) degraded.add('subject')
  const capped = capText(dec.value, ENVELOPE_CAPS.MAX_SUBJECT_LEN)
  if (capped.degraded) degraded.add('subject')
  return capped.value
}

function normalizeDate(raw: string | undefined, degraded: Set<string>): string | undefined {
  if (!raw) return undefined
  const t = new Date(raw)
  if (!isNaN(t.getTime())) return t.toISOString()
  degraded.add('date')
  return capText(raw, ENVELOPE_CAPS.MAX_DATE_LEN).value
}

// ── Producers ────────────────────────────────────────────────────────────────

/** Build the display envelope from raw RFC822 header values (the RFC822 path). */
export function buildEnvelopeFromHeaders(headers: Map<string, string>): DisplayEnvelope {
  const degraded = new Set<string>()
  const from = parseAddressList(headers.get('from'), 'from', degraded)
  const to = parseAddressList(headers.get('to'), 'to', degraded)
  const cc = parseAddressList(headers.get('cc'), 'cc', degraded)
  const replyTo = parseAddressList(headers.get('reply-to'), 'replyTo', degraded)
  return {
    subject: normalizeSubject(headers.get('subject'), degraded),
    from: from[0],
    to,
    cc,
    replyTo: replyTo[0],
    date: normalizeDate(headers.get('date'), degraded),
    degradedFields: [...degraded],
  }
}

/** Raw provider-supplied address (Graph), pre-split into name/email by the API. */
export interface RawProviderAddress {
  readonly email?: string
  readonly name?: string
}
export interface RawProviderEnvelopeFields {
  readonly subject?: string
  readonly from?: RawProviderAddress
  readonly to?: readonly RawProviderAddress[]
  readonly cc?: readonly RawProviderAddress[]
  readonly replyTo?: RawProviderAddress
  readonly date?: string
}

function normalizeProviderAddress(a: RawProviderAddress | undefined, fieldName: string, degraded: Set<string>): EnvelopeAddress | undefined {
  if (!a) return undefined
  // Provider strings are still untrusted: decode (no-op if already decoded) + cap,
  // identically to the RFC822 path so the two forms converge.
  let name: string | undefined
  if (a.name) {
    const dec = decodeHeaderText(a.name)
    if (dec.degraded) degraded.add(fieldName)
    const capped = capText(dec.value, ENVELOPE_CAPS.MAX_NAME_LEN)
    if (capped.degraded) degraded.add(fieldName)
    name = capped.value || undefined
  }
  const emailCap = capText(a.email ?? '', ENVELOPE_CAPS.MAX_EMAIL_LEN)
  if (emailCap.degraded) degraded.add(fieldName)
  return name ? { email: emailCap.value, name } : { email: emailCap.value }
}

function normalizeProviderList(list: readonly RawProviderAddress[] | undefined, fieldName: string, degraded: Set<string>): EnvelopeAddress[] {
  if (!list || list.length === 0) return []
  let items = list
  if (items.length > ENVELOPE_CAPS.MAX_RECIPIENTS) {
    items = items.slice(0, ENVELOPE_CAPS.MAX_RECIPIENTS)
    degraded.add(fieldName)
  }
  const out: EnvelopeAddress[] = []
  for (const a of items) {
    const n = normalizeProviderAddress(a, fieldName, degraded)
    if (n) out.push(n)
  }
  return out
}

/** Build the display envelope from provider-structured fields (the Graph path). */
export function buildEnvelopeFromFields(fields: RawProviderEnvelopeFields): DisplayEnvelope {
  const degraded = new Set<string>()
  return {
    subject: normalizeSubject(fields.subject, degraded),
    from: normalizeProviderAddress(fields.from, 'from', degraded),
    to: normalizeProviderList(fields.to, 'to', degraded),
    cc: normalizeProviderList(fields.cc, 'cc', degraded),
    replyTo: normalizeProviderAddress(fields.replyTo, 'replyTo', degraded),
    date: normalizeDate(fields.date, degraded),
    degradedFields: [...degraded],
  }
}
