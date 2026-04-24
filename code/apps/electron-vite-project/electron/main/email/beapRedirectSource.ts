/**
 * Extract plaintext layers from an inbox row for BEAP redirect (new package to another handshake).
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
      /** Set when depackaging was partial (e.g. qBEAP not decrypted yet) */
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
}

/** Inbox `source_type` values that represent a received BEAP row (P2P direct or email-carried / depackaged). */
export function isReceivedBeapInboxSourceType(st: string | null | undefined): boolean {
  const t = String(st ?? '')
  return t === 'direct_beap' || t === 'email_beap'
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

/**
 * Read-only extraction for `inbox:getBeapRedirectSource`.
 */
export function extractBeapRedirectSourceFromRow(row: InboxRow | null | undefined): BeapRedirectSourceResult {
  if (!row?.id) return { ok: false, error: 'Message not found' }
  const st = String(row.source_type ?? '')
  if (!isReceivedBeapInboxSourceType(st)) {
    return {
      ok: false,
      error:
        'This row is not a received BEAP inbox message. Redirect and Sandbox clone use source types `direct_beap` or `email_beap` (including depackaged BEAP from email, stored as `email_beap`).',
    }
  }

  const subject = String(row.subject ?? '').trim() || '(No subject)'
  let publicText = ''
  let encText = ''
  let warning: string | undefined

  const dep = typeof row.depackaged_json === 'string' ? row.depackaged_json.trim() : ''
  if (dep) {
    try {
      const d = JSON.parse(dep) as Record<string, unknown>
      const fmt = typeof d.format === 'string' ? d.format : ''

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
        // pBEAP, plain, merged, or legacy — single readable body
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
    return {
      ok: false,
      error:
        'No extractable content yet. If the message is qBEAP-encrypted, pending, or not merged into the inbox, wait for decryption and sync (or open it in the extension), then try Sandbox clone or Redirect again. Plain pBEAP and depackaged `email_beap` rows need body or depackaged text.',
    }
  }

  return {
    ok: true,
    message_id: row.id,
    source_type: st,
    original_handshake_id: row.handshake_id?.trim() || null,
    subject,
    public_text: publicText.slice(0, 120_000),
    encrypted_text: encText.slice(0, 120_000),
    ...(warning ? { content_warning: warning } : {}),
  }
}
