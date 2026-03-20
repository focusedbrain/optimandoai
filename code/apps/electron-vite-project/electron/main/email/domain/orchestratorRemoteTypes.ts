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
  /** Local `pending_delete = 1` (not yet grace-queue delete) */
  | 'pending_delete'

/**
 * Result of applying one remote mutation. Providers should return `skipped: true`
 * when the server already reflects the desired state (idempotent success).
 */
export interface OrchestratorRemoteApplyResult {
  ok: boolean
  /** True when remote was already in the target state or op was a no-op. */
  skipped?: boolean
  error?: string
}
