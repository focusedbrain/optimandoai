/**
 * Nuclear reset IPC — Phase 5 (P5.10).
 */

import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'

import type { EdgeTierPodVault } from './podLifecycle.js'
import { assertNoSecretsInRendererPayload } from '../wizard/handlers.js'
import { sshSecretBuffersFromStrings } from '../security/sshSecretBuffers.js'
import { toHostKeyAwareFailure } from './ssh/hostKeyIpc.js'
import { notifyDashboardUpdated, _clearReplicaHealthCacheEntry } from './dashboard.js'
import {
  clearReplacementBudgetOnNuclearReset,
  resetHealthProbeState,
} from './supervisor/index.js'
import { appendSupervisorAudit } from './supervisor/auditLog.js'
import type { ReplicaActionEvent } from './replicaActions.js'
import {
  hashNuclearResetConfirmation,
  nuclearResetReplica,
  type NuclearResetInput,
} from './nuclearReset.js'

let _vault: EdgeTierPodVault | null = null

export function initNuclearResetIpc(vault: EdgeTierPodVault): void {
  _vault = vault
}

function getVault(): EdgeTierPodVault {
  if (!_vault) {
    throw new Error('Nuclear reset IPC not initialized — vault unavailable')
  }
  return _vault
}

function parseNuclearResetInput(raw: unknown): NuclearResetInput & { operationId: string } {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid nuclear reset input')
  }
  const o = raw as Record<string, unknown>
  const replicaId = o.replicaId
  const sshKey = o.sshKey
  const sshUser = o.sshUser
  const operationId = o.operationId
  const reason = o.reason
  const hostConfirm = o.hostConfirm
  const resetConfirm = o.resetConfirm

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
  if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 2000) {
    throw new Error('reason: expected string (3–2000 chars)')
  }
  if (typeof hostConfirm !== 'string' || hostConfirm.length === 0 || hostConfirm.length > 512) {
    throw new Error('hostConfirm: expected non-empty string')
  }
  if (typeof resetConfirm !== 'string' || resetConfirm.length === 0 || resetConfirm.length > 64) {
    throw new Error('resetConfirm: expected non-empty string')
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
    reason: reason.trim(),
    hostConfirm,
    resetConfirm,
  }
}

function sendNuclearResetProgress(
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

async function runNuclearResetStream(
  event: IpcMainInvokeEvent,
  input: NuclearResetInput & { operationId: string },
): Promise<{
  ok: boolean
  result?: ReplicaActionEvent['result']
  error?: string
  hostKeyMismatch?: import('./ssh/hostKeyPinning.js').HostKeyMismatchPayload
}> {
  const confirmationHash = hashNuclearResetConfirmation(
    input.hostConfirm,
    input.resetConfirm,
    input.reason,
  )
  let lastResult: ReplicaActionEvent['result'] | undefined

  try {
    for await (const actionEvent of nuclearResetReplica(input, { vault: getVault() })) {
      sendNuclearResetProgress(event.sender, input.operationId, actionEvent)
      if (actionEvent.result) lastResult = actionEvent.result
      if (actionEvent.kind === 'error') {
        appendSupervisorAudit({
          event: 'nuclear_reset',
          replica_id: input.replicaId,
          container_role: '*',
          success: false,
          reason: input.reason,
          confirmation_user_input_hash: confirmationHash,
        })
        return { ok: false, error: actionEvent.message }
      }
      if (actionEvent.kind === 'done' && actionEvent.result?.action === 'nuclear_reset') {
        const oldReplicaId = actionEvent.result.oldReplicaId ?? input.replicaId
        const newReplicaId = actionEvent.result.newReplica?.edge_pod_id
        _clearReplicaHealthCacheEntry(oldReplicaId)
        if (newReplicaId) {
          _clearReplicaHealthCacheEntry(newReplicaId)
          clearReplacementBudgetOnNuclearReset(newReplicaId)
          resetHealthProbeState(newReplicaId)
        }
        clearReplacementBudgetOnNuclearReset(oldReplicaId)
        resetHealthProbeState(oldReplicaId)
        appendSupervisorAudit({
          event: 'nuclear_reset',
          replica_id: newReplicaId ?? input.replicaId,
          container_role: '*',
          success: true,
          reason: input.reason,
          confirmation_user_input_hash: confirmationHash,
        })
        notifyDashboardUpdated()
        return { ok: true, result: lastResult }
      }
    }
  } catch (err) {
    const failure = toHostKeyAwareFailure(err)
    assertNoSecretsInRendererPayload(failure)
    return failure
  }

  return { ok: false, error: 'Nuclear reset ended without completion' }
}

export function registerNuclearResetIpcHandlers(): void {
  ipcMain.handle('replica:nuclearReset', async (event, raw) => {
    const input = parseNuclearResetInput(raw)
    return runNuclearResetStream(event, input)
  })

  console.log('[MAIN] IPC handler registered: replica:nuclearReset')
}

export function _resetNuclearResetIpcForTest(): void {
  _vault = null
}
