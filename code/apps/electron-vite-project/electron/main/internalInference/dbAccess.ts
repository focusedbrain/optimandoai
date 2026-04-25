/**
 * Resolves the same DB surface as main `getHandshakeDb` (ledger + vault fallback)
 * without importing the nested closure from main.ts.
 */

import { getCachedUserInfo } from '../../../src/auth/session'
import { buildLedgerSessionToken, getLedgerDb, openLedger } from '../handshake/ledger'
import { vaultService } from '../vault/service'

export async function getHandshakeDbForInternalInference(): Promise<any | null> {
  let db = getLedgerDb()
  if (!db) {
    try {
      const userInfo = getCachedUserInfo()
      if (userInfo?.sub && userInfo?.iss) {
        const tok = buildLedgerSessionToken(userInfo.wrdesk_user_id || userInfo.sub, userInfo.iss)
        db = await openLedger(tok)
      }
    } catch {
      /* fall through to vault */
    }
  }
  if (!db) {
    const vs = (globalThis as any).__og_vault_service_ref
    const vdb = vs?.getDb?.() ?? vs?.db ?? null
    if (vdb && !vaultService.isActiveVaultAccountAlignedWithSession()) {
      return null
    }
    db = vdb
  }
  return db ?? null
}
