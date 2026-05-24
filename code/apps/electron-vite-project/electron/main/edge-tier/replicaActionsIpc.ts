/**
 * Replica action IPC — Phase 4 (P4.7).
 */

import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'

import { applyEdgeTierSettingsAndRestartPod, type EdgeTierPodVault } from './podLifecycle.js'
import { pauseEdgeTier } from './globalActions.js'
import {
  redeployReplica,
  removeReplica,
  restartReplica,
  type ReplicaActionEvent,
  type ReplicaActionInput,
  type ReplicaActionDeps,
} from './replicaActions.js'
import { assertNoSecretsInRendererPayload } from '../wizard/handlers.js'
import { sshSecretBuffersFromStrings } from '../security/sshSecretBuffers.js'
import { toHostKeyAwareFailure } from './ssh/hostKeyIpc.js'
import { notifyDashboardUpdated, _clearReplicaHealthCacheEntry } from './dashboard.js'
import { clearReplacementBudgetOnNuclearReset } from './supervisor/index.js'
import { appendSupervisorAudit } from './supervisor/auditLog.js'

let _actionDeps: ReplicaActionDeps | null = null

export function initReplicaActionIpc(vault: EdgeTierPodVault): void {
  _actionDeps = { vault }
}

export function getReplicaActionDeps(): ReplicaActionDeps {
  return getActionDeps()
}

function getActionDeps(): ReplicaActionDeps {
  if (!_actionDeps) {
    throw new Error('Replica action IPC not initialized — vault unavailable')
  }
  return _actionDeps
}

function parseReplicaActionInput(raw: unknown): ReplicaActionInput & { operationId: string } {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid replica action input')
  }
  const o = raw as Record<string, unknown>
  const replicaId = o.replicaId
  const sshKey = o.sshKey
  const sshUser = o.sshUser
  const operationId = o.operationId
  if (typeof replicaId !== 'string' || replicaId.length === 0 || replicaId.length > 200) {
    throw new Error('replicaId: expected non-empty string')
  }
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
  const passphraseString =
    typeof o.passphrase === 'string' && o.passphrase.length > 0 ? o.passphrase : undefined
  const secrets = sshSecretBuffersFromStrings(sshKey, passphraseString)
  return {
    replicaId,
    sshKey: secrets.sshKey,
    sshUser,
    sshPort,
    passphrase: secrets.passphrase,
    operationId,
  }
}

function sendReplicaActionProgress(
  sender: WebContents,
  operationId: string,
  event: ReplicaActionEvent,
): void {
  const payload = { operationId, event }
  assertNoSecretsInRendererPayload(payload)
  if (!sender.isDestroyed()) {
    sender.send('replica:action-progress', payload)
  }
}

async function runReplicaActionStream(
  event: IpcMainInvokeEvent,
  input: ReplicaActionInput & { operationId: string },
  generator: AsyncGenerator<ReplicaActionEvent>,
): Promise<{
  ok: boolean
  result?: ReplicaActionEvent['result']
  error?: string
  hostKeyMismatch?: import('../edge-tier/ssh/hostKeyPinning.js').HostKeyMismatchPayload
}> {
  let lastResult: ReplicaActionEvent['result'] | undefined
  let failed = false
  try {
    for await (const actionEvent of generator) {
      sendReplicaActionProgress(event.sender, input.operationId, actionEvent)
      if (actionEvent.result) lastResult = actionEvent.result
      if (actionEvent.kind === 'error') {
        failed = true
        return { ok: false, error: actionEvent.message }
      }
      if (actionEvent.kind === 'done') {
        if (actionEvent.result?.action === 'remove' || actionEvent.result?.action === 'redeploy') {
          _clearReplicaHealthCacheEntry(input.replicaId)
          if (actionEvent.result.newReplica) {
            _clearReplicaHealthCacheEntry(actionEvent.result.newReplica.edge_pod_id)
          }
        }
        if (actionEvent.result?.action === 'redeploy') {
          clearReplacementBudgetOnNuclearReset(input.replicaId)
          appendSupervisorAudit({
            event: 'replacement_budget_cleared',
            replica_id: input.replicaId,
            container_role: '*',
            success: true,
            reason: 'nuclear_redeploy',
          })
        }
        notifyDashboardUpdated()
        return { ok: true, result: lastResult }
      }
    }
  } catch (err) {
    const failure = toHostKeyAwareFailure(err)
    assertNoSecretsInRendererPayload(failure)
    return failure
  }
  if (failed) return { ok: false, error: 'Action failed' }
  return { ok: false, error: 'Action ended without completion' }
}

export function registerReplicaActionIpcHandlers(): void {
  ipcMain.handle('replica:restart', async (event, raw) => {
    const input = parseReplicaActionInput(raw)
    return runReplicaActionStream(event, input, restartReplica(input))
  })

  ipcMain.handle('replica:redeploy', async (event, raw) => {
    const input = parseReplicaActionInput(raw)
    return runReplicaActionStream(event, input, redeployReplica(input, getActionDeps()))
  })

  ipcMain.handle('replica:remove', async (event, raw) => {
    const input = parseReplicaActionInput(raw)
    return runReplicaActionStream(event, input, removeReplica(input, getActionDeps()))
  })

  ipcMain.handle('dashboard:disableEdgeTier', async () => {
    await pauseEdgeTier(getActionDeps().vault)
    notifyDashboardUpdated()
    return { ok: true }
  })

  console.log(
    '[MAIN] IPC handlers registered: replica:restart, replica:redeploy, replica:remove, dashboard:disableEdgeTier',
  )
}

export function _resetReplicaActionIpcForTest(): void {
  _actionDeps = null
}
