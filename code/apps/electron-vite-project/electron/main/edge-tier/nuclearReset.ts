/**
 * Nuclear reset — wipe a REMOTE_EDGE replica VM and respawn from scratch (P5.10).
 *
 * User-initiated only. Regenerates edge keypair, attestation, and edge_pod_id.
 */

import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { ensureSession } from '../../../src/auth/session.js'
import { zeroizeBuffer } from '../security/zeroize.js'
import { emailGateway } from '../email/gateway.js'
import { notifyEdgeFetchStateChanged } from '../email/edgeFetch/events.js'
import { generateEdgeKeypair } from './keygen.js'
import { requestSsoAttestation } from './attestation.js'
import {
  removeEncryptedEdgePrivateKey,
  storeEncryptedEdgePrivateKey,
} from './keyStorage.js'
import { removeWrappedAccountKey } from './accountKeyStorage.js'
import { removeWrappedQuarantineKey } from './quarantineKeyStorage.js'
import type { EdgeTierPodVault } from './podLifecycle.js'
import { replaceEdgeReplica, type EdgeReplica } from './settings.js'
import { SshClient } from './ssh/client.js'
import {
  buildNuclearResetRemoteCommands,
  deployEdgePod,
  type DeploySshClient,
} from './ssh/deploy.js'
import { deleteReplicaDiagnosticData } from './supervisor/reportStore.js'
import { notifyNuclearResetReauthorize } from './nuclearResetNotify.js'
import {
  connectReplicaActionSsh,
  findEdgeReplica,
  type ReplicaActionEvent,
  type ReplicaActionInput,
  type ReplicaActionSshRunner,
} from './replicaActions.js'

export const NUCLEAR_RESET_CONFIRM_TOKEN = 'RESET'

function readRemoteEdgeManifestTemplate(): string {
  const fromEnv = process.env['BEAP_REMOTE_EDGE_MANIFEST']
  if (fromEnv) return readFileSync(fromEnv, 'utf8')
  return readFileSync(
    join(process.cwd(), 'packages', 'beap-pod', 'pod-remote-edge.yaml'),
    'utf8',
  )
}

export interface NuclearResetInput extends ReplicaActionInput {
  readonly reason: string
  readonly hostConfirm: string
  readonly resetConfirm: string
}

export interface NuclearResetDeps {
  readonly vault: EdgeTierPodVault
  readonly ensureSession?: typeof ensureSession
  readonly requestAttestation?: typeof requestSsoAttestation
  readonly readManifestYaml?: () => string
  readonly createSshClient?: () => SshClient
}

export interface NuclearResetResult {
  readonly action: 'nuclear_reset'
  readonly oldReplicaId: string
  readonly newReplica: Pick<EdgeReplica, 'edge_pod_id' | 'edge_public_key' | 'host' | 'port'>
  readonly degradedAccountIds: string[]
}

function zeroizeNuclearResetInput(input: NuclearResetInput): void {
  zeroizeBuffer(input.sshKey)
  zeroizeBuffer(input.passphrase)
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

export function validateNuclearResetConfirmation(input: {
  host: string
  hostConfirm: string
  resetConfirm: string
  reason: string
}): void {
  if (input.hostConfirm.trim() !== input.host.trim()) {
    throw new Error('Host confirmation does not match')
  }
  if (input.resetConfirm.trim() !== NUCLEAR_RESET_CONFIRM_TOKEN) {
    throw new Error(`Type ${NUCLEAR_RESET_CONFIRM_TOKEN} to confirm nuclear reset`)
  }
  if (input.reason.trim().length < 3) {
    throw new Error('A reset reason is required')
  }
}

export function hashNuclearResetConfirmation(
  hostConfirm: string,
  resetConfirm: string,
  reason: string,
): string {
  return createHash('sha256')
    .update(`${hostConfirm.trim()}\n${resetConfirm.trim()}\n${reason.trim()}`)
    .digest('hex')
}

export function purgeReplicaDesktopState(replicaId: string): void {
  deleteReplicaDiagnosticData(replicaId)
  removeWrappedQuarantineKey(replicaId)
}

export async function markReplicaAccountsDegradedForNuclearReset(
  oldReplicaId: string,
  newReplicaId: string,
): Promise<string[]> {
  const degradedAccountIds: string[] = []
  for (const row of emailGateway.listAccountsSync()) {
    const meta = row.edgeFetch
    if (!meta) continue
    if (meta.replicaId.toLowerCase() !== oldReplicaId.toLowerCase()) continue
    if (meta.state === 'not_on_edge') continue

    removeWrappedAccountKey(row.id)
    await emailGateway.updateAccount(row.id, {
      edgeFetch: {
        replicaId: newReplicaId,
        state: 'degraded',
        remoteState: 'stopped',
        lastError: 'replica_reset',
        updatedAt: Date.now(),
      },
    })
    notifyNuclearResetReauthorize({
      accountId: row.id,
      email: row.email,
      replicaId: newReplicaId,
    })
    degradedAccountIds.push(row.id)
  }
  notifyEdgeFetchStateChanged()
  return degradedAccountIds
}

export async function runNuclearResetRemoteWipe(
  ssh: ReplicaActionSshRunner,
): Promise<{ ok: boolean; commands: string[] }> {
  const commands = buildNuclearResetRemoteCommands()
  for (const command of commands) {
    const result = await ssh.run(command)
    if (result.code !== 0) {
      return { ok: false, commands }
    }
  }
  return { ok: true, commands }
}

export async function* nuclearResetReplica(
  input: NuclearResetInput,
  deps: NuclearResetDeps,
): AsyncGenerator<ReplicaActionEvent> {
  try {
    const replica = findEdgeReplica(input.replicaId)
    validateNuclearResetConfirmation({
      host: replica.host,
      hostConfirm: input.hostConfirm,
      resetConfirm: input.resetConfirm,
      reason: input.reason,
    })

    const oldPodId = replica.edge_pod_id
    yield yieldStage('connect', `Connecting to ${replica.host}…`)

    const client = await connectReplicaActionSsh(replica, input, deps.createSshClient)
    let deployStarted = false

    try {
      yield yieldStage('remote_wipe', `Wiping pod state on ${replica.host}…`)
      const commands = buildNuclearResetRemoteCommands()
      for (const command of commands) {
        const result = await client.run(command)
        yield* emitRunOutput(result)
      }

      yield yieldStage('desktop_cleanup', 'Removing local diagnostic and quarantine copies…')
      purgeReplicaDesktopState(oldPodId)

      const keypair = generateEdgeKeypair()
      const ensure = deps.ensureSession ?? ensureSession
      const session = await ensure(false)
      const attestation = deps.requestAttestation ?? requestSsoAttestation
      const { jwt } = await attestation(keypair.publicKeyHex, keypair.podId, session.accessToken)

      storeEncryptedEdgePrivateKey(keypair.podId, keypair.privateKeyHex, deps.vault)

      const manifestYaml = (deps.readManifestYaml ?? readRemoteEdgeManifestTemplate)()
      const podAuthSecret = randomBytes(32).toString('hex')

      deployStarted = true
      yield yieldStage('deploy', `Deploying fresh REMOTE_EDGE pod on ${replica.host}…`)

      for await (const event of deployEdgePod({
        client: client as DeploySshClient,
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
          removeEncryptedEdgePrivateKey(keypair.podId)
          yield {
            kind: 'error',
            message: event.message,
            stage_name: event.stage_name,
          }
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

          yield yieldStage('accounts', 'Marking edge-fetched accounts as degraded…')
          const degradedAccountIds = await markReplicaAccountsDegradedForNuclearReset(
            oldPodId,
            nextReplica.edge_pod_id,
          )

          yield {
            kind: 'done',
            message: `Nuclear reset complete on ${replica.host}. ${degradedAccountIds.length} account(s) need re-authorization.`,
            stage_name: event.stage_name ?? 'cleanup',
            result: {
              action: 'nuclear_reset',
              oldReplicaId: oldPodId,
              newReplica: nextReplica,
              degradedAccountIds,
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
        for (const command of buildNuclearResetRemoteCommands()) {
          await client.run(command).catch(() => undefined)
        }
      }
      yield {
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
        stage_name: 'nuclear_reset',
      }
    } finally {
      await client.disconnect()
    }
  } finally {
    zeroizeNuclearResetInput(input)
  }
}
