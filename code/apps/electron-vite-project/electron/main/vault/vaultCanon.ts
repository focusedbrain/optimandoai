/**
 * Canonical vault vocabulary.
 *
 * The codebase has historical comments and identifiers that invert the
 * design's outer/inner naming.  This module is the single source of truth
 * for what "outer" and "inner" mean.
 *
 *   Outer vault = SSO-derived ledger (handshake-ledger.db).
 *     Opens on SSO login via HMAC of the session token.
 *     Closes on SSO logout.  Required for general BEAP operations and
 *     non-confidential handshake data.
 *
 *   Inner vault = vaultService (master-password VMK session).
 *     Opens when the user enters their master password.
 *     Required only for confidential data: passwords stored in the vault,
 *     handshakes/messages marked confidential, etc.
 *
 *   HA Mode is a separate IPC restriction tier over the inner vault.
 *   Out of scope for this module.
 *
 * Legacy code may still use the inverted names "outer vault" to mean
 * vaultService or "inner vault" to mean HA Mode.  Do not propagate those
 * uses — import from this module instead.
 */

import { getLedgerDb } from '../handshake/ledger'
import { vaultService } from './rpc'

/** True when the SSO-derived ledger is open (outer vault active). */
export function isOuterVaultActive(): boolean {
  return getLedgerDb() != null
}

/**
 * Returns the SSO-derived ledger DB handle when active, else null.
 * The returned value is typed `any` to match the rest of the codebase,
 * which uses better-sqlite3 instances without importing the type.
 */
export function getOuterVaultDb(): any | null {
  return getLedgerDb()
}

/** True when the master-password VMK session is unlocked (inner vault open). */
export function isInnerVaultUnlocked(): boolean {
  try {
    return vaultService.getStatus().isUnlocked === true
  } catch {
    return false
  }
}

/**
 * Returns the inner vault DB handle (vaultService's SQLite connection) when
 * the vault is unlocked, else null.
 * Uses the private `db` field via an `any` cast — the field is inaccessible
 * through the public API when locked, which is the correct behaviour.
 */
export function getInnerVaultDb(): any | null {
  try {
    const vs = vaultService as any
    return vs.db ?? null
  } catch {
    return null
  }
}

export interface VaultStatusReport {
  outerActive: boolean
  innerUnlocked: boolean
  /** Reason hints for diagnostics; do not parse for control flow. */
  reasonHints: string[]
}

/** Snapshot of both vault layers for diagnostic logging. */
export function getVaultStatusReport(): VaultStatusReport {
  const outer = isOuterVaultActive()
  const inner = isInnerVaultUnlocked()
  const hints: string[] = []
  if (!outer) hints.push('outer_inactive')
  if (!inner) hints.push('inner_locked')
  return {
    outerActive: outer,
    innerUnlocked: inner,
    reasonHints: hints,
  }
}
