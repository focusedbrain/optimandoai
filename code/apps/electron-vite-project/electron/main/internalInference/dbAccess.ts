/**
 * Handshake **ledger** only — same as `getLedgerDbOrOpen` in main (Tier-1, no vault alignment gate).
 * Internal Host target discovery must not return null just because the vault is locked or
 * a different account is “active” in the vault service while SSO has already opened the ledger.
 */

import { getCachedUserInfo } from '../../../src/auth/session'
import { getCurrentSession } from '../handshake/ipc'
import { buildLedgerSessionToken, getLedgerDb, openLedger } from '../handshake/ledger'

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
      /* try SSO session */
    }
  }
  if (!db) {
    try {
      const sess = getCurrentSession()
      if (sess?.wrdesk_user_id && sess?.iss) {
        const tok = buildLedgerSessionToken(sess.wrdesk_user_id, sess.iss)
        db = await openLedger(tok)
      }
    } catch {
      /* no ledger */
    }
  }
  return db ?? null
}
