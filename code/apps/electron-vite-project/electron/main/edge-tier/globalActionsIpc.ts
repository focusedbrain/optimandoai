/**
 * Global edge-tier action IPC — Phase 4 (P4.8).
 */

import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'

import {
  pauseEdgeTier,
  rotateAllEdgeKeys,
  updateFallbackPolicy,
  toDashboardFallbackPolicy,
  type DashboardFallbackPolicy,
  type GlobalActionEvent,
  type RotateAllEdgeKeysInput,
} from './globalActions.js'
import type { EdgeTierPodVault } from './podLifecycle.js'
import { getReplicaActionDeps } from './replicaActionsIpc.js'
import { assertNoSecretsInRendererPayload } from '../wizard/handlers.js'
import { notifyDashboardUpdated } from './dashboard.js'

let _vault: EdgeTierPodVault | null = null

export function initGlobalActionIpc(vault: EdgeTierPodVault): void {
  _vault = vault
}

function getVault(): EdgeTierPodVault {
  if (!_vault) {
    throw new Error('Global action IPC not initialized — vault unavailable')
  }
  return _vault
}

function parseRotateInput(raw: unknown): RotateAllEdgeKeysInput & { operationId: string } {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid rotate input')
  }
  const o = raw as Record<string, unknown>
  const sshKey = o.sshKey
  const sshUser = o.sshUser
  const operationId = o.operationId
  if (typeof sshKey !== 'string' || sshKey.length === 0 || sshKey.length > 32_000) {
    throw new Error('sshKey: expected non-empty string')
  }
  if (typeof sshUser !== 'string' || sshUser.length === 0 || sshUser.length > 128) {
    throw new Error('sshUser: expected non-empty string')
  }
  if (typeof operationId !== 'string' || operationId.length === 0 || operationId.length > 200) {
    throw new Error('operationId: expected non-empty string')
  }
  const sshPort =
    o.sshPort == null
      ? undefined
      : typeof o.sshPort === 'number'
        ? o.sshPort
        : Number(o.sshPort)
  if (sshPort != null && (!Number.isInteger(sshPort) || sshPort < 1 || sshPort > 65535)) {
    throw new Error('sshPort: expected integer 1–65535')
  }
  const passphrase =
    typeof o.passphrase === 'string' && o.passphrase.length > 0 ? o.passphrase : undefined
  return { sshKey, sshUser, sshPort, passphrase, operationId }
}

function parseFallbackPolicy(raw: unknown): DashboardFallbackPolicy {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid fallback policy input')
  }
  const policy = (raw as Record<string, unknown>).policy
  if (policy === 'reject' || policy === 'downgrade_with_badge') {
    return policy
  }
  throw new Error('policy must be reject or downgrade_with_badge')
}

function sendGlobalActionProgress(
  sender: WebContents,
  operationId: string,
  event: GlobalActionEvent,
): void {
  const payload = { operationId, event }
  assertNoSecretsInRendererPayload(payload)
  if (!sender.isDestroyed()) {
    sender.send('global:action-progress', payload)
  }
}

export function registerGlobalActionIpcHandlers(): void {
  ipcMain.handle('global:rotateAllEdgeKeys', async (event: IpcMainInvokeEvent, raw) => {
    const input = parseRotateInput(raw)
    let partialFailure: GlobalActionEvent['partial_failure'] | undefined
    for await (const actionEvent of rotateAllEdgeKeys(input, getReplicaActionDeps())) {
      sendGlobalActionProgress(event.sender, input.operationId, actionEvent)
      if (actionEvent.partial_failure) partialFailure = actionEvent.partial_failure
      if (actionEvent.kind === 'error') {
        notifyDashboardUpdated()
        return {
          ok: false,
          error: actionEvent.message,
          partial_failure: partialFailure,
        }
      }
      if (actionEvent.kind === 'done') {
        notifyDashboardUpdated()
        return { ok: true }
      }
    }
    return { ok: false, error: 'Rotation ended without completion', partial_failure: partialFailure }
  })

  ipcMain.handle('global:pauseEdgeTier', async () => {
    await pauseEdgeTier(getVault())
    notifyDashboardUpdated()
    return { ok: true }
  })

  ipcMain.handle('global:setFallbackPolicy', async (_event, raw) => {
    const policy = parseFallbackPolicy(raw)
    const stored = updateFallbackPolicy(policy)
    notifyDashboardUpdated()
    return { ok: true, policy: toDashboardFallbackPolicy(stored) }
  })

  console.log(
    '[MAIN] IPC handlers registered: global:rotateAllEdgeKeys, global:pauseEdgeTier, global:setFallbackPolicy',
  )
}

export function _resetGlobalActionIpcForTest(): void {
  _vault = null
}
