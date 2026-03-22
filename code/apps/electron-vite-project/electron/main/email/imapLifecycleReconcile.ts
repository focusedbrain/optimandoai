/**
 * IMAP lifecycle mirror repair — previously re-enqueued remote mutations from local orchestrator state.
 *
 * **Remote folder moves are disabled for IMAP** (pull + local classification only). This entry point
 * remains as a no-op so existing IPC callers do not break.
 */

export interface ImapLifecycleReconcileResult {
  ok: boolean
  enqueued: number
  skipped: number
  error?: string
}

/**
 * No-op: IMAP accounts do not enqueue server-side folder mirror operations.
 */
export function reconcileImapLifecycleFromLocalState(
  _db: any,
  _accountId: string,
  _getDb: () => Promise<any> | any,
): ImapLifecycleReconcileResult {
  return { ok: true, enqueued: 0, skipped: 0 }
}
