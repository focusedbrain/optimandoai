/**
 * Same-principal inbound coordination capsules (WebSocket push):
 * whether to treat the capsule as "our own" relay echo and skip ingestion.
 *
 * Normal handshakes: different principals — if sender_wrdesk_user_id === local, always skip.
 * Same-principal handshakes: same principal on two devices — skip only when sender_device_id
 * matches this device (both ids present). Missing device identity must never yield skip=true
 * for same-principal-labelled traffic (caller quarantines and must not ACK).
 *
 * When the DB row is missing but the wire declares same-principal pairing (legacy
 * `handshake_type=internal` wire field, read via `wireDeclaresSamePrincipal`), apply the same
 * device-scoped rules so we do not conservatively skip peer deliveries.
 *
 * Pure function for unit tests and a single implementation site for coordinationWs.
 */

export type SamePrincipalSkipRecord = {
  same_principal?: boolean | null
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
  /** When record is null, same-principal routing still uses the wire declaration (caller resolves it via `wireDeclaresSamePrincipal`). */
  capsuleDeclaresSamePrincipal?: boolean
}): boolean {
  const { hasDb, handshakeId, record, capsuleSenderDeviceId, localDeviceId, capsuleDeclaresSamePrincipal } = args
  if (!hasDb || !handshakeId || handshakeId === 'unknown') {
    return true
  }
  if (!record) {
    if (capsuleDeclaresSamePrincipal === true) {
      const cap = capsuleSenderDeviceId.trim()
      const loc = localDeviceId.trim()
      if (!cap || !loc) {
        return false
      }
      return cap === loc
    }
    return true
  }
  if (record.same_principal !== true) {
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
