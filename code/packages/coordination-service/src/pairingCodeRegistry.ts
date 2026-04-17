/**
 * Coordination Service — Pairing-code registry
 *
 * Maps a per-user 6-digit pairing code (string of decimal digits, e.g. "482917")
 * to the device's `instance_id` for handshake routing.
 *
 * Scope:
 *   - Codes are unique per (user_id, pairing_code).
 *   - A device (user_id, instance_id) "owns" at most one code at a time —
 *     `registerPairingCode` removes any prior code for the same device before
 *     inserting the new one. This is what makes regeneration invalidate the
 *     old code.
 *   - Cross-user collisions are allowed: two different users may both hold
 *     the code "482917"; lookups are always scoped to `user_id`.
 *
 * Persistence: same SQLite store as `handshakeRegistry`.
 */

import type { StoreAdapter } from './store.js'

export interface PairingCodeEntry {
  user_id: string
  pairing_code: string
  instance_id: string
  device_name: string
  created_at: string
}

/** Result of `registerPairingCode`. */
export type RegisterResult =
  | { status: 'inserted' }
  | { status: 'idempotent' }
  | { status: 'collision' }

export interface PairingCodeRegistryAdapter {
  /**
   * Register a code for a device.
   *
   *   - If `(user_id, pairing_code)` is unused → insert and return `'inserted'`.
   *   - If it already maps to the same `instance_id` → return `'idempotent'`
   *     (no row changes; created_at preserved).
   *   - If it maps to a different `instance_id` → return `'collision'`.
   *
   * On insert, any prior `(user_id, *)` rows for this `instance_id` are
   * removed first inside a single transaction so a device only owns one code.
   */
  registerPairingCode(
    userId: string,
    instanceId: string,
    pairingCode: string,
    deviceName: string,
  ): RegisterResult

  /** Resolve a code within a user's scope, or `null` if no match. */
  resolvePairingCode(userId: string, pairingCode: string): PairingCodeEntry | null

  /** @internal exposed for tests / diagnostics. */
  getCodesForUser(userId: string): PairingCodeEntry[]
}

const DIGIT_RE = /^[0-9]{6}$/

export function createPairingCodeRegistry(store: StoreAdapter): PairingCodeRegistryAdapter {
  return {
    registerPairingCode(
      userId: string,
      instanceId: string,
      pairingCode: string,
      deviceName: string,
    ): RegisterResult {
      if (!userId.trim() || !instanceId.trim() || !DIGIT_RE.test(pairingCode)) {
        // Caller is expected to validate; treat malformed input as a hard
        // collision so callers don't accidentally insert junk.
        return { status: 'collision' }
      }

      const db = store.getDb()
      const now = new Date().toISOString()

      const existing = db
        .prepare(
          `SELECT user_id, pairing_code, instance_id, device_name, created_at
           FROM coordination_pairing_codes
           WHERE user_id = ? AND pairing_code = ?`,
        )
        .get(userId, pairingCode) as PairingCodeEntry | undefined

      if (existing) {
        if (existing.instance_id === instanceId) {
          // Idempotent re-register for the same device. Keep created_at as-is
          // but refresh device_name in case it was renamed.
          if (existing.device_name !== deviceName) {
            db.prepare(
              `UPDATE coordination_pairing_codes
               SET device_name = ?
               WHERE user_id = ? AND pairing_code = ?`,
            ).run(deviceName, userId, pairingCode)
          }
          return { status: 'idempotent' }
        }
        return { status: 'collision' }
      }

      const tx = db.transaction(() => {
        db.prepare(
          `DELETE FROM coordination_pairing_codes
           WHERE user_id = ? AND instance_id = ?`,
        ).run(userId, instanceId)

        db.prepare(
          `INSERT INTO coordination_pairing_codes
             (user_id, pairing_code, instance_id, device_name, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(userId, pairingCode, instanceId, deviceName, now)
      })
      tx()
      return { status: 'inserted' }
    },

    resolvePairingCode(userId: string, pairingCode: string): PairingCodeEntry | null {
      if (!userId.trim() || !DIGIT_RE.test(pairingCode)) return null
      const db = store.getDb()
      const row = db
        .prepare(
          `SELECT user_id, pairing_code, instance_id, device_name, created_at
           FROM coordination_pairing_codes
           WHERE user_id = ? AND pairing_code = ?`,
        )
        .get(userId, pairingCode) as PairingCodeEntry | undefined
      return row ?? null
    },

    getCodesForUser(userId: string): PairingCodeEntry[] {
      const db = store.getDb()
      return db
        .prepare(
          `SELECT user_id, pairing_code, instance_id, device_name, created_at
           FROM coordination_pairing_codes
           WHERE user_id = ?
           ORDER BY created_at ASC`,
        )
        .all(userId) as PairingCodeEntry[]
    },
  }
}
