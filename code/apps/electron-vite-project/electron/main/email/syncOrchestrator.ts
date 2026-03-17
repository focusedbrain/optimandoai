/**
 * Sync Orchestrator — Pulls emails from connected providers and routes through message detection.
 *
 * @version 1.0.0
 */

import { emailGateway } from './gateway'
import { detectAndRouteMessage, type RawEmailMessage } from './messageRouter'
import type { SanitizedMessageDetail } from './types'

// ── Types ──

export interface SyncAccountOptions {
  accountId: string
  limit?: number
  fullSync?: boolean
}

export interface SyncResult {
  ok: boolean
  newMessages: number
  beapMessages: number
  plainMessages: number
  errors: string[]
}

export interface EmailSyncStateUpdates {
  last_sync_at?: string
  last_uid?: string
  sync_cursor?: string
  total_synced?: number
  last_error?: string
  last_error_at?: string
  auto_sync_enabled?: number
  sync_interval_ms?: number
}

// ── Helpers ──

/**
 * Upsert email_sync_state row for an account.
 */
export function updateSyncState(db: any, accountId: string, updates: EmailSyncStateUpdates): void {
  if (!db) return
  try {
    const now = new Date().toISOString()
    const row = db.prepare('SELECT * FROM email_sync_state WHERE account_id = ?').get(accountId) as Record<string, unknown> | undefined

    const merged = {
      account_id: accountId,
      last_sync_at: updates.last_sync_at ?? row?.last_sync_at ?? null,
      last_uid: updates.last_uid ?? row?.last_uid ?? null,
      sync_cursor: updates.sync_cursor ?? row?.sync_cursor ?? null,
      auto_sync_enabled: updates.auto_sync_enabled ?? row?.auto_sync_enabled ?? 0,
      sync_interval_ms: updates.sync_interval_ms ?? row?.sync_interval_ms ?? 30000,
      total_synced: updates.total_synced ?? row?.total_synced ?? 0,
      last_error: updates.last_error ?? row?.last_error ?? null,
      last_error_at: updates.last_error_at ?? row?.last_error_at ?? null,
    }

    db.prepare(
      `INSERT INTO email_sync_state (account_id, last_sync_at, last_uid, sync_cursor, auto_sync_enabled, sync_interval_ms, total_synced, last_error, last_error_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         last_sync_at = excluded.last_sync_at,
         last_uid = excluded.last_uid,
         sync_cursor = excluded.sync_cursor,
         auto_sync_enabled = excluded.auto_sync_enabled,
         sync_interval_ms = excluded.sync_interval_ms,
         total_synced = excluded.total_synced,
         last_error = excluded.last_error,
         last_error_at = excluded.last_error_at`
    ).run(
      merged.account_id,
      merged.last_sync_at,
      merged.last_uid,
      merged.sync_cursor,
      merged.auto_sync_enabled,
      merged.sync_interval_ms,
      merged.total_synced,
      merged.last_error,
      merged.last_error_at,
    )
  } catch (e) {
    console.error('[SyncOrchestrator] updateSyncState error:', (e as Error)?.message)
  }
}

function getExistingEmailMessageIds(db: any, accountId: string): Set<string> {
  if (!db) return new Set()
  try {
    const rows = db.prepare(
      'SELECT email_message_id FROM inbox_messages WHERE account_id = ? AND email_message_id IS NOT NULL'
    ).all(accountId) as Array<{ email_message_id: string }>
    return new Set(rows.map((r) => r.email_message_id))
  } catch {
    return new Set()
  }
}

function mapToRawEmailMessage(
  detail: SanitizedMessageDetail,
  attachments: Array<{ id: string; filename: string; mimeType: string; size: number; contentId?: string; content?: Buffer }>,
): RawEmailMessage {
  return {
    messageId: detail.id,
    id: detail.id,
    from: { address: detail.from.email, name: detail.from.name },
    to: detail.to.map((r) => ({ address: r.email, name: r.name })),
    cc: detail.cc?.map((r) => ({ address: r.email, name: r.name })),
    subject: detail.subject ?? '',
    text: detail.bodyText,
    html: detail.bodySafeHtml,
    date: detail.date ?? new Date(detail.timestamp).toISOString(),
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      contentType: a.mimeType,
      size: a.size,
      contentId: a.contentId,
      content: a.content,
    })),
  }
}

// ── Main exports ──

/**
 * Sync emails for an account: pull from provider, deduplicate, route through message detection.
 */
export async function syncAccountEmails(
  db: any,
  options: SyncAccountOptions,
): Promise<SyncResult> {
  const { accountId, limit = 50, fullSync = false } = options
  const result: SyncResult = { ok: true, newMessages: 0, beapMessages: 0, plainMessages: 0, errors: [] }

  try {
    const stateRow = db.prepare('SELECT * FROM email_sync_state WHERE account_id = ?').get(accountId) as Record<string, unknown> | undefined
    const lastSyncAt = stateRow?.last_sync_at as string | undefined
    const lastUid = stateRow?.last_uid as string | undefined
    const syncCursor = stateRow?.sync_cursor as string | undefined

    const listOptions: { limit: number; fromDate?: string } = { limit }
    if (!fullSync && lastSyncAt) {
      listOptions.fromDate = lastSyncAt
    }

    const messages = await emailGateway.listMessages(accountId, listOptions)
    const existingIds = getExistingEmailMessageIds(db, accountId)

    let newCount = 0
    let beapCount = 0
    let plainCount = 0
    let lastUidSeen = lastUid
    let cursorSeen = syncCursor

    for (const msg of messages) {
      if (existingIds.has(msg.id)) continue

      try {
        const detail = await emailGateway.getMessage(accountId, msg.id)
        if (!detail) {
          result.errors.push(`Could not fetch message ${msg.id}`)
          continue
        }

        const attachments: Array<{ id: string; filename: string; mimeType: string; size: number; contentId?: string; content?: Buffer }> = []
        if (detail.hasAttachments && detail.attachmentCount) {
          const attList = await emailGateway.listAttachments(accountId, msg.id)
          for (const att of attList) {
            let content: Buffer | undefined
            try {
              const buf = await emailGateway.fetchAttachmentBuffer(accountId, msg.id, att.id)
              if (buf) content = buf
            } catch {
              // Non-fatal: attachment without content still gets registered
            }
            attachments.push({
              id: att.id,
              filename: att.filename,
              mimeType: att.mimeType,
              size: att.size,
              contentId: att.contentId,
              content,
            })
          }
        }

        const rawMsg = mapToRawEmailMessage(detail, attachments)
        const routeResult = detectAndRouteMessage(db, accountId, rawMsg)

        newCount++
        if (routeResult.type === 'beap') beapCount++
        else plainCount++

        if ((msg as any).uid) lastUidSeen = String((msg as any).uid)
      } catch (err: any) {
        result.errors.push(`${msg.id}: ${err?.message ?? 'Unknown error'}`)
        console.error('[SyncOrchestrator] Message processing error:', msg.id, err)
      }
    }

    result.newMessages = newCount
    result.beapMessages = beapCount
    result.plainMessages = plainCount

    const totalSynced = (stateRow?.total_synced as number | undefined) ?? 0
    updateSyncState(db, accountId, {
      last_sync_at: new Date().toISOString(),
      last_uid: lastUidSeen,
      sync_cursor: cursorSeen,
      total_synced: totalSynced + newCount,
      last_error: undefined,
      last_error_at: undefined,
    })
  } catch (err: any) {
    result.ok = false
    result.errors.push(err?.message ?? 'Sync failed')
    console.error('[SyncOrchestrator] syncAccountEmails error:', err)
    updateSyncState(db, accountId, {
      last_error: err?.message ?? 'Sync failed',
      last_error_at: new Date().toISOString(),
    })
  }

  return result
}

/**
 * Start auto-sync polling loop for an account.
 */
export function startAutoSync(
  db: any,
  accountId: string,
  intervalMs: number = 30_000,
  onNewMessages?: (result: SyncResult) => void,
): { stop: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const tick = async () => {
    try {
      const row = db.prepare('SELECT auto_sync_enabled FROM email_sync_state WHERE account_id = ?').get(accountId) as { auto_sync_enabled?: number } | undefined
      if (row?.auto_sync_enabled !== 1) {
        scheduleNext()
        return
      }

      const result = await syncAccountEmails(db, { accountId })
      if (result.newMessages > 0 && onNewMessages) {
        onNewMessages(result)
      }
    } catch (err: any) {
      console.error('[SyncOrchestrator] Auto-sync tick error:', err?.message)
    }
    scheduleNext()
  }

  const scheduleNext = () => {
    timeoutId = setTimeout(tick, intervalMs)
  }

  tick()

  return {
    stop() {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
    },
  }
}
