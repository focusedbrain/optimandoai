/**
 * BEAP Email Sync — Incoming Email → Ingestion Pipeline Bridge
 *
 * Periodically polls connected email accounts for new messages containing
 * BEAP capsules, extracts them, and submits them to the ingestion pipeline.
 *
 * Detection heuristics (in order):
 *   1. Subject contains "BEAP Handshake:" (from our email transport)
 *   2. Body parses as JSON with `schema_version` + `capsule_type` at top level
 *
 * Non-BEAP emails are ignored. Duplicate message IDs are not reprocessed.
 */

import type { SSOSession } from '../handshake/types'
import { handleIngestionRPC } from '../ingestion/ipc'
import type { SanitizedMessage, SanitizedMessageDetail } from './types'

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

export interface BeapSyncHandle {
  stop: () => void
}

const DEFAULT_POLL_INTERVAL_MS = 30_000

let _emailListFn: EmailListFn | null = null
let _emailGetFn: EmailGetFn | null = null

/**
 * Inject email gateway functions. Called once at app startup.
 */
export function setEmailFunctions(listFn: EmailListFn, getFn: EmailGetFn): void {
  _emailListFn = listFn
  _emailGetFn = getFn
}

/** @internal */
export function _resetEmailFunctions(): void {
  _emailListFn = null
  _emailGetFn = null
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
 * Check if an email subject suggests it contains a BEAP capsule.
 */
export function detectBeapInSubject(subject: string): boolean {
  return typeof subject === 'string' && subject.includes('BEAP Handshake:')
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

  const detection = detectBeapInBody(message.bodyText)
  if (!detection.detected || !detection.capsuleJson) {
    processedMessageIds.add(messageKey)
    return { submitted: false }
  }

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

        const isCandidate = detectBeapInSubject(msg.subject)
        if (!isCandidate) {
          processedMessageIds.add(messageKey)
          continue
        }

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
