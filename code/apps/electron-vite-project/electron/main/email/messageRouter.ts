/**
 * Message Router — Detects BEAP content in incoming emails and routes to ingestion paths.
 *
 * Inserts into inbox_messages AND into p2p_pending_beap (BEAP) or plain_email_inbox (plain)
 * so existing depackaging pipelines continue to work.
 *
 * @version 1.0.0
 */

import { randomUUID } from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'
import { insertPendingP2PBeap, insertPendingPlainEmail } from '../handshake/db'
import { plainEmailToBeapMessage, enrichWithAttachments } from './plainEmailConverter'
import type { SanitizedMessageDetail } from './types'
import { emailGateway } from './gateway'

// ── Types ──

export interface RawEmailMessage {
  messageId?: string
  id?: string
  uid?: string
  /** IMAP folder the message was listed under (for remote MOVE chaining). */
  folder?: string
  headers?: { messageId?: string; inReplyTo?: string; references?: string[] }
  from: { address: string; name?: string }
  to: Array<{ address: string; name?: string }>
  cc?: Array<{ address: string; name?: string }>
  subject: string
  text?: string
  html?: string
  date: string
  attachments?: Array<{
    id?: string
    filename: string
    contentType: string
    size: number
    contentId?: string
    content?: Buffer
  }>
}

export interface DetectAndRouteResult {
  type: 'beap' | 'plain'
  messageId: string
  inboxMessageId: string
}

// ── Detection helpers (mirror beapSync logic) ──

function detectBeapCapsule(text: string): { detected: boolean; capsuleJson?: string } {
  if (!text || typeof text !== 'string') return { detected: false }
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return { detected: false }
  try {
    const parsed = JSON.parse(trimmed)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.schema_version === 'number' &&
      typeof parsed.capsule_type === 'string' &&
      ['initiate', 'accept', 'refresh', 'revoke'].includes(parsed.capsule_type)
    ) {
      return { detected: true, capsuleJson: trimmed }
    }
  } catch {
    /* not valid JSON */
  }
  return { detected: false }
}

function detectBeapMessagePackage(text: string): { detected: boolean; packageJson?: string } {
  if (!text || typeof text !== 'string') return { detected: false }
  const trimmed = text.trim()
  if (!trimmed.startsWith('{')) return { detected: false }
  try {
    const parsed = JSON.parse(trimmed)
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'header' in parsed &&
      parsed.header != null &&
      typeof parsed.header === 'object' &&
      'metadata' in parsed &&
      parsed.metadata != null &&
      typeof parsed.metadata === 'object' &&
      ('envelope' in parsed || 'payload' in parsed)
    ) {
      const enc = parsed.header?.encoding
      if (enc != null && !['qBEAP', 'pBEAP'].includes(enc)) return { detected: false }
      return { detected: true, packageJson: trimmed }
    }
  } catch {
    /* not valid JSON */
  }
  return { detected: false }
}

function detectBeapInJson(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false
  const p = parsed as Record<string, unknown>
  if (p.capsule_type && typeof p.schema_version === 'number') return true
  if (p.header && typeof p.header === 'object' && (p.envelope != null || p.payload != null)) return true
  return false
}

function isBeapAttachment(att: { filename: string; contentType?: string }): boolean {
  const fn = (att.filename || '').toLowerCase()
  const ct = (att.contentType || '').toLowerCase()
  if (fn.endsWith('.beap')) return true
  if (ct === 'application/vnd.beap+json' || ct === 'application/x-beap') return true
  return false
}

function isJsonAttachment(att: { filename: string; contentType?: string }): boolean {
  const fn = (att.filename || '').toLowerCase()
  const ct = (att.contentType || '').toLowerCase()
  if (fn.endsWith('.json')) return true
  if (ct === 'application/json') return true
  return false
}

function extractHandshakeId(parsed: Record<string, unknown>): string | null {
  const h = parsed.header as Record<string, unknown> | undefined
  if (h && typeof h.handshake_id === 'string') return h.handshake_id
  if (h && typeof h.receiver_binding === 'object') {
    const rb = h.receiver_binding as Record<string, unknown>
    if (typeof rb?.handshake_id === 'string') return rb.handshake_id
  }
  if (typeof parsed.handshake_id === 'string') return parsed.handshake_id
  return null
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'attachment'
}

// ── Attachment storage ──

function getAttachmentsBasePath(): string {
  return path.join(app.getPath('userData'), 'inbox-attachments')
}

function storeAttachment(messageId: string, attId: string, filename: string, content: Buffer): string {
  const base = getAttachmentsBasePath()
  const dir = path.join(base, messageId)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  const safeName = sanitizeFilename(filename) || 'attachment'
  const ext = path.extname(safeName) || ''
  const baseName = path.basename(safeName, ext) || 'file'
  const storagePath = path.join(dir, `${attId}_${baseName}${ext}`)
  fs.writeFileSync(storagePath, content)
  return storagePath
}

// ── Main router ──

/**
 * Value stored in `inbox_messages.email_message_id` and passed to the remote orchestrator queue.
 * - **IMAP:** must be the numeric mailbox UID (MOVE / fetch use UID). Prefer `uid`, then `id`; RFC
 *   Message-ID must live only in `headers.messageId` → `imap_rfc_message_id`.
 * - **Gmail / Microsoft:** keep provider message id (`messageId` / `id` as supplied by sync).
 */
function resolveStorageEmailMessageId(accountId: string, rawMsg: RawEmailMessage): string {
  let provider: string | null = null
  try {
    provider = emailGateway.getProviderSync(accountId)
  } catch {
    provider = null
  }

  const pick = (s: string | undefined): string | undefined => {
    const t = typeof s === 'string' ? s.trim() : ''
    return t.length > 0 ? t : undefined
  }

  if (provider === 'imap') {
    return pick(rawMsg.uid) ?? pick(rawMsg.id) ?? pick(rawMsg.messageId) ?? randomUUID()
  }

  return pick(rawMsg.messageId) ?? pick(rawMsg.id) ?? pick(rawMsg.uid) ?? randomUUID()
}

/**
 * Detect BEAP content and route to the correct ingestion path.
 * Inserts into inbox_messages and into p2p_pending_beap (BEAP) or plain_email_inbox (plain).
 */
export function detectAndRouteMessage(
  db: any,
  accountId: string,
  rawMsg: RawEmailMessage,
): DetectAndRouteResult {
  const messageId = resolveStorageEmailMessageId(accountId, rawMsg)
  const inboxMessageId = randomUUID()
  const now = new Date().toISOString()
  const receivedAt = rawMsg.date || now

  const fromAddr = rawMsg.from?.address ?? (rawMsg.from as any)?.email ?? ''
  const fromName = rawMsg.from?.name ?? null
  const toList = rawMsg.to ?? []
  const ccList = rawMsg.cc ?? []
  const toAddrs = toList.map((r) => r.address ?? (r as any).email ?? '')
  const ccAddrs = ccList.map((r) => r.address ?? (r as any).email ?? '')
  const bodyText = rawMsg.text ?? ''
  const bodyHtml = rawMsg.html ?? null
  const subject = rawMsg.subject ?? ''
  const attachments = rawMsg.attachments ?? []

  let beapPackageJson: string | null = null
  let handshakeId: string | null = null
  let detectedType: 'beap' | 'plain' = 'plain'

  // Detection priority 1: .beap file attachment or application/x-beap
  for (const att of attachments) {
    if (!isBeapAttachment(att)) continue
    const content = att.content
    if (!content || content.length === 0) continue
    const text = content.toString('utf-8')
    if (text.length > 65536) continue

    const capsule = detectBeapCapsule(text)
    if (capsule.detected && capsule.capsuleJson) {
      beapPackageJson = capsule.capsuleJson
      try {
        handshakeId = extractHandshakeId(JSON.parse(capsule.capsuleJson)) ?? '__email_import__'
      } catch {
        handshakeId = '__email_import__'
      }
      detectedType = 'beap'
      break
    }

    const pkg = detectBeapMessagePackage(text)
    if (pkg.detected && pkg.packageJson) {
      beapPackageJson = pkg.packageJson
      try {
        handshakeId = extractHandshakeId(JSON.parse(pkg.packageJson)) ?? '__email_import__'
      } catch {
        handshakeId = '__email_import__'
      }
      detectedType = 'beap'
      break
    }
  }

  // Detection priority 2: Body is handshake capsule
  if (detectedType === 'plain' && bodyText.trim().startsWith('{')) {
    const capsule = detectBeapCapsule(bodyText)
    if (capsule.detected && capsule.capsuleJson) {
      beapPackageJson = capsule.capsuleJson
      try {
        handshakeId = extractHandshakeId(JSON.parse(capsule.capsuleJson)) ?? '__email_import__'
      } catch {
        handshakeId = '__email_import__'
      }
      detectedType = 'beap'
    }
  }

  // Detection priority 3: Body is qBEAP/pBEAP message package
  if (detectedType === 'plain' && bodyText.trim().startsWith('{')) {
    const pkg = detectBeapMessagePackage(bodyText)
    if (pkg.detected && pkg.packageJson) {
      beapPackageJson = pkg.packageJson
      try {
        handshakeId = extractHandshakeId(JSON.parse(pkg.packageJson)) ?? '__email_import__'
      } catch {
        handshakeId = '__email_import__'
      }
      detectedType = 'beap'
    }
  }

  // Detection priority 4: JSON attachment with BEAP structure
  if (detectedType === 'plain') {
    for (const att of attachments) {
      if (!isJsonAttachment(att)) continue
      const content = att.content
      if (!content || content.length === 0) continue
      const text = content.toString('utf-8')
      if (text.length > 65536) continue
      try {
        const parsed = JSON.parse(text)
        if (detectBeapInJson(parsed)) {
          beapPackageJson = text
          handshakeId = extractHandshakeId(parsed) ?? '__email_import__'
          detectedType = 'beap'
          break
        }
      } catch {
        /* not valid JSON */
      }
    }
  }

  // Build inbox_messages row
  const hasAttachments = attachments.length > 0
  /** Fresh INBOX pulls must persist a non-empty mailbox — used by lifecycle observed-bucket (exact match vs configured folder names). */
  const folderRaw =
    rawMsg.folder != null && String(rawMsg.folder).trim() !== '' ? String(rawMsg.folder).trim() : 'INBOX'
  const imapRemoteMailbox = folderRaw || 'INBOX'
  const imapRfcMessageId = rawMsg.headers?.messageId?.trim() || null
  const insertInbox = db.prepare(`
    INSERT INTO inbox_messages (
      id, source_type, handshake_id, account_id, email_message_id,
      from_address, from_name, to_addresses, cc_addresses,
      subject, body_text, body_html, beap_package_json,
      has_attachments, attachment_count, received_at, ingested_at,
      imap_remote_mailbox, imap_rfc_message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  insertInbox.run(
    inboxMessageId,
    detectedType === 'beap' ? 'email_beap' : 'email_plain',
    handshakeId,
    accountId,
    messageId,
    fromAddr,
    fromName,
    JSON.stringify(toAddrs),
    JSON.stringify(ccAddrs),
    subject,
    bodyText,
    bodyHtml,
    beapPackageJson,
    hasAttachments ? 1 : 0,
    attachments.length,
    receivedAt,
    now,
    imapRemoteMailbox,
    imapRfcMessageId,
  )

  // Store attachments to disk and register in inbox_attachments
  const insertAtt = db.prepare(`
    INSERT INTO inbox_attachments (id, message_id, filename, content_type, size_bytes, content_id, storage_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `)

  for (const att of attachments) {
    const attId = att.id || randomUUID()
    let storagePath: string | null = null
    if (att.content && att.content.length > 0) {
      try {
        storagePath = storeAttachment(inboxMessageId, attId, att.filename, att.content)
      } catch (e) {
        console.warn('[MessageRouter] Failed to store attachment:', att.filename, e)
      }
    }
    insertAtt.run(
      attId,
      inboxMessageId,
      att.filename || 'attachment',
      att.contentType || 'application/octet-stream',
      att.size ?? 0,
      att.contentId ?? null,
      storagePath,
      now,
    )
  }

  if (detectedType === 'beap' && beapPackageJson) {
    insertPendingP2PBeap(db, handshakeId!, beapPackageJson)
  } else {
    // Plain email: insert into plain_email_inbox for existing pipeline
    const sanitizedDetail: SanitizedMessageDetail = {
      id: messageId,
      accountId,
      subject,
      from: { email: fromAddr, name: fromName ?? undefined },
      to: toList.map((r) => ({ email: r.address ?? (r as any).email ?? '', name: r.name })),
      cc: ccList.length ? ccList.map((r) => ({ email: r.address ?? (r as any).email ?? '', name: r.name })) : undefined,
      date: receivedAt,
      timestamp: new Date(receivedAt).getTime(),
      snippet: bodyText.slice(0, 100),
      flags: { seen: false, flagged: false, answered: false, draft: false, deleted: false, labels: [] },
      folder: 'INBOX',
      hasAttachments,
      attachmentCount: attachments.length,
      bodyText,
      bodySafeHtml: bodyHtml ?? undefined,
    }
    const plainMsg = plainEmailToBeapMessage(sanitizedDetail, accountId)
    const enrichedMsg = enrichWithAttachments(
      plainMsg,
      attachments.map((a) => ({
        id: a.id || randomUUID(),
        filename: a.filename || 'attachment',
        mimeType: a.contentType || 'application/octet-stream',
        size: a.size ?? 0,
      })),
    )
    insertPendingPlainEmail(db, accountId, messageId, JSON.stringify(enrichedMsg))
  }

  return {
    type: detectedType,
    messageId,
    inboxMessageId,
  }
}
