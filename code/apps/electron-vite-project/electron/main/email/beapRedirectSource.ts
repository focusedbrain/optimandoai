/**
 * Extract plaintext layers from any inbox row for redirect / sandbox clone (new qBEAP package; no wire reuse).
 * Does not read or return original wire ciphertext.
 */

export type BeapRedirectSourceResult =
  | {
      ok: true
      message_id: string
      source_type: string
      original_handshake_id: string | null
      subject: string
      /** Transport-safe / public line for qBEAP; may be empty */
      public_text: string
      /** Authoritative body for the new capsule; combined with provenance in the renderer */
      encrypted_text: string
      /** Set when depackaging was partial or the row is a generic email without body in DB */
      content_warning?: string
    }
  | { ok: false; error: string }

type InboxRow = {
  id: string
  source_type?: string | null
  handshake_id?: string | null
  subject?: string | null
  body_text?: string | null
  depackaged_json?: string | null
  beap_package_json?: string | null
  has_attachments?: number | null
}

/** Inbox `source_type` values that represent a received BEAP row (P2P direct or email-carried / depackaged). */
export function isReceivedBeapInboxSourceType(st: string | null | undefined): boolean {
  const t = String(st ?? '')
  return t === 'direct_beap' || t === 'email_beap'
}

function depackFormatFromRow(dep: string | null | undefined): string | null {
  if (!dep?.trim()) return null
  try {
    const d = JSON.parse(dep) as { format?: string }
    return typeof d.format === 'string' ? d.format : null
  } catch {
    return null
  }
}

/**
 * Row has BEAP-specific / extension depackaging (rich extraction path).
 * Kept in sync with renderer `inboxBeapRowEligibility.ts` for *structured* BEAP text.
 */
export function inboxRowIsReceivedBeapForRedirectOrClone(row: {
  source_type?: string | null
  beap_package_json?: string | null
  depackaged_json?: string | null
}): boolean {
  const st = String(row.source_type ?? '')
  if (st === 'direct_beap' || st === 'email_beap') return true
  if (st !== 'email_plain') return false
  if (row.beap_package_json && String(row.beap_package_json).trim().length > 0) return true
  const fmt = depackFormatFromRow(row.depackaged_json)
  if (!fmt) return false
  if (fmt === 'beap_qbeap_outbound') return false
  if (fmt.startsWith('beap_')) return true
  if (fmt === 'pbeap') return true
  return false
}

function extractBodyFromDepackaged(d: Record<string, unknown>): string {
  const body = d.body
  if (typeof body === 'string') return body
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    return String(b.text ?? b.content ?? b.message ?? b.body ?? b.plaintext ?? '').trim()
  }
  return ''
}

const MAX_SLICE = 120_000

/**
 * Build plaintext from a BEAP-shaped row (P2P / depackaged). May return empty strings; caller can fall back.
 */
function tryExtractBeapStructuredText(row: InboxRow): {
  publicText: string
  encText: string
  warning?: string
} {
  let publicText = ''
  let encText = ''
  let warning: string | undefined

  const dep = typeof row.depackaged_json === 'string' ? row.depackaged_json.trim() : ''
  if (dep) {
    try {
      const d = JSON.parse(dep) as Record<string, unknown>
      const fmt = typeof d.format === 'string' ? d.format : ''

      if (fmt === 'beap_qbeap_outbound') {
        const raw = String(row.body_text ?? '').trim()
        encText = raw || extractBodyFromDepackaged(d) || '_(Outbound send copy — use Sent tab for full context.)_'
        publicText = encText
        warning = 'This row is an outbound qBEAP echo; redirect/clone use the local preview or body text only.'
        return { publicText, encText, warning }
      }

      if (fmt === 'beap_qbeap_decrypted') {
        const tp = d.transport_plaintext
        publicText = typeof tp === 'string' ? tp : ''
        const bodyStr = extractBodyFromDepackaged(d)
        encText = bodyStr
        if (!encText && publicText) encText = publicText
      } else if (fmt === 'beap_qbeap_pending_main') {
        publicText = extractBodyFromDepackaged(d) || String(row.body_text ?? '').trim()
        encText = publicText
        warning =
          'This message is still qBEAP-pending: only a preview is available. Decrypt or let the extension merge into the inbox for full content before redirect or Sandbox clone.'
      } else {
        const subj = d.subject
        let bodyStr = extractBodyFromDepackaged(d)
        if (typeof subj === 'string' && subj.trim()) {
          bodyStr = `Subject: ${subj}\n\n${bodyStr}`.trim()
        }
        encText = bodyStr
        publicText = bodyStr
      }
    } catch {
      encText = String(row.body_text ?? '').trim()
      publicText = encText
    }
  } else {
    const raw = String(row.body_text ?? '').trim()
    encText = raw
    publicText = raw
  }

  const rawBt = String(row.body_text ?? '').trim()
  if (!encText.trim() && rawBt && !rawBt.includes('open in extension') && !rawBt.includes('Encrypted qBEAP')) {
    encText = rawBt
    publicText = rawBt
  }

  if (!encText.trim()) {
    return { publicText: '', encText: '', warning: undefined }
  }

  return {
    publicText: publicText.slice(0, MAX_SLICE),
    encText: encText.slice(0, MAX_SLICE),
    ...(warning ? { warning } : {}),
  }
}

/**
 * Any inbox row: plain IMAP, imported, or non-BEAP `email_plain`.
 */
function extractGenericInboxText(row: InboxRow): { publicText: string; encText: string; warning?: string } {
  const subject = String(row.subject ?? '').trim() || '(No subject)'
  let encText = String(row.body_text ?? '').trim()
  let publicText = encText
  const warnings: string[] = []

  const dep = typeof row.depackaged_json === 'string' ? row.depackaged_json.trim() : ''
  if (dep) {
    try {
      const d = JSON.parse(dep) as Record<string, unknown>
      const t = extractBodyFromDepackaged(d)
      if (t) {
        encText = [encText, t].filter(Boolean).join('\n\n').trim()
        publicText = encText
      }
    } catch {
      /* ignore */
    }
  }

  if (!encText.trim()) {
    encText = [`[No message body in local store]`, `Subject: ${subject}`, `—`, `Use “Redirect” to send a placeholder or add content manually after opening in your mail client.`].join(
      '\n',
    )
    publicText = encText
    warnings.push('Body text was empty; placeholder content was generated for the new package.')
  }

  if ((row.has_attachments ?? 0) > 0) {
    warnings.push(
      'Original attachment metadata may be preserved on the message row; large binaries are not always replicated into this text bundle. If a file is missing, open the source mailbox or re-sync attachments.',
    )
  }

  return {
    publicText: publicText.slice(0, MAX_SLICE),
    encText: encText.slice(0, MAX_SLICE),
    ...(warnings.length ? { warning: warnings.join(' ') } : {}),
  }
}

/**
 * Normalized source for every inbox message (`prepareInboxMessageRedirectSource` / clone prepare).
 * Always succeeds for an existing row with an id.
 */
export function extractInboxMessageRedirectSourceFromRow(row: InboxRow | null | undefined): BeapRedirectSourceResult {
  if (!row?.id) return { ok: false, error: 'Message not found' }
  const st = String(row.source_type ?? '')
  const subject = String(row.subject ?? '').trim() || '(No subject)'

  let publicText: string
  let encText: string
  let content_warning: string | undefined

  if (inboxRowIsReceivedBeapForRedirectOrClone(row)) {
    const b = tryExtractBeapStructuredText(row)
    if (b.encText.trim()) {
      publicText = b.publicText
      encText = b.encText
      content_warning = b.warning
    } else {
      const g = extractGenericInboxText(row)
      publicText = g.publicText
      encText = g.encText
      content_warning = [b.warning, g.warning].filter(Boolean).join(' ') || g.warning
    }
  } else {
    const g = extractGenericInboxText(row)
    publicText = g.publicText
    encText = g.encText
    content_warning = g.warning
  }

  if (!encText.trim()) {
    const g = extractGenericInboxText(row)
    publicText = g.publicText
    encText = g.encText
    content_warning = g.warning
  }

  return {
    ok: true,
    message_id: row.id,
    source_type: st,
    original_handshake_id: row.handshake_id?.trim() || null,
    subject,
    public_text: publicText.slice(0, MAX_SLICE),
    encrypted_text: encText.slice(0, MAX_SLICE),
    ...(content_warning ? { content_warning } : {}),
  }
}

/** @deprecated use {@link extractInboxMessageRedirectSourceFromRow} — behavior is identical. */
export const extractBeapRedirectSourceFromRow = extractInboxMessageRedirectSourceFromRow

export const prepareInboxMessageRedirectSource = extractInboxMessageRedirectSourceFromRow
