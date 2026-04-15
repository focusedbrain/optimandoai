/**
 * Same-principal inbound coordination capsules (WebSocket push):
 * whether to treat the capsule as "our own" relay echo and skip ingestion.
 *
 * Normal handshakes: different principals — if sender_wrdesk_user_id === local, always skip.
 * Internal handshakes: same principal on two devices — skip only when sender_device_id
 * matches this device (both ids present). Missing device identity must never yield skip=true
 * for internal-labelled traffic (caller quarantines and must not ACK).
 *
 * When the DB row is missing but the wire declares handshake_type=internal, apply the same
 * device-scoped rules so we do not conservatively skip peer deliveries.
 *
 * Pure function for unit tests and a single implementation site for coordinationWs.
 */

export type SamePrincipalSkipRecord = {
  handshake_type?: 'internal' | 'standard' | null
}

/**
 * @returns true if the caller should skip ingestion and ACK (own-capsule / safe legacy).
 */
export function computeSamePrincipalCoordinationSkipOwn(args: {
  hasDb: boolean
  handshakeId: string
  record: SamePrincipalSkipRecord | null
  capsuleSenderDeviceId: string
  localDeviceId: string
  /** When record is null, same-principal internal routing still uses wire handshake_type */
  capsuleHandshakeType?: string | null
}): boolean {
  const { hasDb, handshakeId, record, capsuleSenderDeviceId, localDeviceId, capsuleHandshakeType } = args
  if (!hasDb || !handshakeId || handshakeId === 'unknown') {
    return true
  }
  if (!record) {
    if (capsuleHandshakeType === 'internal') {
      const cap = capsuleSenderDeviceId.trim()
      const loc = localDeviceId.trim()
      if (!cap || !loc) {
        return false
      }
      return cap === loc
    }
    return true
  }
  if (record.handshake_type !== 'internal') {
    return true
  }
  const cap = capsuleSenderDeviceId.trim()
  const loc = localDeviceId.trim()
  if (!cap || !loc) {
    return false
  }
  if (cap !== loc) {
    return false
  }
  return true
}
