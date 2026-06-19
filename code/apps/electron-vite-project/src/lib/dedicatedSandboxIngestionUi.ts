/**
 * Dedicated sandbox ingestion UI helpers (PROMPT 3).
 * Mirrors backend `resolveSandboxTopologyKind()` values exposed via orchestrator:getMode.
 */

export type SandboxTopologyKind = 'single_machine' | 'dedicated' | 'none'

/** Read-only toolbar copy when the paired host triggers all inbound fetches. */
export const DEDICATED_SANDBOX_HOST_TRIGGERED_STATUS =
  'Inbox Clone shows only BEAP messages cloned from your host. When the host syncs, this device depackages mail headlessly and delivers results to the host inbox — not listed here.'

/** Account sync panel hint — sync window configures host-triggered headless fetch reach. */
export const DEDICATED_SANDBOX_SYNC_WINDOW_HINT =
  'Sets how far back the host-triggered headless fetch reaches. Expanding the window includes older mail on the next host sync; only cloned messages appear in this inbox.'

export function isDedicatedSandboxHostTriggeredIngestion(
  isSandbox: boolean,
  topology: SandboxTopologyKind | null | undefined,
): boolean {
  return isSandbox && topology === 'dedicated'
}
