/**
 * Mirror hs_context_profiles.scope into the ledger handshakes table (W4-P12).
 * Classification is read without inner vault access for BEAP routing gates.
 */

import { getProfile } from '../vault/hsContextProfileService'
import { vaultService } from '../vault/service'
import { getLedgerDb } from './ledger'

export type HandshakeClassification = 'confidential' | 'non_confidential'

export type ConfidentialityScope = 'non_confidential' | 'confidential'

/**
 * Roadmap 0.16: classification fails closed. `unknown` (no ledger, no row, read error, or a
 * sync while the inner vault is locked) is never stored as such and always reads as confidential.
 */
export type ConfidentialityReading = ConfidentialityScope | 'unknown'

export function scopeToClassification(scope: ConfidentialityReading | string | null | undefined): HandshakeClassification {
  return scope === 'non_confidential' ? 'non_confidential' : 'confidential'
}

export function classificationToScope(c: HandshakeClassification): ConfidentialityScope {
  return c === 'confidential' ? 'confidential' : 'non_confidential'
}

/** Read mirrored scope from ledger handshakes (SSO-readable). */
export function readHandshakeConfidentialityScope(db: any, handshakeId: string): ConfidentialityReading {
  const id = String(handshakeId ?? '').trim()
  if (!id || !db) return 'unknown'
  try {
    const row = db
      .prepare('SELECT confidentiality_scope FROM handshakes WHERE handshake_id = ?')
      .get(id) as { confidentiality_scope?: string | null } | undefined
    const v = row?.confidentiality_scope
    return v === 'confidential' || v === 'non_confidential' ? v : 'unknown'
  } catch {
    return 'unknown'
  }
}

export function linkHandshakeProfiles(db: any, handshakeId: string, profileIds: string[]): void {
  const hid = String(handshakeId ?? '').trim()
  if (!hid || !db || !profileIds.length) return
  const insert = db.prepare(
    'INSERT OR IGNORE INTO handshake_hs_profiles (handshake_id, profile_id) VALUES (?, ?)',
  )
  for (const pid of profileIds) {
    const p = String(pid ?? '').trim()
    if (p) insert.run(hid, p)
  }
}

/**
 * Recompute handshakes.confidentiality_scope from linked profile scopes.
 *
 * Fails closed (roadmap 0.16): with linked profiles and the inner vault locked or unavailable,
 * or a linked profile that cannot be read, the result is `unknown`, and the mirror is raised to
 * `confidential` (the column has no `unknown`) — it is never lowered. Only an unlocked vault
 * that reads every linked profile can store `non_confidential`.
 */
export function syncHandshakeConfidentialityScope(
  ledgerDb: any,
  handshakeId: string,
  innerVaultDb: any | null,
): ConfidentialityReading {
  const hid = String(handshakeId ?? '').trim()
  if (!hid || !ledgerDb) return 'unknown'

  let profileIds: string[]
  try {
    const rows = ledgerDb
      .prepare('SELECT profile_id FROM handshake_hs_profiles WHERE handshake_id = ?')
      .all(hid) as Array<{ profile_id?: string }>
    profileIds = rows.map((r) => String(r.profile_id ?? '').trim()).filter(Boolean)
  } catch {
    return 'unknown'
  }

  let reading: ConfidentialityReading = 'non_confidential'
  if (profileIds.length > 0) {
    const innerUnlocked = (() => {
      try {
        return vaultService.getStatus().isUnlocked === true
      } catch {
        return false
      }
    })()
    if (!innerVaultDb || !innerUnlocked) {
      reading = 'unknown'
    } else {
      for (const pid of profileIds) {
        let profile: { scope?: string } | null | undefined
        try {
          profile = getProfile(innerVaultDb, 'publisher', pid)
        } catch {
          profile = undefined
        }
        if (profile?.scope === 'confidential') {
          reading = 'confidential'
          break
        }
        if (!profile) reading = 'unknown'
      }
    }
  }

  try {
    ledgerDb
      .prepare('UPDATE handshakes SET confidentiality_scope = ? WHERE handshake_id = ?')
      .run(reading === 'non_confidential' ? 'non_confidential' : 'confidential', hid)
  } catch {
    /* column may be absent on very old DB until migration */
  }
  return reading
}

/** After a profile scope change, refresh every linked handshake on the ledger. */
export function syncHandshakesForProfile(ledgerDb: any, innerVaultDb: any | null, profileId: string): void {
  const pid = String(profileId ?? '').trim()
  if (!pid || !ledgerDb) return
  let handshakeIds: string[] = []
  try {
    const rows = ledgerDb
      .prepare('SELECT handshake_id FROM handshake_hs_profiles WHERE profile_id = ?')
      .all(pid) as Array<{ handshake_id?: string }>
    handshakeIds = rows.map((r) => String(r.handshake_id ?? '').trim()).filter(Boolean)
  } catch {
    return
  }
  for (const hid of handshakeIds) {
    syncHandshakeConfidentialityScope(ledgerDb, hid, innerVaultDb)
  }
}

/** SSO-readable classification for BEAP routing (mirrored on ledger handshakes). */
export function getHandshakeClassification(handshakeId: string): HandshakeClassification {
  return scopeToClassification(readHandshakeConfidentialityScope(getLedgerDb(), handshakeId))
}

function resolveInnerVaultDb(): any | null {
  try {
    if (vaultService.getStatus().isUnlocked !== true) return null
    const db = (vaultService as { db?: unknown }).db
    return db ?? null
  } catch {
    return null
  }
}

/** Link profile ids on the ledger and refresh mirrored confidentiality_scope. */
export function attachHandshakeProfilesAndSyncScope(
  ledgerDb: any,
  handshakeId: string,
  profileIds: string[],
): void {
  linkHandshakeProfiles(ledgerDb, handshakeId, profileIds)
  syncHandshakeConfidentialityScope(ledgerDb, handshakeId, resolveInnerVaultDb())
}
