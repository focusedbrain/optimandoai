/**
 * Dedicated sandbox ingestion UI helpers (PROMPT 3).
 * Mirrors backend `resolveSandboxTopologyKind()` values exposed via orchestrator:getMode.
 */

export type SandboxTopologyKind = 'single_machine' | 'dedicated' | 'none'

/** Read-only toolbar copy when the paired host triggers all inbound fetches. */
export const DEDICATED_SANDBOX_HOST_TRIGGERED_STATUS =
  'Mail is fetched when the host device syncs.'

/** Account sync panel hint — sync window still configures poll reach on host trigger. */
export const DEDICATED_SANDBOX_SYNC_WINDOW_HINT =
  'Sets how far back mail is fetched when your host device syncs. Expand the window to include older mail.'

export function isDedicatedSandboxHostTriggeredIngestion(
  isSandbox: boolean,
  topology: SandboxTopologyKind | null | undefined,
): boolean {
  return isSandbox && topology === 'dedicated'
}
