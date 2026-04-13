/**
 * Same-principal inbound coordination capsules (WebSocket push):
 * whether to treat the capsule as "our own" relay echo and skip ingestion.
 *
 * Normal handshakes: different principals — if sender_wrdesk_user_id === local, always skip.
 * Internal handshakes: same principal on two devices — skip only when sender_device_id
 * matches this device; missing device ids => conservative skip.
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
}): boolean {
  const { hasDb, handshakeId, record, capsuleSenderDeviceId, localDeviceId } = args
  if (!hasDb || !handshakeId || handshakeId === 'unknown') {
    return true
  }
  if (!record) {
    return true
  }
  if (record.handshake_type !== 'internal') {
    return true
  }
  const cap = capsuleSenderDeviceId.trim()
  const loc = localDeviceId.trim()
  if (!cap || !loc) {
    return true
  }
  if (cap !== loc) {
    return false
  }
  return true
}
