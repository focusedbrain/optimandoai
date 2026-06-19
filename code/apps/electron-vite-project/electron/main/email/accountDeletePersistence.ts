/**
 * SQL ledger cleanup when an email account is deleted.
 * `inbox_messages` are intentionally retained (local history); lifecycle enqueue already
 * skips rows whose account_id is absent from the gateway (`no_account_config`).
 */

export type AccountLedgerPurgeResult = {
  syncStateRowDeleted: number
  queueRowsDeleted: number
}

export function purgeAccountLedgerState(db: unknown, accountId: string): AccountLedgerPurgeResult {
  const id = String(accountId ?? '').trim()
  if (!db || !id) {
    return { syncStateRowDeleted: 0, queueRowsDeleted: 0 }
  }

  let syncStateRowDeleted = 0
  let queueRowsDeleted = 0

  try {
    const row = (db as { prepare: (sql: string) => { run: (...args: unknown[]) => { changes?: number } } })
      .prepare('DELETE FROM email_sync_state WHERE account_id = ?')
      .run(id)
    syncStateRowDeleted = typeof row?.changes === 'number' ? row.changes : 0
  } catch (e) {
    console.warn('[EmailGateway] deleteAccount: email_sync_state cleanup failed:', id, e)
  }

  try {
    const row = (db as { prepare: (sql: string) => { run: (...args: unknown[]) => { changes?: number } } })
      .prepare('DELETE FROM remote_orchestrator_mutation_queue WHERE account_id = ?')
      .run(id)
    queueRowsDeleted = typeof row?.changes === 'number' ? row.changes : 0
  } catch (e) {
    console.warn('[EmailGateway] deleteAccount: remote queue cleanup failed:', id, e)
  }

  console.log(
    `[EmailGateway] deleteAccount ledger cleanup account=${id} sync_state_deleted=${syncStateRowDeleted} queue_deleted=${queueRowsDeleted} inbox_messages=retained`,
  )

  return { syncStateRowDeleted, queueRowsDeleted }
}
