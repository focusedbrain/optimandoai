/**
 * Prompt 2 — role-scoped OAuth token storage (the A2 split).
 *
 * The send-client token (HOST) and the read-client token (SANDBOX) are stored in
 * SEPARATE, role-keyed files so a node operating in one role can hold only its own
 * token and can never read the other's:
 *
 *   userData/email-role-tokens/<accountId>__send.json   ← host send client
 *   userData/email-role-tokens/<accountId>__read.json   ← sandbox read client
 *
 * Each file is encrypted with the existing OS secure storage (DPAPI / Keychain /
 * libsecret) via {@link encryptOAuthTokens} — this module does NOT add a new or
 * weaker crypto path; it reuses the vetted one. There is no plaintext fallback:
 * a save throws {@link SecureStorageUnavailableError} if encryption is unavailable.
 *
 * Invariants:
 *   - INV-2 (tokens never cross the handshake): these records are NODE-LOCAL. They
 *     must NEVER be serialized into a `critical_job_*` payload. The wire-level
 *     assertion in `critical-jobs/remote/serialize.ts` rejects any token-shaped
 *     field on the wire as a defense in depth; this store is the legitimate, local
 *     home for the bytes.
 *   - INV-5 (no plaintext credentials in logs): only role/account/expiry metadata
 *     is ever logged — never `accessToken` / `refreshToken`.
 *   - Independent revocation: {@link deleteRoleScopedTokens} removes ONE role's file
 *     without touching the other, so a send client and a read client are revocable
 *     independently.
 *
 * NOTE: single-machine inert ingestion (Prompt 1) keeps using the ONE bundled
 * client persisted in `email-accounts.json` (gateway). This store is exclusively
 * for the multi-machine A2 split and does not change the single-machine path.
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import {
  encryptOAuthTokens,
  decryptOAuthTokens,
  SecureStorageUnavailableError,
  type OAuthTokens,
} from './secure-storage'

/** A2 split roles. 'all' (single-machine bundle) is NOT stored here — see file header. */
export type TokenRole = 'send' | 'read'

export interface RoleScopedTokenRecord {
  accountId: string
  role: TokenRole
  /** OAuth client id that issued this token (lets a node prove which client to revoke). */
  clientId?: string
  /** Space-joined scope string actually granted (audit / scope-isolation checks). */
  grantedScope?: string
  tokens: OAuthTokens
  savedAt: number
}

interface StoredEnvelope {
  accountId: string
  role: TokenRole
  clientId?: string
  grantedScope?: string
  savedAt: number
  /** Per-field encrypted token blob (output of {@link encryptOAuthTokens}). */
  enc: ReturnType<typeof encryptOAuthTokens>
}

let baseDirOverride: string | null = null

/** Test hook: pin the storage directory (avoids depending on Electron `app`). */
export function __setRoleTokenStoreBaseDirForTests(dir: string | null): void {
  baseDirOverride = dir
}

function baseDir(): string {
  if (baseDirOverride) return baseDirOverride
  const envDir = process.env.WRDESK_ROLE_TOKEN_DIR
  if (envDir && envDir.trim()) return envDir.trim()
  return path.join(app.getPath('userData'), 'email-role-tokens')
}

/** Filesystem-safe component (account ids are provider-issued; be defensive). */
function safeComponent(value: string): string {
  return value.replace(/[^A-Za-z0-9._@-]/g, '_')
}

function fileFor(accountId: string, role: TokenRole): string {
  return path.join(baseDir(), `${safeComponent(accountId)}__${role}.json`)
}

function ensureDir(): void {
  const dir = baseDir()
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function roleLog(...args: unknown[]): void {
  // INV-5: metadata only — callers never pass token bytes here.
  console.log('[RoleTokenStore]', ...args)
}

/**
 * Persist a role's OAuth tokens, encrypted, in its own file. Throws
 * {@link SecureStorageUnavailableError} if OS encryption is unavailable (no
 * plaintext fallback — fail closed).
 */
export function saveRoleScopedTokens(
  accountId: string,
  role: TokenRole,
  tokens: OAuthTokens,
  meta?: { clientId?: string; grantedScope?: string },
): void {
  ensureDir()
  const envelope: StoredEnvelope = {
    accountId,
    role,
    clientId: meta?.clientId,
    grantedScope: meta?.grantedScope,
    savedAt: Date.now(),
    enc: encryptOAuthTokens(tokens),
  }
  fs.writeFileSync(fileFor(accountId, role), JSON.stringify(envelope), 'utf-8')
  roleLog(`saved tokens account=${accountId} role=${role} clientId=${meta?.clientId ?? '(none)'} scope="${meta?.grantedScope ?? ''}"`)
}

/** Load and decrypt a role's tokens, or null when none stored. */
export function loadRoleScopedTokens(accountId: string, role: TokenRole): RoleScopedTokenRecord | null {
  const p = fileFor(accountId, role)
  if (!fs.existsSync(p)) return null
  try {
    const envelope = JSON.parse(fs.readFileSync(p, 'utf-8')) as StoredEnvelope
    return {
      accountId: envelope.accountId,
      role: envelope.role,
      clientId: envelope.clientId,
      grantedScope: envelope.grantedScope,
      tokens: decryptOAuthTokens(envelope.enc),
      savedAt: envelope.savedAt,
    }
  } catch (err) {
    roleLog(`load failed account=${accountId} role=${role}:`, err instanceof Error ? err.message : String(err))
    return null
  }
}

export function hasRoleScopedTokens(accountId: string, role: TokenRole): boolean {
  return fs.existsSync(fileFor(accountId, role))
}

/**
 * Revoke (delete) ONE role's stored tokens without affecting the other role.
 * Returns true if a file was removed.
 */
export function deleteRoleScopedTokens(accountId: string, role: TokenRole): boolean {
  const p = fileFor(accountId, role)
  if (!fs.existsSync(p)) return false
  fs.unlinkSync(p)
  roleLog(`revoked tokens account=${accountId} role=${role}`)
  return true
}

/**
 * Move a role's token file from one account id to another (duplicate-row cleanup).
 * No-op when the source has no token or the destination already has one for that role.
 */
export function migrateRoleScopedTokens(fromAccountId: string, toAccountId: string, role: TokenRole): boolean {
  if (fromAccountId === toAccountId) return false
  if (hasRoleScopedTokens(toAccountId, role)) {
    deleteRoleScopedTokens(fromAccountId, role)
    return false
  }
  const rec = loadRoleScopedTokens(fromAccountId, role)
  if (!rec) return false
  saveRoleScopedTokens(toAccountId, role, rec.tokens, {
    clientId: rec.clientId,
    grantedScope: rec.grantedScope,
  })
  deleteRoleScopedTokens(fromAccountId, role)
  roleLog(`migrated tokens role=${role} from=${fromAccountId} to=${toAccountId}`)
  return true
}

/** Which split roles currently hold tokens for an account (for audit/UX). */
export function listRoleScopedTokenRoles(accountId: string): TokenRole[] {
  const roles: TokenRole[] = []
  for (const role of ['send', 'read'] as const) {
    if (hasRoleScopedTokens(accountId, role)) roles.push(role)
  }
  return roles
}

export { SecureStorageUnavailableError }
