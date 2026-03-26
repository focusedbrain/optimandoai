/**
 * Orchestrator ↔ remote mailbox sync — shared types (no provider imports).
 *
 * Local WR Desk inbox state (SQLite) is authoritative for UI. These operations
 * describe **best-effort** remote mutations that mirror lifecycle transitions.
 */

/** Mirrors local orchestrator lifecycle buckets (not arbitrary sort_category strings). */
export type OrchestratorRemoteOperation =
  | 'archive'
  /** Local `sort_category = pending_review` */
  | 'pending_review'
  /** Local `sort_category = urgent` */
  | 'urgent'
  /** Local `pending_delete = 1` (not yet grace-queue delete) */
  | 'pending_delete'

/** Optional IMAP locate context (from `inbox_messages`) — enables chained MOVE across mailboxes. */
export interface OrchestratorRemoteApplyContext {
  imapRemoteMailbox?: string | null
  imapRfcMessageId?: string | null
}

/**
 * Result of applying one remote mutation. Providers should return `skipped: true`
 * only when the server already reflects the desired state (verified idempotency).
 */
export interface OrchestratorRemoteApplyResult {
  ok: boolean
  /** True when remote was already in the target state or op was a no-op. */
  skipped?: boolean
  error?: string
  /** After a successful IMAP MOVE, UID in the destination mailbox (UID changes per folder). */
  imapUidAfterMove?: string
  /** IMAP mailbox path (same string used for OPEN/MOVE) after success. */
  imapMailboxAfterMove?: string
}
