/**
 * Coordination Service — Handshake registry
 * Tracks which handshakes exist and who can send.
 * Authoritative state lives in storage adapter.
 *
 * Identity binding is full-claim [VII.3.8–3.10] via the shared guard
 * (@repo/ingestion-core): each principal side is bound as (sub, iss). Legacy
 * rows without a recorded issuer keep working on sub alone and lazily bind
 * their issuer on the next register-handshake from that principal ("re-register
 * on next client contact"); once recorded, an issuer is immutable for the row.
 */

import { fullClaimIdentityMatch } from '@repo/ingestion-core'
import type { StoreAdapter } from './store.js'

export interface HandshakeEntry {
  handshake_id: string
  initiator_user_id: string
  acceptor_user_id: string
  initiator_email: string | null
  acceptor_email: string | null
  initiator_device_id: string | null
  acceptor_device_id: string | null
  /** Optional audit / ops (same-principal internal) */
  initiator_device_role: string | null
  acceptor_device_role: string | null
  initiator_device_name: string | null
  acceptor_device_name: string | null
  /** OIDC issuer per side — NULL on legacy rows until lazy backfill. */
  initiator_iss: string | null
  acceptor_iss: string | null
  created_at: string
}

export type RecipientRoute = { userId: string; deviceId: string | null }

/** Authenticated caller identity from the validated OIDC token. */
export interface CallerIdentity {
  sub: string
  iss: string
}

export type RegisterHandshakeResult =
  | { ok: true }
  | { ok: false; reason: 'issuer_mismatch' }

/**
 * Full-claim check of an authenticated caller against one registry side.
 * Sub must match; when the side has a recorded issuer, it must match too.
 * A NULL recorded issuer is a legacy binding (matches on sub, flagged
 * incomplete by the guard — acceptable until the next re-registration binds it).
 */
function callerMatchesSide(
  caller: { sub: string; iss?: string | null },
  sideUserId: string,
  sideIss: string | null,
): boolean {
  return fullClaimIdentityMatch(
    { sub: caller.sub, iss: caller.iss ?? null },
    { sub: sideUserId, iss: sideIss },
  ).ok
}

export interface HandshakeRegistryAdapter {
  registerHandshake(
    handshakeId: string,
    initiatorUserId: string,
    acceptorUserId: string,
    initiatorEmail?: string,
    acceptorEmail?: string,
    initiatorDeviceId?: string,
    acceptorDeviceId?: string,
    initiatorDeviceRole?: string,
    acceptorDeviceRole?: string,
    initiatorDeviceName?: string,
    acceptorDeviceName?: string,
    /**
     * Authenticated caller — stamps the issuer onto the side(s) whose user id
     * equals the caller's sub (lazy backfill; first recorded issuer wins).
     * Registration is refused when the caller's issuer conflicts with an
     * already-recorded issuer for their side.
     */
    callerIdentity?: CallerIdentity,
  ): RegisterHandshakeResult
  /** @internal exposed for relay capsule validation */
  getHandshake(handshakeId: string): HandshakeEntry | null
  getRecipientForSender(
    handshakeId: string,
    senderUserId: string,
    senderDeviceId?: string,
    senderIss?: string | null,
  ): RecipientRoute | null
  isSenderAuthorized(handshakeId: string, senderUserId: string, senderIss?: string | null): boolean
  /**
   * Full-claim check of an authenticated identity against the side of the
   * registry row it claims to be (by sub). Used by the beap_ingest_ack binding.
   */
  identityMatchesRegisteredPrincipal(
    handshakeId: string,
    identity: { sub: string; iss?: string | null },
  ): boolean
  /**
   * Resolve the device role ('host' | 'sandbox') for the given sender device id
   * within a handshake row, by matching it against the stored initiator/acceptor
   * device ids. Returns null when the row, the device id, or its role is unknown.
   * Used by the coordination ingress backstop to refuse data-plane capsules from a
   * sandbox-role device while permitting its control-plane / plumbing capsules.
   */
  getDeviceRoleForSender(
    handshakeId: string,
    senderDeviceId: string | undefined | null,
  ): 'host' | 'sandbox' | null
  /**
   * True iff a registry row exists for `handshakeId` and both user IDs are
   * identical — i.e. both endpoints belong to the same `wrdesk_user_id`.
   *
   * This is the relay's server-side authority for granting same-principal
   * unmetered BEAP transport (PR 3). The predicate reads only the registry;
   * it is not influenced by any client-supplied field. Returns `false` for
   * missing rows, mismatched IDs, or any read error — never throws.
   */
  isSamePrincipalHandshake(handshakeId: string): boolean
}

export function createHandshakeRegistry(store: StoreAdapter): HandshakeRegistryAdapter {
  return {
    registerHandshake(
      handshakeId: string,
      initiatorUserId: string,
      acceptorUserId: string,
      initiatorEmail?: string,
      acceptorEmail?: string,
      initiatorDeviceId?: string,
      acceptorDeviceId?: string,
      initiatorDeviceRole?: string,
      acceptorDeviceRole?: string,
      initiatorDeviceName?: string,
      acceptorDeviceName?: string,
      callerIdentity?: CallerIdentity,
    ): RegisterHandshakeResult {
      const db = store.getDb()
      const now = new Date().toISOString()

      const callerIss = callerIdentity?.iss?.trim() || null
      const callerSub = callerIdentity?.sub?.trim() || null
      const initiatorIss = callerSub && callerSub === initiatorUserId ? callerIss : null
      const acceptorIss = callerSub && callerSub === acceptorUserId ? callerIss : null

      // Refuse re-registration under a conflicting issuer: a recorded issuer is
      // immutable for the life of the row (anti cross-realm sub collision).
      if (callerSub && callerIss) {
        const existing = this.getHandshake(handshakeId)
        if (existing) {
          const recordedForCaller =
            (existing.initiator_user_id === callerSub ? existing.initiator_iss : null) ??
            (existing.acceptor_user_id === callerSub ? existing.acceptor_iss : null)
          if (recordedForCaller && recordedForCaller !== callerIss) {
            return { ok: false, reason: 'issuer_mismatch' }
          }
        }
      }

      db.prepare(
        `INSERT INTO coordination_handshake_registry (
           handshake_id, initiator_user_id, acceptor_user_id,
           initiator_email, acceptor_email,
           initiator_device_id, acceptor_device_id,
           initiator_device_role, acceptor_device_role,
           initiator_device_name, acceptor_device_name,
           initiator_iss, acceptor_iss,
           created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(handshake_id) DO UPDATE SET
           initiator_user_id = COALESCE(excluded.initiator_user_id, coordination_handshake_registry.initiator_user_id),
           acceptor_user_id = COALESCE(excluded.acceptor_user_id, coordination_handshake_registry.acceptor_user_id),
           initiator_email = COALESCE(excluded.initiator_email, coordination_handshake_registry.initiator_email),
           acceptor_email = COALESCE(excluded.acceptor_email, coordination_handshake_registry.acceptor_email),
           initiator_device_id = COALESCE(excluded.initiator_device_id, coordination_handshake_registry.initiator_device_id),
           acceptor_device_id = COALESCE(excluded.acceptor_device_id, coordination_handshake_registry.acceptor_device_id),
           initiator_device_role = COALESCE(excluded.initiator_device_role, coordination_handshake_registry.initiator_device_role),
           acceptor_device_role = COALESCE(excluded.acceptor_device_role, coordination_handshake_registry.acceptor_device_role),
           initiator_device_name = COALESCE(excluded.initiator_device_name, coordination_handshake_registry.initiator_device_name),
           acceptor_device_name = COALESCE(excluded.acceptor_device_name, coordination_handshake_registry.acceptor_device_name),
           initiator_iss = COALESCE(coordination_handshake_registry.initiator_iss, excluded.initiator_iss),
           acceptor_iss = COALESCE(coordination_handshake_registry.acceptor_iss, excluded.acceptor_iss)`,
      ).run(
        handshakeId,
        initiatorUserId,
        acceptorUserId,
        initiatorEmail ?? null,
        acceptorEmail ?? null,
        initiatorDeviceId ?? null,
        acceptorDeviceId ?? null,
        initiatorDeviceRole ?? null,
        acceptorDeviceRole ?? null,
        initiatorDeviceName ?? null,
        acceptorDeviceName ?? null,
        initiatorIss,
        acceptorIss,
        now,
      )
      return { ok: true }
    },

    getHandshake(handshakeId: string): HandshakeEntry | null {
      const db = store.getDb()
      const row = db.prepare(
        `SELECT handshake_id, initiator_user_id, acceptor_user_id,
                initiator_email, acceptor_email,
                initiator_device_id, acceptor_device_id,
                initiator_device_role, acceptor_device_role,
                initiator_device_name, acceptor_device_name,
                initiator_iss, acceptor_iss,
                created_at FROM coordination_handshake_registry WHERE handshake_id = ?`,
      ).get(handshakeId) as HandshakeEntry | undefined
      return row ?? null
    },

    getRecipientForSender(
      handshakeId: string,
      senderUserId: string,
      senderDeviceId?: string,
      senderIss?: string | null,
    ): RecipientRoute | null {
      const h = this.getHandshake(handshakeId)
      if (!h) return null

      if (h.initiator_user_id === h.acceptor_user_id) {
        if (!callerMatchesSide({ sub: senderUserId, iss: senderIss }, h.initiator_user_id, h.initiator_iss) &&
            !callerMatchesSide({ sub: senderUserId, iss: senderIss }, h.acceptor_user_id, h.acceptor_iss)) {
          return null
        }
        const idI = (h.initiator_device_id ?? '').trim()
        const idA = (h.acceptor_device_id ?? '').trim()
        if (!idI || !idA || idI === idA) {
          return null
        }
        const sd = (senderDeviceId ?? '').trim()
        if (!sd) {
          return null
        }
        if (sd === idI) {
          return { userId: h.acceptor_user_id, deviceId: idA }
        }
        if (sd === idA) {
          return { userId: h.initiator_user_id, deviceId: idI }
        }
        return null
      }

      if (callerMatchesSide({ sub: senderUserId, iss: senderIss }, h.initiator_user_id, h.initiator_iss)) {
        return { userId: h.acceptor_user_id, deviceId: h.acceptor_device_id }
      }
      if (callerMatchesSide({ sub: senderUserId, iss: senderIss }, h.acceptor_user_id, h.acceptor_iss)) {
        return { userId: h.initiator_user_id, deviceId: h.initiator_device_id }
      }
      return null
    },

    isSenderAuthorized(handshakeId: string, senderUserId: string, senderIss?: string | null): boolean {
      const h = this.getHandshake(handshakeId)
      if (!h) return false
      return (
        callerMatchesSide({ sub: senderUserId, iss: senderIss }, h.initiator_user_id, h.initiator_iss) ||
        callerMatchesSide({ sub: senderUserId, iss: senderIss }, h.acceptor_user_id, h.acceptor_iss)
      )
    },

    identityMatchesRegisteredPrincipal(
      handshakeId: string,
      identity: { sub: string; iss?: string | null },
    ): boolean {
      const h = this.getHandshake(handshakeId)
      if (!h) return false
      return (
        callerMatchesSide(identity, h.initiator_user_id, h.initiator_iss) ||
        callerMatchesSide(identity, h.acceptor_user_id, h.acceptor_iss)
      )
    },

    getDeviceRoleForSender(
      handshakeId: string,
      senderDeviceId: string | undefined | null,
    ): 'host' | 'sandbox' | null {
      const sd = (senderDeviceId ?? '').trim()
      if (!sd) return null
      const h = this.getHandshake(handshakeId)
      if (!h) return null
      const normalizeRole = (r: string | null): 'host' | 'sandbox' | null =>
        r === 'host' || r === 'sandbox' ? r : null
      if ((h.initiator_device_id ?? '').trim() === sd) return normalizeRole(h.initiator_device_role)
      if ((h.acceptor_device_id ?? '').trim() === sd) return normalizeRole(h.acceptor_device_role)
      return null
    },

    isSamePrincipalHandshake(handshakeId: string): boolean {
      try {
        const h = this.getHandshake(handshakeId)
        return h !== null && h.initiator_user_id === h.acceptor_user_id
      } catch {
        return false
      }
    },
  }
}
