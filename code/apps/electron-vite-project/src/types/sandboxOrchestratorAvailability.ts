/**
 * Mirrors `SandboxOrchestratorAvailability` / `SandboxOrchestratorAvailabilityStatus` from
 * `electron/main/handshake/internalSandboxesApi.ts` (internal sandbox list + P2P health).
 */

export type SandboxOrchestratorAvailabilityStatus = 'connected' | 'exists_but_offline' | 'not_configured'

export interface SandboxOrchestratorAvailability {
  status: SandboxOrchestratorAvailabilityStatus
  relay_connected: boolean
  use_coordination: boolean
}

export const defaultSandboxAvailability: SandboxOrchestratorAvailability = {
  status: 'not_configured',
  relay_connected: false,
  use_coordination: false,
}

/** Returned by `internalSandboxes.listAvailable` — mirrors main `AuthoritativeDeviceInternalRole`. */
export type AuthoritativeDeviceInternalRole = 'host' | 'sandbox' | 'none'
