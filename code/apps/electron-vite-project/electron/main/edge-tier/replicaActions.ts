/**
 * Per-replica dashboard actions — Phase 4 (P4.7).
 *
 * SSH credentials are held in memory only for the duration of each action.
 */

import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ensureSession } from '../../../src/auth/session.js'
import { generateEdgeKeypair } from './keygen.js'
import { requestSsoAttestation } from './attestation.js'
import {
  removeEncryptedEdgePrivateKey,
  storeEncryptedEdgePrivateKey,
} from './keyStorage.js'
import type { EdgeTierPodVault } from './podLifecycle.js'
import {
  loadEdgeTierSettings,
  replaceEdgeReplica,
  removeEdgeReplica,
  type EdgeReplica,
} from './settings.js'
import { SshClient } from './ssh/client.js'
import {
  buildRestartCommand,
  buildTeardownCommand,
  deployEdgePod,
  type DeploySshClient,
} from './ssh/deploy.js'

function readRemoteEdgeManifestTemplate(): string {
  const fromEnv = process.env['BEAP_REMOTE_EDGE_MANIFEST']
  if (fromEnv) return readFileSync(fromEnv, 'utf8')
  return readFileSync(
    join(process.cwd(), 'packages', 'beap-pod', 'pod-remote-edge.yaml'),
    'utf8',
  )
}

export type ReplicaActionKind = 'restart' | 'redeploy' | 'remove'

export type ReplicaActionEventKind = 'log' | 'stage' | 'done' | 'error'

export interface ReplicaActionInput {
  readonly replicaId: string
  readonly sshUser: string
  readonly sshPort?: number
  readonly sshKey: string
  readonly passphrase?: string
}

export interface ReplicaActionResult {
  readonly action: ReplicaActionKind
  readonly wasLastReplica?: boolean
  readonly newReplica?: Pick<EdgeReplica, 'edge_pod_id' | 'edge_public_key' | 'host' | 'port'>
}

export interface ReplicaActionEvent {
  readonly kind: ReplicaActionEventKind
  readonly message: string
  readonly stage_name?: string
  readonly result?: ReplicaActionResult
}

export interface ReplicaActionDeps {
  readonly vault: EdgeTierPodVault
  readonly ensureSession?: typeof ensureSession
  readonly requestAttestation?: typeof requestSsoAttestation
  readonly readManifestYaml?: () => string
  readonly createSshClient?: () => SshClient
}

export interface ReplicaActionSshRunner {
  readonly run: (command: string) => Promise<{ stdout: string; stderr: string; code: number | null }>
  readonly uploadContent: (content: string | Buffer, remotePath: string) => Promise<void>
  readonly disconnect: () => Promise<void>
}

function yieldLog(message: string, stream: 'stdout' | 'stderr' = 'stdout'): ReplicaActionEvent {
  const prefix = stream === 'stderr' ? '[stderr] ' : ''
  return { kind: 'log', message: `${prefix}${message}`.trimEnd() }
}

function yieldStage(stage_name: string, message: string): ReplicaActionEvent {
  return { kind: 'stage', stage_name, message }
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trimEnd())
}

function* emitRunOutput(result: { stdout: string; stderr: string }): Generator<ReplicaActionEvent> {
  for (const line of splitLines(result.stdout)) {
    if (line) yield yieldLog(line)
  }
  for (const line of splitLines(result.stderr)) {
    if (line) yield yieldLog(line, 'stderr')
  }
}

export function findEdgeReplica(replicaId: string): EdgeReplica {
  const replica = loadEdgeTierSettings().replicas.find(
    (r) => r.edge_pod_id.toLowerCase() === replicaId.toLowerCase(),
  )
  if (!replica) {
    throw new Error('Replica not found')
  }
  return replica
}

export async function connectReplicaActionSsh(
  replica: EdgeReplica,
  input: ReplicaActionInput,
  createClient: () => SshClient = () => new SshClient(),
): Promise<ReplicaActionSshRunner & DeploySshClient> {
  const client = createClient()
  await client.connect({
    host: replica.host,
    port: input.sshPort ?? 22,
    username: input.sshUser,
    privateKey: input.sshKey,
    passphrase: input.passphrase,
  })
  return {
    run: (command) => client.run(command),
    uploadContent: (content, remotePath) => client.uploadContent(content, remotePath),
    disconnect: () => client.disconnect(),
  }
}

export async function* restartReplica(
  input: ReplicaActionInput,
  deps?: Pick<ReplicaActionDeps, 'createSshClient'>,
): AsyncGenerator<ReplicaActionEvent> {
  const replica = findEdgeReplica(input.replicaId)
  yield yieldStage('connect', `Connecting to ${replica.host}…`)

  const client = await connectReplicaActionSsh(replica, input, deps?.createSshClient)
  try {
    yield yieldStage('restart', `Restarting pod on ${replica.host}…`)
    const result = await client.run(buildRestartCommand())
    yield* emitRunOutput(result)
    if (result.code !== 0) {
      yield {
        kind: 'error',
        message: `Restart failed (exit ${result.code ?? 'unknown'}).`,
        stage_name: 'restart',
      }
      return
    }
    yield {
      kind: 'done',
      message: `Replica on ${replica.host} restarted.`,
      stage_name: 'restart',
      result: { action: 'restart' },
    }
  } finally {
    await client.disconnect()
  }
}

export async function* removeReplica(
  input: ReplicaActionInput,
  _deps?: ReplicaActionDeps,
): AsyncGenerator<ReplicaActionEvent> {
  const replica = findEdgeReplica(input.replicaId)
  yield yieldStage('connect', `Connecting to ${replica.host}…`)

  const client = await connectReplicaActionSsh(replica, input, _deps?.createSshClient)
  try {
    yield yieldStage('teardown', `Stopping and removing pod on ${replica.host}…`)
    const result = await client.run(buildTeardownCommand())
    yield* emitRunOutput(result)
    if (result.code !== 0) {
      yield {
        kind: 'error',
        message: `Remote teardown failed (exit ${result.code ?? 'unknown'}).`,
        stage_name: 'teardown',
      }
      return
    }

    yield yieldStage('settings', 'Removing replica from edge tier settings…')
    const { wasLast } = removeEdgeReplica(replica.edge_pod_id)
    removeEncryptedEdgePrivateKey(replica.edge_pod_id)

    yield {
      kind: 'done',
      message: wasLast
        ? 'Last replica removed. Add another replica or disable edge tier.'
        : `Replica removed from ${replica.host}.`,
      stage_name: 'settings',
      result: {
        action: 'remove',
        wasLastReplica: wasLast,
      },
    }
  } finally {
    await client.disconnect()
  }
}

export async function* redeployReplica(
  input: ReplicaActionInput,
  deps: ReplicaActionDeps,
): AsyncGenerator<ReplicaActionEvent> {
  const replica = findEdgeReplica(input.replicaId)
  const oldPodId = replica.edge_pod_id
  yield yieldStage('connect', `Connecting to ${replica.host}…`)

  const client = await connectReplicaActionSsh(replica, input, deps.createSshClient)
  let deployStarted = false

  try {
    yield yieldStage('teardown', `Stopping existing pod on ${replica.host}…`)
    const teardown = await client.run(buildTeardownCommand())
    yield* emitRunOutput(teardown)
    if (teardown.code !== 0) {
      yield {
        kind: 'error',
        message: `Teardown failed (exit ${teardown.code ?? 'unknown'}).`,
        stage_name: 'teardown',
      }
      return
    }

    const keypair = generateEdgeKeypair()
    const ensure = deps.ensureSession ?? ensureSession
    const session = await ensure(false)
    const attestation = deps.requestAttestation ?? requestSsoAttestation
    const { jwt } = await attestation(keypair.publicKeyHex, keypair.podId, session.accessToken)

    storeEncryptedEdgePrivateKey(keypair.podId, keypair.privateKeyHex, deps.vault)

    const manifestYaml = (deps.readManifestYaml ?? readRemoteEdgeManifestTemplate)()
    const podAuthSecret = randomBytes(32).toString('hex')

    deployStarted = true
    for await (const event of deployEdgePod({
      client,
      host: replica.host,
      podId: keypair.podId,
      publicKey: keypair.publicKeyClaim,
      privateKeyHex: keypair.privateKeyHex,
      attestationJwt: jwt,
      podAuthSecret,
      manifestYaml,
      certTtlSeconds: 86400,
    })) {
      if (event.kind === 'error') {
        yield {
          kind: 'error',
          message: event.message,
          stage_name: event.stage_name,
        }
        removeEncryptedEdgePrivateKey(keypair.podId)
        return
      }
      if (event.kind === 'done' && event.replica_state) {
        const nextReplica: EdgeReplica = {
          host: replica.host,
          port: replica.port,
          edge_pod_id: event.replica_state.podId,
          edge_public_key: event.replica_state.publicKey,
          sso_attestation_jwt: event.replica_state.attestationJwt,
        }
        replaceEdgeReplica(oldPodId, nextReplica)
        removeEncryptedEdgePrivateKey(oldPodId)
        yield {
          kind: 'done',
          message: `Replica redeployed on ${replica.host} with new edge pod ID.`,
          stage_name: event.stage_name ?? 'cleanup',
          result: {
            action: 'redeploy',
            newReplica: nextReplica,
          },
        }
        return
      }
      yield {
        kind: event.kind,
        message: event.message,
        stage_name: event.stage_name,
      }
    }
  } catch (err) {
    if (deployStarted) {
      await client.run(buildTeardownCommand()).catch(() => undefined)
    }
    yield {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
      stage_name: 'redeploy',
    }
  } finally {
    await client.disconnect()
  }
}

/** Collect events for tests. */
export async function collectReplicaActionEvents(
  generator: AsyncGenerator<ReplicaActionEvent>,
): Promise<ReplicaActionEvent[]> {
  const events: ReplicaActionEvent[] = []
  for await (const event of generator) {
    events.push(event)
  }
  return events
}
