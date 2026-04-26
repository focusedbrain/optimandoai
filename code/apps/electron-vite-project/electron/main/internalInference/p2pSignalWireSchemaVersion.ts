/**
 * Outbound `/beap/p2p-signal` JSON `schema_version`. Must stay aligned with
 * `packages/coordination-service/src/p2pSignal.ts` (`P2P_SIGNAL_SCHEMA_VERSION`).
 * CI: `packages/coordination-service/__tests__/p2pSignalSchemaElectronAlignment.test.ts`.
 */

export const P2P_SIGNAL_WIRE_SCHEMA_VERSION = 1

let _p2pWireSchemaLogged = false

/** At most once per process — safe to call from Host health and from first Host AI list. */
export function logP2pSignalWireSchemaStartupLine(): void {
  if (_p2pWireSchemaLogged) return
  _p2pWireSchemaLogged = true
  console.log(`[P2P_SIGNAL_SCHEMA] component=electron-app wire_schema_version=${P2P_SIGNAL_WIRE_SCHEMA_VERSION}`)
}

/** @internal */
export function resetP2pSignalWireSchemaLogForTests(): void {
  _p2pWireSchemaLogged = false
}
