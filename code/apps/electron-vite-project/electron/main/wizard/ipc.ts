/**
 * Wizard IPC bridge — Phase 4 (P4.4).
 */

import { ipcMain, dialog, type IpcMainInvokeEvent, type WebContents } from 'electron'

import type { TargetProbe } from '../edge-tier/ssh/types.js'
import type { InstallEvent } from '../edge-tier/ssh/install-podman.js'
import type { DeployEvent } from '../edge-tier/ssh/deploy.js'
import type { EdgeTierPodVault } from '../edge-tier/podLifecycle.js'

import {
  wizardAuthenticate,
  wizardGenerateAndDeploy,
  wizardInstallPodman,
  wizardProbe,
  wizardRefreshTier,
  wizardStoreVmCredentials,
  wizardVerifyAndSwitch,
  wizardPairInitiate,
  wizardPairConfirm,
  wizardParsePairingLink,
  assertNoSecretsInRendererPayload,
  createDefaultWizardHandlerDeps,
  type WizardHandlerDeps,
} from './handlers.js'
import { OrchestratorPairingError } from '../edge-agent/orchestratorPairing.js'
import { clearPendingWizardPairing } from './pairingSession.js'
import { INITIAL_WIZARD_STATE, wizardReducer, type WizardEvent } from './stateMachine.js'
import type {
  WizardGenerateDeployInput,
  WizardProbeInput,
  WizardPublicState,
  WizardState,
  WizardVerifyInput,
} from './types.js'
import { _resetWizardSshSessionForTest, clearWizardVmCredentials } from './sshSession.js'
import { toHostKeyAwareFailure } from '../edge-tier/ssh/hostKeyIpc.js'
import {
  buildWizardEntryContext,
  resumeWizardAddReplica,
  resumeWizardReconfigure,
  resumeWizardSetup,
  resetWizardState,
  startOverEdgeSetupLocally,
} from './entry.js'

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
  return dispatch({ type: 'PROBE_SUCCESS', probe })
}

export function initWizardIpc(vault: EdgeTierPodVault): void {
  _handlerDeps = createDefaultWizardHandlerDeps(vault)
}

export function registerWizardIpcHandlers(): void {
  ipcMain.handle('wizard:refreshTier', async () => {
    const result = await wizardRefreshTier(getDeps())
    return result
  })

  ipcMain.handle('wizard:continueFromExplainer', async () => {
    return { state: dispatch({ type: 'EXPLAINER_CONTINUE' }) }
  })

  ipcMain.handle('wizard:getEntryContext', async () => {
    return buildWizardEntryContext(_wizardState)
  })

  ipcMain.handle('wizard:continueFromProbe', async () => {
    return { state: dispatch({ type: 'PODMAN_READY' }) }
  })

  ipcMain.handle('wizard:resumeSetup', async () => {
    _wizardState = resumeWizardSetup(_wizardState)
    return { state: getPublicState() }
  })

  ipcMain.handle('wizard:addAnotherReplica', async () => {
    _wizardState = resumeWizardAddReplica(_wizardState)
    return { state: getPublicState() }
  })

  ipcMain.handle('wizard:reconfigure', async () => {
    _wizardState = resumeWizardReconfigure(_wizardState)
    return { state: getPublicState() }
  })

  ipcMain.handle('wizard:startOverLocally', async () => {
    await startOverEdgeSetupLocally(getDeps().vault)
    _wizardState = resetWizardState()
    clearWizardVmCredentials()
    return { state: getPublicState() }
  })

  ipcMain.handle('wizard:getState', async () => getPublicState())

  ipcMain.handle('wizard:reset', async () => {
    _wizardState = { ...INITIAL_WIZARD_STATE }
    clearWizardVmCredentials()
    for (const controller of _activeOperations.values()) controller.abort()
    _activeOperations.clear()
    return getPublicState()
  })

  ipcMain.handle('wizard:pickSshKeyFile', async () => pickSshKeyFileViaDialog())

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

  ipcMain.handle('wizard:parsePairingLink', async (_event, raw: unknown) => {
    const text = typeof raw === 'string' ? raw : ''
    return wizardParsePairingLink(text)
  })

  ipcMain.handle('wizard:pairInitiate', async (_event, input: unknown) => {
    const parsed = parsePairInitiateInput(input)
    const sub = _wizardState.authenticate?.sub
    if (!sub) {
      throw new Error('Sign in before pairing')
    }
    try {
      const result = await wizardPairInitiate({
        address: parsed.address,
        pairingCode: parsed.pairingCode,
        orchestratorSub: sub,
      })
      return {
        ok: true,
        fingerprint: result.fingerprint,
        state: dispatch({
          type: 'PAIR_FINGERPRINT_READY',
          address: parsed.address,
          fingerprint: result.fingerprint,
        }),
      }
    } catch (err) {
      const message =
        err instanceof OrchestratorPairingError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err)
      return {
        ok: false,
        error: message,
        state: dispatch({ type: 'PAIR_FAILED', message }),
      }
    }
  })

  ipcMain.handle('wizard:pairConfirm', async () => {
    try {
      await wizardPairConfirm(getDeps())
      const settings = (await import('../edge-tier/settings.js')).loadEdgeTierSettings()
      const replica = settings.replicas.find((r) => r.deployment_type === 'agent')
      const deployed = replica
        ? {
            host: replica.host,
            port: replica.port,
            podId: replica.edge_pod_id,
            publicKey: replica.edge_public_key,
          }
        : undefined
      return {
        ok: true,
        state: dispatch({ type: 'PAIR_SUCCESS', replica: deployed }),
      }
    } catch (err) {
      clearPendingWizardPairing()
      const message =
        err instanceof OrchestratorPairingError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err)
      return {
        ok: false,
        error: message,
        state: dispatch({ type: 'PAIR_FAILED', message }),
      }
    }
  })

  ipcMain.handle('wizard:pairCancelFingerprint', async () => {
    clearPendingWizardPairing()
    return { state: dispatch({ type: 'PAIR_CANCEL_FINGERPRINT' }) }
  })

  ipcMain.handle('wizard:setVmCredentials', async (_event, input: unknown) => {
    const parsed = parseVmCredentialsInput(input)
    // Residual: parsed.passphraseString is an immutable JS string until GC; converted to Buffer immediately.
    const passphrase =
      parsed.passphraseString !== undefined
        ? Buffer.from(parsed.passphraseString, 'utf8')
        : undefined
    const credentials = wizardStoreVmCredentials({
      host: parsed.host,
      user: parsed.user,
      keyFilePath: parsed.keyFilePath,
      port: parsed.port,
      passphrase,
    })
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
    try {
      const probe = await wizardProbe(getDeps())
      return { probe, state: applyProbeResult(probe) }
    } catch (err) {
      const failure = toHostKeyAwareFailure(err)
      return {
        probe: null,
        ...failure,
        state: dispatch({
          type: 'PROBE_FAILED',
          message: failure.error,
        }),
      }
    }
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
            dispatch({ type: 'PODMAN_INSTALL_SUCCEEDED' })
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
    const result = await wizardVerifyAndSwitch(
      getDeps(),
      parsed.replicaIndex,
      parsed.nativeBeapRouting ?? 'direct',
      parsed.totalReplicas,
    )
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
    '[MAIN] IPC handlers registered: wizard:getState, wizard:refreshTier, wizard:continueFromExplainer, wizard:authenticate, wizard:pickSshKeyFile, wizard:setVmCredentials, wizard:probe, wizard:installPodman, wizard:generateAndDeploy, wizard:verifyAndSwitch, wizard:cancel',
  )
}

export async function pickSshKeyFileViaDialog(
  showOpenDialog: typeof dialog.showOpenDialog = dialog.showOpenDialog.bind(dialog),
): Promise<{ canceled: true } | { canceled: false; filePath: string }> {
  const result = await showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'SSH private keys', extensions: ['*'] }],
  })
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true }
  }
  return { canceled: false, filePath: result.filePaths[0]! }
}

export function parseVmCredentialsInput(
  input: unknown,
): Omit<WizardProbeInput, 'passphrase'> & { passphraseString?: string } {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Invalid VM credentials input')
  }
  const o = input as Record<string, unknown>
  if (
    typeof o.host !== 'string' ||
    typeof o.user !== 'string' ||
    typeof o.keyFilePath !== 'string'
  ) {
    throw new Error('VM credentials input requires host, user, and keyFilePath')
  }
  return {
    host: o.host,
    user: o.user,
    keyFilePath: o.keyFilePath,
    port: typeof o.port === 'number' ? o.port : undefined,
    passphraseString:
      typeof o.passphrase === 'string' && o.passphrase.length > 0 ? o.passphrase : undefined,
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

export function _resetWizardIpcStateForTest(): void {
  _wizardState = { ...INITIAL_WIZARD_STATE }
  _resetWizardSshSessionForTest()
  _activeOperations.clear()
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

function parsePairInitiateInput(input: unknown): { address: string; pairingCode: string } {
  if (typeof input !== 'object' || input === null) {
    throw new Error('Invalid pair initiate input')
  }
  const o = input as Record<string, unknown>
  if (typeof o.address !== 'string' || typeof o.pairingCode !== 'string') {
    throw new Error('Pair initiate requires address and pairingCode')
  }
  return { address: o.address.trim(), pairingCode: o.pairingCode.trim() }
}

function parseVerifyInput(input: unknown): WizardVerifyInput {
  if (typeof input !== 'object' || input === null) {
    return { replicaIndex: 0, nativeBeapRouting: 'direct', totalReplicas: 1 }
  }
  const o = input as Record<string, unknown>
  const nativeBeapRouting =
    o.nativeBeapRouting === 'require_edge' ? 'require_edge' : 'direct'
  const totalReplicas =
    typeof o.totalReplicas === 'number' && o.totalReplicas >= 1 ? o.totalReplicas : 1
  return {
    replicaIndex: typeof o.replicaIndex === 'number' ? o.replicaIndex : 0,
    nativeBeapRouting,
    totalReplicas,
  }
}
