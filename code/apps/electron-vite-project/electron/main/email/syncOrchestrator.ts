/**
 * Sync Orchestrator — Pulls emails from connected providers and routes through message detection.
 *
 * **Model**
 * - **Manual Pull** (`inbox:syncAccount`): `fullSync: true` — lists the **entire** mailbox (no `maxAgeDays` bound);
 *   uses `syncFetchAllPages` until the provider has no more pages.
 * - **First run** (no `last_sync_at`): same as Pull (bootstrap import).
 * - **Auto-sync tick**: incremental from `last_sync_at`, same full pagination for new mail (no message-count cap).
 * - Providers paginate list APIs (Gmail `pageToken`, Graph `@odata.nextLink`, IMAP seq/SEARCH chunks).
 * - **`syncPullLock`** during list+fetch prevents remote-queue moves for the same account (see `REMOTE_ORCHESTRATOR_SYNC.md`).
 *
 * @version 1.0.0
 */

import { processPendingP2PBeapEmails } from './beapEmailIngestion'
import { processPendingPlainEmails } from './plainEmailIngestion'
import {
  drainOrchestratorRemoteQueueBounded,
  enqueueRemoteOpsForLocalLifecycleState,
  scheduleOrchestratorRemoteDrain,
} from './inboxOrchestratorRemoteQueue'
import { emailGateway } from './gateway'
import { detectAndRouteMessage, type RawEmailMessage } from './messageRouter'
import { markPullActive, markPullInactive } from './syncPullLock'
import { ImapProvider } from './providers/imap'
import type { MessageSearchOptions, SanitizedMessageDetail } from './types'

function isLikelyEmailAuthError(message: string): boolean {
  const m = (message || '').toLowerCase()
  return (
    /not authenticated|authentication failed|unauthorized|invalid_grant|invalid credentials|login failed|auth(?:orization)? failed|401|403/.test(
      m,
    ) || m.includes('eauthentication')
  )
}

// ── Types ──

export interface SyncAccountOptions {
  accountId: string
  limit?: number
  /**
   * Manual Pull: list the whole sync window on the host (subject to account `sync.maxAgeDays`),
   * not only messages newer than `last_sync_at`.
   */
  fullSync?: boolean
}

export interface SyncResult {
  ok: boolean
  newMessages: number
  beapMessages: number
  plainMessages: number
  errors: string[]
  /** `inbox_messages.id` for rows ingested in this run (for remote lifecycle mirror). */
  newInboxMessageIds: string[]
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

/**
 * One-time per account: move messages out of legacy WRDesk-* / typo lifecycle folders into canonical names.
 * Sets `email_sync_state.imap_folders_consolidated` after a successful run (connect + consolidate).
 */
async function maybeRunImapLegacyFolderConsolidation(db: any, accountId: string): Promise<void> {
  if (!db) return
  try {
    const row = db
      .prepare('SELECT imap_folders_consolidated FROM email_sync_state WHERE account_id = ?')
      .get(accountId) as { imap_folders_consolidated?: number } | undefined
    if (row?.imap_folders_consolidated === 1) return
  } catch {
    return
  }

  const cfg = emailGateway.getAccountConfig(accountId)
  if (!cfg || cfg.provider !== 'imap') return

  const p = new ImapProvider()
  try {
    console.log('[SyncOrchestrator] IMAP legacy folder consolidation (one-time) starting for account', accountId)
    await p.connect(cfg)
    await p.consolidateLifecycleFolders()
    try {
      db.prepare(
        `INSERT INTO email_sync_state (account_id, imap_folders_consolidated)
         VALUES (?, 1)
         ON CONFLICT(account_id) DO UPDATE SET imap_folders_consolidated = 1`,
      ).run(accountId)
    } catch (e: any) {
      console.warn('[SyncOrchestrator] Could not persist imap_folders_consolidated:', e?.message)
    }
    console.log('[SyncOrchestrator] IMAP legacy folder consolidation done for account', accountId)
  } catch (e: any) {
    console.warn(
      '[SyncOrchestrator] IMAP legacy folder consolidation failed (will retry on next sync):',
      e?.message || e,
    )
  } finally {
    try {
      await p.disconnect()
    } catch {
      /* ignore */
    }
  }
}

function mapToRawEmailMessage(
  detail: SanitizedMessageDetail,
  attachments: Array<{ id: string; filename: string; mimeType: string; size: number; contentId?: string; content?: Buffer }>,
  opts?: { provider?: string },
): RawEmailMessage {
  const id = detail.id
  const headerBlock =
    detail.headers?.messageId || detail.headers?.inReplyTo || detail.headers?.references
      ? {
          ...(detail.headers.messageId ? { messageId: detail.headers.messageId } : {}),
          ...(detail.headers.inReplyTo ? { inReplyTo: detail.headers.inReplyTo } : {}),
          ...(detail.headers.references ? { references: detail.headers.references } : {}),
        }
      : undefined

  const base = {
    from: { address: detail.from.email, name: detail.from.name },
    to: detail.to.map((r) => ({ address: r.email, name: r.name })),
    cc: detail.cc?.map((r) => ({ address: r.email, name: r.name })),
    subject: detail.subject ?? '',
    text: detail.bodyText,
    html: detail.bodySafeHtml,
    date: detail.date ?? new Date(detail.timestamp).toISOString(),
    folder: detail.folder || 'INBOX',
    headers: headerBlock,
    attachments: attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      contentType: a.mimeType,
      size: a.size,
      contentId: a.contentId,
      content: a.content,
    })),
  }

  /**
   * IMAP: `SanitizedMessageDetail.id` is the UID from the provider. Do **not** set top-level
   * `messageId` here — it collides with RFC Message-ID semantics in `messageRouter` and breaks MOVE.
   * RFC header stays in `headers.messageId` → `imap_rfc_message_id`.
   */
  if (opts?.provider === 'imap') {
    return {
      ...base,
      uid: id,
      id,
    }
  }

  return {
    ...base,
    messageId: id,
    id,
  }
}

// ── Per-account sync serialization (manual Pull + auto-sync ticks share one queue) ──

const syncChains = new Map<string, Promise<unknown>>()

/**
 * Sync emails for an account: pull from provider, deduplicate, route through message detection.
 * Serialized per `accountId` so manual Pull and auto-sync never run concurrently for the same account.
 */
export async function syncAccountEmails(db: any, options: SyncAccountOptions): Promise<SyncResult> {
  const accountId = options.accountId
  const prev = syncChains.get(accountId) ?? Promise.resolve()
  const current = prev.then(() => syncAccountEmailsImpl(db, options))
  syncChains.set(accountId, current.then(() => undefined, () => undefined))
  return current
}

async function syncAccountEmailsImpl(
  db: any,
  options: SyncAccountOptions,
): Promise<SyncResult> {
  const { accountId, fullSync = false } = options
  const result: SyncResult = {
    ok: true,
    newMessages: 0,
    beapMessages: 0,
    plainMessages: 0,
    errors: [],
    newInboxMessageIds: [],
  }

  try {
    const accountInfo = await emailGateway.getAccount(accountId)
    if (accountInfo?.provider === 'imap') {
      await maybeRunImapLegacyFolderConsolidation(db, accountId)
    }
    /** Default 0 = no lower date bound unless account sets sync.maxAgeDays (incremental / auto-sync window). */
    const maxAgeDays = accountInfo?.sync?.maxAgeDays ?? 0

    let oldestIso: string | undefined
    if (maxAgeDays > 0) {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - maxAgeDays)
      oldestIso = d.toISOString()
    }

    const stateRow = db.prepare('SELECT * FROM email_sync_state WHERE account_id = ?').get(accountId) as Record<string, unknown> | undefined
    const lastSyncAt = stateRow?.last_sync_at as string | undefined
    const lastUid = stateRow?.last_uid as string | undefined
    const syncCursor = stateRow?.sync_cursor as string | undefined

    const hasPriorSync = Boolean(lastSyncAt)
    const bootstrap = !hasPriorSync
    const treatAsFullImport = fullSync || bootstrap

    let effectiveFrom: string | undefined
    if (treatAsFullImport) {
      /** Manual Pull (`fullSync: true`) must list the whole mailbox — ignore account `maxAgeDays` lower bound. */
      effectiveFrom = fullSync ? undefined : oldestIso
    } else if (lastSyncAt) {
      effectiveFrom = lastSyncAt
      if (oldestIso) {
        const a = new Date(effectiveFrom).getTime()
        const b = new Date(oldestIso).getTime()
        if (!Number.isNaN(a) && !Number.isNaN(b) && a < b) {
          effectiveFrom = oldestIso
        }
      }
    } else {
      effectiveFrom = oldestIso
    }

    const listOptions: MessageSearchOptions = {
      limit: 200,
      syncFetchAllPages: true,
      // Omit syncMaxMessages — providers paginate until exhaustion (still bounded by maxAgeDays when set).
      ...(effectiveFrom ? { fromDate: effectiveFrom } : {}),
    }

    /** Hold during list + per-message fetch so remote mirror cannot move mail out of INBOX mid-pull. */
    let messages: Awaited<ReturnType<typeof emailGateway.listMessages>> = []
    let skippedDuplicate = 0
    let newCount = 0
    let beapCount = 0
    let plainCount = 0
    let lastUidSeen = lastUid
    let cursorSeen = syncCursor

    markPullActive(accountId)
    try {
      messages = await emailGateway.listMessages(accountId, listOptions)
      const existingIds = getExistingEmailMessageIds(db, accountId)
      skippedDuplicate = 0

      console.log(
        `[SyncOrchestrator] Provider returned ${messages.length} message(s) (fullSync=${treatAsFullImport}, fromDate=${effectiveFrom ?? 'none'})`,
      )

      for (const msg of messages) {
        if (existingIds.has(msg.id)) {
          skippedDuplicate++
          continue
        }

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

          const rawMsg = mapToRawEmailMessage(detail, attachments, { provider: accountInfo?.provider })
          const routeResult = detectAndRouteMessage(db, accountId, rawMsg)

          newCount++
          result.newInboxMessageIds.push(routeResult.inboxMessageId)
          if (routeResult.type === 'beap') beapCount++
          else plainCount++

          if (newCount > 0 && newCount % 50 === 0) {
            console.log(
              `[SyncOrchestrator] Progress: ${newCount} ingested, ${skippedDuplicate} dupes, ${result.errors.length} errors, ${messages.length} listed`,
            )
          }

          if ((msg as any).uid) lastUidSeen = String((msg as any).uid)
        } catch (err: any) {
          result.errors.push(`${msg.id}: ${err?.message ?? 'Unknown error'}`)
          console.error('[SyncOrchestrator] Message processing error:', msg.id, err)
        }
      }
    } finally {
      markPullInactive(accountId)
    }

    result.newMessages = newCount
    result.beapMessages = beapCount
    result.plainMessages = plainCount

    console.log(
      `[SyncOrchestrator] Ingested ${newCount} new message(s), skipped ${skippedDuplicate} duplicate id(s) already in inbox`,
    )

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
    const errMsg = err?.message ?? 'Sync failed'
    result.errors.push(errMsg)
    console.error('[SyncOrchestrator] syncAccountEmails error:', err)
    updateSyncState(db, accountId, {
      last_error: errMsg,
      last_error_at: new Date().toISOString(),
    })
    if (isLikelyEmailAuthError(errMsg)) {
      try {
        await emailGateway.updateAccount(accountId, {
          status: 'error',
          lastError: 'Not authenticated or session expired. Reconnect this account in Email settings.',
        })
      } catch (persistErr: any) {
        console.warn('[SyncOrchestrator] Could not persist account auth state:', persistErr?.message)
      }
    }
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
  /** Resume background remote-queue drain when bounded inline drain does not finish. */
  getDbForRemoteDrain?: () => Promise<any> | any,
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
      processPendingPlainEmails(db)
      processPendingP2PBeapEmails(db)
      try {
        if (result.newInboxMessageIds.length > 0) {
          enqueueRemoteOpsForLocalLifecycleState(db, result.newInboxMessageIds)
        }
        await drainOrchestratorRemoteQueueBounded(db)
        if (getDbForRemoteDrain) scheduleOrchestratorRemoteDrain(getDbForRemoteDrain)
      } catch (e: any) {
        console.warn('[SyncOrchestrator] Post-sync remote drain:', e?.message)
        if (getDbForRemoteDrain) scheduleOrchestratorRemoteDrain(getDbForRemoteDrain)
      }
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
