/**
 * BEAP Email Sync — Incoming Email → Ingestion Pipeline Bridge
 *
 * Periodically polls connected email accounts for new messages containing
 * BEAP capsules or message packages, extracts them, and submits them.
 *
 * Detection heuristics:
 *   - Handshake capsules: JSON with `schema_version` + `capsule_type` (initiate/accept/refresh/revoke)
 *     → ingestion-core via handleIngestionRPC
 *   - qBEAP/pBEAP message packages: JSON with `header` + `metadata` + (`envelope` or `payload`)
 *     → processBeapPackageInline (validate-before-write, sealed inbox or quarantine row)
 *
 * Non-BEAP emails are ignored. Duplicate message IDs are not reprocessed.
 */

import { processBeapPackageInline } from './beapEmailIngestion'
import type { SSOSession } from '../handshake/types'
import { handleIngestionRPC } from '../ingestion/ipc'
import type { SanitizedMessage, SanitizedMessageDetail, AttachmentMeta, ExtractedAttachmentText } from './types'
import { plainEmailToBeapMessage, enrichWithAttachments } from './plainEmailConverter'

export interface BeapSyncConfig {
  pollIntervalMs: number
  accountIds: string[]
}

export interface EmailListFn {
  (accountId: string, options?: { since?: number; limit?: number }): Promise<SanitizedMessage[]>
}

export interface EmailGetFn {
  (accountId: string, messageId: string): Promise<SanitizedMessageDetail | null>
}

export interface EmailListAttachmentsFn {
  (accountId: string, messageId: string): Promise<AttachmentMeta[]>
}

export interface EmailExtractAttachmentTextFn {
  (accountId: string, messageId: string, attachmentId: string): Promise<ExtractedAttachmentText>
}

export interface BeapSyncHandle {
  stop: () => void
}

const DEFAULT_POLL_INTERVAL_MS = 30_000

let _emailListFn: EmailListFn | null = null
let _emailGetFn: EmailGetFn | null = null
let _emailListAttachmentsFn: EmailListAttachmentsFn | null = null
let _emailExtractAttachmentTextFn: EmailExtractAttachmentTextFn | null = null

/**
 * Inject email gateway functions. Called once at app startup.
 */
export function setEmailFunctions(
  listFn: EmailListFn,
  getFn: EmailGetFn,
  listAttachmentsFn?: EmailListAttachmentsFn,
  extractAttachmentTextFn?: EmailExtractAttachmentTextFn,
): void {
  _emailListFn = listFn
  _emailGetFn = getFn
  _emailListAttachmentsFn = listAttachmentsFn ?? null
  _emailExtractAttachmentTextFn = extractAttachmentTextFn ?? null
}

/** @internal */
export function _resetEmailFunctions(): void {
  _emailListFn = null
  _emailGetFn = null
  _emailListAttachmentsFn = null
  _emailExtractAttachmentTextFn = null
}

const processedMessageIds = new Set<string>()

/**
 * Check if an email body looks like a BEAP capsule.
 */
export function detectBeapInBody(bodyText: string): { detected: boolean; capsuleJson?: string } {
  if (!bodyText || typeof bodyText !== 'string') return { detected: false }

  const trimmed = bodyText.trim()
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
    // Not valid JSON — not a BEAP capsule
  }

  return { detected: false }
}

/**
 * Check if text is a qBEAP/pBEAP message package (header + metadata + envelope/payload).
 * Unlike handshake capsules, message packages have no capsule_type.
 */
export function detectBeapMessagePackage(text: string): { detected: boolean; packageJson?: string } {
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
      // Optional tighter check: header.encoding in ['qBEAP', 'pBEAP']
      const enc = parsed.header?.encoding
      if (enc != null && !['qBEAP', 'pBEAP'].includes(enc)) return { detected: false }
      return { detected: true, packageJson: trimmed }
    }
  } catch {
    // Not valid JSON — not a BEAP message package
  }

  return { detected: false }
}

/**
 * Check if an email subject suggests it contains a BEAP capsule or message package.
 * Matches: "BEAP Handshake:" (capsules) or any subject containing "BEAP" (message packages).
 */
export function detectBeapInSubject(subject: string): boolean {
  if (typeof subject !== 'string') return false
  if (subject.includes('BEAP Handshake:')) return true
  if (subject.includes('BEAP')) return true
  return false
}

/**
 * Check if an attachment looks like a .beap capsule file.
 */
function isBeapAttachment(att: AttachmentMeta): boolean {
  if (att.filename?.toLowerCase().endsWith('.beap')) return true
  if (att.mimeType === 'application/vnd.beap+json') return true
  if (att.mimeType === 'application/x-beap') return true
  return false
}

/**
 * Check if an attachment might contain BEAP JSON (e.g. .json or application/json).
 */
function isJsonAttachment(att: AttachmentMeta): boolean {
  if (att.filename?.toLowerCase().endsWith('.json')) return true
  if (att.mimeType === 'application/json') return true
  return false
}

/**
 * Check if parsed JSON has BEAP structure (handshake capsule or message package).
 */
function detectBeapInParsedJson(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false
  const p = parsed as Record<string, unknown>
  if (p.capsule_type && typeof p.schema_version === 'number') return true
  if (p.header && typeof p.header === 'object' && (p.envelope != null || p.payload != null)) return true
  return false
}

/**
 * Process a single email message: detect BEAP capsule, submit to pipeline.
 */
export async function processEmailForBeap(
  accountId: string,
  message: SanitizedMessageDetail,
  db: any,
  ssoSession: SSOSession,
): Promise<{ submitted: boolean; result?: any; error?: string }> {
  const messageKey = `${accountId}:${message.id}`
  if (processedMessageIds.has(messageKey)) {
    return { submitted: false }
  }

  // Strategy 1: Detect BEAP handshake capsule in email body
  const detection = detectBeapInBody(message.bodyText)
  if (detection.detected && detection.capsuleJson) {
    try {
      const result = await handleIngestionRPC(
        'ingestion.ingest',
        {
          rawInput: {
            body: detection.capsuleJson,
            mime_type: 'application/vnd.beap+json',
            headers: { 'content-type': 'application/vnd.beap+json' },
          },
          sourceType: 'email',
          transportMeta: {
            channel_id: `email:${accountId}`,
            message_id: message.id,
            sender_address: message.from.email,
            recipient_address: message.to?.[0]?.email,
            mime_type: 'application/vnd.beap+json',
          },
        },
        db,
        ssoSession,
      )

      processedMessageIds.add(messageKey)
      return { submitted: true, result }
    } catch (err: any) {
      processedMessageIds.add(messageKey)
      return { submitted: false, error: err?.message ?? 'Pipeline submission failed' }
    }
  }

  // Strategy 1b: Detect qBEAP/pBEAP message package in email body — inline validate-before-write
  const msgPkgDetection = detectBeapMessagePackage(message.bodyText)
  if (msgPkgDetection.detected && msgPkgDetection.packageJson) {
    try {
      console.log('[BEAP Sync] Message package detected in email body:', {
        sender: message.from?.email,
        subject: message.subject?.slice(0, 80),
        messageId: message.id,
      })
      const handshakeId = (() => {
        try { return (JSON.parse(msgPkgDetection.packageJson) as any)?.handshake_id?.trim() || '__email_import__' } catch { return '__email_import__' }
      })()
      await processBeapPackageInline(db, msgPkgDetection.packageJson, handshakeId, {
        session: ssoSession,
        sourceType: 'email',
        transportSender: message.from?.email ?? null,
        receivedAt: new Date().toISOString(),
        transportFolder: 'email_body',
      })
      processedMessageIds.add(messageKey)
      return { submitted: true }
    } catch (err: any) {
      processedMessageIds.add(messageKey)
      return { submitted: false, error: err?.message ?? 'Failed to process message package' }
    }
  }

  // Strategy 2: Detect .beap file attachments (process ALL matching attachments)
  if (message.hasAttachments && _emailListAttachmentsFn && _emailExtractAttachmentTextFn) {
    try {
      const attachments = await _emailListAttachmentsFn(accountId, message.id)
      let anySubmitted = false
      let lastResult: any = null

      for (const att of attachments) {
        const isBeap = isBeapAttachment(att)
        const isJson = isJsonAttachment(att)
        if (!isBeap && !isJson) continue

        try {
          const extracted = await _emailExtractAttachmentTextFn(accountId, message.id, att.id)

          // Size guard before parsing — reject oversized attachments early
          if (extracted.text.length > 65536) continue

          // For JSON attachments: verify it contains BEAP structure before processing
          if (isJson && !isBeap) {
            try {
              const parsed = JSON.parse(extracted.text)
              if (!detectBeapInParsedJson(parsed)) continue
            } catch {
              continue
            }
          }

          // Try handshake capsule first (ingestion-core)
          const attDetection = detectBeapInBody(extracted.text)
          if (attDetection.detected && attDetection.capsuleJson) {
            lastResult = await handleIngestionRPC(
              'ingestion.ingest',
              {
                rawInput: {
                  body: attDetection.capsuleJson,
                  mime_type: 'application/vnd.beap+json',
                  headers: { 'content-type': 'application/vnd.beap+json' },
                  filename: att.filename,
                },
                sourceType: 'email',
                transportMeta: {
                  channel_id: `email:${accountId}`,
                  message_id: `${message.id}:attachment:${att.id}`,
                  sender_address: message.from.email,
                  recipient_address: message.to?.[0]?.email,
                  mime_type: 'application/vnd.beap+json',
                },
              },
              db,
              ssoSession,
            )
            anySubmitted = true
            continue
          }

          // Try qBEAP/pBEAP message package — inline validate-before-write
          const msgPkgDetection = detectBeapMessagePackage(extracted.text)
          if (msgPkgDetection.detected && msgPkgDetection.packageJson) {
            console.log('[BEAP Sync] Message package detected in attachment:', {
              sender: message.from?.email,
              subject: message.subject?.slice(0, 80),
              attachment: att.filename,
              messageId: message.id,
            })
            const handshakeId = (() => {
              try { return (JSON.parse(msgPkgDetection.packageJson) as any)?.handshake_id?.trim() || '__email_import__' } catch { return '__email_import__' }
            })()
            await processBeapPackageInline(db, msgPkgDetection.packageJson, handshakeId, {
              session: ssoSession,
              sourceType: 'email',
              transportSender: message.from?.email ?? null,
              receivedAt: new Date().toISOString(),
              transportFolder: 'email_attachment',
            })
            anySubmitted = true
          }
        } catch (attErr: any) {
          console.warn(`[BEAP Sync] Attachment ${att.id} processing error:`, attErr?.message)
        }
      }

      if (anySubmitted) {
        processedMessageIds.add(messageKey)
        return { submitted: true, result: lastResult }
      }
    } catch (err: any) {
      console.warn('[BEAP Sync] Attachment enumeration error:', err?.message)
    }
  }

  // Strategy 3: Plain email — no-op in this path.
  // Phase B, PR B-3: plain emails are now handled inline by detectAndRouteMessage
  // (via syncOrchestrator).  The plain_email_inbox staging table was dropped in
  // schema v65.  This function (processEmailForBeap) is called only from
  // runBeapSyncCycle, which is a legacy periodic-poll path that is no longer
  // invoked in the main sync flow (syncOrchestrator calls detectAndRouteMessage
  // directly).  Plain email deduplication is handled by the syncOrchestrator's
  // existingIds check, so no staging is needed here.
  processedMessageIds.add(messageKey)
  return { submitted: false }
}

/**
 * Run a single sync cycle: poll all configured accounts, detect BEAP, submit.
 */
export async function runBeapSyncCycle(
  accountIds: string[],
  db: any,
  ssoSession: SSOSession,
): Promise<{ processed: number; errors: string[] }> {
  if (!_emailListFn || !_emailGetFn) {
    return { processed: 0, errors: ['Email functions not configured'] }
  }

  let processed = 0
  const errors: string[] = []

  for (const accountId of accountIds) {
    try {
      const messages = await _emailListFn(accountId, { limit: 50 })

      for (const msg of messages) {
        const messageKey = `${accountId}:${msg.id}`
        if (processedMessageIds.has(messageKey)) continue

        const detail = await _emailGetFn(accountId, msg.id)
        if (!detail) {
          processedMessageIds.add(messageKey)
          continue
        }

        const result = await processEmailForBeap(accountId, detail, db, ssoSession)
        if (result.submitted) processed++
        if (result.error) errors.push(`${accountId}/${msg.id}: ${result.error}`)
      }
    } catch (err: any) {
      errors.push(`${accountId}: ${err?.message ?? 'Sync cycle error'}`)
    }
  }

  return { processed, errors }
}

/**
 * Start periodic BEAP email sync.
 *
 * Polls configured accounts at the specified interval and submits any
 * detected BEAP capsules to the ingestion pipeline.
 */
export function startBeapEmailSync(
  config: BeapSyncConfig,
  getDb: () => any,
  getSsoSession: () => SSOSession | undefined,
): BeapSyncHandle {
  const intervalMs = config.pollIntervalMs || DEFAULT_POLL_INTERVAL_MS

  const intervalId = setInterval(async () => {
    const db = getDb()
    const session = getSsoSession()
    if (!db || !session) return

    try {
      await runBeapSyncCycle(config.accountIds, db, session)
    } catch (err: any) {
      console.warn('[BEAP Sync] Cycle error:', err?.message)
    }
  }, intervalMs)

  return {
    stop() {
      clearInterval(intervalId)
    },
  }
}

/** @internal — clear processed messages set (for tests) */
export function _resetProcessedMessages(): void {
  processedMessageIds.clear()
}
