/**
 * Prompt 2 — optional trash on origin mailbox after local WRDesk delete (Prompt 1).
 *
 * Only runs when per-account Smart Sync (`deleteFromProviderOnLocalDelete`) is true.
 * Archive/sort provider mirror is separate and not gated on this flag — see types.ts.
 * Uses provider trash/move APIs (recoverable) — never permanent delete.
 */

import { emailGateway } from './gateway'
import { LOCAL_WRDESK_DELETE_SKIP_REASON } from './localInboxDeletion'
import {
  assessOriginDeleteCapability,
  type OriginDeleteCapability,
} from './originMailboxDeleteCapability'

const P2P_BEAP_ACCOUNT_ID = '__p2p_beap__'

export interface OriginDeleteAttemptResult {
  messageId: string
  accountId: string
  trashed: boolean
  skipped?: boolean
  skipReason?: string
  error?: string
}

export interface BulkOriginDeleteResult {
  attempted: number
  trashed: number
  skipped: number
  failed: number
  results: OriginDeleteAttemptResult[]
}

type InboxRow = {
  id: string
  account_id?: string | null
  email_message_id?: string | null
  source_type?: string | null
  imap_remote_mailbox?: string | null
  imap_rfc_message_id?: string | null
}

function isOriginDeletableRow(row: InboxRow): boolean {
  if (!row.email_message_id?.trim()) return false
  if (row.source_type === 'direct_beap') return false
  if (row.account_id === P2P_BEAP_ACCOUNT_ID) return false
  return true
}

export async function trashOnOriginAfterLocalDelete(
  db: any,
  messageIds: string[],
  options?: { originDeleteConfirmed?: boolean },
): Promise<BulkOriginDeleteResult> {
  const out: BulkOriginDeleteResult = {
    attempted: 0,
    trashed: 0,
    skipped: 0,
    failed: 0,
    results: [],
  }
  if (!db || !messageIds.length) return out

  const capabilityCache = new Map<string, OriginDeleteCapability>()

  for (const messageId of messageIds) {
    const row = db
      .prepare(
        `SELECT id, account_id, email_message_id, source_type, imap_remote_mailbox, imap_rfc_message_id
         FROM inbox_messages WHERE id = ?`,
      )
      .get(messageId) as InboxRow | undefined

    if (!row?.account_id) {
      out.skipped++
      out.results.push({
        messageId,
        accountId: '',
        trashed: false,
        skipped: true,
        skipReason: 'Message not found',
      })
      continue
    }

    const account = emailGateway.getAccountConfig(row.account_id)
    if (!account) {
      out.skipped++
      out.results.push({
        messageId,
        accountId: row.account_id,
        trashed: false,
        skipped: true,
        skipReason: 'Account not found',
      })
      continue
    }

    if (account.deleteFromProviderOnLocalDelete !== true) {
      out.skipped++
      out.results.push({
        messageId,
        accountId: row.account_id,
        trashed: false,
        skipped: true,
        skipReason: 'Per-account origin delete is off',
      })
      continue
    }

    if (!isOriginDeletableRow(row)) {
      out.skipped++
      out.results.push({
        messageId,
        accountId: row.account_id,
        trashed: false,
        skipped: true,
        skipReason: 'No origin mailbox for this message type',
      })
      continue
    }

    if (options?.originDeleteConfirmed !== true) {
      out.failed++
      out.results.push({
        messageId,
        accountId: row.account_id,
        trashed: false,
        error: 'Origin delete confirmation required',
      })
      continue
    }

    let cap = capabilityCache.get(row.account_id)
    if (!cap) {
      cap = await assessOriginDeleteCapability(account)
      capabilityCache.set(row.account_id, cap)
    }

    if (!cap.canTrashOnProvider) {
      out.failed++
      out.results.push({
        messageId,
        accountId: row.account_id,
        trashed: false,
        error: cap.blockReason ?? 'Insufficient scope for provider trash',
      })
      continue
    }

    out.attempted++
    try {
      await emailGateway.deleteMessage(row.account_id, row.email_message_id!, {
        imapRemoteMailbox: row.imap_remote_mailbox ?? null,
        imapRfcMessageId: row.imap_rfc_message_id ?? null,
      })
      const now = new Date().toISOString()
      try {
        db.prepare(
          `UPDATE inbox_messages SET remote_deleted = 1, remote_deleted_at = ?,
            lifecycle_remote_delete_skip_reason = NULL
           WHERE id = ? AND lifecycle_remote_delete_skip_reason = ?`,
        ).run(now, messageId, LOCAL_WRDESK_DELETE_SKIP_REASON)
      } catch {
        /* best-effort metadata */
      }
      out.trashed++
      out.results.push({
        messageId,
        accountId: row.account_id,
        trashed: true,
      })
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      out.failed++
      out.results.push({
        messageId,
        accountId: row.account_id,
        trashed: false,
        error: msg,
      })
    }
  }

  return out
}
