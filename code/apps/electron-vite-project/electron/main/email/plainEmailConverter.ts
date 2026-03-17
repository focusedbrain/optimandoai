/**
 * Plain Email → BeapMessage Converter
 *
 * Converts plain (non-BEAP) emails into depackaged BeapMessages per Canon §6
 * "Handling of Unstamped Emails". Resulting messages have trustLevel 'depackaged',
 * handshakeId null, and appear with ✉️ icon in the AI inbox.
 *
 * @version 1.0.0
 */

import type { SanitizedMessageDetail } from './types'

/** Output shape matches BeapMessage for addPlainEmailMessage. */
export interface PlainEmailBeapMessage {
  messageId: string
  senderFingerprint: string
  senderEmail: string
  senderDisplayName?: string
  handshakeId: null
  encoding: 'none'
  trustLevel: 'depackaged'
  messageBody: string
  canonicalContent: string
  attachments: Array<{
    attachmentId: string
    filename: string
    mimeType: string
    sizeBytes: number
    semanticContent?: string
    selected: boolean
  }>
  automationTags: string[]
  /** Matches ProcessingEventOffer: LOCAL semantic allows AI classification. */
  processingEvents: {
    schemaVersion: string
    declarations: Array<{
      class: 'semantic' | 'actuating'
      boundary: string
      scope: string
      retention: string
    }>
  }
  timestamp: number
  receivedAt: number
  isRead: boolean
  urgency: 'normal'
  archived: boolean
  accountId: string
  emailMessageId: string
  subject: string
}

/**
 * Deterministic hash of sender email for grouping.
 * Uses a simple hash for display; not cryptographically secure.
 */
function hashSenderEmail(email: string): string {
  let h = 0
  const s = (email || '').toLowerCase().trim()
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(16).padStart(8, '0').toUpperCase()
}

/**
 * Strip HTML tags and extract text content.
 * Handles basic HTML; for complex multipart, prefer text/plain when available.
 */
function stripHtml(html: string): string {
  if (!html || typeof html !== 'string') return ''
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract #hashtag-style tags from subject and body.
 */
function extractAutomationTags(subject: string, body: string): string[] {
  const text = `${subject} ${body}`
  const matches = text.match(/#[a-zA-Z0-9_-]+/g) ?? []
  return [...new Set(matches)]
}

/**
 * Convert a plain email into a BeapMessage-compatible object.
 *
 * @param email - Sanitized email detail (from, to, subject, body, attachments)
 * @param accountId - Email account ID
 * @returns Serializable object matching addPlainEmailMessage input
 */
export function plainEmailToBeapMessage(
  email: SanitizedMessageDetail,
  accountId: string,
): PlainEmailBeapMessage {
  const now = Date.now()
  const bodyText = email.bodyText?.trim() || stripHtml(email.bodySafeHtml || '') || ''
  const senderEmail = email.from?.email || ''
  const senderFingerprint = hashSenderEmail(senderEmail)

  // Unique message ID: accountId:emailId (email.id is unique per account)
  const messageId = `plain:${accountId}:${email.id}`.replace(/[^a-zA-Z0-9_-]/g, '_')

  const attachments = (email.hasAttachments && email.attachmentCount)
    ? [] // v1.0: attachment metadata populated below if listAttachments available
    : []

  return {
    messageId,
    senderFingerprint,
    senderEmail,
    senderDisplayName: email.from?.name,
    handshakeId: null,
    encoding: 'none',
    trustLevel: 'depackaged',
    messageBody: bodyText,
    canonicalContent: bodyText,
    attachments,
    automationTags: extractAutomationTags(email.subject || '', bodyText),
    processingEvents: {
      schemaVersion: '1.0',
      senderIntentOnly: true,
      declarations: [
        { class: 'semantic', boundary: 'LOCAL', scope: 'FULL', providers: [], retention: 'NONE' },
        { class: 'actuating', boundary: 'NONE', scope: 'MINIMAL', providers: [], retention: 'NONE' },
      ],
    },
    timestamp: email.timestamp || now,
    receivedAt: now,
    isRead: false,
    urgency: 'normal',
    archived: false,
    accountId,
    emailMessageId: email.id,
    subject: email.subject || '',
  }
}

/**
 * BEAP-compatible depackaged structure for inbox_messages.depackaged_json.
 * Used by plainEmailIngestion when processing plain_email_inbox.
 */
export interface PlainEmailDepackagedFormat {
  schema_version: string
  format: 'plain_email_converted'
  header: {
    message_id: string
    from: string | { address: string; name?: string }
    to: string[] | Array<{ address: string; name?: string }>
    cc?: string[] | Array<{ address: string; name?: string }>
    subject: string
    date: string
  }
  body: { text: string; html?: string }
  attachments: Array<{ filename: string; content_type: string; size: number; content_id?: string }>
  metadata: { converted_at: string; source: 'plain_email' }
}

/**
 * Convert raw message (PlainEmailBeapMessage or RawEmailMessage-like) to BEAP-compatible
 * depackaged format for inbox_messages.depackaged_json.
 */
export function convertPlainToBeapFormat(rawMsg: unknown): PlainEmailDepackagedFormat {
  const now = new Date().toISOString()
  const empty = {
    schema_version: '1.0.0',
    format: 'plain_email_converted' as const,
    header: {
      message_id: '',
      from: '',
      to: [] as string[],
      cc: [] as string[],
      subject: '',
      date: now,
    },
    body: { text: '', html: undefined as string | undefined },
    attachments: [] as Array<{ filename: string; content_type: string; size: number; content_id?: string }>,
    metadata: { converted_at: now, source: 'plain_email' as const },
  }

  if (!rawMsg || typeof rawMsg !== 'object') return empty
  const m = rawMsg as Record<string, unknown>

  // PlainEmailBeapMessage shape (from messageRouter / beapSync)
  if (typeof m.emailMessageId === 'string' || typeof m.messageId === 'string') {
    const msgId = (m.emailMessageId as string) || (m.messageId as string) || ''
    const from = (m.senderEmail as string) || ''
    const subject = (m.subject as string) || ''
    const bodyText = (m.messageBody as string) || (m.canonicalContent as string) || ''
    const timestamp = typeof m.timestamp === 'number' ? m.timestamp : Date.now()
    const atts = (m.attachments as Array<{ filename?: string; mimeType?: string; sizeBytes?: number; attachmentId?: string }>) || []
    return {
      schema_version: '1.0.0',
      format: 'plain_email_converted',
      header: {
        message_id: msgId,
        from,
        to: [],
        cc: [],
        subject,
        date: new Date(timestamp).toISOString(),
      },
      body: { text: bodyText },
      attachments: atts.map((a) => ({
        filename: a.filename || 'attachment',
        content_type: a.mimeType || 'application/octet-stream',
        size: a.sizeBytes ?? 0,
        content_id: a.attachmentId,
      })),
      metadata: { converted_at: now, source: 'plain_email' },
    }
  }

  // RawEmailMessage-like shape (from, to, subject, text, html, attachments)
  const fromObj = m.from as { address?: string; email?: string; name?: string } | undefined
  const fromAddr = fromObj?.address ?? fromObj?.email ?? ''
  const toList = (m.to as Array<{ address?: string; email?: string }>) || []
  const ccList = (m.cc as Array<{ address?: string; email?: string }>) || []
  const toAddrs = toList.map((r) => r?.address ?? r?.email ?? '')
  const ccAddrs = ccList.map((r) => r?.address ?? r?.email ?? '')
  const msgId = (m.messageId ?? m.id ?? m.uid ?? '') as string
  const date = (m.date as string) || now
  const atts = (m.attachments as Array<{ filename?: string; contentType?: string; size?: number; contentId?: string }>) || []

  return {
    schema_version: '1.0.0',
    format: 'plain_email_converted',
    header: {
      message_id: String(msgId),
      from: fromAddr,
      to: toAddrs,
      cc: ccAddrs,
      subject: (m.subject as string) || '',
      date: typeof date === 'string' ? date : now,
    },
    body: {
      text: (m.text as string) || '',
      html: (m.html as string) || undefined,
    },
    attachments: atts.map((a) => ({
      filename: a.filename || 'attachment',
      content_type: a.contentType || 'application/octet-stream',
      size: a.size ?? 0,
      content_id: a.contentId,
    })),
    metadata: { converted_at: now, source: 'plain_email' },
  }
}

/**
 * Enrich with attachment metadata when available.
 * Call this after listAttachments if the email has attachments.
 */
export function enrichWithAttachments(
  msg: PlainEmailBeapMessage,
  attachments: Array<{ id: string; filename: string; mimeType: string; size: number }>,
): PlainEmailBeapMessage {
  return {
    ...msg,
    attachments: attachments.map((a) => ({
      attachmentId: a.id,
      filename: a.filename || 'attachment',
      mimeType: a.mimeType || 'application/octet-stream',
      sizeBytes: a.size || 0,
      selected: false,
    })),
  }
}
