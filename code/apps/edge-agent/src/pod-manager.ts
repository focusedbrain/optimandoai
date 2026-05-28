/**
 * Pod lifecycle — podman play kube, digest verify, SSO attestation, supervisor (Stream C — PR5).
 */

import { randomBytes } from 'node:crypto'

import { EDGE_AGENT_OIDC, requestEdgeAttestation } from '@repo/sso'

import type { AgentConfig } from './config.js'
import type { AgentStorage } from './storage.js'
import { generatePodIdentityKeypair } from './podIdentity.js'
import {
  ExpectedDigestMissingError,
  ImageDigestMismatchError,
  verifyAgentImageDigest,
} from './image-digest.js'
import { installAgentPodSeccompProfiles } from './install-seccomp.js'
import {
  buildLaunchEnv,
  loadRemoteEdgeManifest,
  podmanPlayKube,
  preDeployCleanup,
  REMOTE_EDGE_POD_NAME,
  substituteManifest,
  waitForAllContainersHealthy,
  type PodLaunchSecrets,
} from './pod-deploy.js'
import {
  probeContainerHealthExec,
  probeIngestorHealthHost,
  stopAndRemovePod,
  type PodmanRunner,
  setPodmanRunnerForTests,
} from './podman.js'
import {
  clearAgentSupervisorForRetry,
  startAgentPodSupervisor,
  stopAgentPodSupervisor,
  getAgentSupervisorState,
  getAgentSupervisorHaltReason,
} from './pod-supervisor.js'
import { ensureFreshAccessToken } from './sso/session.js'
import { deliverAllAccountsToMailFetcher } from './credentialDelivery.js'
import { emitAgentLogEvent } from './log-stream/emit.js'

export type PodState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'start_failed'
  | 'replacing'
  | 'replacement_exhausted'
  | 'halted_by_anomaly'

export interface PodManagerStatus {
  state: PodState
  lastError: string | null
  lastErrorCode: string | null
  edgePodId: string | null
  edgePublicKeyHex: string | null
  imageDigestExpected: string | null
  imageDigestActual: string | null
}

export interface PodManagerDeps {
  verifyDigest?: typeof verifyAgentImageDigest
  requestAttestation?: typeof requestEdgeAttestation
  loadManifest?: () => Promise<string>
  playKube?: (renderedYaml: string) => Promise<{ ok: boolean; stderr: string }>
  runPodman?: PodmanRunner
}

function emit(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ level: 'info', source: 'pod-manager', event, ...fields }))
}

function emitError(event: string, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ level: 'error', source: 'pod-manager', event, ...fields }))
}

function logStructured(
  eventCode: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  fields: Record<string, string | number | boolean | null> = {},
): void {
  emitAgentLogEvent({
    level,
    source: 'pod_manager',
    event_code: eventCode,
    message,
    fields,
  })
}

export class PodManager {
  private _state: PodState = 'stopped'
  private _lastError: string | null = null
  private _lastErrorCode: string | null = null
  private _podAuthSecret: string | null = null
  private _edgePodId: string | null = null
  private _edgePublicKeyHex: string | null = null
  private _imageExpected: string | null = null
  private _imageActual: string | null = null
  private _startInFlight: Promise<void> | null = null

  constructor(
    private readonly config: AgentConfig,
    private readonly storage: AgentStorage,
    private readonly deps: PodManagerDeps = {},
  ) {}

  getStatus(): PodManagerStatus {
    return {
      state: this._state,
      lastError: this._lastError,
      lastErrorCode: this._lastErrorCode,
      edgePodId: this._edgePodId,
      edgePublicKeyHex: this._edgePublicKeyHex,
      imageDigestExpected: this._imageExpected,
      imageDigestActual: this._imageActual,
    }
  }

  getState(): PodState {
    return this._state
  }

  async startPod(): Promise<void> {
    if (this._startInFlight) return this._startInFlight
    this._startInFlight = this._startPodInner().finally(() => {
      this._startInFlight = null
    })
    return this._startInFlight
  }

  private async _startPodInner(): Promise<void> {
    const persisted = await this.storage.loadState()
    if (persisted.haltedByAnomaly) {
      this._state = 'halted_by_anomaly'
      this._lastError = persisted.haltReason ?? 'halted by anomaly'
      this._lastErrorCode = 'halted_by_anomaly'
      return
    }

    this._state = 'starting'
    this._lastError = null
    this._lastErrorCode = null
    emit('pod_start_begin', { podName: REMOTE_EDGE_POD_NAME })
    logStructured('pod_starting', 'info', 'Verification pod is starting.', {
      pod_name: REMOTE_EDGE_POD_NAME,
    })

    try {
      const verify = this.deps.verifyDigest ?? verifyAgentImageDigest
      const { expected, actual } = await verify()
      this._imageExpected = expected
      this._imageActual = actual
      emit('image_digest_verified', { expected, actual })
      logStructured('image_digest_verified', 'info', 'Container image digest verified.', {
        image_digest_expected: expected,
        image_digest_actual: actual,
      })
    } catch (err) {
      await this.failStart(err)
      return
    }

    try {
      installAgentPodSeccompProfiles()
    } catch (err) {
      emitError('seccomp_install_warn', { message: String(err) })
    }

    const identity = generatePodIdentityKeypair()
    this._edgePodId = identity.podId
    this._edgePublicKeyHex = identity.publicKeyHex
    this._podAuthSecret = randomBytes(32).toString('hex')

    const accessToken = await ensureFreshAccessToken(this.storage)
    if (!accessToken) {
      await this.failStart(new Error('SSO access token required to start pod'), 'sso_required')
      return
    }

    let attestationJwt: string
    try {
      const request = this.deps.requestAttestation ?? requestEdgeAttestation
      const { jwt } = await request(EDGE_AGENT_OIDC, identity.publicKeyHex, identity.podId, accessToken, {
        stub: process.env['BEAP_ATTESTATION_STUB'] === '1',
      })
      attestationJwt = jwt
    } catch (err) {
      await this.failStart(err, 'attestation_failed')
      return
    }

    const state = await this.storage.loadState()
    await this.storage.saveState({
      ...state,
      edgePodId: identity.podId,
      edgePublicKeyHex: identity.publicKeyHex,
      podIdentityKeys: {
        ...(state.podIdentityKeys ?? {}),
        [identity.podId]: {
          publicKeyHex: identity.publicKeyHex,
          privateKeyHex: identity.privateKeyHex,
          createdAt: new Date().toISOString(),
        },
      },
      pairRecord: state.pairRecord
        ? { ...state.pairRecord }
        : undefined,
    })

    const secrets: PodLaunchSecrets = {
      podAuthSecret: this._podAuthSecret,
      edgePrivateKeyHex: identity.privateKeyHex,
      edgePodId: identity.podId,
      ssoAttestationJwt: attestationJwt,
      certTtlSeconds: Number(process.env['CERT_TTL_SECONDS'] ?? 86_400),
    }

    try {
      await preDeployCleanup(REMOTE_EDGE_POD_NAME)
      const template = await (this.deps.loadManifest ?? loadRemoteEdgeManifest)()
      const rendered = substituteManifest(template, buildLaunchEnv(secrets))
      const playFn = this.deps.playKube ?? podmanPlayKube
      const play = await playFn(rendered)
      if (!play.ok) {
        await this.failStart(new Error(play.stderr || 'podman play kube failed'), 'play_kube_failed')
        return
      }

      const healthy = await waitForAllContainersHealthy(async (check) => {
        if ('hostLoopback' in check && check.hostLoopback) {
          return probeIngestorHealthHost(check.port)
        }
        return probeContainerHealthExec(check.container, check.port, 3000)
      })

      if (!healthy) {
        await preDeployCleanup(REMOTE_EDGE_POD_NAME)
        await this.failStart(new Error('Container health check timed out'), 'health_timeout')
        return
      }

      this._state = 'running'
      emit('pod_running', { edgePodId: identity.podId })
      logStructured('pod_started', 'info', 'Verification pod is running.', {
        edge_pod_id: identity.podId,
      })

      await deliverAllAccountsToMailFetcher(this.storage, this._podAuthSecret)

      startAgentPodSupervisor(this.storage, async (kind, reason) => {
        this._state = kind === 'replacement_exhausted' ? 'replacement_exhausted' : 'halted_by_anomaly'
        this._lastError = reason
        this._lastErrorCode = kind
        await this.stopPod()
      })
    } catch (err) {
      await preDeployCleanup(REMOTE_EDGE_POD_NAME).catch(() => undefined)
      await this.failStart(err)
    }
  }

  private async failStart(err: unknown, code?: string): Promise<void> {
    const message = err instanceof Error ? err.message : String(err)
    let errorCode = code ?? 'start_failed'
    if (err instanceof ImageDigestMismatchError) errorCode = err.code
    if (err instanceof ExpectedDigestMissingError) errorCode = err.code
    if (err instanceof ImageDigestMismatchError) {
      this._imageExpected = err.expected
      this._imageActual = err.actual
    }
    this._state = 'start_failed'
    this._lastError = message
    this._lastErrorCode = errorCode
    emitError('pod_start_failed', { code: errorCode, message })
    if (errorCode === 'image_digest_mismatch') {
      logStructured('image_digest_mismatch', 'error', 'Container image digest did not match expected value.', {
        image_digest_expected: this._imageExpected ?? '',
        image_digest_actual: this._imageActual ?? '',
        error_code: errorCode,
      })
    } else {
      logStructured('pod_start_failed', 'error', 'Verification pod failed to start.', {
        error_code: errorCode,
        reason: message,
      })
    }
  }

  async stopPod(): Promise<void> {
    stopAgentPodSupervisor()
    this._state = 'replacing'
    try {
      await stopAndRemovePod(REMOTE_EDGE_POD_NAME)
    } catch (err) {
      emitError('pod_stop_error', { message: String(err) })
    }
    if (this._podAuthSecret) {
      this._podAuthSecret = null
    }
    this._state = 'stopped'
    emit('pod_stopped')
    logStructured('pod_stopped', 'info', 'Verification pod stopped.', {})
  }

  async restartPod(): Promise<void> {
    logStructured('pod_restart_requested', 'info', 'Verification pod restart requested.', {})
    await this.stopPod()
    await this.startPod()
  }

  /** User recovery from halted_by_anomaly / replacement_exhausted (localhost maintenance). */
  getPodAuthSecret(): string | null {
    return this._podAuthSecret
  }

  /** User-initiated restart to pick up new credentials (does not consume supervisor budget). */
  async activateCredentials(): Promise<void> {
    if (this._state === 'running') {
      await this.restartPod()
      return
    }
    if (this._state === 'stopped' || this._state === 'start_failed') {
      await this.startPod()
      return
    }
    throw new Error(`Cannot activate credentials while pod state is ${this._state}`)
  }

  async recoverFromHalt(): Promise<void> {
    clearAgentSupervisorForRetry()
    const state = await this.storage.loadState()
    await this.storage.saveState({
      ...state,
      haltedByAnomaly: false,
      haltReason: undefined,
    })
    this._state = 'stopped'
    this._lastError = null
    this._lastErrorCode = null
    await this.startPod()
  }

  getSupervisorSnapshot(): { state: string; haltReason: string | null } {
    const sup = getAgentSupervisorState()
    if (sup !== 'healthy') {
      return { state: sup, haltReason: getAgentSupervisorHaltReason() }
    }
    return { state: this._state, haltReason: this._lastError }
  }
}

export { setPodmanRunnerForTests }
