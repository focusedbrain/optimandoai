/**
 * Account identity for vault ownership (SSO / wrdesk).
 * Authoritative pair: (owner_sub, owner_iss) plus owner_wrdesk_user_id for product routing.
 *
 * Scope (this task):
 * - Device keys: install / OS-user scoped — unchanged here.
 * - Vaults: account-scoped via persisted owner_* on registry + meta.
 * - Session: account-scoped (JWT / getCachedUserInfo).
 * - Handshake ledger: session/account-keyed (see ledger module); vault DB fallback requires active vault owner alignment.
 */

import type { SessionUserInfo } from '../../../src/auth/session'

/** Persisted on vault registry + meta JSON */
export interface VaultOwnerRecord {
  owner_wrdesk_user_id: string
  owner_sub: string
  owner_iss: string
  owner_email: string
  /** Best-effort; may be omitted in older writes */
  owner_email_verified?: boolean
  owner_claimed_at: string
  vault_schema_version: number
}

export const VAULT_OWNER_SCHEMA_VERSION = 1

export const VAULT_ACCOUNT_ERROR = {
  MISMATCH_UNLOCK: 'ERR_VAULT_ACCOUNT_MISMATCH',
  MISMATCH_ACTIVE: 'ERR_ACTIVE_VAULT_ACCOUNT_MISMATCH',
  MISMATCH_CONTEXT_PROFILE: 'ERR_VAULT_ACCOUNT_MISMATCH_CONTEXT_PROFILE',
  MISMATCH_HANDSHAKE_DB: 'ERR_VAULT_ACCOUNT_MISMATCH_HANDSHAKE_DB',
  LEGACY_REQUIRES_CLAIM: 'ERR_VAULT_LEGACY_REQUIRES_CLAIM',
} as const

export type VaultAccountErrorCode = (typeof VAULT_ACCOUNT_ERROR)[keyof typeof VAULT_ACCOUNT_ERROR]

export function getCurrentAccountIdentity(
  session: SessionUserInfo | null | undefined,
): VaultOwnerRecord | null {
  if (!session?.sub?.trim() || !session.iss?.trim()) return null
  const sub = session.sub.trim()
  const iss = session.iss.trim()
  const wr =
    (typeof session.wrdesk_user_id === 'string' && session.wrdesk_user_id.trim()) || sub
  const email = typeof session.email === 'string' ? session.email.trim() : ''
  return {
    owner_wrdesk_user_id: wr,
    owner_sub: sub,
    owner_iss: iss,
    owner_email: email,
    owner_email_verified: true,
    owner_claimed_at: new Date().toISOString(),
    vault_schema_version: VAULT_OWNER_SCHEMA_VERSION,
  }
}

export function normalizeVaultOwner(session: SessionUserInfo | null | undefined): VaultOwnerRecord | null {
  return getCurrentAccountIdentity(session)
}

function sameString(a: string | undefined | null, b: string | undefined | null): boolean {
  return (a ?? '').trim() === (b ?? '').trim()
}

/** True if persisted owner matches the current session (sub+iss+wrdesk). */
export function vaultOwnerMatchesSession(
  meta: Partial<VaultOwnerRecord> | null | undefined,
  session: SessionUserInfo | null | undefined,
): boolean {
  if (!meta?.owner_sub?.trim() || !meta.owner_iss?.trim()) return false
  const cur = getCurrentAccountIdentity(session)
  if (!cur) return false
  if (!sameString(meta.owner_sub, cur.owner_sub)) return false
  if (!sameString(meta.owner_iss, cur.owner_iss)) return false
  if (!sameString(meta.owner_wrdesk_user_id, cur.owner_wrdesk_user_id)) return false
  return true
}

export function assertVaultOwnerMatchesSession(
  meta: Partial<VaultOwnerRecord> | null | undefined,
  session: SessionUserInfo | null | undefined,
  errorCode: VaultAccountErrorCode = VAULT_ACCOUNT_ERROR.MISMATCH_UNLOCK,
): void {
  if (vaultOwnerMatchesSession(meta, session)) return
  const err = new Error(errorCode)
  ;(err as any).code = errorCode
  throw err
}

export function hasVaultOwnerMetadata(meta: Partial<VaultOwnerRecord> | null | undefined): boolean {
  return Boolean(
    meta?.owner_sub?.trim() &&
      meta?.owner_iss?.trim() &&
      (meta?.owner_wrdesk_user_id?.trim() || meta?.owner_sub?.trim()),
  )
}
