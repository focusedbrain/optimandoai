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
  created_at: string
}

export interface HandshakeRegistryAdapter {
  registerHandshake(
    handshakeId: string,
    initiatorUserId: string,
    acceptorUserId: string,
    initiatorEmail?: string,
    acceptorEmail?: string,
  ): void
  getHandshake(handshakeId: string): HandshakeEntry | null
  getRecipientForSender(handshakeId: string, senderUserId: string): string | null
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
    ): void {
      const db = store.getDb()
      const now = new Date().toISOString()
      db.prepare(
        `INSERT INTO coordination_handshake_registry (handshake_id, initiator_user_id, acceptor_user_id, initiator_email, acceptor_email, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(handshake_id) DO UPDATE SET
           initiator_user_id = excluded.initiator_user_id,
           acceptor_user_id = excluded.acceptor_user_id,
           initiator_email = excluded.initiator_email,
           acceptor_email = excluded.acceptor_email`,
      ).run(handshakeId, initiatorUserId, acceptorUserId, initiatorEmail ?? null, acceptorEmail ?? null, now)
    },

    getHandshake(handshakeId: string): HandshakeEntry | null {
      const db = store.getDb()
      const row = db.prepare(
        `SELECT handshake_id, initiator_user_id, acceptor_user_id, initiator_email, acceptor_email, created_at
         FROM coordination_handshake_registry WHERE handshake_id = ?`,
      ).get(handshakeId) as HandshakeEntry | undefined
      return row ?? null
    },

    getRecipientForSender(handshakeId: string, senderUserId: string): string | null {
      const h = this.getHandshake(handshakeId)
      if (!h) return null
      if (h.initiator_user_id === senderUserId) return h.acceptor_user_id
      if (h.acceptor_user_id === senderUserId) return h.initiator_user_id
      return null
    },

    isSenderAuthorized(handshakeId: string, senderUserId: string): boolean {
      return this.getRecipientForSender(handshakeId, senderUserId) !== null
    },
  }
}
