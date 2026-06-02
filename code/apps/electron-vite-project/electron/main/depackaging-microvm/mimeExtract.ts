/**
 * Minimal, BOUNDED MIME extraction — runs INSIDE the depackaging guest only.
 *
 * This deliberately does the smallest correct thing for Build 1's vertical slice:
 * split an email into a subject, its `text/plain` parts, and everything else
 * ("artifact" parts: html, attachments, anything non-plain). It is NOT a
 * general-purpose MIME library; production hardening (a vetted parser, fuzzing)
 * is a guest-image concern. What matters for the invariant is WHERE this runs
 * (isolated guest) and that its output feeds POSITIVE CONSTRUCTION, never
 * pass-through.
 *
 * Hard bounds prevent a malicious message from exhausting the guest.
 */

export interface MimePart {
  contentType: string
  /** Decoded raw bytes of this part (after transfer-encoding decode). */
  bytes: Buffer
  filename?: string
}

export interface ExtractedMime {
  subject: string
  /** Decoded UTF-8 text of all `text/plain` parts (in order). */
  plainTextParts: string[]
  /** Every non-`text/plain` part — becomes an encrypted artifact blob. */
  artifactParts: MimePart[]
}

export const MIME_LIMITS = {
  MAX_INPUT_BYTES: 8 * 1024 * 1024,
  MAX_PARTS: 64,
  MAX_HEADERS_BYTES: 64 * 1024,
} as const

function parseHeaders(block: string): Map<string, string> {
  const headers = new Map<string, string>()
  // Unfold RFC822 continuation lines (leading whitespace continues prior header).
  const unfolded = block.replace(/\r?\n[ \t]+/g, ' ')
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx <= 0) continue
    const name = line.slice(0, idx).trim().toLowerCase()
    const value = line.slice(idx + 1).trim()
    if (name && !headers.has(name)) headers.set(name, value)
  }
  return headers
}

function decodeTransfer(bytes: Buffer, encoding: string): Buffer {
  const enc = encoding.trim().toLowerCase()
  if (enc === 'base64') {
    return Buffer.from(bytes.toString('ascii').replace(/\s+/g, ''), 'base64')
  }
  if (enc === 'quoted-printable') {
    const s = bytes.toString('latin1')
    const decoded = s
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)))
    return Buffer.from(decoded, 'latin1')
  }
  // 7bit / 8bit / binary / unknown → as-is.
  return bytes
}

function contentTypeOf(headers: Map<string, string>): { type: string; boundary?: string; filename?: string } {
  const ct = headers.get('content-type') ?? 'text/plain'
  const type = ct.split(';')[0]!.trim().toLowerCase()
  const boundaryMatch = /boundary="?([^";]+)"?/i.exec(ct)
  const cd = headers.get('content-disposition') ?? ''
  const nameMatch = /filename="?([^";]+)"?/i.exec(cd) ?? /name="?([^";]+)"?/i.exec(ct)
  return {
    type,
    boundary: boundaryMatch?.[1],
    filename: nameMatch?.[1],
  }
}

function splitHeaderBody(raw: string): { headerBlock: string; body: string } {
  const sep = raw.indexOf('\r\n\r\n')
  const sep2 = sep === -1 ? raw.indexOf('\n\n') : sep
  if (sep2 === -1) return { headerBlock: raw.slice(0, MIME_LIMITS.MAX_HEADERS_BYTES), body: '' }
  const headerEnd = sep === -1 ? sep2 : sep
  const bodyStart = sep === -1 ? sep2 + 2 : sep2 + 4
  return { headerBlock: raw.slice(0, headerEnd), body: raw.slice(bodyStart) }
}

/**
 * Extract a bounded MIME structure. Fail-closed: on any parse anomaly the
 * caller treats the whole input as a single opaque artifact (never as text).
 */
export function extractMime(input: Buffer): ExtractedMime {
  const capped = input.length > MIME_LIMITS.MAX_INPUT_BYTES ? input.subarray(0, MIME_LIMITS.MAX_INPUT_BYTES) : input
  const raw = capped.toString('latin1')
  const { headerBlock, body } = splitHeaderBody(raw)
  const headers = parseHeaders(headerBlock)
  const subject = headers.get('subject') ?? ''
  const top = contentTypeOf(headers)

  const plainTextParts: string[] = []
  const artifactParts: MimePart[] = []

  const pushPart = (partHeaders: Map<string, string>, partBodyRaw: string) => {
    if (plainTextParts.length + artifactParts.length >= MIME_LIMITS.MAX_PARTS) return
    const info = contentTypeOf(partHeaders)
    const cte = partHeaders.get('content-transfer-encoding') ?? '7bit'
    const decoded = decodeTransfer(Buffer.from(partBodyRaw, 'latin1'), cte)
    const isAttachment = /attachment|inline/i.test(partHeaders.get('content-disposition') ?? '') && !!info.filename
    if (info.type === 'text/plain' && !isAttachment) {
      // Re-decode as UTF-8 for text. (latin1→bytes→utf8 round-trips raw octets.)
      plainTextParts.push(decoded.toString('utf8'))
    } else {
      artifactParts.push({ contentType: info.type, bytes: decoded, filename: info.filename })
    }
  }

  if (top.type.startsWith('multipart/') && top.boundary) {
    const boundary = top.boundary
    const segments = body.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\r?\\n?`))
    for (const seg of segments) {
      if (!seg.trim()) continue
      const { headerBlock: ph, body: pb } = splitHeaderBody(seg)
      if (!ph && !pb) continue
      pushPart(parseHeaders(ph), pb)
      if (plainTextParts.length + artifactParts.length >= MIME_LIMITS.MAX_PARTS) break
    }
  } else if (top.type === 'text/plain' && !top.filename) {
    const cte = headers.get('content-transfer-encoding') ?? '7bit'
    plainTextParts.push(decodeTransfer(Buffer.from(body, 'latin1'), cte).toString('utf8'))
  } else {
    // Single non-plain part (e.g. text/html, application/*) → artifact.
    const cte = headers.get('content-transfer-encoding') ?? '7bit'
    artifactParts.push({
      contentType: top.type,
      bytes: decodeTransfer(Buffer.from(body, 'latin1'), cte),
      filename: top.filename,
    })
  }

  return { subject, plainTextParts, artifactParts }
}
