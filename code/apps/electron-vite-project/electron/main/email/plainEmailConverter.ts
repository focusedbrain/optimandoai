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
