/**
 * Sync Orchestrator — Pulls emails from connected providers and routes through message detection.
 *
 * **Model (Smart Sync)**
 * - **First run** (no `last_sync_at`): pull up to `maxMessagesPerPull` (default 500) within `syncWindowDays` (default 30; **0** = all time, same cap).
 * - **Bootstrap with 0 listed / 0 new:** do **not** set `last_sync_at` so the next Pull retries the full window (avoids “stuck incremental” after a failed first list).
 * - **Auto-sync / manual Pull** (after first sync): incremental from `last_sync_at` only (new mail).
 * - **Pull More** (`pullMore: true`): next batch older than `MIN(received_at)` in DB, capped at `maxMessagesPerPull`.
 * - Providers paginate list APIs (Gmail `pageToken`, Graph `@odata.nextLink`, IMAP SEARCH + fetch chunks).
 * - **`syncPullLock`** during list+fetch prevents remote-queue moves for the same account (see `REMOTE_ORCHESTRATOR_SYNC.md`).
 *
 * @version 1.1.0
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
import { emailDebugLog, emailDebugWarn } from './emailDebug'
import { isPullActive, markPullActive, markPullInactive } from './syncPullLock'

/** Re-export for callers that already import sync orchestrator (Sync Remote clears locks via ipc → syncPullLock). */
export { clearAllPullActiveLocks } from './syncPullLock'
import { ImapProvider } from './providers/imap'
import { resolveImapPullFolders } from './domain/imapPullFolders'
import type { MessageSearchOptions, SanitizedMessage, SanitizedMessageDetail } from './types'
import { getEffectiveSyncWindowDays, getMaxMessagesPerPull } from './domain/smartSyncPrefs'
import { isLikelyEmailAuthError } from './emailAuthErrors'

// ── Types ──

export interface SyncAccountOptions {
  accountId: string
  limit?: number
  /**
   * Fetch the next batch of messages **older** than the oldest `inbox_messages.received_at` for this account.
   * @see `domain/smartSyncPrefs` for batch size.
   */
  pullMore?: boolean
  /**
   * @deprecated No longer used — manual Pull is incremental after the first Smart Sync bootstrap.
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
  /** Messages returned from provider list API in this run (before dedupe / per-message fetch). */
  listedFromProvider?: number
  /** Skipped during ingest — `email_message_id` already in `inbox_messages` for this account. */
  skippedDuplicate?: number
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
      sync_interval_ms: updates.sync_interval_ms ?? row?.sync_interval_ms ?? 300_000,
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

/** Oldest message timestamp in local inbox for this account (for Pull More upper bound). */
function getOldestInboxReceivedAtIso(db: any, accountId: string): string | null {
  if (!db) return null
  try {
    const row = db
      .prepare(
        `SELECT MIN(datetime(COALESCE(received_at, ingested_at))) AS oldest
         FROM inbox_messages WHERE account_id = ?`,
      )
      .get(accountId) as { oldest?: string | null }
    const o = row?.oldest
    if (o == null || String(o).trim() === '') return null
    return String(o)
  } catch {
    return null
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

/** Successful pulls that listed 0 messages and ingested 0 new (per account) — for stuck detection. */
const consecutiveZeroListingPulls = new Map<string, number>()

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Call from `inbox:resetSyncState` so streak does not carry over after a manual reset. */
export function clearConsecutiveZeroListingPulls(accountId: string): void {
  const id = String(accountId ?? '').trim()
  if (!id) return
  consecutiveZeroListingPulls.delete(id)
}

function notePullOutcomeForStuckDetection(
  accountId: string,
  opts: {
    ok: boolean
    /** `last_sync_at` from DB at the start of this sync run (before any update). */
    lastSyncAtBeforeRun: string | undefined
    listedFromProvider: number
    newMessages: number
  },
): void {
  const id = String(accountId ?? '').trim()
  if (!id || !opts.ok) return

  const listed = opts.listedFromProvider
  const newM = opts.newMessages
  if (listed === 0 && newM === 0) {
    const next = (consecutiveZeroListingPulls.get(id) ?? 0) + 1
    consecutiveZeroListingPulls.set(id, next)

    const anchor = opts.lastSyncAtBeforeRun
    if (anchor) {
      const t = new Date(anchor).getTime()
      if (!Number.isNaN(t) && Date.now() - t > MS_PER_DAY && next >= 3) {
        emailDebugWarn('[SYNC-DEBUG] Account may be stuck — consider resetting sync state.', {
          accountId: id,
          last_sync_at_at_start_of_run: anchor,
          consecutive_zero_listing_pulls: next,
        })
      }
    }
  } else {
    consecutiveZeroListingPulls.set(id, 0)
  }
}

/**
 * Sync emails for an account: pull from provider, deduplicate, route through message detection.
 * Serialized per `accountId` so manual Pull and auto-sync never run concurrently for the same account.
 */
export async function syncAccountEmails(db: any, options: SyncAccountOptions): Promise<SyncResult> {
  console.error('SYNC_ENTRY', options.accountId, new Date().toISOString())
  const accountId = options.accountId
  const accountEarly = emailGateway.getAccountConfig(accountId)
  console.log('[IMAP-PULL-TRACE] syncAccountEmails entry:', {
    accountId,
    provider: accountEarly?.provider,
    hasImapConfig: !!accountEarly?.imap,
    imapHost: accountEarly?.imap?.host,
    syncWindowDays: accountEarly?.sync?.syncWindowDays,
  })
  emailDebugLog(
    '[SYNC-DEBUG] syncAccountEmails invoked (serialized per account via syncChains; does not skip if pull lock active)',
    { accountId, pullMore: options.pullMore === true },
  )
  const prev = syncChains.get(accountId) ?? Promise.resolve()
  const current = prev.then(() => syncAccountEmailsImpl(db, options))
  syncChains.set(accountId, current.then(() => undefined, () => undefined))
  return current
}

async function syncAccountEmailsImpl(
  db: any,
  options: SyncAccountOptions,
): Promise<SyncResult> {
  const { accountId, pullMore = false } = options
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
    const accountCfg = emailGateway.getAccountConfig(accountId)
    const windowDays = getEffectiveSyncWindowDays(accountCfg?.sync)
    const maxPerPull = getMaxMessagesPerPull(accountCfg?.sync)

    let windowStartIso: string | undefined
    if (windowDays > 0) {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - windowDays)
      windowStartIso = d.toISOString()
    }

    const stateRow = db.prepare('SELECT * FROM email_sync_state WHERE account_id = ?').get(accountId) as Record<string, unknown> | undefined
    const lastSyncAt = stateRow?.last_sync_at as string | undefined
    const lastUid = stateRow?.last_uid as string | undefined
    const syncCursor = stateRow?.sync_cursor as string | undefined

    const hasPriorSync = Boolean(lastSyncAt)
    const bootstrap = !hasPriorSync && !pullMore

    emailDebugLog('[SYNC-DEBUG] sync prefs + DB sync state', {
      accountId,
      provider: accountCfg?.provider,
      rawAccountSync: accountCfg?.sync ?? null,
      windowDays,
      windowStartIsoForBootstrap: windowStartIso ?? '(none — all time)',
      maxPerPull,
      last_sync_at: lastSyncAt ?? null,
      hasPriorSync,
      bootstrap,
      pullMore,
    })

    let listOptions: MessageSearchOptions

    if (pullMore) {
      const oldestLocal = getOldestInboxReceivedAtIso(db, accountId)
      if (!oldestLocal) {
        emailDebugLog(
          '[SYNC-DEBUG] list fetch NOT attempted: Pull More aborted — no local messages (oldest received_at)',
          { accountId },
        )
        result.errors.push('Pull More: no local messages — run Pull first.')
        result.ok = false
        result.listedFromProvider = 0
        console.error('SYNC_RETURN_LINE_399', accountId)
        return result
      }
      const t = new Date(oldestLocal).getTime()
      if (Number.isNaN(t)) {
        result.errors.push('Pull More: invalid oldest message date in local DB.')
        result.ok = false
        result.listedFromProvider = 0
        console.error('SYNC_RETURN_LINE_407', accountId)
        return result
      }
      const beforeIso = new Date(t - 1).toISOString()
      listOptions = {
        limit: 200,
        syncFetchAllPages: true,
        syncMaxMessages: maxPerPull,
        toDate: beforeIso,
      }
    } else if (bootstrap) {
      listOptions = {
        limit: 200,
        syncFetchAllPages: true,
        syncMaxMessages: maxPerPull,
        ...(windowStartIso ? { fromDate: windowStartIso } : {}),
      }
    } else {
      /** Incremental: only messages newer than last successful sync (auto-sync + manual Pull after bootstrap). */
      listOptions = {
        limit: 200,
        syncFetchAllPages: true,
        fromDate: lastSyncAt as string,
      }
    }

    emailDebugLog('[SYNC-DEBUG] listOptions for provider listMessages', {
      accountId,
      mode: pullMore ? 'pullMore' : bootstrap ? 'bootstrap' : 'incremental',
      incrementalUsesLastSyncAt: !pullMore && !bootstrap ? (lastSyncAt as string) : null,
      fromDate: listOptions.fromDate ?? null,
      toDate: listOptions.toDate ?? null,
      syncMaxMessages: listOptions.syncMaxMessages,
    })

    /** Hold during list + per-message fetch so remote mirror cannot move mail out of INBOX mid-pull. */
    let messages: Awaited<ReturnType<typeof emailGateway.listMessages>> = []
    let skippedDuplicate = 0
    let newCount = 0
    let beapCount = 0
    let plainCount = 0
    let lastUidSeen = lastUid
    let cursorSeen = syncCursor

    emailDebugLog('[SYNC-DEBUG] SyncPullLock before list+fetch', {
      accountId,
      pullLockAlreadyActive: isPullActive(accountId),
      note: 'isPullActive only defers remote-queue moves; sync still runs',
    })
    markPullActive(accountId)
    try {
      const basePullLabels = accountCfg ? resolveImapPullFolders(accountCfg) : ['INBOX']
      const pullFolders =
        accountCfg?.provider === 'imap'
          ? await emailGateway.resolveImapPullFoldersExpanded(accountId, basePullLabels)
          : basePullLabels
      emailDebugLog('[SYNC-DEBUG] resolved IMAP pull folder list (expanded)', {
        accountId,
        basePullLabels,
        pullFolders,
        provider: accountCfg?.provider ?? 'unknown',
      })
      if (accountCfg?.provider === 'imap' && pullFolders.length > 1) {
        const merged: SanitizedMessage[] = []
        const seen = new Set<string>()
        for (const folder of pullFolders) {
          try {
            emailDebugLog('[SYNC-DEBUG] multi-folder listMessages fetch', { accountId, folder, listOptions })
            console.error('SYNC_LIST_CALL', accountId, folder)
            const part = await emailGateway.listMessages(accountId, { ...listOptions, folder })
            for (const m of part) {
              const k = `${m.folder || folder}|${m.id}`
              if (seen.has(k)) continue
              seen.add(k)
              merged.push(m)
            }
            console.log(
              `[SyncOrchestrator] IMAP list folder=${JSON.stringify(folder)} → ${part.length} message(s) (merged ${merged.length} unique)`,
            )
          } catch (folderErr: any) {
            const msg = folderErr?.message ?? String(folderErr)
            result.errors.push(`listMessages ${folder}: ${msg}`)
            console.warn('[SyncOrchestrator] IMAP folder list failed:', folder, msg)
          }
        }
        messages = merged
      } else {
        const folder = pullFolders[0] || accountCfg?.folders?.inbox || accountInfo?.folders?.inbox || 'INBOX'
        emailDebugLog('[SYNC-DEBUG] single-folder listMessages fetch', { accountId, folder, listOptions })
        console.error('SYNC_LIST_CALL', accountId, folder)
        messages = await emailGateway.listMessages(accountId, { ...listOptions, folder })
      }
      console.error('SYNC_LIST_RESULT', accountId, messages?.length)
      const existingIds = getExistingEmailMessageIds(db, accountId)
      skippedDuplicate = 0

      console.log(
        `[SyncOrchestrator] Provider returned ${messages.length} message(s) (bootstrap=${bootstrap}, pullMore=${pullMore}, fromDate=${listOptions.fromDate ?? 'none'}, toDate=${listOptions.toDate ?? 'none'}, pullFolders=${pullFolders.join(',')})`,
      )
      if (messages.length === 0) {
        emailDebugLog(
          '[SYNC-DEBUG] provider list returned 0 messages after fetch was attempted (not “skipped”) — check IMAP SEARCH/SINCE, folder path, or incremental last_sync_at window',
          { accountId, bootstrap, pullMore, last_sync_at_used: lastSyncAt ?? null },
        )
      }

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
          // Always list attachments (Gmail/Outlook APIs). Empty list is harmless; IMAP may return [] until implemented.
          try {
            const attList = await emailGateway.listAttachments(accountId, msg.id)
            console.log(
              `[SyncOrchestrator] Attachments for ${msg.id}: ${attList.length} listed (detail flags hasAttachments=${detail.hasAttachments} count=${detail.attachmentCount})`,
            )
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
          } catch (attListErr: any) {
            console.warn(
              `[SyncOrchestrator] listAttachments failed for ${msg.id}:`,
              attListErr?.message ?? attListErr,
            )
          }

          const rawMsg = mapToRawEmailMessage(detail, attachments, { provider: accountInfo?.provider })
          const routeResult = await detectAndRouteMessage(db, accountId, rawMsg)

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
    result.listedFromProvider = messages.length
    result.skippedDuplicate = skippedDuplicate

    console.log(
      `[SyncOrchestrator] Ingested ${newCount} new message(s), skipped ${skippedDuplicate} duplicate id(s) already in inbox`,
    )

    const totalSynced = (stateRow?.total_synced as number | undefined) ?? 0
    const nextLastSyncAt = new Date().toISOString()
    const skipAdvanceLastSyncAt =
      bootstrap && messages.length === 0 && newCount === 0

    if (skipAdvanceLastSyncAt) {
      emailDebugWarn(
        '[SYNC-DEBUG] Bootstrap sync returned 0 messages — NOT advancing last_sync_at so next pull retries the full window.',
        { accountId, listedFromProvider: messages.length, newMessagesIngested: newCount },
      )
    } else {
      emailDebugLog('[SYNC-DEBUG] updating last_sync_at after sync', {
        accountId,
        previous_last_sync_at: lastSyncAt ?? null,
        next_last_sync_at: nextLastSyncAt,
        listedFromProvider: messages.length,
        newMessagesIngested: newCount,
        bootstrap,
      })
    }

    const syncUpdates: EmailSyncStateUpdates = {
      ...(skipAdvanceLastSyncAt ? {} : { last_sync_at: nextLastSyncAt }),
      last_uid: lastUidSeen,
      sync_cursor: cursorSeen,
      total_synced: totalSynced + newCount,
      last_error: undefined,
      last_error_at: undefined,
    }
    updateSyncState(db, accountId, syncUpdates)

    notePullOutcomeForStuckDetection(accountId, {
      ok: true,
      lastSyncAtBeforeRun: lastSyncAt,
      listedFromProvider: messages.length,
      newMessages: newCount,
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
        const accountCfg = emailGateway.getAccountConfig(accountId)
        const isImap = accountCfg?.provider === 'imap'
        await emailGateway.updateAccount(accountId, {
          status: isImap ? 'auth_error' : 'error',
          lastError: isImap
            ? 'Authentication failed — check credentials'
            : 'Not authenticated or session expired. Reconnect this account in Email settings.',
        })
      } catch (persistErr: any) {
        console.warn('[SyncOrchestrator] Could not persist account auth state:', persistErr?.message)
      }
    }
  }

  const anyAuthErr = result.errors.some((e) => isLikelyEmailAuthError(e))
  if (anyAuthErr) {
    try {
      const accountCfg = emailGateway.getAccountConfig(accountId)
      const isImap = accountCfg?.provider === 'imap'
      await emailGateway.updateAccount(accountId, {
        status: isImap ? 'auth_error' : 'error',
        lastError: isImap
          ? 'Authentication failed — check credentials'
          : 'Not authenticated or session expired. Reconnect this account in Email settings.',
      })
    } catch (persistErr: any) {
      console.warn('[SyncOrchestrator] Could not persist account auth state (partial errors):', persistErr?.message)
    }
  } else if (result.ok) {
    try {
      const cfg = emailGateway.getAccountConfig(accountId)
      if (cfg?.status === 'auth_error') {
        await emailGateway.updateAccount(accountId, { status: 'active', lastError: undefined })
      }
    } catch {
      /* ignore */
    }
  }

  console.error('SYNC_RETURN_LINE_678', accountId)
  return result
}

/**
 * Start auto-sync polling loop for an account.
 */
export function startAutoSync(
  db: any,
  accountId: string,
  intervalMs: number = 300_000,
  onNewMessages?: (result: SyncResult) => void,
  /** Resume background remote-queue drain when bounded inline drain does not finish. */
  getDbForRemoteDrain?: () => Promise<any> | any,
): { stop: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const tick = async () => {
    try {
      console.log('[AUTO_SYNC] Tick fired for account:', accountId)
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
        await drainOrchestratorRemoteQueueBounded(
          db,
          getDbForRemoteDrain ? { getDbForDrainContinue: getDbForRemoteDrain } : undefined,
        )
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
