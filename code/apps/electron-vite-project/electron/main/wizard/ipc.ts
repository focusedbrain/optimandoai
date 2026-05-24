/**
 * Wizard IPC bridge — Phase 4 (P4.4).
 */

import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron'

import type { TargetProbe } from '../edge-tier/ssh/types.js'
import type { InstallEvent } from '../edge-tier/ssh/install-podman.js'
import type { DeployEvent } from '../edge-tier/ssh/deploy.js'
import type { EdgeTierPodVault } from '../edge-tier/podLifecycle.js'

import {
  wizardAuthenticate,
  wizardGenerateAndDeploy,
  wizardInstallPodman,
  wizardProbe,
  wizardStoreVmCredentials,
  wizardVerifyAndSwitch,
  assertNoSecretsInRendererPayload,
  createDefaultWizardHandlerDeps,
  type WizardHandlerDeps,
} from './handlers.js'
import { INITIAL_WIZARD_STATE, wizardReducer, type WizardEvent } from './stateMachine.js'
import type {
  WizardGenerateDeployInput,
  WizardProbeInput,
  WizardPublicState,
  WizardState,
  WizardVerifyInput,
} from './types.js'
import { _resetWizardSshSessionForTest } from './sshSession.js'

let _wizardState: WizardState = { ...INITIAL_WIZARD_STATE }
let _handlerDeps: WizardHandlerDeps | null = null

const _activeOperations = new Map<string, AbortController>()

function getDeps(): WizardHandlerDeps {
  if (!_handlerDeps) {
    throw new Error('Wizard IPC not initialized — vault unavailable')
  }
  return _handlerDeps
}

function dispatch(event: WizardEvent): WizardPublicState {
  _wizardState = wizardReducer(_wizardState, event)
  return getPublicState()
}

function getPublicState(): WizardPublicState {
  const state = structuredClone(_wizardState)
  assertNoSecretsInRendererPayload(state)
  return state
}

function registerOperation(operationId: string): AbortController {
  const existing = _activeOperations.get(operationId)
  if (existing) existing.abort()
  const controller = new AbortController()
  _activeOperations.set(operationId, controller)
  return controller
}

function clearOperation(operationId: string): void {
  _activeOperations.delete(operationId)
}

function cancelOperation(operationId: string): boolean {
  const controller = _activeOperations.get(operationId)
  if (!controller) return false
  controller.abort()
  return true
}

function sendProgress(
  sender: WebContents,
  channel: string,
  operationId: string,
  event: InstallEvent | DeployEvent,
): void {
  const payload = { operationId, event }
  assertNoSecretsInRendererPayload(payload)
  if (!sender.isDestroyed()) {
    sender.send(channel, payload)
  }
}

function applyProbeResult(probe: TargetProbe): WizardPublicState {
  if (!probe.verdict.ok) {
    return dispatch({
      type: 'PROBE_FAILED',
      message: probe.verdict.message,
    })
  }
  let state = dispatch({ type: 'PROBE_SUCCESS', probe })
  if (probe.podman_installed) {
    state = dispatch({ type: 'PODMAN_READY' })
  }
  return state
}

export function initWizardIpc(vault: EdgeTierPodVault): void {
  _handlerDeps = createDefaultWizardHandlerDeps(vault)
}

export function registerWizardIpcHandlers(): void {
  ipcMain.handle('wizard:getState', async () => getPublicState())

  ipcMain.handle('wizard:reset', async () => {
    _wizardState = { ...INITIAL_WIZARD_STATE }
    _resetWizardSshSessionForTest()
    for (const controller of _activeOperations.values()) controller.abort()
    _activeOperations.clear()
    return getPublicState()
  })

  ipcMain.handle('wizard:authenticate', async () => {
    const result = await wizardAuthenticate(getDeps())
    if (result.ok) {
      return {
        ...result,
        state: dispatch({ type: 'AUTH_SUCCESS', plan: result.plan, sub: result.sub }),
      }
    }
    return {
      ...result,
      state: dispatch({ type: 'AUTH_FAILED', message: result.error }),
    }
  })

  ipcMain.handle('wizard:setVmCredentials', async (_event, input: unknown) => {
    const parsed = parseProbeInput(input)
    const credentials = wizardStoreVmCredentials(parsed)
    assertNoSecretsInRendererPayload(credentials)
    return {
      credentials,
      state: dispatch({ type: 'VM_CREDENTIALS_SET', credentials }),
    }
  })

  ipcMain.handle('wizard:setReplicaCount', async (_event, count: unknown) => {
    const n = typeof count === 'number' ? count : Number(count)
    if (!Number.isInteger(n) || n < 1 || n > 3) {
      throw new Error('Replica count must be 1, 2, or 3')
    }
    return {
      state: dispatch({ type: 'REPLICA_COUNT_SET', count: n }),
    }
  })

  ipcMain.handle('wizard:probe', async () => {
    const probe = await wizardProbe(getDeps())
    return { probe, state: applyProbeResult(probe) }
  })

  ipcMain.handle(
    'wizard:installPodman',
    async (event: IpcMainInvokeEvent, input: unknown) => {
      const { operationId, probe } = parseInstallInput(input)
      const controller = registerOperation(operationId)
      try {
        for await (const installEvent of wizardInstallPodman(probe, controller.signal)) {
          sendProgress(event.sender, 'wizard:installPodman-progress', operationId, installEvent)
          if (controller.signal.aborted) break
          if (installEvent.kind === 'done') {
            dispatch({ type: 'PODMAN_READY' })
          }
          if (installEvent.kind === 'error') {
            dispatch({ type: 'PODMAN_INSTALL_FAILED', message: installEvent.message })
          }
        }
        return { ok: true, state: getPublicState() }
      } finally {
        clearOperation(operationId)
      }
    },
  )

  ipcMain.handle(
    'wizard:generateAndDeploy',
    async (event: IpcMainInvokeEvent, input: unknown) => {
      const parsed = parseGenerateDeployInput(input)
      const controller = registerOperation(parsed.operationId)
      let deployReplica:
        | { host: string; port: number; podId: string; publicKey: string }
        | undefined

      try {
        for await (const deployEvent of wizardGenerateAndDeploy(
          getDeps(),
          { replicaIndex: parsed.replicaIndex },
          controller.signal,
        )) {
          sendProgress(event.sender, 'wizard:generateAndDeploy-progress', parsed.operationId, deployEvent)
          if (controller.signal.aborted) break

          if (deployEvent.kind === 'done' && deployEvent.replica_state) {
            deployReplica = {
              host: deployEvent.replica_state.host,
              port: 18100,
              podId: deployEvent.replica_state.podId,
              publicKey: deployEvent.replica_state.publicKey,
            }
            dispatch({
              type: 'DEPLOY_SUCCESS',
              replica: deployReplica,
            })
          }
          if (deployEvent.kind === 'error') {
            dispatch({ type: 'DEPLOY_FAILED', message: deployEvent.message })
          }
        }
        return { ok: true, state: getPublicState() }
      } finally {
        clearOperation(parsed.operationId)
      }
    },
  )

  ipcMain.handle('wizard:verifyAndSwitch', async (_event, input: unknown) => {
    const parsed = parseVerifyInput(input)
    const result = await wizardVerifyAndSwitch(getDeps(), parsed.replicaIndex)
    const state = result.verified
      ? dispatch({ type: 'VERIFY_SUCCESS' })
      : dispatch({
          type: 'VERIFY_FAILED',
          message: result.reason ?? 'Verification failed',
        })
    assertNoSecretsInRendererPayload({ result, state })
    return { ...result, state }
  })

  ipcMain.handle('wizard:cancel', async (_event, operationId: unknown) => {
    if (typeof operationId !== 'string' || !operationId) {
      throw new Error('operationId is required')
    }
    return { cancelled: cancelOperation(operationId) }
  })

  console.log(
    '[MAIN] IPC handlers registered: wizard:getState, wizard:authenticate, wizard:probe, wizard:installPodman, wizard:generateAndDeploy, wizard:verifyAndSwitch, wizard:cancel',
  )
}

function parseProbeInput(input: unknown): WizardProbeInput {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Invalid probe input')
  }
  const o = input as Record<string, unknown>
  if (typeof o.host !== 'string' || typeof o.user !== 'string' || typeof o.key !== 'string') {
    throw new Error('probe input requires host, user, and key')
  }
  return {
    host: o.host,
    user: o.user,
    key: o.key,
    port: typeof o.port === 'number' ? o.port : undefined,
    passphrase: typeof o.passphrase === 'string' ? o.passphrase : undefined,
  }
}

function parseInstallInput(input: unknown): { operationId: string; probe: TargetProbe } {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Invalid installPodman input')
  }
  const o = input as Record<string, unknown>
  if (typeof o.operationId !== 'string' || typeof o.probe !== 'object' || o.probe === null) {
    throw new Error('installPodman input requires operationId and probe')
  }
  return { operationId: o.operationId, probe: o.probe as TargetProbe }
}

function parseGenerateDeployInput(input: unknown): WizardGenerateDeployInput {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Invalid generateAndDeploy input')
  }
  const o = input as Record<string, unknown>
  if (typeof o.operationId !== 'string') {
    throw new Error('generateAndDeploy input requires operationId')
  }
  const replicaIndex = typeof o.replicaIndex === 'number' ? o.replicaIndex : 0
  const totalReplicas = typeof o.totalReplicas === 'number' ? o.totalReplicas : 1
  return { operationId: o.operationId, replicaIndex, totalReplicas }
}

function parseVerifyInput(input: unknown): WizardVerifyInput {
  if (typeof input !== 'object' || input === null) {
    return { replicaIndex: 0 }
  }
  const o = input as Record<string, unknown>
  return {
    replicaIndex: typeof o.replicaIndex === 'number' ? o.replicaIndex : 0,
  }
}

/** Tests — inject handler deps without vault. */
export function _setWizardHandlerDepsForTest(deps: WizardHandlerDeps | null): void {
  _handlerDeps = deps
}

export function _getWizardStateForTest(): WizardState {
  return _wizardState
}

export function _setWizardStateForTest(state: WizardState): void {
  _wizardState = state
}
