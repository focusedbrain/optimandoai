/**
 * Remote-capsule revoke callback registry.
 *
 * Extracted into its own module so tests can import the setter without pulling in
 * enforcement.ts (which transitively imports crypto and many other heavy modules).
 *
 * Lifecycle:
 *   1. main.ts registers a callback via setRemoteRevokeCallback.
 *   2. enforcement.ts fires _remoteRevokeCb after removeTopologyForHandshake succeeds
 *      on the remote-capsule revoke path.
 *   3. main.ts dispatches by localDeviceRole: host → topology:handshakeRevoked banner
 *      (UX-3 D1); sandbox → topology:sandboxReadCleanupHint (UX-3 D2).
 */

export type RemoteRevokeCb = (
  handshakeId: string,
  localDeviceRole: 'host' | 'sandbox' | null,
) => void

let _remoteRevokeCb: RemoteRevokeCb | null = null

export function setRemoteRevokeCallback(cb: RemoteRevokeCb | null): void {
  _remoteRevokeCb = cb
}

export function getRemoteRevokeCallback(): RemoteRevokeCb | null {
  return _remoteRevokeCb
}
