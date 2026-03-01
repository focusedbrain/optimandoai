/**
 * useFullAutoStatus
 *
 * Returns Full-Auto status derived from the backend-backed handshake system.
 * Full-Auto permissions are not yet surfaced by the new RPC HandshakeRecord,
 * so this always returns unavailable until the backend exposes that field.
 */

export interface FullAutoStatus {
  hasAnyFullAuto: boolean
  fullAutoHandshakes: Array<{
    handshakeId: string
    displayName: string
    fingerprint: string
  }>
  explanation: string
}

export function useFullAutoStatus(): FullAutoStatus {
  return {
    hasAnyFullAuto: false,
    fullAutoHandshakes: [],
    explanation:
      'Full-Auto is not available. Establish a trusted handshake with Full-Auto permissions to enable automated package processing.',
  }
}
