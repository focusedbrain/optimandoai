/**
 * Coordination Service — Handshake registry
 * Tracks which handshakes exist and who can send.
 * Authoritative state lives in storage adapter.
 */

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
  created_at: string
}

export type RecipientRoute = { userId: string; deviceId: string | null }

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
  ): void
  /** @internal exposed for relay capsule validation */
  getHandshake(handshakeId: string): HandshakeEntry | null
  getRecipientForSender(
    handshakeId: string,
    senderUserId: string,
    senderDeviceId?: string,
  ): RecipientRoute | null
  isSenderAuthorized(handshakeId: string, senderUserId: string): boolean
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
    ): void {
      const db = store.getDb()
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO coordination_handshake_registry (
           handshake_id, initiator_user_id, acceptor_user_id,
           initiator_email, acceptor_email,
           initiator_device_id, acceptor_device_id,
           initiator_device_role, acceptor_device_role,
           initiator_device_name, acceptor_device_name,
           created_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
           acceptor_device_name = COALESCE(excluded.acceptor_device_name, coordination_handshake_registry.acceptor_device_name)`,
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
        now,
      )
    },

    getHandshake(handshakeId: string): HandshakeEntry | null {
      const db = store.getDb()
      const row = db.prepare(
        `SELECT handshake_id, initiator_user_id, acceptor_user_id,
                initiator_email, acceptor_email,
                initiator_device_id, acceptor_device_id,
                initiator_device_role, acceptor_device_role,
                initiator_device_name, acceptor_device_name,
                created_at FROM coordination_handshake_registry WHERE handshake_id = ?`,
      ).get(handshakeId) as HandshakeEntry | undefined
      return row ?? null
    },

    getRecipientForSender(
      handshakeId: string,
      senderUserId: string,
      senderDeviceId?: string,
    ): RecipientRoute | null {
      const h = this.getHandshake(handshakeId)
      if (!h) return null

      if (h.initiator_user_id === h.acceptor_user_id) {
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

      if (h.initiator_user_id === senderUserId) {
        return { userId: h.acceptor_user_id, deviceId: h.acceptor_device_id }
      }
      if (h.acceptor_user_id === senderUserId) {
        return { userId: h.initiator_user_id, deviceId: h.initiator_device_id }
      }
      return null
    },

    isSenderAuthorized(handshakeId: string, senderUserId: string): boolean {
      const h = this.getHandshake(handshakeId)
      if (!h) return false
      return h.initiator_user_id === senderUserId || h.acceptor_user_id === senderUserId
    },
  }
}
