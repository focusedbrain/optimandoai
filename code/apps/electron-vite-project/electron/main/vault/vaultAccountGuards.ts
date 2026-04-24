/**
 * Central checks for using vault DB in handshake + profile paths.
 */

import type { SessionUserInfo } from '../../../src/auth/session'
import { getCachedUserInfo } from '../../../src/auth/session'
import { VAULT_ACCOUNT_ERROR, type VaultOwnerRecord } from './vaultOwnerIdentity'

/**
 * When handshake pipeline falls back to vault DB, require the unlocked vault
 * to belong to the current SSO account.
 */
export function assertVaultDbAllowedForHandshakeFallback(vaultService: {
  isActiveVaultAccountAlignedWithSession: () => boolean
}): void {
  if (!vaultService.isActiveVaultAccountAlignedWithSession()) {
    const err = new Error(VAULT_ACCOUNT_ERROR.MISMATCH_HANDSHAKE_DB)
    ;(err as any).code = VAULT_ACCOUNT_ERROR.MISMATCH_HANDSHAKE_DB
    throw err
  }
}

/**
 * Resolves current session and checks vault service active owner (if any).
 */
export function assertActiveVaultForOperation(
  vaultService: { isActiveVaultAccountAlignedWithSession: () => boolean; getStatus: () => { isUnlocked?: boolean } },
  code: (typeof VAULT_ACCOUNT_ERROR)['MISMATCH_CONTEXT_PROFILE'] | (typeof VAULT_ACCOUNT_ERROR)['MISMATCH_ACTIVE'],
): void {
  if (!getCachedUserInfo()?.sub) {
    const err = new Error(code)
    ;(err as any).code = code
    throw err
  }
  if (vaultService.getStatus?.()?.isUnlocked && !vaultService.isActiveVaultAccountAlignedWithSession()) {
    const err = new Error(code)
    ;(err as any).code = code
    throw err
  }
}

export function getSessionForVaultCheck(): SessionUserInfo | null {
  return getCachedUserInfo()
}

export function readOwnerFromVaultMeta(
  getMeta: (vaultId: string) => Partial<VaultOwnerRecord> | null,
  vaultId: string,
): Partial<VaultOwnerRecord> | null {
  return getMeta(vaultId)
}
