/**
 * Visibility filter for context blocks (public/private).
 *
 * When vault is unlocked: all blocks visible.
 * When vault is locked: only public blocks visible.
 *
 * Uses the actual vault status (getStatus), not DB availability.
 * getHandshakeDb() may return a DB (Ledger/SSO) even when vault is locked.
 */

/**
 * Returns the SQL WHERE clause fragment for visibility filtering.
 *
 * When vault is unlocked: no filter (all blocks visible)
 * When vault is locked: only public blocks visible
 *
 * @param tableAlias - SQL table alias (e.g. 'cb' or 'ctx' for context_blocks)
 * @param vaultUnlocked - whether the vault is currently unlocked
 * @returns SQL fragment and params array
 */
export function visibilityWhereClause(
  tableAlias: string,
  vaultUnlocked: boolean,
): { sql: string; params: unknown[] } {
  if (vaultUnlocked) {
    return { sql: '', params: [] }
  }
  return {
    sql: ` AND ${tableAlias}.visibility = ?`,
    params: ['public'],
  }
}

/**
 * Checks if the vault is currently unlocked.
 * Works with both VaultService and getHandshakeDb patterns.
 */
export function isVaultCurrentlyUnlocked(): boolean {
  const vs = (globalThis as any).__og_vault_service_ref
  if (!vs) return false
  const status = vs.getStatus?.()
  return status?.isUnlocked === true
}
