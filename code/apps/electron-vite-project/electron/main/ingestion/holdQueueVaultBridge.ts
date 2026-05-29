/**
 * Lazy vault binding for hold queue — avoids static import of vault/service in holdQueue.ts
 * (ESM bundle safe; wired from main after vault module loads).
 */

export type HoldQueueVault = {
  deriveApplicationKey(info: string): Buffer | null
}

let _bridge: HoldQueueVault | null = null

export function setHoldQueueVaultBridge(vault: HoldQueueVault): void {
  _bridge = vault
}

export function getHoldQueueVaultBridge(): HoldQueueVault {
  if (!_bridge) {
    throw new Error('Hold queue vault bridge is not initialized')
  }
  return _bridge
}

/** Test-only reset */
export function resetHoldQueueVaultBridgeForTest(): void {
  _bridge = null
}
